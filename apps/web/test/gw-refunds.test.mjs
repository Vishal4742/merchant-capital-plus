// claude-contracts checks for POST /api/v1/payments/{id}/refunds/sync (FR-GW-7, FR-PAY-10, AT-15): payment.refunded fires
// only for a Refunded log that MerchantPay itself emitted, for this payment, in a successful receipt. The client's word
// (an id and a tx hash) is never enough. events.ts is replaced with a recorder (gw-events covers onRefund's once-per-total
// dedupe); receipts are injected, or for the route's own chain read, the JSON-RPC fetch is faked (never the network).
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-refunds.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { MERCHANT, OTHER_MERCHANT, params, req, setupDb, signedIn } from "./gw-helpers.mjs";

const MERCHANT_PAY = `0x${"ab".repeat(20)}`; // letters, so the log's upper-case copy below really differs in case
const OTHER_CONTRACT = "0x4444444444444444444444444444444444444444";
const PAYER = "0x5555555555555555555555555555555555555555";
process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
process.env.RELAYER_URL = "http://relayer.test";

const refunds = [];
mock.module("../lib/server/events.ts", {
  namedExports: {
    onRefund: async (session, amount, totalRefunded, paidAmount) => {
      refunds.push({ sessionId: session.id, amount, totalRefunded, paidAmount });
    },
  },
});

const { syncRefund } = await import("../lib/server/refunds.ts");
const { POST } = await import("../app/api/v1/payments/[id]/refunds/sync/route.ts");
const { createSession, recordPayment } = await import("../lib/sessions.ts");
const { resetRateLimits } = await import("../lib/server/http.ts");

const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const TX = `0x${"ab".repeat(32)}`;
const abi = parseAbi([
  "event Refunded(uint256 indexed paymentId, uint256 amount, uint256 totalRefunded)",
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
]);
const uints = (...values) => encodeAbiParameters(values.map(() => ({ type: "uint256" })), values);
const refundLog = (paymentId, amount, total, address = MERCHANT_PAY) => ({
  address,
  topics: encodeEventTopics({ abi, eventName: "Refunded", args: { paymentId } }),
  data: uints(amount, total),
});
// another MerchantPay event whose first indexed topic is the same payment id: must not read as a refund
const paidLog = (paymentId) => ({
  address: MERCHANT_PAY,
  topics: encodeEventTopics({ abi, eventName: "Paid", args: { paymentId, merchant: MERCHANT, payer: PAYER } }),
  data: encodeAbiParameters(
    ["uint256", "bytes32", "uint256", "uint256", "uint256", "uint256"].map((type) => ({ type })),
    [0n, `0x${"00".repeat(32)}`, USDT(1), USDT(1), 0n, 0n],
  ),
});
const receipt = (logs, status = "success") => ({ status, logs });
const reader = (r) => {
  const calls = [];
  const readReceipt = async (hash) => {
    calls.push(hash);
    return r;
  };
  return { calls, readReceipt };
};

// payment 7 is MERCHANT's: the session asked 25.00, a voucher made the charged price 20.00. Payment 8 is another merchant's.
let mine;
before(async () => {
  await setupDb(); // the checkouts are in the database (batch 023)
  mine = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: USDT(25), reference: "A-1042", items: [{ name: "Beans", qty: 1, price: USDT(25) }] });
  await recordPayment(mine.id, { txHash: `0x${"01".repeat(32)}`, blockNumber: "10", paymentId: "7", from: PAYER, paidAt: Date.now(), amount: USDT(20) });
  const theirs = await createSession({ merchant: OTHER_MERCHANT, merchantName: "Other", amount: USDT(10), reference: "B-1", items: [{ name: "Tea", qty: 1, price: USDT(10) }] });
  await recordPayment(theirs.id, { txHash: `0x${"02".repeat(32)}`, blockNumber: "11", paymentId: "8", from: PAYER, paidAt: Date.now(), amount: USDT(10) });
});
beforeEach(() => {
  refunds.length = 0;
  resetRateLimits();
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
});

