// Server-only checkout sessions (FR-PAY-4). The chain is the truth for money; this only remembers what
// a shop asked to be paid and which payment settled it, so the pay page needs no browser chain reads.
import { randomBytes, randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import type { Currency } from "./fx.ts";
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
  /** An attempt whose outcome is unknown (timeout, dropped connection, 5xx, an unconfirmed 200): the chain decides it. */
  pending?: { from: Address; validBefore: bigint };
}

// ponytail: in-memory store, so sessions vanish on restart and aren't shared between serverless
// instances. Move to Neon (`app_sessions`) when the Vercel project and DATABASE_URL exist.
const globalStore = globalThis as unknown as { __mcSessions?: Map<string, Session>; __mcInvoiceAttempts?: Map<string, InvoiceAttempt> };
const sessions = (globalStore.__mcSessions ??= new Map<string, Session>());

/** Every way in (the sessions API, links and pages) passes here, so the returnUrl rule lives here too. Throws on a bad
 *  returnUrl; the API checks first and answers 400. */
export function createSession(input: Omit<Session, "id" | "orderRef" | "createdAt" | "expiresAt" | "payment" | "pending">, now = Date.now(), ttlMs = SESSION_TTL_MS): Session {
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
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

/** A checkout's currency in API replies (FR-GW-11): the currency the shop asked for, and `priced` for any but USDT. */
export function currencyFields(session: Session) {
  const p = session.priced;
  if (!p) return { currency: "USDT" as const };
  return { currency: p.currency, priced: { currency: p.currency, amount: plainUsdt(p.amount), rate: p.rate, rateAt: p.rateDate, source: p.source } };
}


/** Paid checkouts for one merchant, newest first (the dashboard's payments table). */
export function listPayments(merchant: string): { session: Session; payment: Payment }[] {
  const out: { session: Session; payment: Payment }[] = [];
  for (const session of sessions.values()) {
    if (session.payment && session.merchant.toLowerCase() === merchant.toLowerCase()) out.push({ session, payment: session.payment });
  }
  return out.sort((a, b) => b.payment.paidAt - a.payment.paidAt);
}

// One payment in flight per checkout (key: the session id) or invoice (key: "invoice:<id>"): without this, two quick
// requests with different salts could both settle and charge the customer twice.
const inFlight = new Set<string>();

/** The in-flight key of an invoice, shared by its pay route and its page. */
export const invoiceLock = (id: string) => `invoice:${id}`;

/** True if this caller may relay a payment for this checkout or invoice now; false if one is already in flight. */
export function claimPayment(id: string): boolean {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  return true;
}

export function releasePayment(id: string): void {
  inFlight.delete(id);
}

export function isInFlight(id: string): boolean {
  return inFlight.has(id);
}

function update(id: string, change: (session: Session) => Session): Session {
  const session = sessions.get(id);
  if (!session) throw new Error("No such checkout");
  const next = change(session);
  sessions.set(id, next);
  return next;
}

/** First write wins: a later record (e.g. a reconcile without a txHash) never replaces a relayed payment. */
export function recordPayment(id: string, payment: Payment): Session {
  return update(id, (session) => (session.payment ? session : { ...session, payment, pending: undefined }));
}

export function markPending(id: string, pending: NonNullable<Session["pending"]>): Session {
  return update(id, (session) => ({ ...session, pending }));
}

/** Clears `expected` only if it is still the pending attempt: a newer one that arrived meanwhile stays. */
export function clearPending(id: string, expected: Session["pending"]): Session {
  return update(id, (session) => (session.pending === expected ? { ...session, pending: undefined } : session));
}

/** What our server remembers about paying one invoice (FR-PAY-3), by invoice id. The invoice itself lives on chain;
 *  this only decides what its pay page shows. Losing it on restart is safe: MerchantPay never takes more than is owed
 *  (WrongAmount) and refuses a paid invoice (InvoiceNotOpen); a lost `pending` only drops a "Don't pay again". */
export interface InvoiceAttempt {
  /** An attempt whose outcome is unknown: the chain decides (lib/settle.ts invoiceState). */
  pending?: { from: Address; validBefore: bigint };
  receipt?: { paymentId: string; txHash: Hex | null };
}

const invoiceAttempts = (globalStore.__mcInvoiceAttempts ??= new Map<string, InvoiceAttempt>());

export const invoiceAttempt = (id: string): InvoiceAttempt => invoiceAttempts.get(id) ?? {};

export function setInvoiceAttempt(id: string, attempt: InvoiceAttempt): void {
  invoiceAttempts.set(id, attempt);
}
