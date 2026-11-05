// reviewer-security probes for batch 004 round 1: the pay route's pending/expiry/poll edges.
// Same harness as apps/web/test/checkout-api.test.mjs (mocked chain read and relayer fetch). Test-only env values.
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const WEB = "/Users/vg890/ethglobal/apps/web";
const require = createRequire(`${WEB}/package.json`);
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { toHex } = require("viem");

process.env.MERCHANT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.SHOP_API_KEY = "probe-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = "0x2222222222222222222222222222222222222222";
process.env.RELAYER_URL = "http://relayer.test";
const MERCHANT_PAY = process.env.MERCHANT_PAY_ADDRESS;

let settled = async () => null;
mock.module(`${WEB}/lib/onchain.ts`, { namedExports: { saleSettled: (...a) => settled(...a) } });
const { POST: createSession } = await import(`${WEB}/app/api/v1/sessions/route.ts`);
const { POST: pay } = await import(`${WEB}/app/api/v1/sessions/[id]/pay/route.ts`);
const { GET: status } = await import(`${WEB}/app/api/v1/sessions/[id]/route.ts`);
const { getSession } = await import(`${WEB}/lib/sessions.ts`);
const { saleAuthorization } = await import(`${WEB}/lib/pay.ts`);

let relayReply;
let relayCalls = 0;
globalThis.fetch = async () => (relayCalls++, relayReply());
beforeEach(() => {
  settled = async () => null;
  relayCalls = 0;
});

const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" };
async function newSession() {
  const res = await createSession(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: auth, body: JSON.stringify({ amount: "25.00" }) }));
  return (await res.json()).id;
}
async function signed(id, account, windowS = 600) {
  const s = getSession(id);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + windowS);
  const sale = { merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount: s.amount };
  const signature = await account.signTypedData(saleAuthorization(sale, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}
const callPay = (id, body) => pay(new Request(`http://shop.test/x`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const poll = async (id) => (await status(new Request("http://shop.test/x", { headers: auth }), { params: Promise.resolve({ id }) })).json();

test("P1: a stranger with the checkout URL locks the real customer out for validBefore + 60 s via a 422 replay", async () => {
  const id = await newSession();
  const stranger = privateKeyToAccount(generatePrivateKey()); // unfunded; its nonce was burned on-chain beforehand
  relayReply = async () => Response.json({ code: "replay", error: "this authorization was already used" }, { status: 422 });
  const r1 = await callPay(id, await signed(id, stranger, 900));
  assert.equal(r1.status, 504);
  assert.equal(getSession(id).pending?.from, stranger.address, "pending is pinned to the stranger");
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "1" });
  const r2 = await callPay(id, await signed(id, customer));
  assert.equal(r2.status, 409);
  assert.match((await r2.json()).error, /Don't pay again/);
  assert.equal(relayCalls, 1, "the customer's payment never reached the relayer");
  console.log(`P1 lockout until ${Number(getSession(id).pending.validBefore) + 60 - Math.floor(Date.now() / 1000)} s from now`);
});

test("P2: an expired checkout with a pending attempt answers 'Ask the shop for a new one' without asking the chain", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => new Response("bad gateway", { status: 502 });
  assert.equal((await callPay(id, await signed(id, customer))).status, 504);
  assert.ok(getSession(id).pending);
  getSession(id).expiresAt = Date.now() - 1; // probe only: the 30 min TTL passes while the outcome is unknown
  let chainAsked = false;
  settled = async () => ((chainAsked = true), "7"); // the first attempt did land
  const r = await callPay(id, await signed(id, customer));
  const body = await r.json();
  assert.equal(r.status, 410);
  assert.match(body.error, /Ask the shop for a new one/);
  assert.equal(chainAsked, false, "the landed payment was never looked up");
  console.log("P2 pay route:", r.status, body.error);
  console.log("P2 shop poll:", (await poll(id)).status);
});

test("P3: a 422 whose chain check fails still says 'Nothing was charged; start again'", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => Response.json({ code: "would_revert", error: "OrderPaid()" }, { status: 422 });
  settled = async () => {
    throw new Error("header not found");
  };
  const r = await callPay(id, await signed(id, customer));
  const body = await r.json();
  assert.equal(r.status, 400);
  assert.match(body.error, /Nothing was charged/);
  console.log("P3:", r.status, body.error);
});

test("P4: the shop's poll says open, then expired, while a payment is in flight; then paid", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  let release;
  relayReply = () => new Promise((resolve) => (release = () => resolve(Response.json({ txHash: `0x${"cd".repeat(32)}`, blockNumber: "9" }))));
  const inFlight = callPay(id, await signed(id, customer));
  await new Promise((r) => setTimeout(r, 50));
  const during = (await poll(id)).status;
  getSession(id).expiresAt = Date.now() - 1; // probe only: the TTL passes mid-relay
  const duringExpired = (await poll(id)).status;
  settled = async () => "3";
  release();
  assert.equal((await inFlight).status, 200);
  const after = (await poll(id)).status;
  console.log("P4 statuses:", { during, duringExpired, after });
  assert.deepEqual([during, duringExpired, after], ["open", "expired", "paid"]);
});
