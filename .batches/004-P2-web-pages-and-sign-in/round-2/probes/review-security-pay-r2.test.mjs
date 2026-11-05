// reviewer-security probes for batch 004 round 2: the round-2 money design (fresh salt per attempt, replay as a
// refusal, compare-and-clear, first-write-wins) and the residual edges. Same harness as round 1: mocked chain read
// and relayer fetch, throwaway keys, test-only env values. Asserts what the code does today; comments say if it's OK.
import { test, beforeEach, afterEach, mock } from "node:test";
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
const { saleAuthorization, saleNonce } = await import(`${WEB}/lib/pay.ts`);

let relayReply;
let relayCalls = 0;
const relayBodies = [];
globalThis.fetch = async (_url, init) => (relayCalls++, relayBodies.push(JSON.parse(init.body)), relayReply());
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
beforeEach(() => {
  settled = async () => null;
  relayCalls = 0;
  relayBodies.length = 0;
  shift = 0;
});
afterEach(() => (shift = 0));

const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" };
async function newSession() {
  const res = await createSession(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: auth, body: JSON.stringify({ amount: "25.00" }) }));
  return (await res.json()).id;
}
async function signed(id, account, windowS = 465) {
  const s = getSession(id);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + windowS);
  const sale = { merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount: s.amount };
  const signature = await account.signTypedData(saleAuthorization(sale, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}
const callPay = (id, body) => pay(new Request(`http://shop.test/x`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const poll = async (id) => (await status(new Request("http://shop.test/x", { headers: auth }), { params: Promise.resolve({ id }) })).json();
const waitFor = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(cond(), "waitFor timed out"); };
const ok = (hash = "ab") => async () => Response.json({ txHash: `0x${hash.repeat(32)}`, blockNumber: "1" });

test("R1 (S2 closed): a stranger's 422 replay is a refusal; the customer's next attempt relays at once", async () => {
  const id = await newSession();
  const stranger = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => Response.json({ code: "replay" }, { status: 422 });
  const r1 = await callPay(id, await signed(id, stranger, 900));
  assert.equal(r1.status, 400);
  assert.equal(getSession(id).pending, undefined, "no pending for the stranger");
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = ok();
  settled = async (sale) => (sale.payer === customer.address ? "5" : null);
  const r2 = await callPay(id, await signed(id, customer));
  assert.equal(r2.status, 200);
  assert.equal(relayCalls, 2);
  console.log("R1:", r1.status, "then customer", r2.status, "relayCalls", relayCalls);
});

test("R2 (S1 closed): expired + pending → 409 pending while it may land; receipt if it did; 410 only once it's dead", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => new Response("bad gateway", { status: 502 });
  shift = 29 * 60 * 1000; // the attempt starts a minute before the 30 min TTL ends
  assert.equal((await callPay(id, await signed(id, customer))).status, 504);
  shift = 31 * 60 * 1000; // TTL passed; the approval (validBefore = 29 min + 465 s) is still live
  const stillLive = await callPay(id, await signed(id, customer));
  const stillLiveBody = await stillLive.json();
  assert.equal(stillLive.status, 409);
  assert.match(stillLiveBody.error, /Don't pay again/);
  settled = async () => "7";
  const landed = await callPay(id, await signed(id, customer));
  const landedBody = await landed.json();
  assert.equal(landed.status, 409);
  assert.equal(landedBody.receiptId, id);
  // a second session: pending, TTL passed and the approval dead (validBefore + 60 s), chain says not paid
  shift = 0;
  const id2 = await newSession();
  relayReply = async () => new Response("bad gateway", { status: 502 });
  settled = async () => null;
  shift = 29 * 60 * 1000;
  await callPay(id2, await signed(id2, customer));
  shift = (29 * 60 + 465 + 61) * 1000;
  const dead = await callPay(id2, await signed(id2, customer));
  assert.equal(dead.status, 410);
  assert.equal(relayCalls, 2, "nothing relayed after expiry");
  console.log("R2:", { stillLive: stillLive.status, landed: [landed.status, landedBody.receiptId === id], dead: dead.status });
});

test("R3 (S1 residual): an attempt in flight at expiry; a second view gets 410 'Ask the shop for a new one', then the first lands", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  let release;
  relayReply = () => new Promise((resolve) => (release = () => resolve(Response.json({ txHash: `0x${"cd".repeat(32)}`, blockNumber: "9" }))));
  shift = 30 * 60 * 1000 - 5_000; // the attempt starts 5 s before the TTL ends
  const first = callPay(id, await signed(id, customer));
  await waitFor(() => typeof release === "function");
  shift = 30 * 60 * 1000 + 5_000; // the relay takes 10 s; the TTL passes meanwhile
  const second = await callPay(id, await signed(id, customer)); // a second tab, a reload's retry, or "Check again" then hold
  const secondBody = await second.json();
  settled = async () => "11";
  release();
  const firstRes = await first;
  console.log("R3: second view", second.status, secondBody.error, "| first attempt", firstRes.status, "| poll", (await poll(id)).status);
  assert.equal(second.status, 410);
  assert.match(secondBody.error, /Ask the shop for a new one/);
  assert.equal(firstRes.status, 200);
});

test("R4 (fresh salt): A unknown → B with a new salt is held until A is dead; then B relays with its own nonce", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => new Response("bad gateway", { status: 502 });
  const a = await signed(id, customer);
  assert.equal((await callPay(id, a)).status, 504);
  const b = await signed(id, customer);
  const held = await callPay(id, b);
  assert.equal(held.status, 409);
  assert.equal(relayCalls, 1, "B never reached the relayer while A could still land");
  shift = (465 + 61) * 1000; // A's validBefore + 60 s passed; the chain says A never landed
  const c = await signed(id, customer);
  relayReply = ok("ef");
  let reads = 0;
  settled = async (sale) => (reads++ === 0 ? null : sale.payer === customer.address ? "12" : null); // settle read: A never landed; post-relay read: C did
  const relayed = await callPay(id, c);
  assert.equal(relayed.status, 200);
  const s = getSession(id);
  const nonceA = saleNonce({ merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount: s.amount }, a.salt);
  const nonceC = saleNonce({ merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount: s.amount }, c.salt);
  assert.notEqual(nonceA, nonceC);
  assert.equal(relayBodies[0].args.orderRef, relayBodies[1].args.orderRef, "both attempts name the same order: OrderPaid allows one");
  assert.equal(relayBodies[0].args.merchant, relayBodies[1].args.merchant);
  console.log("R4:", JSON.stringify({ held: held.status, relayedAfterDead: relayed.status, sameOrderRef: relayBodies[0].args.orderRef === relayBodies[1].args.orderRef, distinctNonces: nonceA !== nonceC }));
});

