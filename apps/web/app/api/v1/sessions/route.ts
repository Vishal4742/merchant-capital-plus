// POST /api/v1/sessions: a shop creates a checkout with its secret key and gets a hosted pay URL (FR-PAY-4).
// v2 (batch 006): `currency` (a price in USD, EUR, GBP, INR, AED or SGD becomes USDT at a quote locked for the checkout,
// FR-GW-11), `returnUrl` for the checkout's "Back to <shop>" link, plain amounts, and `Idempotency-Key` (ARCHITECTURE §4b).
import { createHash } from "node:crypto";
import { merchantConfig, shopAuthorized, type MerchantConfig } from "../../../../lib/config.ts";
import { CURRENCIES, FxUnavailableError, QUOTE_LOCK_MS, quote, type Currency } from "../../../../lib/fx.ts";
import { BAD_RETURN_URL, SESSION_TTL_MS, createSession, currencyFields, webUrl, type LineItem } from "../../../../lib/sessions.ts";
import { formatUsdt, parseUsdt, plainUsdt } from "../../../../lib/usdt.ts";

const MIN_UNITS = 1_000_000n; // 1 USDT minimum payment (FR-REL-4)
const MAX_UNITS = 10_000_000_000n; // 10,000 USDT: a demo ceiling, well above every demo amount
const MAX_ITEMS = 20;
const MAX_REFERENCE = 40;
const MAX_IDEMPOTENCY_KEY = 255;
const IDEMPOTENCY_MS = 24 * 60 * 60 * 1000;
const MAX_IDEMPOTENCY_KEYS = 1_000; // the oldest goes first (security review 006 F6)

type Reply = { status: number; body: unknown };
const fail = (status: number, error: string): Reply => ({ status, body: { error } });
const send = ({ status, body }: Reply) => Response.json(body, { status });

// ponytail: kept in this process (lost on restart, not shared between instances) until sessions move to Neon
const replies = new Map<string, { hash: string; at: number; reply: Promise<Reply> }>();

export async function POST(request: Request) {
  const config = merchantConfig();
  if (!config) return send(fail(503, "Checkout isn't set up on this server."));
  if (!shopAuthorized(request, config.apiKey)) return send(fail(401, "Missing or wrong API key."));
  const text = await request.text();
  const key = request.headers.get("idempotency-key");
  if (key === null) return send(await create(text, request.url, config));
  if (!key || key.length > MAX_IDEMPOTENCY_KEY) return send(fail(400, `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY} characters.`));

  // the same key within 24 h gets the first checkout back; the reply is stored before the await, so two requests at
  // the same moment still create one
  const now = Date.now(), hash = createHash("sha256").update(text).digest("hex"), slot = `${config.merchant}:${key}`;
  for (const [k, kept] of replies) if (now - kept.at > IDEMPOTENCY_MS) replies.delete(k);
  const prior = replies.get(slot);
  if (prior) return send(prior.hash === hash ? await prior.reply : fail(422, "This Idempotency-Key was already used for a different request."));
  // a Map keeps insertion order, so its first key is the oldest
  if (replies.size >= MAX_IDEMPOTENCY_KEYS) replies.delete(replies.keys().next().value!);
  const reply = create(text, request.url, config);
  replies.set(slot, { hash, at: now, reply });
  let done: Reply | undefined;
  try {
    done = await reply;
    return send(done);
  } finally {
    // only a created checkout is replayed: a refused or failed one frees the key for a corrected retry
    if (done?.status !== 201) replies.delete(slot);
  }
}

const isCurrency = (value: unknown): value is Currency => typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);

async function create(text: string, pageUrl: string, config: MerchantConfig): Promise<Reply> {
  let body: { amount?: unknown; currency?: unknown; reference?: unknown; items?: unknown; returnUrl?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!body || typeof body !== "object" || typeof body.amount !== "string") return fail(400, 'Send JSON like {"amount": "25.00"}.');
  const currency = body.currency === undefined ? "USDT" : body.currency;
  if (!isCurrency(currency)) return fail(400, `currency must be one of ${CURRENCIES.join(", ")}.`);
  let asked: bigint;
  try {
    asked = parseUsdt(body.amount);
  } catch {
    return fail(400, "amount must look like 25.00 (up to 6 decimals).");
  }
  if (body.reference !== undefined && typeof body.reference !== "string") return fail(400, "reference must be text.");
  const reference = (body.reference ?? "").trim();
  if (reference.length > MAX_REFERENCE) return fail(400, `reference must be at most ${MAX_REFERENCE} characters.`);
  const returnUrl = body.returnUrl === undefined ? undefined : webUrl(body.returnUrl);
  if (returnUrl === null) return fail(400, BAD_RETURN_URL);

  // item prices are in the checkout's currency, and must add up to the amount in it
  const items: LineItem[] = [];
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) return fail(400, `items must be a list of at most ${MAX_ITEMS}.`);
    for (const raw of body.items as { name?: unknown; qty?: unknown; price?: unknown }[]) {
      const qty = Number(raw?.qty);
      if (typeof raw?.name !== "string" || !raw.name.trim() || !Number.isInteger(qty) || qty < 1 || qty > 999 || typeof raw.price !== "string") {
        return fail(400, 'Each item needs {"name", "qty" (1-999), "price" like "10.00"}.');
      }
      try {
        items.push({ name: raw.name.trim().slice(0, 80), qty, price: parseUsdt(raw.price) });
      } catch {
        return fail(400, `Item "${raw.name.trim().slice(0, 40)}" has a bad price.`);
      }
    }
    const total = items.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n);
    if (items.length && total !== asked) return fail(400, `Items add up to ${formatUsdt(total)} ${currency}, but amount is ${formatUsdt(asked)} ${currency}.`);
  }

  let fx: Awaited<ReturnType<typeof quote>>;
  try {
    fx = await quote(currency, body.amount);
  } catch (error) {
    if (error instanceof FxUnavailableError) return fail(503, error.message); // nothing is created without a rate
    throw error;
  }
  if (fx.usdt < MIN_UNITS || fx.usdt > MAX_UNITS) {
    const converted = currency === "USDT" ? "" : ` (${formatUsdt(asked)} ${currency} is ${formatUsdt(fx.usdt)} USDT)`;
    return fail(400, `amount must be between 1.00 and 10,000.00 USDT${converted}.`);
  }

  const session = createSession(
    {
      merchant: config.merchant,
      merchantName: config.merchantName,
      amount: fx.usdt,
      reference,
      items,
      priced: currency === "USDT" ? undefined : { currency, amount: asked, rate: fx.rate, rateDate: fx.rateDate, fetchedAt: fx.fetchedAt, source: fx.source },
      returnUrl,
    },
    Date.now(),
    // a quoted rate holds for 10 minutes, and the checkout ends with it; USD (1:1) and USDT keep 30
    currency === "USDT" || currency === "USD" ? SESSION_TTL_MS : QUOTE_LOCK_MS,
  );
  const url = new URL(`/checkout/${session.id}`, pageUrl).toString();
  return { status: 201, body: { id: session.id, url, amount: plainUsdt(session.amount), ...currencyFields(session), expiresAt: new Date(session.expiresAt).toISOString() } };
}
