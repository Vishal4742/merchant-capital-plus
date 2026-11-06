// Server-only payment links (SRS FR-GW-1, table app_gw_links), plus the checkout helpers links and pages share: a price
// in the link's currency becomes USDT at checkout (lib/server/quotes.ts), then a session (lib/sessions.ts) and a checkout row.
import { formatUnits, getAddress, type Address } from "viem";
import { createSession, type LineItem } from "../sessions.ts";
import { parseUsdt } from "../usdt.ts";
import { paidCounts, recordCheckout, type CheckoutKind } from "./checkouts.ts";
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
import { toUsdtUnits, usdRate, type Rate } from "./quotes.ts";

const MAX_PRICE = 100_000_000_000_000n; // 100,000,000 of any currency: a sanity cap; the 1..1,000 USDT rule runs at checkout
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

/** USDT units for prices in `currency` at the live rate, each rounded up: the merchant never gets less than its price. */
export async function inUsdt(prices: bigint[], currency: Currency): Promise<{ prices: bigint[]; rate: Rate }> {
  const rate = await usdRate(currency);
  return { prices: prices.map((price) => toUsdtUnits(formatUnits(price, 6), rate)), rate };
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

/** Opens a checkout session for line items priced in `currency`: converts them to USDT at one rate, records where the
 *  session came from and the rate (the checkout shows it, AT-13), and sends the payer there:
 *  303 to /checkout/{id}, or {checkout_url, session_id} for a caller that accepts JSON (the pay button). */
export async function openCheckout(
  request: Request,
  from: { kind: CheckoutKind; refId: string; merchant: string; reference: string },
  priced: LineItem[],
  currency: Currency,
): Promise<Response> {
  const { prices, rate } = await inUsdt(priced.map((item) => item.price), currency);
  const items = priced.map((item, i) => ({ ...item, price: prices[i] }));
  const amount = items.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n);
  if (amount < MIN_PAYMENT || amount > MAX_PAYMENT) throw new HttpError(400, "The total must be between 1 and 1,000 USDT.");
  const merchant = getAddress(from.merchant);
  const session = createSession({ merchant, merchantName: merchantName(merchant), amount, reference: from.reference, items });
  const fiatTotal = priced.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n);
  const fx = { currency, amount: fiatTotal, rate: rate.rate, rateAt: rate.rateAt, source: rate.source, fetchedAt: rate.fetchedAt };
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
}

type LinkRow = { id: string; slug: string; merchant: string; amount: string | null; currency: Currency; description: string; reference_id: string | null; single_use: boolean; expires_at: string | null; cancelled_at: string | null; created_at: string };
const COLUMNS = "id, slug, merchant, amount::text, currency, description, reference_id, single_use, expires_at::text, cancelled_at::text, created_at::text";
const num = (text: string | null) => (text === null ? null : Number(text));

async function withPayments(rows: LinkRow[]): Promise<Link[]> {
  const paid = await paidCounts("link", rows.map((r) => r.id));
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
    payments: paid.get(r.id) ?? 0,
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

/** What a payer sees: render info only, nothing merchant-private. */
export const publicLinkJson = (link: Link) => ({
  slug: link.slug,
  merchant_name: merchantName(getAddress(link.merchant)),
  amount: decimal(link.amount),
  currency: link.currency,
  description: link.description,
  status: linkStatus(link),
});

export async function createLink(merchant: Address, body: Record<string, unknown>, now = Date.now()): Promise<Link> {
  const currency = currencyField(body.currency);
  const usd = currency === "USD" || currency === "USDT";
  const amount = !given(body.amount) ? null : usd ? usdtField(body.amount) : priceField(body.amount, "amount");
  const description = textField(body.description, "description");
  const referenceId = textField(body.reference_id, "reference_id", { max: 40, required: false }) || null;
  const expiresAt = given(body.expires_at) ? futureTime(body.expires_at, "expires_at", now) : null;
  if (given(body.single_use) && typeof body.single_use !== "boolean") throw new HttpError(400, "single_use must be true or false.");
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

export async function linkBySlug(slug: string): Promise<Link | null> {
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
