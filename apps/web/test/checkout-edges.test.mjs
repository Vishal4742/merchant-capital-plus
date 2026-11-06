// Tester checks (batch 004 round 1) for spec criteria the builder's tests leave open: the create limits, the pay
// route's input and window checks, 404/410, the pending margin, a failed chain read never reopening a checkout,
// polling an expired checkout, cookie flags and per-wallet payments. Run from apps/web: npm test
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";

process.env.MERCHANT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
process.env.AUTH_SECRET = "test-auth-secret-0123456789abcdef0123";
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";

let settled = async () => null;
mock.module("../lib/onchain.ts", {
  namedExports: { saleSettled: (...args) => settled(...args), readUsdtBalance: async () => 1_000_000_000n, readPayment: async () => ({ merchant: process.env.MERCHANT_ADDRESS, gross: 1n, payer: process.env.MERCHANT_ADDRESS, refunded: 0n }) },
});

const { POST: createSession } = await import("../app/api/v1/sessions/route.ts");
const { POST: pay } = await import("../app/api/v1/sessions/[id]/pay/route.ts");
const { GET: status } = await import("../app/api/v1/sessions/[id]/route.ts");
const { POST: logoutRoute } = await import("../app/api/auth/logout/route.ts");
const { GET: nonceRoute } = await import("../app/api/auth/nonce/route.ts");
const { POST: verifyRoute } = await import("../app/api/auth/verify/route.ts");
const { POST: demoCheckout } = await import("../app/api/demo-checkout/route.ts");
const { getSession, listPayments, recordPayment, SESSION_TTL_MS } = await import("../lib/sessions.ts");
const { saleAuthorization, SIGNATURE_WINDOW_S } = await import("../lib/pay.ts");

const customer = privateKeyToAccount(generatePrivateKey());
const relayCalls = [];
let relayReply;
globalThis.fetch = async (url) => {
  relayCalls.push(String(url));
  return relayReply();
};
const ok = () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "7" });

beforeEach(() => {
  relayCalls.length = 0;
  settled = async () => null;
  relayReply = async () => ok();
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://relayer.test";
});

