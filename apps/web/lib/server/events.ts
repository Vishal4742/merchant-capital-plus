// Server-only: what the gateway does after a checkout is paid or refunded (batch 007, ARCHITECTURE §4b).
// claude-frontend's record-payment path calls these two. A link's status and a voucher's count follow from the payment,
// and the merchant's webhooks fire (SRS FR-GW-1, FR-GW-7, FR-GW-12). Safe to call again: nothing happens twice.
import type { Address } from "viem";
import type { Session } from "../sessions.ts";
import { formatUsdt } from "../usdt.ts";
import { checkoutOf, markCheckoutPaid } from "./checkouts.ts";
import { query } from "./db.ts";
import { confirmRedemption } from "./vouchers.ts";
import { enqueueEvent } from "./webhooks.ts";

type EventType = "payment.succeeded" | "payment.refunded";
const plain = (units: bigint) => formatUsdt(units).replaceAll(",", ""); // "1000.00": machine-readable, no separators

/** The webhook `data`: claude-sdk's `Session` (packages/sdk GatewayEvent.data) plus where the session came from. */
async function eventData(session: Session, paidAmount = session.amount) {
  const checkout = await checkoutOf(session.id);
  return {
    id: session.id,
    status: "paid",
    amount: plain(paidAmount), // what the payer paid, in USDT (after any voucher)
    currency: "USDT",
    reference: session.reference,
    paymentId: session.payment?.paymentId ?? null,
    txHash: session.payment?.txHash ?? null,
    link_id: checkout?.kind === "link" ? checkout.refId : null,
    page_id: checkout?.kind === "page" ? checkout.refId : null,
  };
}

/** Queues the webhook once per key; if queuing fails the key is released, so a retry still delivers it. */
async function sendOnce(key: string, merchant: Address, type: EventType, data: Record<string, unknown>, now: number): Promise<void> {
  const fresh = await query("INSERT INTO app_gw_events (key, created_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key", [key, now]);
  if (fresh.length === 0) return;
  try {
    await enqueueEvent(merchant, type, data);
  } catch (err) {
    await query("DELETE FROM app_gw_events WHERE key = $1", [key]);
    throw err;
  }
}

/** `paidAmount` = the price the pay route claimed (claimAmountDue) and relayed. Required on purpose (batch 012 review N1):
 *  a default of session.amount would confirm and report the undiscounted price for a voucher payment. */
export async function onSessionPaid(session: Session, paidAmount: bigint, now = Date.now()): Promise<void> {
  await markCheckoutPaid(session.id, now); // idempotent: single-use links read their status from this
  await confirmRedemption(session.id, paidAmount); // idempotent per session; counts only if the discounted total was paid
  await sendOnce(`paid:${session.id}`, session.merchant, "payment.succeeded", await eventData(session, paidAmount), now);
}

/** `paidAmount` = what the payer actually paid (after any voucher), so a full refund of a discounted sale reads as full (N4). */
export async function onRefund(session: Session, amount: bigint, totalRefunded: bigint, paidAmount: bigint, now = Date.now()): Promise<void> {
  // SDK Session.refunded = the running total; refund_amount = this refund
  const data = { ...(await eventData(session, paidAmount)), refunded: plain(totalRefunded), refund_amount: plain(amount) };
  await sendOnce(`refund:${session.id}:${totalRefunded}`, session.merchant, "payment.refunded", data, now);
}
