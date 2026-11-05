// claude-frontend checks for the consumer rule (ARCHITECTURE §2, claude-contracts): an order counts as paid only
// if payments(saleOf(merchant, orderRef)).gross equals the session amount. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { saleSettled, paymentRefunded } = await import("../lib/onchain.ts");

const sale = {
  merchantPay: "0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7",
  merchant: "0x1111111111111111111111111111111111111111",
  orderRef: `0x${"22".repeat(32)}`,
  amount: 25_000_000n,
  payer: "0x3333333333333333333333333333333333333333",
};

// a fake chain: saleOf → id, payments(id) → [merchant, gross, payer, refunded]; records every call
function chain({ id = 7n, gross = 25_000_000n, merchant = sale.merchant, payer = sale.payer } = {}) {
  const calls = [];
  const read = async (req) => {
    calls.push(req);
    if (req.functionName === "saleOf") return id;
    if (req.functionName === "payments") return [merchant, gross, payer, 0n];
    throw new Error(`unexpected ${req.functionName}`);
  };
  return { read, calls };
}

test("a sale on-chain with the exact amount is settled, and returns MerchantPay's payment id", async () => {
  const { read, calls } = chain();
  assert.equal(await saleSettled(sale, { read, blockNumber: 12_300_000n }), "7");
  assert.deepEqual(calls[0].args, [sale.merchant, sale.orderRef]);
  assert.deepEqual(calls[1].args, [7n]);
  assert.ok(calls.every((c) => c.address === sale.merchantPay && c.blockNumber === 12_300_000n), "reads MerchantPay at the receipt's block");
});

test("no sale for this order, a different amount, another merchant, or another payer is not settled", async () => {
  assert.equal(await saleSettled(sale, chain({ id: 0n })), null);
  assert.equal(await saleSettled(sale, chain({ gross: 24_900_000n })), null);
  assert.equal(await saleSettled(sale, chain({ merchant: "0x4444444444444444444444444444444444444444" })), null);
  // claude-contracts S6 (a): someone else's payment for this order is not ours
  assert.equal(await saleSettled(sale, chain({ payer: "0x5555555555555555555555555555555555555555" })), null);
});

test("a lagging RPC backend ('header not found') is retried at the same block, then gives up loudly", async () => {
  const { read, calls } = chain();
  let failures = 2;
  const flaky = async (req) => {
    if (failures-- > 0) throw new Error("header not found");
    return read(req);
  };
  assert.equal(await saleSettled(sale, { read: flaky, blockNumber: 12_300_000n, gapMs: 0 }), "7");
  assert.ok(calls.every((c) => c.blockNumber === 12_300_000n), "never falls back to a later block");
  const down = async () => {
    throw new Error("header not found");
  };
  await assert.rejects(saleSettled(sale, { read: down, gapMs: 0, tries: 3 }), /header not found/);
});

test("the receipt's refund status is MerchantPay's payments(id).refunded", async () => {
  const read = async (req) => (assert.deepEqual([req.functionName, req.args], ["payments", [7n]]), [sale.merchant, 25_000_000n, sale.payer, 1_500_000n]);
  assert.equal(await paymentRefunded(sale.merchantPay, 7n, read), 1_500_000n);
});
