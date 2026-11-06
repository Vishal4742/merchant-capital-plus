// What a pay request's answer means for the customer's sheet, shared by the checkout and the invoice page (code review
// 004 R2 F2). Pure, and no viem at run time, so it adds nothing to the pay pages' first load (NFR-12).
import type { Hex } from "viem";

/** When we can't know whether the payment went out, never say "Nothing was charged". */
export const UNCONFIRMED = "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes.";
export const FAILED = "The payment didn't go through. Nothing was charged.";
/** The human's gate decision (batch 004, 01:45): an unfunded guest is a demo limit, so say so plainly. The pay routes
 *  send it after their own balance read; the relayer's insufficient_funds maps to it too. The sheets show it in the
 *  warning tone, not as an error (UX review 005 N3). */
export const NOT_FUNDED = "This is a demo: paying needs test USDT, and this browser doesn't have enough yet. Nothing was charged.";
/** "Pay with your wallet" (FR-PAY-16): our server says the connected wallet is short, before any approval prompt. */
export const WALLET_SHORT = "This wallet doesn't have enough test USDT for this payment. Nothing was charged.";
/** The customer said no in their wallet (EIP-1193 4001). Their choice, not a failure (UX review 032 L3). */
export const WALLET_CANCELLED = "You cancelled in your wallet. Nothing was charged.";

/** The colour of a sheet's error line: a demo limit is amber, a cancel is plain ink, anything else is an error. */
export function errorTone(message: string): string {
  if (message === NOT_FUNDED || message === WALLET_SHORT) return "text-warning";
  return message === WALLET_CANCELLED ? "text-ink-muted" : "text-critical";
}

export type Outcome =
  | { kind: "paid"; receiptId: string | null; txHash: Hex | null }
  | { kind: "closed" } // 410: the checkout expired, or the invoice was cancelled
  | { kind: "confirming" } // the outcome is unknown: never offer the button again on this page
  | { kind: "error"; message: string }; // nothing was sent: the server's own plain words

export interface PayAnswer {
  receiptId?: string | null;
  txHash?: Hex | null;
  /** An invoice paid by someone else: closed as paid, maybe without a receipt here. */
  paid?: boolean;
  error?: string;
}

export function outcome(status: number, data: PayAnswer): Outcome {
  // a receipt id or `paid` means it's paid, now or earlier (a 409 "Already paid" after a reload or a second tab)
  if (data.receiptId || data.paid) return { kind: "paid", receiptId: data.receiptId ?? null, txHash: data.txHash ?? null };
  if (status === 410) return { kind: "closed" };
  // 409: another attempt is in flight or pending. Any 5xx but 503 (busy, nothing sent) may have gone out.
  if (status === 409 || (status >= 500 && status !== 503)) return { kind: "confirming" };
  return { kind: "error", message: data.error ?? FAILED };
}
