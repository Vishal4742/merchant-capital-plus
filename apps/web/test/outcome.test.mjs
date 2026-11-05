// claude-frontend checks for lib/outcome.ts (code review 004 R2 F2): how the checkout and invoice sheets read a pay
// request's answer. "Nothing was charged" may only follow an answer that proves nothing was sent. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { outcome, FAILED } = await import("../lib/outcome.ts");

test("each pay answer maps to one sheet state", () => {
  const tx = `0x${"ab".repeat(32)}`;
  const rows = [
    [200, { receiptId: "r1", txHash: tx }, { kind: "paid", receiptId: "r1", txHash: tx }], // paid now
    [409, { error: "Already paid.", receiptId: "r1" }, { kind: "paid", receiptId: "r1", txHash: null }], // paid earlier
    [409, { error: "This invoice is already paid.", paid: true, receiptId: null }, { kind: "paid", receiptId: null, txHash: null }], // paid by someone else
    [410, { error: "This checkout has expired." }, { kind: "closed" }], // expired checkout, cancelled invoice
    [409, { error: "This checkout is already being paid." }, { kind: "confirming" }], // in flight or pending
    [500, {}, { kind: "confirming" }],
    [502, {}, { kind: "confirming" }],
    [504, { error: "We couldn't confirm this payment yet." }, { kind: "confirming" }], // may have gone out
    [503, { error: "Payments are busy right now. Nothing was charged; try again in a moment." }, { kind: "error", message: "Payments are busy right now. Nothing was charged; try again in a moment." }],
    [400, { error: "This approval doesn't match the checkout. Nothing was charged." }, { kind: "error", message: "This approval doesn't match the checkout. Nothing was charged." }],
    [400, {}, { kind: "error", message: FAILED }],
  ];
  for (const [status, data, want] of rows) assert.deepEqual(outcome(status, data), want, `${status} ${JSON.stringify(data)}`);
});
