// Batch 031 round 4 (owner Stage-2 item 7): unknown-payment recovery on the checkout pay + status routes. Same harness as
// checkout-api.test.mjs (chain reads mocked; real SQL on PGlite). Stronger on-chain order/amount binding is Stage 4.
// Run from apps/web: node --experimental-test-module-mocks --test test/unknown-recovery.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, expireSession, agePending } from "./gw-helpers.mjs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";

process.env.MERCHANT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";

// the chain read of the consumer rule (lib/onchain.ts has its own tests). Default, like reality: the sale is
// on-chain (as id 1) only once the relayer has answered 200 for this checkout.
let chainPaid = false;
const onChainIfRelayed = async () => (chainPaid ? "1" : null);
let settled = onChainIfRelayed;
const settledCalls = [];
// the guest's test USDT, read on the server before a payment is locked or relayed (default: plenty)
let balance = 1_000_000_000n;
let balanceReadFails = false;
const balanceReads = [];
mock.module("../lib/onchain.ts", {
  namedExports: {
    saleSettled: (...args) => (settledCalls.push(args), settled(...args)),
    readUsdtBalance: async (...args) => {
      balanceReads.push(args);
      if (balanceReadFails) throw new Error("rpc down");
      return balance;
    },
    readPayment: async () => ({ merchant: process.env.MERCHANT_ADDRESS, gross: 25_000_000n, payer: customer.address, refunded: 0n }),
  },
});

const { POST: createSession } = await import("../app/api/v1/sessions/route.ts");
const { POST: pay } = await import("../app/api/v1/sessions/[id]/pay/route.ts");
const { UNKNOWN } = await import("../lib/relay.ts");
const { GET: status } = await import("../app/api/v1/sessions/[id]/route.ts");
const { getSession } = await import("../lib/sessions.ts");
const { saleAuthorization, saleNonce } = await import("../lib/pay.ts");

const customer = privateKeyToAccount(generatePrivateKey());
const relayCalls = [];
let relayReply = async () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "12300000" });
globalThis.fetch = async (url, init) => {
  relayCalls.push({ url: String(url), body: JSON.parse(init.body) });
  const res = await relayReply();
  if (res.ok) chainPaid = true;
  return res;
};

before(setupDb);
beforeEach(async () => {
  await resetDb();
  balanceReads.length = 0;
  balance = 1_000_000_000n;
  balanceReadFails = false;
  relayCalls.length = 0;
  settledCalls.length = 0;
  chainPaid = false;
  settled = onChainIfRelayed;
  relayReply = async () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "12300000" });
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://relayer.test";
});

const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" };
async function newSession(body = { amount: "25.00", reference: "A-1042", items: [{ name: "Cold brew", qty: 2, price: "10.00" }, { name: "Banana bread", qty: 1, price: "5.00" }] }) {
  const res = await createSession(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: auth, body: JSON.stringify(body) }));
  return { res, data: await res.json() };
}
async function signedBody(id, { amount, account = customer, validBefore = BigInt(Math.floor(Date.now() / 1000) + 600) } = {}) {
  const s = await getSession(id);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const sale = { merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount: amount ?? s.amount };
  const signature = await account.signTypedData(saleAuthorization(sale, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}
const callPay = (id, body) => pay(new Request(`http://shop.test/api/v1/sessions/${id}/pay`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

const TX = `0x${"cd".repeat(32)}`;
const readStatus = async (id) => (await status(new Request(`http://shop.test/api/v1/sessions/${id}`, { headers: auth }), { params: Promise.resolve({ id }) })).json();

test("a lost first response (relayer may have sent it) keeps the tx reference; a retry recovers the same attempt, never relays twice", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ code: "rpc_error", txHash: TX }, { status: 502 });
  const first = await callPay(data.id, await signedBody(data.id));
  assert.equal(first.status, 504);
  assert.equal((await first.json()).error, UNKNOWN);
  assert.equal((await getSession(data.id)).pending.txHash, TX, "the reference is stored with the pending attempt");
  relayReply = async () => Response.json({ txHash: `0x${"ee".repeat(32)}`, blockNumber: "1" });
  const retry = await callPay(data.id, await signedBody(data.id));
  assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /Don't pay again/);
  assert.equal(relayCalls.length, 1, "the retry was not relayed: no second economic execution");
});

test("refresh: the status route keeps showing pending with the same tx reference", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ code: "rpc_error", txHash: TX }, { status: 502 });
  await callPay(data.id, await signedBody(data.id));
  for (let i = 0; i < 2; i++) {
    const s = await readStatus(data.id);
    assert.deepEqual([s.status, s.pendingTxHash, s.txHash], ["pending", TX, null]);
  }
});

