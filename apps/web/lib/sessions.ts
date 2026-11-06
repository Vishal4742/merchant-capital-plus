// Server-only checkout sessions (FR-PAY-4). The chain is the truth for money; this only remembers what
// a shop asked to be paid and which payment settled it, so the pay page needs no browser chain reads.
import { randomBytes, randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { query } from "./server/db.ts";
import type { Currency } from "./server/http.ts";
import { plainUsdt } from "./usdt.ts";

export const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_RETURN_URL = 200;
export const BAD_RETURN_URL = `returnUrl must be an http or https URL of at most ${MAX_RETURN_URL} characters.`;

/** The URL as the browser will read it (WHATWG-parsed href), if it is http or https and at most 200 characters; else
 *  null. Storing the href, not the raw text, means what we checked is what the "Back to <shop>" link opens (security
 *  review 006 F4). */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || !URL.canParse(value)) return null;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= MAX_RETURN_URL ? url.href : null;
}

export interface LineItem {
  name: string;
  qty: number;
  price: bigint; // 6-decimal units of the session's currency: USDT, or `priced.currency`
}

/** A checkout the shop priced in another currency (FR-GW-11): the quote it was converted at, locked at creation. */
export interface Priced {
  currency: Exclude<Currency, "USDT">;
  amount: bigint; // what the shop asked, in 6-decimal units of `currency`
  rate: string; // units of `currency` per 1 USD
  rateDate: string; // YYYY-MM-DD
  fetchedAt: number;
  source: string;
}

export interface Payment {
  txHash: Hex | null; // null when the payment was found on chain after an unknown outcome (lib/settle.ts)
  blockNumber: string | null;
  paymentId: string | null; // MerchantPay's Paid event id (relayer 200)
  from: Address;
  paidAt: number;
  /** USDT units paid: the attempt's charged price (a discount code can make it less than the session's amount). */
  amount: bigint;
}

export interface Session {
  id: string;
  merchant: Address;
  merchantName: string;
  amount: bigint; // USDT units, 6 decimals
  orderRef: Hex; // bytes32 bound into the signed nonce
  reference: string; // the shop's own order label, e.g. "A-1042"
  items: LineItem[];
  /** Absent for a checkout priced in USDT. */
  priced?: Priced;
  /** http(s) only (checked when the shop creates it): the checkout's "Back to <shop>" link. */
  returnUrl?: string;
  createdAt: number;
  expiresAt: number;
  payment?: Payment;
  /** An attempt whose outcome is unknown (timeout, dropped connection, 5xx, an unconfirmed 200): the chain decides it.
   *  `amount` is the price a link or page attempt claimed and signed (security 009 F3): the chain is read for exactly
   *  that; absent for a shop's own session, whose price is `amount` above. */
  pending?: { from: Address; validBefore: bigint; amount?: bigint };
}

// Stored in Postgres (db/050_web_sessions.sql), never in this process: on Vercel the checkout page and the API run on
// different instances, so every read and every lock goes to the database (batch 023).
const COLUMNS =
  "id, merchant, merchant_name, amount::text, order_ref, reference, items::text, priced::text, return_url, created_at::text, expires_at::text, payment::text, pending::text";
type SessionRow = Record<"id" | "merchant" | "merchant_name" | "amount" | "order_ref" | "reference" | "items" | "created_at" | "expires_at", string> &
  Record<"priced" | "return_url" | "payment" | "pending", string | null>;

/** JSON with every bigint as its decimal string: exact, never a float. */
const json = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

function sessionOf(r: SessionRow): Session {
  const items = (JSON.parse(r.items) as (Omit<LineItem, "price"> & { price: string })[]).map((i) => ({ ...i, price: BigInt(i.price) }));
  const priced = r.priced === null ? undefined : (JSON.parse(r.priced) as Omit<Priced, "amount"> & { amount: string });
  const payment = r.payment === null ? undefined : (JSON.parse(r.payment) as Omit<Payment, "amount"> & { amount: string });
  const pending = r.pending === null ? undefined : (JSON.parse(r.pending) as { from: Address; validBefore: string; amount?: string });
  return {
    id: r.id,
    merchant: r.merchant as Address,
    merchantName: r.merchant_name,
    amount: BigInt(r.amount),
    orderRef: r.order_ref as Hex,
    reference: r.reference,
    items,
    ...(priced && { priced: { ...priced, amount: BigInt(priced.amount) } }),
    ...(r.return_url !== null && { returnUrl: r.return_url }),
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    ...(payment && { payment: { ...payment, amount: BigInt(payment.amount) } }),
    ...(pending && { pending: { from: pending.from, validBefore: BigInt(pending.validBefore), ...(pending.amount !== undefined && { amount: BigInt(pending.amount) }) } }),
  };
}

