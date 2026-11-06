// POST /api/v1/sessions: a shop creates a checkout with its secret key and gets a hosted pay URL (FR-PAY-4).
// v2 (batch 006): `currency` (a price in USD, EUR, GBP, INR, AED or SGD becomes USDT at a quote locked for the checkout,
// FR-GW-11), `returnUrl` for the checkout's "Back to <shop>" link, plain amounts, and `Idempotency-Key` (ARCHITECTURE §4b).
// Batch 011: a merchant's own secret key (sk_test_…) works too, and the checkout is that merchant's (FR-GW-6).
// Batch 015: prices go through lib/server/quotes.ts, the app's one FX source (human 05:4x; ±15% bands, 7-day date,
// rounded up to the cent), the same rate links and pages use (FR-GW-11, AT-13).
import { createHash } from "node:crypto";
import { formatUnits } from "viem";
import { BAD_RETURN_URL, SESSION_TTL_MS, createSession, currencyFields, webUrl, type LineItem, type Priced } from "../../../../lib/sessions.ts";
import { CURRENCIES, HttpError, MAX_PAYMENT, MIN_PAYMENT, rateLimit, type Currency } from "../../../../lib/server/http.ts";
import { QUOTE_TTL_MS, toUsdtUnits, usdRate } from "../../../../lib/server/quotes.ts";
import { shopCaller, type Shop } from "../../../../lib/shop-auth.ts";
import { formatUsdt, parseUsdt, plainUsdt } from "../../../../lib/usdt.ts";

const MAX_ITEMS = 20;
const SESSIONS_PER_MINUTE = 60;
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
  const shop = await shopCaller(request);
  if ("error" in shop) return send(fail(shop.status, shop.error));
  // per merchant: any signed-in wallet can mint a key, so one key can't flood the checkout store (security 012 F3)
  try {
    rateLimit(`sessions:${shop.merchant.toLowerCase()}`, SESSIONS_PER_MINUTE, 60_000);
  } catch {
    return send(fail(429, "Too many checkouts at once. Wait a minute and try again."));
  }
  const text = await request.text();
  const key = request.headers.get("idempotency-key");
  if (key === null) return send(await create(text, request.url, shop));
  if (!key || key.length > MAX_IDEMPOTENCY_KEY) return send(fail(400, `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY} characters.`));

  // the same key within 24 h gets the first checkout back; the reply is stored before the await, so two requests at
  // the same moment still create one. One slot per merchant: another merchant's key never replays this checkout.
  const now = Date.now(), hash = createHash("sha256").update(text).digest("hex"), slot = `${shop.merchant.toLowerCase()}:${key}`;
  for (const [k, kept] of replies) if (now - kept.at > IDEMPOTENCY_MS) replies.delete(k);
  const prior = replies.get(slot);
  if (prior) return send(prior.hash === hash ? await prior.reply : fail(422, "This Idempotency-Key was already used for a different request."));
  // a Map keeps insertion order, so its first key is the oldest
  if (replies.size >= MAX_IDEMPOTENCY_KEYS) replies.delete(replies.keys().next().value!);
  const reply = create(text, request.url, shop);
  replies.set(slot, { hash, at: now, reply });
  let done: Reply | undefined;
  try {
    done = await reply;
    return send(done);
  } finally {
    // only a created checkout is replayed: a refused or failed one frees the key for a corrected retry
    // only its own entry: a newer request may hold this slot if this one was evicted (code review 006 R2-4)
    if (done?.status !== 201 && replies.get(slot)?.reply === reply) replies.delete(slot);
  }
}

const isCurrency = (value: unknown): value is Currency => typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);

async function create(text: string, pageUrl: string, shop: Shop): Promise<Reply> {
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

  // USDT is charged exactly; any other currency at quotes.ts's rate (USD 1:1), up to the cent
  let usdt = asked;
  let priced: Priced | undefined;
  if (currency !== "USDT") {
    try {
      const rate = await usdRate(currency);
      usdt = toUsdtUnits(formatUnits(asked, 6), rate);
      priced = { currency, amount: asked, rate: rate.rate, rateDate: rate.rateAt, fetchedAt: rate.fetchedAt, source: rate.source };
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message); // 503 without a usable rate: nothing is created
      throw error;
    }
  }
  if (usdt < MIN_PAYMENT || usdt > MAX_PAYMENT) {
    const converted = currency === "USDT" ? "" : ` (${formatUsdt(asked)} ${currency} is ${formatUsdt(usdt)} USDT)`;
    return fail(400, `amount must be between 1.00 and 1,000.00 USDT${converted}.`); // §4b: 1,000 per payment on testnet
  }

  const session = createSession(
    {
      merchant: shop.merchant,
      merchantName: shop.merchantName,
      amount: usdt,
      reference,
      items,
      priced,
      returnUrl,
    },
    Date.now(),
    // a quoted rate holds for 10 minutes, and the checkout ends with it; USD (1:1) and USDT keep 30
    currency === "USDT" || currency === "USD" ? SESSION_TTL_MS : QUOTE_TTL_MS,
  );
  const url = new URL(`/checkout/${session.id}`, pageUrl).toString();
  return { status: 201, body: { id: session.id, url, amount: plainUsdt(session.amount), ...currencyFields(session), expiresAt: new Date(session.expiresAt).toISOString() } };
}