test("R5 (residual availability): a stranger whose relay ends 502 (e.g. a front-run revert) pins pending for up to 960 s", async () => {
  const id = await newSession();
  const stranger = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => Response.json({ code: "reverted" }, { status: 502 });
  assert.equal((await callPay(id, await signed(id, stranger, 900))).status, 504);
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = ok();
  const r = await callPay(id, await signed(id, customer));
  const lockS = Number(getSession(id).pending.validBefore) + 60 - Math.floor(Date.now() / 1000);
  console.log("R5: customer gets", r.status, "lock", lockS, "s");
  assert.equal(r.status, 409);
  assert.ok(lockS > 900);
});

test("R6 (INFO): reconcile-first race: a poll records the payment with txHash null; the relayed txHash is dropped", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  relayReply = async () => new Response("bad gateway", { status: 502 });
  await callPay(id, await signed(id, customer));
  shift = (465 + 61) * 1000;
  // the poll's chain read is slow and returns after attempt B has landed
  const firstReads = [];
  settled = (sale) => new Promise((resolve) => firstReads.push(() => resolve(sale.payer === customer.address ? "21" : null)));
  const pollP = poll(id);
  await waitFor(() => firstReads.length === 1);
  // the pay request's own settle read: not paid yet → dead → open → relay B
  const payReads = [];
  settled = (sale) => new Promise((resolve) => payReads.push(() => resolve(null)));
  let release;
  relayReply = () => new Promise((resolve) => (release = () => resolve(Response.json({ txHash: `0x${"aa".repeat(32)}`, blockNumber: "30" }))));
  const payP = callPay(id, await signed(id, customer));
  await waitFor(() => payReads.length === 1);
  payReads.shift()(); // pay request: A dead → relays B
  await waitFor(() => typeof release === "function");
  firstReads.shift()(); // poll's read sees B's payment → records txHash null
  await pollP;
  settled = async () => "21";
  release();
  const res = await payP;
  const body = await res.json();
  console.log("R6: response txHash", body.txHash?.slice(0, 10), "| stored txHash", getSession(id).payment.txHash);
  assert.equal(getSession(id).payment.paymentId, "21");
  assert.equal(getSession(id).payment.txHash, null);
});

test("R7: two concurrent attempts with different salts: the second is refused before the relayer", async () => {
  const id = await newSession();
  const customer = privateKeyToAccount(generatePrivateKey());
  let release;
  relayReply = () => new Promise((resolve) => (release = () => resolve(Response.json({ txHash: `0x${"bb".repeat(32)}`, blockNumber: "2" }))));
  settled = async () => "31";
  const first = callPay(id, await signed(id, customer));
  await waitFor(() => typeof release === "function");
  const second = await callPay(id, await signed(id, customer));
  release();
  assert.equal(second.status, 409);
  assert.equal((await first).status, 200);
  assert.equal(relayCalls, 1);
  console.log("R7: second", second.status, "relayCalls", relayCalls);
});