const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" };
const create = async (body) => {
  const res = await createSession(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: auth, body: JSON.stringify(body) }));
  return { res, data: await res.json() };
};
const now = () => Math.floor(Date.now() / 1000);
async function signed(id, { validBefore = BigInt(now() + 600), signer = customer, from = customer.address, orderRef } = {}) {
  const s = getSession(id);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const sale = { merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: orderRef ?? s.orderRef, amount: s.amount };
  const signature = await signer.signTypedData(saleAuthorization(sale, from, salt, validBefore));
  return { from, salt, validBefore: validBefore.toString(), signature };
}
const callPay = (id, body) => pay(new Request(`http://shop.test/api/v1/sessions/${id}/pay`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const poll = (id) => status(new Request(`http://shop.test/api/v1/sessions/${id}`, { headers: auth }), { params: Promise.resolve({ id }) });
const timeout = async () => {
  throw new DOMException("timed out", "TimeoutError");
};

test("create: 1.00 and 10,000.00 are accepted; 10,000.01 is not; the reply is {id, url, amount, currency, expiresAt} with a 30 min expiry", async () => {
  assert.equal((await create({ amount: "1.00" })).res.status, 201);
  assert.equal((await create({ amount: "10000.00" })).res.status, 201);
  assert.equal((await create({ amount: "10000.01" })).res.status, 400);
  assert.equal((await create({ amount: 25 })).res.status, 400, "a number, not a string");
  const before = Date.now();
  const { data } = await create({ amount: "25.00" });
  assert.deepEqual(Object.keys(data).sort(), ["amount", "currency", "expiresAt", "id", "url"]);
  const ttl = Date.parse(data.expiresAt) - before;
  assert.ok(ttl >= SESSION_TTL_MS - 1000 && ttl <= SESSION_TTL_MS + 1000, `expiry ${ttl} ms`);
  assert.equal(SESSION_TTL_MS, 30 * 60 * 1000);
});

test("create: at most 20 items, qty 1-999 whole numbers, a parseable price, and a list", async () => {
  const item = { name: "Tea", qty: 1, price: "1.00" };
  assert.equal((await create({ amount: "20.00", items: Array(20).fill(item) })).res.status, 201);
  assert.equal((await create({ amount: "21.00", items: Array(21).fill(item) })).res.status, 400);
  for (const qty of [0, 1000, 1.5, -1]) assert.equal((await create({ amount: "1.00", items: [{ ...item, qty }] })).res.status, 400, `qty ${qty}`);
  assert.equal((await create({ amount: "999.00", items: [{ ...item, qty: 999 }] })).res.status, 201);
  assert.equal((await create({ amount: "1.00", items: [{ ...item, price: "1.0000001" }] })).res.status, 400);
  assert.equal((await create({ amount: "1.00", items: [{ ...item, name: " " }] })).res.status, 400);
  assert.equal((await create({ amount: "1.00", items: { name: "Tea" } })).res.status, 400);
});

test("pay: an unknown checkout is 404 and an expired one 410, before anything is relayed", async () => {
  assert.equal((await callPay("00000000-0000-0000-0000-000000000000", {})).status, 404);
  const { data } = await create({ amount: "25.00" });
  const body = await signed(data.id);
  getSession(data.id).expiresAt = Date.now() - 1;
  assert.equal((await callPay(data.id, body)).status, 410);
  assert.equal(relayCalls.length, 0);
});

test("pay: malformed from, salt, signature or validBefore is 400 and the relayer is not called", async () => {
  const { data } = await create({ amount: "25.00" });
  const good = await signed(data.id);
  for (const [what, bad] of [
    ["from", { ...good, from: "0x123" }],
    ["salt", { ...good, salt: "0x1234" }],
    ["signature", { ...good, signature: good.signature.slice(0, 100) }],
    ["validBefore text", { ...good, validBefore: "soon" }],
    ["validBefore number", { ...good, validBefore: Number(good.validBefore) }],
  ]) {
    assert.equal((await callPay(data.id, bad)).status, 400, what);
  }
  assert.equal(relayCalls.length, 0);
});

test("pay: validBefore must sit in the relayer's now+30 s ... now+15 min window; the browser's 465 s is inside it", async () => {
  const { data } = await create({ amount: "25.00" });
  assert.equal((await callPay(data.id, await signed(data.id, { validBefore: BigInt(now() + 30) }))).status, 400, "now+30");
  assert.equal((await callPay(data.id, await signed(data.id, { validBefore: BigInt(now() + 15 * 60 + 2) }))).status, 400, "past 15 min");
  assert.equal(relayCalls.length, 0);
  assert.equal(SIGNATURE_WINDOW_S, 465);
  assert.ok(SIGNATURE_WINDOW_S - 30 >= 7 * 60 && 900 - SIGNATURE_WINDOW_S >= 7 * 60, "about 7 min of clock skew either way");
  relayReply = async () => ok();
  settled = async () => "1";
  assert.equal((await callPay(data.id, await signed(data.id, { validBefore: BigInt(now() + SIGNATURE_WINDOW_S) }))).status, 200);
});

test("pay: a signature by another key, or for another order, is refused with 400 before the relayer", async () => {
  const { data } = await create({ amount: "25.00" });
  const intruder = privateKeyToAccount(generatePrivateKey());
  assert.equal((await callPay(data.id, await signed(data.id, { signer: intruder }))).status, 400, "signed by someone else, claims the customer");
  assert.equal((await callPay(data.id, await signed(data.id, { orderRef: `0x${"99".repeat(32)}` }))).status, 400, "another order");
  assert.equal(relayCalls.length, 0);
});

// verifyTypedData throws on a malformed signature (bad v, r = 0, a point off the curve); the route treats that as a
// mismatch (tester R1 OPEN 1, fixed in round 2).
test("pay: a malformed 65-byte signature is a 400 mismatch, not a 500", async () => {
  const { data } = await create({ amount: "25.00" });
  const good = await signed(data.id);
  for (const signature of [`0x${"11".repeat(65)}`, `0x${"00".repeat(65)}`, `0x${"11".repeat(64)}1b`]) {
    assert.equal((await callPay(data.id, { ...good, signature })).status, 400, signature.slice(-4));
  }
  assert.equal(relayCalls.length, 0);
});

test("pay: a paid checkout answers 409 with its receiptId and is never relayed again", async () => {
  const { data } = await create({ amount: "25.00" });
  settled = async () => "1";
  assert.equal((await callPay(data.id, await signed(data.id))).status, 200);
  const again = await callPay(data.id, await signed(data.id));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).receiptId, data.id);
  assert.equal(relayCalls.length, 1);
});

