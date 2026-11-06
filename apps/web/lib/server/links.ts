// Server-only payment links (SRS FR-GW-1, table app_gw_links), plus the checkout helpers links and pages share: a price
// in the link's currency becomes USDT at checkout (lib/server/quotes.ts), then a session (lib/sessions.ts) and a checkout row.
import { formatUnits, getAddress, type Address } from "viem";
import { SESSION_TTL_MS, createSession, type LineItem } from "../sessions.ts";
import { parseUsdt } from "../usdt.ts";
import { recordCheckout, type CheckoutKind } from "./checkouts.ts";
import { query } from "./db.ts";
import {
  HttpError,
  MAX_PAYMENT,
  MIN_PAYMENT,
  clientIp,
  currencyField,
  futureTime,
  merchantName,
  newId,
  newSlug,
  ok,
  rateLimit,
  readJson,
  textField,
  usdtField,
  type Currency,
} from "./http.ts";
import { QUOTE_TTL_MS, toUsdtUnits, usdRate } from "./quotes.ts";
import { dispatchSoon } from "./webhooks.ts";

const MAX_PRICE = 100_000_000_000_000n; // 100,000,000 of any currency: a sanity cap; the 1..1,000 USDT rule runs at creation and checkout
export const MAX_LIST = 200; // ponytail: list screens show the newest 200; add a cursor when a merchant has more
const CHECKOUTS_PER_MINUTE = 20;
const MAX_FORM_BYTES = 16_384;

export const given = (value: unknown) => value !== undefined && value !== null;
export const decimal = (units: bigint | null) => (units === null ? null : formatUnits(units, 6));
export const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** A price in the link or page's own currency: a decimal string above 0 with at most 6 decimals, as 6-decimal units. */
export function priceField(value: unknown, name: string): bigint {
  let units = 0n;
  try {
    if (typeof value === "string") units = parseUsdt(value);
  } catch {
    // not a decimal: the 400 below
  }
  if (units <= 0n || units > MAX_PRICE) throw new HttpError(400, `${name} must be a decimal string like "25.00" (above 0, at most 6 decimals).`);
  return units;
}

/** Refuses stored prices that could never be paid (FR-GW-1/2): at today's rate, one above 1,000 USDT, or under 1 USDT
 *  when `atLeastOne` (a fixed link's whole price). No prices: no rate needed. Best effort: during an FX outage the
 *  check is skipped, since creating a link moves no money and the checkout re-checks the bounds at its own rate. */
export async function payablePrices(prices: bigint[], currency: Currency, atLeastOne = false): Promise<void> {
  if (prices.length === 0) return;
  let rate;
  try {
    rate = await usdRate(currency);
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) return; // FX down: don't block a merchant creating EUR links
    throw err;
  }
  for (const price of prices) {
    const usdt = toUsdtUnits(formatUnits(price, 6), rate);
    if (usdt > MAX_PAYMENT || (atLeastOne && usdt < MIN_PAYMENT)) throw new HttpError(400, "That price is outside 1 to 1,000 USDT at today's rate.");
  }
}

/** Public checkouts: at most 20 a minute per IP (links and pages together). */
export const limitCheckouts = (request: Request) => rateLimit(`checkout:${clientIp(request)}`, CHECKOUTS_PER_MINUTE, 60_000);

/** A public checkout's body: a JSON object, or an HTML form (application/x-www-form-urlencoded). */
export async function readCheckoutBody(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) return readJson(request);
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) throw new HttpError(413, "That request is too large.");
  return Object.fromEntries(new URLSearchParams(text));
}

/** Opens a checkout session for line items priced in `currency`: converts their total to USDT once at the live rate
 *  (rounded up to the cent, so it equals a quote for that total; USD and USDT exactly: H1, FR-GW-11), records where the
 *  session came from and the rate (the checkout shows it, AT-13), and sends the payer there:
 *  303 to /checkout/{id}, or {checkout_url, session_id} for a caller that accepts JSON (the pay button).
 *  The items keep their prices in `currency`; a non-USDT session carries `priced` (the checkout labels them with it); a
 *  fiat one lives only as long as the 10-min quote lock, USD (1:1) and USDT keep the 30-min session (FR-GW-11, AT-13). */