/** Every way in (the sessions API, links and pages) passes here, so the returnUrl rule lives here too. Throws on a bad
 *  returnUrl; the API checks first and answers 400. */
export async function createSession(input: Omit<Session, "id" | "orderRef" | "createdAt" | "expiresAt" | "payment" | "pending">, now = Date.now(), ttlMs = SESSION_TTL_MS): Promise<Session> {
  const returnUrl = input.returnUrl === undefined ? undefined : webUrl(input.returnUrl);
  if (returnUrl === null) throw new Error(BAD_RETURN_URL);
  const session: Session = {
    ...input,
    returnUrl,
    id: randomUUID(),
    orderRef: `0x${randomBytes(32).toString("hex")}`,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  await query(
    `INSERT INTO app_web_sessions (id, merchant, merchant_name, amount, order_ref, reference, items, priced, return_url, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
    [session.id, session.merchant, session.merchantName, session.amount.toString(), session.orderRef, session.reference, json(session.items), session.priced ? json(session.priced) : null, returnUrl ?? null, now, session.expiresAt],
  );
  return session;
}

export async function getSession(id: string): Promise<Session | undefined> {
  const [row] = await query<SessionRow>(`SELECT ${COLUMNS} FROM app_web_sessions WHERE id = $1`, [id]);
  return row && sessionOf(row);
}

/** A checkout's currency in API replies (FR-GW-11): the currency the shop asked for, and `priced` for any but USDT. */
export function currencyFields(session: Session) {
  const p = session.priced;
  if (!p) return { currency: "USDT" as const };
  return { currency: p.currency, priced: { currency: p.currency, amount: plainUsdt(p.amount), rate: p.rate, rateAt: p.rateDate, source: p.source } };
}

/** Paid checkouts for one merchant, newest first (the dashboard's payments table).
 *  ponytail: every paid checkout of the merchant, unpaged, as before; page it when a merchant has thousands. */
export async function listPayments(merchant: string): Promise<{ session: Session; payment: Payment }[]> {
  const rows = await query<SessionRow>(
    `SELECT ${COLUMNS} FROM app_web_sessions WHERE lower(merchant) = lower($1) AND payment IS NOT NULL ORDER BY (payment->>'paidAt')::bigint DESC`,
    [merchant],
  );
  return rows.map(sessionOf).map((session) => ({ session, payment: session.payment! }));
}

// One payment in flight per checkout (key: the session id) or invoice (key: "invoice:<id>"): without this, two quick
// requests with different salts could both settle and charge the customer twice. A row in app_web_locks, so it holds
// across instances. LOCK_S outlasts any route: Vercel stops a function at 300 s by default (fluid compute, every plan),
// so a live attempt's lock never lapses under it, and one left by a crashed instance frees itself after LOCK_S.
// The lock's expiry is its owner token: a release deletes only its own row, so an attempt that outlived a lapsed lock
// can't free the lock a later attempt took (security review 026 F1). Raise LOCK_S with maxDuration if it ever exceeds 300 s.
const LOCK_S = 300;

/** The in-flight key of an invoice, shared by its pay route and its page. */
export const invoiceLock = (id: string) => `invoice:${id}`;

/** This caller's lock token if it may relay a payment for this checkout or invoice now; null if one is already in
 *  flight. One statement, so two instances racing for a free or lapsed lock: exactly one gets a row back. */
export async function claimPayment(key: string): Promise<string | null> {
  const rows = await query<{ token: string }>(
    `INSERT INTO app_web_locks (key, until) VALUES ($1, now() + interval '${LOCK_S} seconds')
     ON CONFLICT (key) DO UPDATE SET until = EXCLUDED.until WHERE app_web_locks.until < now()
     RETURNING until::text AS token`,
    [key],
  );
  return rows[0]?.token ?? null;
}

/** Called in a `finally`: a failed delete is logged, never thrown over the route's answer, and the lock lapses on its own. */
export async function releasePayment(key: string, token: string): Promise<void> {
  await query("DELETE FROM app_web_locks WHERE key = $1 AND until = $2::timestamptz", [key, token]).catch((error: unknown) =>
    console.error(`lock ${key}: not released (it lapses in ${LOCK_S} s): ${error instanceof Error ? error.name : "error"}`),
  );
}

export async function isInFlight(key: string): Promise<boolean> {
  return (await query("SELECT 1 FROM app_web_locks WHERE key = $1 AND until > now()", [key])).length === 1;
}

const pendingJson = (pending: NonNullable<Session["pending"]>) => json({ from: pending.from, validBefore: pending.validBefore, ...(pending.amount !== undefined && { amount: pending.amount }) });

async function changed(id: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0 && !(await getSession(id))) throw new Error("No such checkout");
}

/** First write wins: a later record (e.g. a reconcile without a txHash) never replaces a relayed payment. Returns the
 *  checkout as stored, so its payment is the first one. */
export async function recordPayment(id: string, payment: Payment): Promise<Session> {
  await query("UPDATE app_web_sessions SET payment = $2::jsonb, pending = NULL WHERE id = $1 AND payment IS NULL", [id, json(payment)]);
  const session = await getSession(id);
  if (!session) throw new Error("No such checkout");
  return session;
}

export async function markPending(id: string, pending: NonNullable<Session["pending"]>): Promise<void> {
  await changed(id, await query("UPDATE app_web_sessions SET pending = $2::jsonb WHERE id = $1 RETURNING id", [id, pendingJson(pending)]));
}

/** Clears `expected` only if it is still the pending attempt, compared by value in the same statement: a newer one that
 *  arrived meanwhile stays. (A newer attempt equal in every field is the same chain question, so it is decided too.) */
export async function clearPending(id: string, expected: Session["pending"]): Promise<void> {
  if (!expected) return;
  await changed(id, await query("UPDATE app_web_sessions SET pending = NULL WHERE id = $1 AND pending = $2::jsonb RETURNING id", [id, pendingJson(expected)]));
}

/** The same attempt, by value: what clearPending compares (reads return fresh objects, so never by reference). */
export const samePending = (a: Session["pending"], b: Session["pending"]) => (a && b ? pendingJson(a) === pendingJson(b) : a === b);

/** What our server remembers about paying one invoice (FR-PAY-3), by invoice id. The invoice itself lives on chain;
 *  this only decides what its pay page shows. Losing it is safe: MerchantPay never takes more than is owed
 *  (WrongAmount) and refuses a paid invoice (InvoiceNotOpen); a lost `pending` only drops a "Don't pay again". */
export interface InvoiceAttempt {
  /** An attempt whose outcome is unknown: the chain decides (lib/settle.ts invoiceState). */
  pending?: { from: Address; validBefore: bigint };
  receipt?: { paymentId: string; txHash: Hex | null };
}

export async function invoiceAttempt(id: string): Promise<InvoiceAttempt> {
  const [row] = await query<{ attempt: string }>("SELECT attempt::text FROM app_web_invoice_attempts WHERE id = $1", [id]);
  if (!row) return {};
  const { pending, receipt } = JSON.parse(row.attempt) as { pending?: { from: Address; validBefore: string }; receipt?: InvoiceAttempt["receipt"] };
  return { ...(pending && { pending: { from: pending.from, validBefore: BigInt(pending.validBefore) } }), ...(receipt && { receipt }) };
}

export async function setInvoiceAttempt(id: string, attempt: InvoiceAttempt): Promise<void> {
  const stored = { ...(attempt.pending && { pending: { from: attempt.pending.from, validBefore: attempt.pending.validBefore } }), ...(attempt.receipt && { receipt: attempt.receipt }) };
  await query("INSERT INTO app_web_invoice_attempts (id, attempt) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET attempt = EXCLUDED.attempt", [id, json(stored)]);
}

/** Drops an invoice's `expected` pending attempt only if it is still the one stored (compare and clear, one statement). */
export async function clearInvoicePending(id: string, expected: NonNullable<InvoiceAttempt["pending"]>): Promise<void> {
  await query("UPDATE app_web_invoice_attempts SET attempt = attempt - 'pending' WHERE id = $1 AND attempt->'pending' = $2::jsonb", [
    id,
    json({ from: expected.from, validBefore: expected.validBefore }),
  ]);
}
