// claude-frontend checks for lib/settle.ts and lib/sessions.ts races (batch 004 round 2, code review LOW).
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb } from "./gw-helpers.mjs";

let settled = async () => null;
mock.module("../lib/onchain.ts", { namedExports: { saleSettled: (...args) => settled(...args), readUsdtBalance: async () => 1_000_000_000n } });
const { createSession, getSession, markPending, recordPayment } = await import("../lib/sessions.ts");
const { settlePending } = await import("../lib/settle.ts");

const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";
const A = "0x3333333333333333333333333333333333333333", B = "0x4444444444444444444444444444444444444444";
before(setupDb);
beforeEach(resetDb);
const fresh = () => createSession({ merchant: "0x1111111111111111111111111111111111111111", merchantName: "Bandra Beans", amount: 25_000_000n, reference: "", items: [] });

test("a slow settle never clears a newer pending attempt that arrived during its chain read", async () => {
  const s = await fresh();
  await markPending(s.id, { from: A, validBefore: 0n }); // old attempt, long expired
  settled = async () => (await markPending(s.id, { from: B, validBefore: BigInt(Math.floor(Date.now() / 1000) + 400) }), null);
  assert.equal(await settlePending(await getSession(s.id), MERCHANT_PAY), "pending");
  assert.equal((await getSession(s.id)).pending.from, B, "the newer attempt is still pending");
});

test("a recorded payment is never overwritten (first write wins, so a relayed txHash isn't lost)", async () => {
  const s = await fresh();
  await recordPayment(s.id, { txHash: `0x${"ab".repeat(32)}`, blockNumber: "5", paymentId: "1", from: A, paidAt: 1, amount: 25_000_000n });
  const later = await recordPayment(s.id, { txHash: null, blockNumber: null, paymentId: "1", from: A, paidAt: 2, amount: 25_000_000n });
  assert.equal(later.payment.txHash, `0x${"ab".repeat(32)}`, "the stored (first) payment comes back");
  assert.equal((await getSession(s.id)).payment.txHash, `0x${"ab".repeat(32)}`);
});