test("a MerchantPay Refunded log for this payment fires onRefund once, with the charged price as paidAmount", async () => {
  const { calls, readReceipt } = reader(receipt([refundLog(7n, USDT(5), USDT(5))]));
  const res = await syncRefund(MERCHANT, 7n, TX, { readReceipt });
  assert.deepEqual(calls, [TX]);
  assert.deepEqual(refunds, [{ sessionId: mine.id, amount: USDT(5), totalRefunded: USDT(5), paidAmount: USDT(20) }]);
  assert.deepEqual(res, { payment_id: "7", refunds: [{ amount: "5.00", total_refunded: "5.00" }], tx_hash: TX });
});

test("the same tx again hands onRefund the same total, so its once-per-total key sends nothing new", async () => {
  const { readReceipt } = reader(receipt([refundLog(7n, USDT(5), USDT(5))]));
  await syncRefund(MERCHANT, 7n, TX, { readReceipt });
  await syncRefund(MERCHANT, 7n, TX, { readReceipt });
  assert.equal(refunds.length, 2);
  assert.deepEqual(refunds[0], refunds[1]); // same session + total → onRefund's `refund:<session>:<total>` key dedupes
});

test("MerchantPay's address matches in any case; decoys in the same receipt are skipped", async () => {
  const { readReceipt } = reader(
    receipt([refundLog(7n, USDT(9), USDT(9), OTHER_CONTRACT), refundLog(8n, USDT(3), USDT(3)), paidLog(7n), refundLog(7n, USDT(2), USDT(7), MERCHANT_PAY.toUpperCase().replace("0X", "0x"))]),
  );
  const res = await syncRefund(MERCHANT, 7n, TX, { readReceipt });
  assert.deepEqual(refunds, [{ sessionId: mine.id, amount: USDT(2), totalRefunded: USDT(7), paidAmount: USDT(20) }]);
  assert.deepEqual(res.refunds, [{ amount: "2.00", total_refunded: "7.00" }]);
});

test("two refunds of this payment in one tx fire in log order", async () => {
  const { readReceipt } = reader(receipt([refundLog(7n, USDT(1), USDT(1)), refundLog(7n, USDT(0.5), USDT(1.5))]));
  const res = await syncRefund(MERCHANT, 7n, TX, { readReceipt });
  assert.deepEqual(refunds.map((r) => r.totalRefunded), [USDT(1), USDT(1.5)]);
  assert.deepEqual(res.refunds, [{ amount: "1.00", total_refunded: "1.00" }, { amount: "0.50", total_refunded: "1.50" }]);
});

const NO_REFUND = { status: 400, message: "That transaction has no refund for this payment." };

test("a Refunded log from another contract is ignored: 400, nothing fires", async () => {
  const { readReceipt } = reader(receipt([refundLog(7n, USDT(5), USDT(5), OTHER_CONTRACT)]));
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), NO_REFUND);
  assert.equal(refunds.length, 0);
});

test("a Refunded log for another payment id is ignored: 400", async () => {
  const { readReceipt } = reader(receipt([refundLog(8n, USDT(5), USDT(5))]));
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), NO_REFUND);
  assert.equal(refunds.length, 0);
});

test("another MerchantPay event carrying this payment id is not a refund: 400", async () => {
  const { readReceipt } = reader(receipt([paidLog(7n)]));
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), NO_REFUND);
  assert.equal(refunds.length, 0);
});

test("a receipt with no logs at all: 400", async () => {
  const { readReceipt } = reader(receipt([]));
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), NO_REFUND);
});

test("a reverted receipt is refused even with a Refunded log in it: 400", async () => {
  const { readReceipt } = reader(receipt([refundLog(7n, USDT(5), USDT(5))], "reverted"));
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), { status: 400, message: "That refund transaction failed." });
  assert.equal(refunds.length, 0);
});