test("pay: a relayer 500 (any 5xx) is an unknown outcome: pending, never 'Nothing was charged'", async () => {
  const { data } = await create({ amount: "25.00" });
  relayReply = async () => Response.json({ error: "boom" }, { status: 500 });
  const res = await callPay(data.id, await signed(data.id));
  assert.equal(res.status, 504);
  assert.doesNotMatch((await res.json()).error, /Nothing was charged/);
  assert.ok(getSession(data.id).pending, "pending recorded");
});

test("pay: ENOTFOUND and EAI_AGAIN never reached the relayer: unlock with 'Nothing was charged'", async () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
    const { data } = await create({ amount: "25.00" });
    relayReply = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
    };
    const res = await callPay(data.id, await signed(data.id));
    assert.equal(res.status, 503, code);
    assert.match((await res.json()).error, /Nothing was charged/);
    assert.equal(getSession(data.id).pending, undefined, code);
  }
});

test("pending: still pending inside the 60 s clock margin after validBefore, open after it", async () => {
  const { data } = await create({ amount: "25.00" });
  relayReply = timeout;
  assert.equal((await callPay(data.id, await signed(data.id))).status, 504);
  getSession(data.id).pending.validBefore = BigInt(now() - 30);
  assert.equal((await callPay(data.id, await signed(data.id))).status, 409, "30 s past validBefore: USDT might still settle on a skewed chain clock");
  getSession(data.id).pending.validBefore = BigInt(now() - 61);
  let relayed = false;
  relayReply = async () => ((relayed = true), ok());
  settled = async () => (relayed ? "4" : null); // not on chain until the new attempt is relayed
  assert.equal((await callPay(data.id, await signed(data.id))).status, 200);
  assert.equal(relayCalls.length, 2);
});

test("pending: a failed chain read never reopens the checkout, even long past validBefore", async () => {
  const { data } = await create({ amount: "25.00" });
  relayReply = timeout;
  await callPay(data.id, await signed(data.id));
  getSession(data.id).pending.validBefore = 0n;
  settled = async () => {
    throw new Error("rpc down");
  };
  const res = await callPay(data.id, await signed(data.id));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Don't pay again/);
  assert.equal((await (await poll(data.id)).json()).status, "pending");
  assert.equal(relayCalls.length, 1);
});

test("poll: an open checkout past its expiry reads 'expired'; a paid one stays 'paid'", async () => {
  const open = await create({ amount: "25.00" });
  getSession(open.data.id).expiresAt = Date.now() - 1;
  assert.equal((await (await poll(open.data.id)).json()).status, "expired");
  const paid = await create({ amount: "25.00" });
  settled = async () => "2";
  assert.equal((await callPay(paid.data.id, await signed(paid.data.id))).status, 200);
  getSession(paid.data.id).expiresAt = Date.now() - 1;
  assert.equal((await (await poll(paid.data.id)).json()).status, "paid");
});

test("dashboard data: each wallet lists only payments made to its own address", async () => {
  const { data } = await create({ amount: "25.00" });
  recordPayment(data.id, { txHash: null, blockNumber: null, paymentId: "77", from: customer.address, paidAt: Date.now() });
  assert.ok(listPayments(process.env.MERCHANT_ADDRESS.toUpperCase().replace("0X", "0x")).some((p) => p.session.id === data.id), "the shop's wallet, any case");
  assert.deepEqual(listPayments("0x9999999999999999999999999999999999999999"), []);
});

