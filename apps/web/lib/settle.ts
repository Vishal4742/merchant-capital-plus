// Settling a checkout whose last attempt had an unknown outcome. The chain decides, never a guess:
// - this customer paid the order on-chain with the exact amount → record it (the receipt shows);
// - not paid, and the signed approval is past its validBefore → USDT can never settle it, so open the checkout;
// - otherwise it stays pending ("Don't pay again").
// A link or page attempt carries the price it claimed (pending.amount): the chain is read for exactly that, and a dead
// attempt's frozen voucher hold is released (batch-009 security review F1 iii, F3).
import { announcePaid } from "./announce-paid.ts";
import type { Address } from "viem";
import { saleSettled, type Invoice } from "./onchain.ts";
import { checkoutOf, type Checkout } from "./server/checkouts.ts";
import { DbUnavailable } from "./server/db.ts";
import { releaseHold } from "./server/vouchers.ts";
import { claimPayment, clearPending, getSession, invoiceAttempt, isInFlight, recordPayment, releasePayment, setInvoiceAttempt, type Session } from "./sessions.ts";

// our server clock vs chain time: wait this long past validBefore before calling an approval dead
const CLOCK_MARGIN_S = 60n;

export type Settlement = "paid" | "open" | "pending";

/** The link or page checkout behind a session, or null for a shop's own session. With no gateway database configured
 *  there are no link or page checkouts at all, so that is null too; any other database failure throws. */
export async function gatewayCheckout(sessionId: string): Promise<Checkout | null> {
  return checkoutOf(sessionId).catch((error: unknown) => {
    if (error instanceof DbUnavailable) return null;
    throw error;
  });
}

/** Unfreezes a link or page checkout's voucher hold. Only for an attempt that holds the in-flight lock and claimed, and
 *  only when nothing can settle at its price (F1). A failed write is logged: the hold stays frozen, and the next attempt
 *  claims the same price again. */
export async function releaseClaim(sessionId: string): Promise<void> {
  await releaseHold(sessionId).catch((error: unknown) => console.error(`checkout ${sessionId}: voucher hold not released: ${error instanceof Error ? error.name : "error"}`));
}

/** The payment id if `payer` paid this order on-chain at exactly `amount` (and records it at that price); null if not;
 *  undefined if the read failed. `amount` is the attempt's charged price, never a re-claimed one (F3). */
export async function findPayment(session: Session, merchantPay: Address, payer: Address, amount = session.amount): Promise<string | null | undefined> {
  const sale = { merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount, payer };
  const paymentId = await saleSettled(sale).catch((error: unknown) => {
    console.error(`checkout ${session.id}: chain read failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  if (paymentId) announcePaid(recordPayment(session.id, { txHash: null, blockNumber: null, paymentId, from: payer, paidAt: Date.now(), amount }), amount);
  return paymentId;
}

/** `locked`: the caller holds this checkout's in-flight lock (the pay route). Without it, a dead link or page attempt is
 *  cleared and its hold released only if the lock is free, so a live attempt's freeze is never released (F1). */
export async function settlePending(session: Session, merchantPay: Address, { now = Date.now(), locked = false } = {}): Promise<Settlement> {
  if (session.payment) return "paid";
  const pending = session.pending;
  if (!pending) return "open";
  const paymentId = await findPayment(session, merchantPay, pending.from, pending.amount ?? session.amount);
  if (paymentId) return "paid";
  if (paymentId === null && BigInt(Math.floor(now / 1000)) > pending.validBefore + CLOCK_MARGIN_S) {
    if (pending.amount !== undefined) return reopen(session.id, pending, locked);
    clearPending(session.id, pending); // only this attempt: a newer one may have arrived during the read
    return getSession(session.id)?.pending ? "pending" : "open";
  }
  return "pending";
}

/** A dead link or page attempt (F1 iii): clear it and release its hold, under the in-flight lock. */
async function reopen(id: string, pending: NonNullable<Session["pending"]>, locked: boolean): Promise<Settlement> {
  const lockedHere = !locked && claimPayment(id);
  if (!locked && !lockedHere) return "pending"; // a payment is in flight right now: it settles this attempt itself
  try {
    const current = getSession(id);
    if (current?.pending !== pending) return current?.payment ? "paid" : current?.pending ? "pending" : "open"; // settled meanwhile
    clearPending(id, pending);
    await releaseClaim(id);
    return "open";
  } finally {
    if (lockedHere) releasePayment(id);
  }
}

export type InvoiceState = Invoice["status"] | "pending";

/** What an invoice shows, from its status just read on chain. An open invoice with an unknown attempt stays pending
 *  ("Don't pay again") until that attempt's approval is past its validBefore; any other status ends it. Synchronous,
 *  so nothing can replace the attempt between the check and the clear. */
export function invoiceState(id: string, status: Invoice["status"], now = Date.now()): InvoiceState {
  const attempt = invoiceAttempt(id);
  if (!attempt.pending) return status;
  if (status === "open" && BigInt(Math.floor(now / 1000)) <= attempt.pending.validBefore + CLOCK_MARGIN_S) return "pending";
  setInvoiceAttempt(id, { ...attempt, pending: undefined });
  return status;
}

/** /pay serves and relays only the shop's own invoices (human, 2026-11-06 02:3x): no pay pages for payees we never
 *  onboarded on our domain (security review 005 F7). The shop is MERCHANT_ADDRESS; none configured, none served. */
export function isShopInvoice(invoice: Invoice, shop: Address | undefined): boolean {
  return Boolean(shop) && invoice.status !== "missing" && invoice.merchant.toLowerCase() === shop!.toLowerCase();
}

/** What a pay page shows: an open checkout or invoice whose payment is being relayed right now may land, so it reads as
 *  pending, never offering the button or "ask for a new one" (security review 004 R2 F1). `lock` is the in-flight key. */
export function pageState<T extends string>(state: T, lock: string): T | "pending" {
  return state === "open" && isInFlight(lock) ? "pending" : state;
}