export async function openCheckout(
  request: Request,
  from: { kind: CheckoutKind; refId: string; merchant: string; reference: string },
  priced: LineItem[],
  currency: Currency,
): Promise<Response> {
  const rate = await usdRate(currency);
  const total = priced.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n); // in `currency`
  const amount = toUsdtUnits(formatUnits(total, 6), rate);
  if (amount < MIN_PAYMENT || amount > MAX_PAYMENT) throw new HttpError(400, "The total must be between 1 and 1,000 USDT.");
  const merchant = getAddress(from.merchant);
  const fx = { currency, amount: total, rate: rate.rate, rateAt: rate.rateAt, source: rate.source, fetchedAt: rate.fetchedAt };
  const usdt = currency === "USDT";
  const session = await createSession(
    {
      merchant,
      merchantName: merchantName(merchant),
      amount,
      reference: from.reference,
      items: priced,
      priced: usdt ? undefined : { currency, amount: total, rate: rate.rate, rateDate: rate.rateAt, fetchedAt: rate.fetchedAt, source: rate.source },
    },
    Date.now(),
    usdt || currency === "USD" ? SESSION_TTL_MS : QUOTE_TTL_MS,
  );
  await recordCheckout(session.id, from.kind, from.refId, merchant, amount, { fx });
  const url = new URL(`/checkout/${session.id}`, request.url).toString();
  if ((request.headers.get("accept") ?? "").includes("application/json")) return ok({ checkout_url: url, session_id: session.id });
  return new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store" } });
}

export type LinkStatus = "active" | "paid" | "expired" | "cancelled";
export interface Link {
  id: string;
  slug: string;
  merchant: string; // lowercase address
  amount: bigint | null; // in `currency`, 6 decimals; null = the payer enters it
  currency: Currency;
  description: string;
  referenceId: string | null;
  singleUse: boolean;
  expiresAt: number | null;
  cancelledAt: number | null;
  createdAt: number;
  payments: number; // paid checkouts
  paidAt: number | null; // the first paid checkout's time
}

type LinkRow = { id: string; slug: string; merchant: string; amount: string | null; currency: Currency; description: string; reference_id: string | null; single_use: boolean; expires_at: string | null; cancelled_at: string | null; created_at: string };
const COLUMNS = "id, slug, merchant, amount::text, currency, description, reference_id, single_use, expires_at::text, cancelled_at::text, created_at::text";
const num = (text: string | null) => (text === null ? null : Number(text));

/** Each link with its paid checkouts: how many, and when the first was paid (the public view's paid_at). */
async function withPayments(rows: LinkRow[]): Promise<Link[]> {
  if (rows.length === 0) return [];
  const counted = await query<{ ref_id: string; n: string; first: string }>(
    "SELECT ref_id, count(*)::text AS n, min(paid_at)::text AS first FROM app_gw_checkouts WHERE kind = 'link' AND ref_id = ANY($1) AND paid_at IS NOT NULL GROUP BY ref_id",
    [rows.map((r) => r.id)],
  );
  const paid = new Map(counted.map((c) => [c.ref_id, c]));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    merchant: r.merchant,
    amount: r.amount === null ? null : BigInt(r.amount),
    currency: r.currency,
    description: r.description,
    referenceId: r.reference_id,
    singleUse: r.single_use,
    expiresAt: num(r.expires_at),
    cancelledAt: num(r.cancelled_at),
    createdAt: Number(r.created_at),
    payments: Number(paid.get(r.id)?.n ?? 0),
    paidAt: num(paid.get(r.id)?.first ?? null),
  }));
}

/** cancelled > paid (a single-use link with a paid checkout) > expired > active. */
export function linkStatus(link: Link, now = Date.now()): LinkStatus {
  if (link.cancelledAt !== null) return "cancelled";
  if (link.singleUse && link.payments > 0) return "paid";
  if (link.expiresAt !== null && link.expiresAt <= now) return "expired";
  return "active";
}

/** The dashboard's view of a link. */
export const linkJson = (link: Link) => ({
  id: link.id,
  slug: link.slug,
  url: `/l/${link.slug}`,
  amount: decimal(link.amount),
  currency: link.currency,
  description: link.description,
  reference_id: link.referenceId,
  single_use: link.singleUse,
  status: linkStatus(link),
  expires_at: iso(link.expiresAt),
  created_at: iso(link.createdAt),
  payments: link.payments,
});

/** What a payer sees: render info only, nothing merchant-private. `paid_at` only once the link is "paid". */
export const publicLinkJson = (link: Link) => {
  const status = linkStatus(link);
  return {
    slug: link.slug,
    merchant_name: merchantName(getAddress(link.merchant)),
    amount: decimal(link.amount),
    currency: link.currency,
    description: link.description,
    status,
    paid_at: status === "paid" ? iso(link.paidAt) : null,
  };
};

