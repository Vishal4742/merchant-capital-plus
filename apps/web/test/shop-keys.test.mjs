// claude-frontend checks for merchant API keys on our shop routes (FR-GW-5, FR-GW-6): POST /api/v1/sessions and
// GET /api/v1/payments take a merchant's own sk_ key, refuse a pk_ key (403) and a revoked one (401), keep the demo
// shop's SHOP_API_KEY working, and never show one merchant's checkouts to another. Real Postgres (PGlite) for the keys;
// the chain is faked. Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { MERCHANT, OTHER_MERCHANT, resetDb, setupDb } from "./gw-helpers.mjs";

const DEMO_SHOP = "0x3333333333333333333333333333333333333333";
const MERCHANT_PAY = "0x4444444444444444444444444444444444444444";
process.env.MERCHANT_ADDRESS = DEMO_SHOP;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
process.env.RELAYER_URL = "http://relayer.test";

const tx = (n) => `0x${n.toString(16).padStart(64, "0")}`;
let logs = [];
let chain = new Map();
const indexCalls = [];
mock.module("../lib/onchain.ts", {
  namedExports: {
    paidLogs: async (...args) => (indexCalls.push(args), logs),
    readPayment: async (_, id) => chain.get(id),
    saleSettled: async () => null, // the poll route settles a pending checkout first; none here are pending
  },
});

before(setupDb);
beforeEach(async () => {
  await resetDb();
  indexCalls.length = 0;
  logs = [];
  chain = new Map();
});

const { POST: createRoute } = await import("../app/api/v1/sessions/route.ts");
const { GET: paymentsRoute } = await import("../app/api/v1/payments/route.ts");
const { GET: statusRoute } = await import("../app/api/v1/sessions/[id]/route.ts");
const { createKey, revokeKey } = await import("../lib/server/keys.ts");
const { createSession, getSession, recordPayment } = await import("../lib/sessions.ts");

const bearer = (key) => ({ authorization: `Bearer ${key}` });
async function checkout(headers, body = { amount: "25.00", reference: "A-1" }) {
  const res = await createRoute(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  return { res, data: await res.json() };
}
async function payments(headers) {
  const res = await paymentsRoute(new Request("http://shop.test/api/v1/payments", { headers }));
  return { res, data: await res.json() };
}

test("a merchant's sk_ key creates a checkout that belongs to that merchant", async () => {
  const { key } = await createKey(MERCHANT, "Shop server", "sk");
  const { res, data } = await checkout(bearer(key));
  assert.equal(res.status, 201);
  const session = getSession(data.id);
  assert.equal(session.merchant.toLowerCase(), MERCHANT);
  assert.equal(session.merchantName, "0x1111…1111", "a merchant without a configured name shows its short address");
});

test("a pk_ key is for the browser: 403 on both routes, nothing created or read", async () => {
  const { key } = await createKey(MERCHANT, "Pay button", "pk");
  const before = globalThis.__mcSessions?.size ?? 0;
  for (const { res, data } of [await checkout(bearer(key)), await payments(bearer(key))]) {
    assert.equal(res.status, 403);
    assert.equal(data.error, "Use a secret key (sk_…) on your server.");
  }
  assert.equal(globalThis.__mcSessions?.size ?? 0, before);
  assert.equal(indexCalls.length, 0);
});

test("a revoked sk_ key gets 401 on both routes", async () => {
  const { key, record } = await createKey(MERCHANT, "Old server", "sk");
  assert.equal(await revokeKey(MERCHANT, record.id), true);
  assert.equal((await checkout(bearer(key))).res.status, 401);
  assert.equal((await payments(bearer(key))).res.status, 401);
  assert.equal((await checkout(bearer("sk_test_" + "A".repeat(32)))).res.status, 401, "an unknown key too");
});

test("SHOP_API_KEY still opens checkouts for the demo shop", async () => {
  const { res, data } = await checkout(bearer(process.env.SHOP_API_KEY));
  assert.equal(res.status, 201);
  assert.equal(getSession(data.id).merchant, DEMO_SHOP);
  assert.equal(getSession(data.id).merchantName, "Bandra Beans");
});

test("another merchant's checkout stays invisible: its Idempotency-Key slot and its payments", async () => {
  const mine = (await createKey(MERCHANT, "A", "sk")).key;
  const theirs = (await createKey(OTHER_MERCHANT, "B", "sk")).key;
  const first = await checkout({ ...bearer(mine), "idempotency-key": "order-42" });
  const second = await checkout({ ...bearer(theirs), "idempotency-key": "order-42" });
  assert.equal(second.res.status, 201);
  assert.notEqual(second.data.id, first.data.id, "the same key from another merchant never replays the first checkout");
  assert.equal(getSession(second.data.id).merchant.toLowerCase(), OTHER_MERCHANT);

  // payment 1 is MERCHANT's (with a checkout), payment 2 is OTHER_MERCHANT's: each key lists only its own
  const session = createSession({ merchant: MERCHANT, merchantName: "A", amount: 25_000_000n, reference: "A-secret", items: [] });
  recordPayment(session.id, { txHash: tx(1n), blockNumber: "1", paymentId: "1", from: MERCHANT, paidAt: Date.now() });
  logs = [1n, 2n].map((id) => ({ paymentId: id, invoiceId: 0n, gross: 25_000_000n, txHash: tx(id), time: Date.UTC(2026, 10, 6) }));
  chain = new Map([
    [1n, { merchant: MERCHANT, gross: 25_000_000n, payer: MERCHANT, refunded: 0n }],
    [2n, { merchant: OTHER_MERCHANT, gross: 25_000_000n, payer: MERCHANT, refunded: 0n }],
  ]);
  const listed = await payments(bearer(theirs));
  assert.equal(listed.res.status, 200);
  assert.equal(indexCalls.at(-1)[1].merchant.toLowerCase(), OTHER_MERCHANT, "the index is asked for the key's merchant");
  assert.deepEqual(listed.data.data.map((p) => p.paymentId), ["2"]);
  assert.ok(!JSON.stringify(listed.data).includes("A-secret"));
  assert.deepEqual((await payments(bearer(mine))).data.data.map((p) => [p.paymentId, p.reference]), [["1", "A-secret"]]);
});

test("GET /api/v1/sessions/:id: a merchant's sk_ key polls its own checkout, never another merchant's", async () => {
  const { key } = await createKey(MERCHANT, "Shop server", "sk");
  const own = createSession({ merchant: MERCHANT, merchantName: "Own shop", amount: 5_000_000n, reference: "K-1", items: [] });
  const other = createSession({ merchant: OTHER_MERCHANT, merchantName: "Other shop", amount: 5_000_000n, reference: "K-2", items: [] });
  const poll = (id) => statusRoute(new Request(`http://shop.test/api/v1/sessions/${id}`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id }) });
  const mine = await poll(own.id);
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).status, "open");
  assert.equal((await poll(other.id)).status, 404, "the same answer as a missing checkout");
});
