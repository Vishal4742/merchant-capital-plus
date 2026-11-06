// claude-frontend checks for GET /api/v1/payments (FR-GW-5, the SDK's payments.list): auth, the merchant filter, the cursor.
// The log index and the chain are faked (lib/onchain.ts has its own tests). Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb } from "./gw-helpers.mjs";

const MERCHANT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const PAYER = "0x5555555555555555555555555555555555555555";
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";
process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
process.env.RELAYER_URL = "http://relayer.test";

const tx = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const log = (id, { invoiceId = 0n, gross = 25_000_000n } = {}) => ({ paymentId: id, invoiceId, gross, txHash: tx(id), time: Date.UTC(2026, 10, 6, 0, Number(id)) });
let logs = [];
let chain = new Map(); // paymentId → payments(id)
const indexCalls = [];
const readCalls = [];
let indexDown = false;
let chainDown = false;
mock.module("../lib/onchain.ts", {
  namedExports: {
    paidLogs: async (...args) => {
      indexCalls.push(args);
      if (indexDown) throw new Error("log index answered 502");
      return logs;
    },
    readPayment: async (merchantPay, id) => {
      readCalls.push(id);
      if (chainDown) throw new Error("header not found");
      return chain.get(id) ?? { merchant: "0x0000000000000000000000000000000000000000", gross: 0n, payer: "0x0000000000000000000000000000000000000000", refunded: 0n };
    },
  },
});

const { GET: list } = await import("../app/api/v1/payments/route.ts");
const { createSession, recordPayment } = await import("../lib/sessions.ts");

const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}` };
async function get(query = "", headers = auth) {
  const res = await list(new Request(`http://shop.test/api/v1/payments${query}`, { headers }));
  return { res, data: await res.json() };
}

before(setupDb);
beforeEach(async () => {
  await resetDb();
  indexDown = false;
  chainDown = false;
  indexCalls.length = 0;
  readCalls.length = 0;
  // payments 1–5 in the index; 3 is an invoice's, 4 was refunded in part, and the index says 99.00 for 4 while the
  // chain says 25.00 (the index is untrusted: ids only; code review 006 M2)
  logs = [log(1n), log(2n), log(3n, { invoiceId: 7n, gross: 10_100_000n }), log(4n, { gross: 99_000_000n }), log(5n)];
  chain = new Map(logs.map((l) => [l.paymentId, { merchant: MERCHANT, gross: l.paymentId === 4n ? 25_000_000n : l.gross, payer: PAYER, refunded: l.paymentId === 4n ? 5_000_000n : 0n }]));
});

test("listing payments needs the shop's key", async () => {
  assert.equal((await get("", {})).res.status, 401);
  assert.equal((await get("", { authorization: "Bearer nope" })).res.status, 401);
  assert.equal(indexCalls.length, 0, "nothing is read for a caller without the key");
});

test("lists MERCHANT_ADDRESS's payments newest first, in the SDK's shape, amounts and refunds from the chain", async () => {
  const session = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: 25_000_000n, reference: "A-1042", items: [] });
  await recordPayment(session.id, { txHash: tx(5n), blockNumber: "1", paymentId: "5", from: PAYER, paidAt: Date.now(), amount: 25_000_000n });
  const { res, data } = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(indexCalls, [[MERCHANT_PAY, { merchant: MERCHANT }]], "the index is asked for this merchant only");
  assert.deepEqual(data.data.map((p) => p.paymentId), ["5", "4", "3", "2", "1"]);
  assert.deepEqual(data.data[0], { paymentId: "5", sessionId: session.id, invoiceId: null, amount: "25.00", refunded: "0.00", txHash: tx(5n), paidAt: "2026-11-06T00:05:00.000Z", reference: "A-1042" });
  assert.deepEqual([data.data[1].amount, data.data[1].refunded], ["25.00", "5.00"], "the amount is payments(id).gross on chain, never the index's 99.00");
  assert.deepEqual([data.data[2].invoiceId, data.data[2].sessionId, data.data[2].amount, data.data[2].reference], ["7", null, "10.10", ""]);
  assert.equal(data.next, null);
});

test("a payment the index lists but the chain gives to another merchant (or doesn't have) is left out", async () => {
  chain.set(2n, { ...chain.get(2n), merchant: OTHER });
  chain.delete(1n);
  const { data } = await get();
  assert.deepEqual(data.data.map((p) => p.paymentId), ["5", "4", "3"]);
});

test("limit and cursor page through the list without gaps or repeats, reading only the page on chain", async () => {
  const first = await get("?limit=2");
  assert.deepEqual([first.data.data.map((p) => p.paymentId), first.data.next], [["5", "4"], "4"]);
  assert.deepEqual(readCalls, [5n, 4n]);
  const second = await get(`?limit=2&cursor=${first.data.next}`);
  assert.deepEqual([second.data.data.map((p) => p.paymentId), second.data.next], [["3", "2"], "2"]);
  const last = await get(`?limit=2&cursor=${second.data.next}`);
  assert.deepEqual([last.data.data.map((p) => p.paymentId), last.data.next], [["1"], null]);
});

test("limit is 1–100 and cursor a payment id; anything else is a 400", async () => {
  for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?limit=2.5", "?cursor=abc", "?cursor=-1", "?cursor=0x05"]) {
    const { res, data } = await get(query);
    assert.equal(res.status, 400, query);
    assert.equal(typeof data.error, "string");
  }
  assert.equal((await get("?limit=100")).res.status, 200);
});

test("when the log index or the chain can't be read the list fails with 503, never a partial or empty list", async () => {
  // one failure at a time (code review 006 M1: the chain case used to run with the index down too)
  for (const [index, chainRead] of [[true, false], [false, true]]) {
    indexDown = index;
    chainDown = chainRead;
    const { res, data } = await get();
    assert.equal(res.status, 503, index ? "index down" : "chain down");
    assert.match(data.error, /try again/i);
    assert.equal(indexCalls.length > 0, true);
  }
  assert.ok(readCalls.length > 0, "the chain-down case really reached the chain reads");
});

test("a payment the chain shows for this merchant but with no gross (no such payment) is left out", async () => {
  chain.set(3n, { merchant: MERCHANT, gross: 0n, payer: PAYER, refunded: 0n });
  const { data } = await get();
  assert.deepEqual(data.data.map((p) => p.paymentId), ["5", "4", "2", "1"]);
});