export async function createLink(merchant: Address, body: Record<string, unknown>, now = Date.now()): Promise<Link> {
  const currency = currencyField(body.currency);
  const usd = currency === "USD" || currency === "USDT";
  const amount = !given(body.amount) ? null : usd ? usdtField(body.amount) : priceField(body.amount, "amount");
  const description = textField(body.description, "description");
  const referenceId = textField(body.reference_id, "reference_id", { max: 40, required: false }) || null;
  const expiresAt = given(body.expires_at) ? futureTime(body.expires_at, "expires_at", now) : null;
  if (given(body.single_use) && typeof body.single_use !== "boolean") throw new HttpError(400, "single_use must be true or false.");
  if (amount !== null && !usd) await payablePrices([amount], currency, true); // USD and USDT: usdtField checked 1..1,000
  const rows = await query<LinkRow>(
    `INSERT INTO app_gw_links (id, slug, merchant, amount, currency, description, reference_id, single_use, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (merchant, reference_id) DO NOTHING RETURNING ${COLUMNS}`,
    [newId("lnk"), newSlug(), merchant.toLowerCase(), amount?.toString() ?? null, currency, description, referenceId, body.single_use === true, expiresAt, now],
  );
  if (rows.length === 0) throw new HttpError(409, "You already have a link with that reference_id.");
  return (await withPayments(rows))[0];
}

export async function listLinks(merchant: Address): Promise<Link[]> {
  const rows = await query<LinkRow>(`SELECT ${COLUMNS} FROM app_gw_links WHERE merchant = $1 ORDER BY created_at DESC, id LIMIT ${MAX_LIST}`, [merchant.toLowerCase()]);
  return withPayments(rows);
}

/** True if the merchant has this link (cancelling twice keeps the first time). */
export async function cancelLink(merchant: Address, id: string, now = Date.now()): Promise<boolean> {
  const rows = await query("UPDATE app_gw_links SET cancelled_at = COALESCE(cancelled_at, $3) WHERE id = $1 AND merchant = $2 RETURNING id", [id, merchant.toLowerCase(), now]);
  return rows.length === 1;
}

export const MAX_LINK_PAYMENTS = 50; // ponytail: the newest 50 paid checkouts of a reusable link; add a cursor if needed

/** One of the merchant's links, or null (another merchant's id is the same null: the route answers 404). */
export async function linkById(merchant: Address, id: string): Promise<Link | null> {
  const rows = await query<LinkRow>(`SELECT ${COLUMNS} FROM app_gw_links WHERE id = $1 AND merchant = $2`, [id, merchant.toLowerCase()]);
  return rows.length ? (await withPayments(rows))[0] : null;
}

/** A link's paid checkouts, newest first (batch 052): the server's own record of each payment (app_web_sessions.payment,
 *  written by the pay route once the relayer's receipt, or the chain after an unknown outcome, confirmed it), never a
 *  redirect or a client's word. `amount` is what was paid in USDT, after any discount code. */
export async function linkPayments(link: Link): Promise<{ session_id: string; payment_id: string | null; amount: string; currency: "USDT"; tx_hash: string | null; paid_at: string | null }[]> {
  const rows = await query<{ session_id: string; paid_at: string; payment: { txHash?: string | null; paymentId?: string | null; amount?: string } | null; usdt_amount: string }>(
    `SELECT c.session_id, c.paid_at::text, c.usdt_amount::text, s.payment FROM app_gw_checkouts c LEFT JOIN app_web_sessions s ON s.id = c.session_id
     WHERE c.kind = 'link' AND c.ref_id = $1 AND c.merchant = $2 AND c.paid_at IS NOT NULL ORDER BY c.paid_at DESC, c.session_id LIMIT ${MAX_LINK_PAYMENTS}`,
    [link.id, link.merchant],
  );
  return rows.map((r) => ({
    session_id: r.session_id,
    payment_id: r.payment?.paymentId ?? null,
    amount: decimal(BigInt(r.payment?.amount ?? r.usdt_amount))!,
    currency: "USDT",
    tx_hash: r.payment?.txHash ?? null,
    paid_at: iso(Number(r.paid_at)),
  }));
}

export async function linkBySlug(slug: string): Promise<Link | null> {
  dispatchSoon(); // a customer opening a checkout: the steadiest traffic there is, so due webhook retries ride on it
  const rows = await query<LinkRow>(`SELECT ${COLUMNS} FROM app_gw_links WHERE slug = $1`, [slug]);
  return rows.length ? (await withPayments(rows))[0] : null;
}

/** A payer opens a checkout from a link. A fixed link's stored price always wins; only an open link reads `amount`. */
export async function payLink(request: Request, slug: string): Promise<Response> {
  limitCheckouts(request);
  const link = await linkBySlug(slug);
  if (!link) throw new HttpError(404, "No such payment link.");
  const status = linkStatus(link);
  if (status !== "active") throw new HttpError(410, `This payment link is ${status}.`);
  const price = link.amount ?? priceField((await readCheckoutBody(request)).amount, "amount");
  const from = { kind: "link" as const, refId: link.id, merchant: link.merchant, reference: link.referenceId ?? link.slug };
  return openCheckout(request, from, [{ name: link.description.slice(0, 80), qty: 1, price }], link.currency);
}