test("outages never say 'nothing charged': no relayer answer, and a failed chain read after a relayed 200, both stay pending", async () => {
  const a = (await newSession()).data;
  relayReply = async () => {
    throw Object.assign(new Error("socket hang up"), { cause: { code: "UND_ERR_SOCKET" } });
  };
  const r1 = await callPay(a.id, await signedBody(a.id));
  assert.equal(r1.status, 504);
  assert.doesNotMatch((await r1.json()).error, /nothing was charged/i);
  const b = (await newSession()).data;
  relayReply = async () => Response.json({ txHash: TX, blockNumber: "7" });
  settled = async () => {
    throw new Error("rpc down");
  };
  const r2 = await callPay(b.id, await signedBody(b.id));
  assert.equal(r2.status, 504);
  assert.doesNotMatch((await r2.json()).error, /nothing was charged/i);
  assert.equal((await getSession(b.id)).pending.txHash, TX, "relayed 200 + failed read: the relayer's tx reference is kept");
});

test("a relayer refusal before signing (503) is the only 'nothing was charged', and it is true", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ code: "db_unavailable" }, { status: 503 });
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Nothing was charged/);
  assert.equal((await getSession(data.id)).pending, undefined);
});

test("two submissions at the same moment relay at most once", async () => {
  const { data } = await newSession();
  let release;
  const gate = new Promise((r) => (release = r));
  relayReply = async () => {
    await gate; // hold the first relay open until both requests are in (deterministic overlap)
    return Response.json({ txHash: TX, blockNumber: "3" });
  };
  const p1 = callPay(data.id, await signedBody(data.id));
  const p2 = callPay(data.id, await signedBody(data.id));
  await new Promise((r) => setImmediate(r));
  release();
  const statuses = (await Promise.all([p1, p2])).map((r) => r.status).sort();
  assert.equal(relayCalls.length, 1, "one economic execution");
  assert.ok(statuses.includes(200) && statuses.every((s) => s === 200 || s === 409), `statuses ${statuses}`);
});

test("chain reconciliation settles the real outcome: a pending attempt that landed becomes paid", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ code: "rpc_error", txHash: TX }, { status: 502 });
  await callPay(data.id, await signedBody(data.id));
  settled = async () => "9"; // the chain now shows the sale
  const s = await readStatus(data.id);
  assert.equal(s.status, "paid");
});

test("a definitive failure (approval expired, nothing on chain) reopens safely for a new payment", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ code: "rpc_error", txHash: TX }, { status: 502 });
  await callPay(data.id, await signedBody(data.id));
  await agePending(data.id); // its approval can no longer settle
  settled = async () => null; // and nothing is on chain
  assert.equal((await readStatus(data.id)).status, "open");
  settled = onChainIfRelayed; // the chain shows a sale only once a relay succeeds (harness default)
  relayReply = async () => Response.json({ txHash: `0x${"ef".repeat(32)}`, blockNumber: "4" });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
});

test("review F4: a refused relay (e.g. OrderPaid) whose chain read fails stays pending, never 'start again'", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ code: "order_paid" }, { status: 422 });
  settled = async () => {
    throw new Error("rpc down");
  };
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 504);
  const { error } = await res.json();
  assert.equal(error, UNKNOWN);
  assert.doesNotMatch(error, /start the checkout again|nothing was charged/i);
  assert.ok((await getSession(data.id)).pending, "kept pending so the chain decides");
});
