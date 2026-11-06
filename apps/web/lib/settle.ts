// Settling a checkout whose last attempt had an unknown outcome. The chain decides, never a guess:
// - this customer paid the order on-chain with the exact amount → record it (the receipt shows);
// - not paid, and the signed approval is past its validBefore → USDT can never settle it, so open the checkout;
// - otherwise it stays pending ("Don't pay again").
import { announcePaid } from "./announce-paid.ts";
import type { Address } from "viem";
import { saleSettled, type Invoice } from "./onchain.ts";
import { clearPending, getSession, invoiceAttempt, isInFlight, recordPayment, setInvoiceAttempt, type Session } from "./sessions.ts";

// our server clock vs chain time: wait this long past validBefore before calling an approval dead
const CLOCK_MARGIN_S = 60n;

export type Settlement = "paid" | "open" | "pending";

/** The payment id if `payer` paid this order on-chain (and records it); null if not; undefined if the read failed. */
export async function findPayment(session: Session, merchantPay: Address, payer: Address): Promise<string | null | undefined> {
  const sale = { merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: session.amount, payer };
  const paymentId = await saleSettled(sale).catch((error: unknown) => {
    console.error(`checkout ${session.id}: chain read failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  if (paymentId) announcePaid(recordPayment(session.id, { txHash: null, blockNumber: null, paymentId, from: payer, paidAt: Date.now() }));
  return paymentId;
}

export async function settlePending(session: Session, merchantPay: Address, now = Date.now()): Promise<Settlement> {
  if (session.payment) return "paid";
  const pending = session.pending;
  if (!pending) return "open";
  const paymentId = await findPayment(session, merchantPay, pending.from);
  if (paymentId) return "paid";
  if (paymentId === null && BigInt(Math.floor(now / 1000)) > pending.validBefore + CLOCK_MARGIN_S) {
    clearPending(session.id, pending); // only this attempt: a newer one may have arrived during the read
    return getSession(session.id)?.pending ? "pending" : "open";
  }
  return "pending";
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
