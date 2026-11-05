// claude-frontend checks for lib/settle.ts and lib/sessions.ts races (batch 004 round 2, code review LOW).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let settled = async () => null;
mock.module("../lib/onchain.ts", { namedExports: { saleSettled: (...args) => settled(...args) } });
const { createSession, getSession, markPending, recordPayment } = await import("../lib/sessions.ts");
const { settlePending } = await import("../lib/settle.ts");

const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";
const A = "0x3333333333333333333333333333333333333333", B = "0x4444444444444444444444444444444444444444";
const fresh = () => createSession({ merchant: "0x1111111111111111111111111111111111111111", merchantName: "Bandra Beans", amount: 25_000_000n, reference: "", items: [] });

test("a slow settle never clears a newer pending attempt that arrived during its chain read", async () => {
  const s = fresh();
  markPending(s.id, { from: A, validBefore: 0n }); // old attempt, long expired
  settled = async () => (markPending(s.id, { from: B, validBefore: BigInt(Math.floor(Date.now() / 1000) + 400) }), null);
  assert.equal(await settlePending(getSession(s.id), MERCHANT_PAY), "pending");
  assert.equal(getSession(s.id).pending.from, B, "the newer attempt is still pending");
});

test("a recorded payment is never overwritten (first write wins, so a relayed txHash isn't lost)", () => {
  const s = fresh();
  recordPayment(s.id, { txHash: `0x${"ab".repeat(32)}`, blockNumber: "5", paymentId: "1", from: A, paidAt: 1 });
  recordPayment(s.id, { txHash: null, blockNumber: null, paymentId: "1", from: A, paidAt: 2 });
  assert.equal(getSession(s.id).payment.txHash, `0x${"ab".repeat(32)}`);
});
