// What a pay request's answer means for the customer's sheet, shared by the checkout and the invoice page (code review
// 004 R2 F2). Pure, and no viem at run time, so it adds nothing to the pay pages' first load (NFR-12).
import type { Hex } from "viem";

/** When we can't know whether the payment went out, never say "Nothing was charged". */
export const UNCONFIRMED = "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes.";
export const FAILED = "The payment didn't go through. Nothing was charged.";

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
