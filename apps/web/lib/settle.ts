// Settling a checkout whose last attempt had an unknown outcome. The chain decides, never a guess:
// - this customer paid the order on-chain with the exact amount → record it (the receipt shows);
// - not paid, and the signed approval is past its validBefore → USDT can never settle it, so open the checkout;
// - otherwise it stays pending ("Don't pay again").
import type { Address } from "viem";
import { saleSettled } from "./onchain.ts";
import { clearPending, getSession, recordPayment, type Session } from "./sessions.ts";

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
  if (paymentId) recordPayment(session.id, { txHash: null, blockNumber: null, paymentId, from: payer, paidAt: Date.now() });
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