test("cookies: nonce 5 min and session 8 h, HttpOnly, SameSite=Lax, Secure only on https; logout clears the session", async () => {
  const http = (await nonceRoute(new Request("http://shop.test/api/auth/nonce"))).headers.get("set-cookie");
  assert.match(http, /^mc_nonce=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=300$/);
  const https = (await nonceRoute(new Request("https://shop.test/api/auth/nonce"))).headers.get("set-cookie");
  assert.match(https, /; Secure$/);
  const { SESSION_TTL_S, setCookie } = await import("../lib/auth.ts");
  assert.equal(SESSION_TTL_S, 8 * 60 * 60);
  assert.equal(setCookie("mc_session", "v", SESSION_TTL_S, true), "mc_session=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure");
  const out = await logoutRoute(new Request("https://shop.test/api/auth/logout", { method: "POST" }));
  assert.equal(out.headers.get("set-cookie"), "mc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
});

test("verify: a valid nonce cookie with a message for another nonce, or an oversized message, is 401", async () => {
  const { createSiweMessage } = await import("viem/siwe");
  const merchant = privateKeyToAccount(generatePrivateKey());
  const res = await nonceRoute(new Request("http://shop.test/api/auth/nonce"));
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const msg = createSiweMessage({ address: merchant.address, chainId: 1874, domain: "shop.test", nonce: "otherNonce12345678", uri: "http://shop.test", version: "1", expirationTime: new Date(Date.now() + 60_000) });
  const v = (message) => verifyRoute(new Request("http://shop.test/api/auth/verify", { method: "POST", headers: { cookie }, body: JSON.stringify({ message, signature: "0x" + "11".repeat(65) }) }));
  assert.equal((await v(msg)).status, 401);
  assert.equal((await v("x".repeat(2_001))).status, 401);
});

// Round 2 (tester): two mutants survived the builder's round-2 tests.
test("pay: an expired checkout whose pending attempt is dead (chain: not paid) answers 410 and relays nothing new", async () => {
  const { data } = await create({ amount: "25.00", reference: "BB-X1" });
  relayReply = timeout;
  assert.equal((await callPay(data.id, await signed(data.id))).status, 504);
  const session = getSession(data.id);
  session.pending = { ...session.pending, validBefore: BigInt(now() - 120) }; // past validBefore + 60 s
  session.expiresAt = Date.now() - 1;
  relayReply = async () => ok();
  const res = await callPay(data.id, await signed(data.id));
  assert.equal(res.status, 410);
  assert.equal(relayCalls.length, 1); // only the first attempt ever reached the relayer
});

test("pay: a relayer 200 with a malformed txHash is an unknown outcome, never a recorded payment", async () => {
  const { data } = await create({ amount: "25.00", reference: "BB-X2" });
  settled = async () => "9"; // the chain would say paid; the txHash is still not trusted as a record
  relayReply = async () => Response.json({ txHash: "0xnothex", blockNumber: "7" });
  const res = await callPay(data.id, await signed(data.id));
  assert.equal(res.status, 504);
  assert.equal(getSession(data.id).payment, undefined);
});

// Batch 005: security review 004 R2 F1, and code review 004 R2 F5 (guards no test pinned yet).
test("pay: a payment still in flight when the checkout expires answers 409 (confirming), never 410 'ask for a new one'", async () => {
  const { data } = await create({ amount: "25.00" });
  let release;
  relayReply = () => new Promise((resolve) => (release = () => resolve(ok())));
  const paying = callPay(data.id, await signed(data.id));
  await new Promise((r) => setTimeout(r, 20));
  getSession(data.id).expiresAt = Date.now() - 1;
  const second = await callPay(data.id, await signed(data.id));
  assert.equal(second.status, 409);
  assert.doesNotMatch((await second.json()).error, /new one/);
  settled = async () => "1";
  release();
  assert.equal((await paying).status, 200);
});

test("create: qty 1000 is refused even when the items add up (M26)", async () => {
  assert.equal((await create({ amount: "1000.00", items: [{ name: "Tea", qty: 1000, price: "1.00" }] })).res.status, 400);
});

test("demo checkout: a plain POST answers 303 to a new /checkout/<uuid> (N26)", async () => {
  const res = await demoCheckout(new Request("http://shop.test/api/demo-checkout", { method: "POST" }));
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /^http:\/\/shop\.test\/checkout\/[0-9a-f-]{36}$/);
});
