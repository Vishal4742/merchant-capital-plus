// Server-only: what the gateway does after a checkout is paid or refunded (batch 007, ARCHITECTURE §4b).
// claude-frontend's record-payment path calls these two. A link's status and a voucher's count follow from the payment,
// and the merchant's webhooks fire (SRS FR-GW-1, FR-GW-7, FR-GW-12). Safe to call again: nothing happens twice.
import { createHash } from "node:crypto";
import type { Address } from "viem";
import type { Session } from "../sessions.ts";
import { formatUsdt } from "../usdt.ts";
import { checkoutOf, markCheckoutPaid } from "./checkouts.ts";
import { query } from "./db.ts";
import { confirmRedemption } from "./vouchers.ts";
import { enqueueEventOnce } from "./webhooks.ts";

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

/** The event's id, derived from its sendOnce key (claude-frontend F2): a retried enqueue, or a re-announce from another
 *  server instance, reuses it, so a merchant deduping on event.id (the SDK README's advice) never ships twice. */
export const eventIdFor = (key: string) => `evt_${createHash("sha256").update(key).digest("base64url").slice(0, 24)}`;

/** Queues the webhook once per key (same event id on every try). The key and the deliveries are written by one statement
 *  in enqueueEventOnce (batch 031 A1), so a failure or a killed process leaves either both or neither: a retry or a
 *  re-announce still delivers it, and nothing is marked sent without deliveries. The key is checked before the data is
 *  built (F4): a re-announce of a queued event does no other work; two racing announcements are settled by the insert. */
async function sendOnce(key: string, merchant: Address, type: EventType, buildData: () => Promise<Record<string, unknown>>, now: number): Promise<void> {
  if ((await query("SELECT 1 FROM app_gw_events WHERE key = $1", [key])).length > 0) return;
  await enqueueEventOnce(key, merchant, type, await buildData(), now, eventIdFor(key));
}

/** `paidAmount` = the price the pay route claimed (claimAmountDue) and relayed. Required on purpose (batch 012 review N1):
 *  a default of session.amount would confirm and report the undiscounted price for a voucher payment. */
export async function onSessionPaid(session: Session, paidAmount: bigint, now = Date.now()): Promise<void> {
  await markCheckoutPaid(session.id, now); // idempotent: single-use links read their status from this
  await confirmRedemption(session.id, paidAmount); // idempotent per session; counts only if the discounted total was paid
  await sendOnce(`paid:${session.id}`, session.merchant, "payment.succeeded", () => eventData(session, paidAmount), now);
}

/** `paidAmount` = what the payer actually paid (after any voucher), so a full refund of a discounted sale reads as full (N4). */
export async function onRefund(session: Session, amount: bigint, totalRefunded: bigint, paidAmount: bigint, now = Date.now()): Promise<void> {
  // SDK Session.refunded = the running total; refund_amount = this refund
  const data = async () => ({ ...(await eventData(session, paidAmount)), refunded: plain(totalRefunded), refund_amount: plain(amount) });
  await sendOnce(`refund:${session.id}:${totalRefunded}`, session.merchant, "payment.refunded", data, now);
}