test("an unknown payment or another merchant's: 404, and the chain isn't read", async () => {
  const { calls, readReceipt } = reader(receipt([refundLog(8n, USDT(5), USDT(5))]));
  await assert.rejects(syncRefund(MERCHANT, 99n, TX, { readReceipt }), { status: 404 });
  await assert.rejects(syncRefund(MERCHANT, 8n, TX, { readReceipt }), { status: 404 });
  assert.equal(calls.length, 0);
  assert.equal(refunds.length, 0);
});

test("a receipt that can't be read: 502, nothing fires", async () => {
  const readReceipt = async () => {
    throw new Error("TransactionReceiptNotFoundError");
  };
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), { status: 502 });
  assert.equal(refunds.length, 0);
});

test("payConfig missing: 503 before anything is read", async () => {
  delete process.env.MERCHANT_PAY_ADDRESS;
  const { calls, readReceipt } = reader(receipt([refundLog(7n, USDT(5), USDT(5))]));
  await assert.rejects(syncRefund(MERCHANT, 7n, TX, { readReceipt }), { status: 503 });
  assert.equal(calls.length, 0);
});

// --- the route ---
const sync = (id, body, headers = signedIn()) => POST(req("POST", `/api/v1/payments/${id}/refunds/sync`, { body, headers }), params({ id }));

test("route: no cookie → 401", async () => {
  const res = await sync("7", { tx_hash: TX }, {});
  assert.equal(res.status, 401);
});

test("route: a bad tx hash or payment id → 400", async () => {
  for (const body of [{}, { tx_hash: "0x1234" }, { tx_hash: 7 }, { tx_hash: `0x${"zz".repeat(32)}` }, { tx_hash: `${"ab".repeat(32)}` }]) {
    assert.equal((await sync("7", body)).status, 400, JSON.stringify(body));
  }
  for (const id of ["abc", "0", "-1", "1.5", "007", "7 ", "1e3", "9".repeat(79)]) {
    assert.equal((await sync(id, { tx_hash: TX })).status, 400, id);
  }
  assert.equal(refunds.length, 0);
});

test("route: another merchant's payment → 404", async () => {
  const res = await sync("8", { tx_hash: TX });
  assert.equal(res.status, 404);
  assert.equal(refunds.length, 0);
});

test("route: payConfig missing → 503", async () => {
  delete process.env.MERCHANT_PAY_ADDRESS;
  const res = await sync("7", { tx_hash: TX });
  assert.equal(res.status, 503);
});

test("route: 30 syncs a minute per merchant, then 429", async () => {
  for (let i = 0; i < 30; i++) assert.equal((await sync("99", { tx_hash: TX })).status, 404);
  assert.equal((await sync("99", { tx_hash: TX })).status, 429);
  assert.equal((await sync("99", { tx_hash: TX }, signedIn(OTHER_MERCHANT))).status, 404, "another merchant has its own window");
});

test("route: reads the receipt over JSON-RPC (eth_getTransactionReceipt) and answers with the synced refund", async (t) => {
  const log = refundLog(7n, USDT(5), USDT(12.5));
  const rpcReceipt = {
    transactionHash: TX,
    transactionIndex: "0x0",
    blockHash: `0x${"cd".repeat(32)}`,
    blockNumber: "0x10",
    from: PAYER,
    to: MERCHANT_PAY,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    contractAddress: null,
    logsBloom: `0x${"00".repeat(256)}`,
    type: "0x2",
    status: "0x1",
    logs: [{ ...log, address: MERCHANT_PAY, blockHash: `0x${"cd".repeat(32)}`, blockNumber: "0x10", transactionHash: TX, transactionIndex: "0x0", logIndex: "0x0", removed: false }],
  };
  const methods = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    methods.push(body.method);
    return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "eth_getTransactionReceipt" && body.params[0] === TX ? rpcReceipt : null });
  });
  const res = await sync("7", { tx_hash: TX });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { payment_id: "7", refunds: [{ amount: "5.00", total_refunded: "12.50" }], tx_hash: TX });
  assert.deepEqual(methods, ["eth_getTransactionReceipt"]);
  assert.deepEqual(refunds, [{ sessionId: mine.id, amount: USDT(5), totalRefunded: USDT(12.5), paidAmount: USDT(20) }]);
});
