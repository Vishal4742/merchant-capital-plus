// claude-frontend: the network fee the relayer paid for a payment, shown to merchants on /merchant/payments
// (human 07:39 "do it"). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { readTxFee } = await import("../lib/onchain.ts");
const HASH = `0x${"ab".repeat(32)}`;

test("readTxFee: gas used × effective gas price, plus the OP-stack L1 data fee", async () => {
  const readReceipt = async (hash) => (assert.equal(hash, HASH), { gasUsed: 98_000n, effectiveGasPrice: 1_000_252n, l1Fee: 37n });
  assert.equal(await readTxFee(HASH, { readReceipt }), 98_000n * 1_000_252n + 37n);
  assert.equal(await readTxFee(HASH, { readReceipt: async () => ({ gasUsed: 21_000n, effectiveGasPrice: 2n, l1Fee: null }) }), 42_000n, "no L1 fee field");
});

test("readTxFee retries a failed read, then gives up with the error (never a guessed 0)", async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? Promise.reject(new Error("header not found")) : { gasUsed: 1n, effectiveGasPrice: 1n });
  assert.equal(await readTxFee(HASH, { readReceipt: flaky, tries: 2, gapMs: 0 }), 1n);
  await assert.rejects(readTxFee(HASH, { readReceipt: async () => { throw new Error("down"); }, tries: 2, gapMs: 0 }), /down/);
});
