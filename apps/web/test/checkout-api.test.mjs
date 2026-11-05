// claude-frontend checks for the checkout API (FR-PAY-4, FR-PAY-5): auth, validation, and the money rules.
// Run from apps/web: npm test
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
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
mock.module("../lib/onchain.ts", {
  namedExports: {
    saleSettled: (...args) => (settledCalls.push(args), settled(...args)),
    readUsdtBalance: async () => {
      if (balanceReadFails) throw new Error("rpc down");
      return balance;
    },
  },
});

const { POST: createSession } = await import("../app/api/v1/sessions/route.ts");
const { POST: pay } = await import("../app/api/v1/sessions/[id]/pay/route.ts");
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

beforeEach(() => {
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
async function signedBody(id, { amount, account = customer } = {}) {
  const s = getSession(id);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const sale = { merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount: amount ?? s.amount };
  const signature = await account.signTypedData(saleAuthorization(sale, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}
const callPay = (id, body) => pay(new Request(`http://shop.test/api/v1/sessions/${id}/pay`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

test("creating a checkout needs the shop's key", async () => {
  const res = await createSession(new Request("http://shop.test/api/v1/sessions", { method: "POST", body: JSON.stringify({ amount: "25.00" }) }));
  assert.equal(res.status, 401);
  const wrong = await createSession(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: { ...auth, authorization: "Bearer nope" }, body: "{}" }));
  assert.equal(wrong.status, 401);
});

test("amounts are validated: format, the 1 USDT minimum, and items that must add up", async () => {
  assert.equal((await newSession({ amount: "25.0000001" })).res.status, 400);
  assert.equal((await newSession({ amount: "0.50" })).res.status, 400);
  assert.equal((await newSession({ amount: "-5" })).res.status, 400);
  const { res, data } = await newSession({ amount: "30.00", items: [{ name: "Cold brew", qty: 2, price: "10.00" }] });
  assert.equal(res.status, 400);
  assert.match(data.error, /add up to 20\.00/);
});

test("a valid checkout returns a hosted URL and stores the exact amount", async () => {
  const { res, data } = await newSession();
  assert.equal(res.status, 201);
  assert.match(data.url, /^http:\/\/shop\.test\/checkout\/[0-9a-f-]{36}$/);
  assert.equal(data.amount, "25.00");
  assert.equal(getSession(data.id).amount, 25_000_000n);
});

test("a correct approval is relayed once and recorded; paying again is refused", async () => {
  const { data } = await newSession();
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { receiptId: data.id, txHash: `0x${"ab".repeat(32)}` });
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].url, "http://relayer.test/relay");
  assert.equal(relayCalls[0].body.action, "paySale");
  assert.equal(relayCalls[0].body.args.amount, "25000000");
  assert.match(relayCalls[0].body.sig, /^0x[0-9a-f]{130}$/, "signature sent whole as sig");
  assert.equal(getSession(data.id).payment.txHash, `0x${"ab".repeat(32)}`);
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 409);
  assert.equal(relayCalls.length, 1, "no second relay");
});

test("an approval for a different amount is refused before the relayer is called", async () => {
  const { data } = await newSession();
  const res = await callPay(data.id, await signedBody(data.id, { amount: 1_000_000n }));
  assert.equal(res.status, 400);
  assert.equal(relayCalls.length, 0);
});

test("two payments at the same moment: one goes through, the other is refused", async () => {
  const { data } = await newSession();
  relayReply = () => new Promise((resolve) => setTimeout(() => resolve(Response.json({ txHash: `0x${"cd".repeat(32)}`, blockNumber: "1" })), 50));
  const [a, b] = await Promise.all([callPay(data.id, await signedBody(data.id)), callPay(data.id, await signedBody(data.id))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(relayCalls.length, 1);
});

test("a relayer timeout keeps the checkout locked, because the payment may have gone through", async () => {
  const { data } = await newSession();
  relayReply = async () => {
    throw new DOMException("timed out", "TimeoutError");
  };
  const first = await callPay(data.id, await signedBody(data.id));
  assert.equal(first.status, 504);
  assert.match((await first.json()).error, /Don't pay again/);
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 409);
});

test("a 422 (approval won't work) unlocks the checkout and explains it plainly, without relayer text", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "TetherToken: auth expired" }, { status: 422 });
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /start the checkout again/);
  assert.doesNotMatch(error, /TetherToken/, "relayer developer text never reaches the customer");
  relayReply = async () => Response.json({ txHash: `0x${"ef".repeat(32)}`, blockNumber: "2" });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
});

test("without MerchantPay or a relayer configured, nothing is relayed", async () => {
  const { data } = await newSession();
  delete process.env.RELAYER_URL;
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 503);
  assert.equal(relayCalls.length, 0);
});

test("a relayer 502 keeps the checkout locked: the signature may still settle", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "rpc trouble", txHash: `0x${"12".repeat(32)}` }, { status: 502 });
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 504);
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 409);
});

// relayer contract 22:50 (claude-relayer): 200 adds paymentId; errors are {error, code}; 422 replay means the
// approval was already used; 503 means nothing was sent; a dropped connection may have been sent.
test("a relayed sale is recorded only after the chain shows it, with the chain's payment id", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "5", paymentId: "41" });
  settled = async () => "42";
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
  assert.equal(getSession(data.id).payment.paymentId, "42", "the chain decides, not the relayer");
  const [sale, opts] = settledCalls[0];
  assert.deepEqual([sale.merchantPay, sale.orderRef, sale.amount, sale.payer, opts.blockNumber], [MERCHANT_PAY, getSession(data.id).orderRef, 25_000_000n, customer.address, 5n]);
});

test("a relayer 200 the chain doesn't confirm (or a failed read) stays locked and records nothing", async () => {
  for (const chainSays of [async () => null, async () => { throw new Error("rpc down"); }]) {
    const { data } = await newSession();
    settled = chainSays;
    const res = await callPay(data.id, await signedBody(data.id));
    assert.equal(res.status, 504);
    assert.match((await res.json()).error, /Don't pay again/);
    assert.equal(getSession(data.id).payment, undefined);
    assert.equal((await callPay(data.id, await signedBody(data.id))).status, 409);
  }
});

test("a 422 replay never locks the checkout (a stranger can burn a nonce on purpose); the chain decides", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "authorization used", code: "replay" }, { status: 422 });
  const stranger = await callPay(data.id, await signedBody(data.id));
  assert.equal(stranger.status, 400, "refused, not pending: the real customer must not be locked out");
  assert.equal(getSession(data.id).pending, undefined);
  relayReply = async () => Response.json({ txHash: `0x${"ef".repeat(32)}`, blockNumber: "2" });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200, "the next attempt relays at once");
  // and if the order turns out paid by this customer, a replay shows the receipt
  const second = (await newSession()).data;
  relayReply = async () => Response.json({ error: "authorization used", code: "replay" }, { status: 422 });
  settled = async () => "8";
  const res = await callPay(second.id, await signedBody(second.id));
  assert.deepEqual([res.status, (await res.json()).receiptId], [200, second.id]);
});

test("a 422 insufficient_funds unlocks and says plainly it's a demo that needs test USDT (human gate 004)", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "balance", code: "insufficient_funds" }, { status: 422 });
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /^This is a demo: paying needs test USDT/);
  relayReply = async () => Response.json({ txHash: `0x${"ef".repeat(32)}`, blockNumber: "2" });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
});

test("a relayer 503 (gas cap, paused, budget) sent nothing: unlocks and says try again", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "gas price above cap", code: "gas_price_cap" }, { status: 503 });
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Nothing was charged/);
  relayReply = async () => Response.json({ txHash: `0x${"ef".repeat(32)}`, blockNumber: "2" });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
});

test("relayer unreachable unlocks; a connection dropped mid-request stays locked", async () => {
  const { data } = await newSession();
  const fetchFailed = (code) => async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
  };
  relayReply = fetchFailed("ECONNREFUSED");
  const refused = await callPay(data.id, await signedBody(data.id));
  assert.equal(refused.status, 503);
  assert.match((await refused.json()).error, /Nothing was charged/);
  relayReply = fetchFailed("UND_ERR_SOCKET");
  const dropped = await callPay(data.id, await signedBody(data.id));
  assert.equal(dropped.status, 504);
  assert.match((await dropped.json()).error, /Don't pay again/);
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 409);
});

test("our sale nonce equals the deployed MerchantPay's saleNonce view (KIND_SALE = 2)", () => {
  // vector read on 2026-11-05 from MerchantPay 0x83b5…73b7 on chain 1874:
  // saleNonce(0x11…11, 0x22…22, 25000000, 0x33…33). A wrong kind here makes every customer signature fail.
  const sale = { merchantPay: "0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7", merchant: "0x1111111111111111111111111111111111111111", orderRef: `0x${"22".repeat(32)}`, amount: 25_000_000n };
  assert.equal(saleNonce(sale, `0x${"33".repeat(32)}`), "0x6746adfa0053a73d5e487d1bf8dbf83c8b7f84cff6e1993269c45278a8616cc8");
});

test("our sale nonce equals the final MerchantPay 0xab81…4251's saleNonce view (paySale unchanged in Phase 3)", () => {
  // vector read on 2026-11-06 from MerchantPay 0xab81…4251 on chain 1874: saleNonce(0x11…11, 0x22…22, 25000000, 0x33…33)
  const sale = { merchantPay: "0xab817593253a0a37de723072827d88fe0ca54251", merchant: "0x1111111111111111111111111111111111111111", orderRef: `0x${"22".repeat(32)}`, amount: 25_000_000n };
  assert.equal(saleNonce(sale, `0x${"33".repeat(32)}`), "0xae742da47f306ed9030d17b08d5c8647361b6babfd5a200cb584d4678b02da8c");
});

// Unknown outcomes are pending, not locked forever (plan review, batch 004): the chain settles them either way.
const timeout = async () => {
  throw new DOMException("timed out", "TimeoutError");
};

test("an unknown outcome that the chain later shows as paid by this customer becomes a receipt", async () => {
  const { data } = await newSession();
  relayReply = timeout;
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 504);
  settled = async () => "9";
  const again = await callPay(data.id, await signedBody(data.id));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).receiptId, data.id);
  assert.deepEqual([getSession(data.id).payment.paymentId, getSession(data.id).payment.txHash], ["9", null]);
  assert.equal(relayCalls.length, 1, "never relayed twice");
});

test("an unknown outcome stays pending until its approval has expired, then the checkout opens again", async () => {
  const { data } = await newSession();
  relayReply = timeout;
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 504);
  const pending = await callPay(data.id, await signedBody(data.id));
  assert.equal(pending.status, 409);
  assert.match((await pending.json()).error, /Don't pay again/);
  assert.equal(relayCalls.length, 1);
  getSession(data.id).pending.validBefore = 0n; // the signed approval is past its validBefore: USDT can't settle it
  relayReply = async () => Response.json({ txHash: `0x${"ef".repeat(32)}`, blockNumber: "2" });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
  assert.equal(relayCalls.length, 2);
});

test("a refusal (422) for an order the chain shows paid by this customer returns the receipt, not 'start again'", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "execution reverted: OrderPaid()", code: "would_revert" }, { status: 422 });
  settled = async () => "5";
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { receiptId: data.id, txHash: null });
  assert.equal(getSession(data.id).payment.paymentId, "5");
});

test("a relayer 429 (rate limit) sent nothing: unlocks and says try again", async () => {
  const { data } = await newSession();
  relayReply = async () => Response.json({ error: "slow down", code: "rate_limited" }, { status: 429 });
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Nothing was charged/);
});

// The shop polls its checkout (PHASES: polling stands in for FR-PAY-10 webhooks on the AT-1 path).
const poll = (id, headers = auth) => status(new Request(`http://shop.test/api/v1/sessions/${id}`, { headers }), { params: Promise.resolve({ id }) });

test("the shop polls a checkout with its key: open, then paid with MerchantPay's payment id", async () => {
  const { data } = await newSession();
  assert.equal((await poll(data.id, {})).status, 401);
  assert.equal((await poll("00000000-0000-0000-0000-000000000000")).status, 404);
  assert.deepEqual(await (await poll(data.id)).json(), { id: data.id, status: "open", amount: "25.00", reference: "A-1042", paymentId: null, txHash: null });
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
  const paid = await (await poll(data.id)).json();
  assert.deepEqual([paid.status, paid.paymentId, paid.txHash], ["paid", "1", `0x${"ab".repeat(32)}`]);
});

test("polling a pending checkout asks the chain, so the shop sees a payment that settled after a timeout", async () => {
  const { data } = await newSession();
  relayReply = timeout;
  await callPay(data.id, await signedBody(data.id));
  assert.equal((await (await poll(data.id)).json()).status, "pending");
  settled = async () => "3";
  assert.equal((await (await poll(data.id)).json()).status, "paid");
});

// Round 2 (security S1 / code M1): an expired checkout with a pending attempt asks the chain before "expired".
test("an expired checkout whose last attempt is pending asks the chain first and never says 'ask for a new one'", async () => {
  const { data } = await newSession();
  relayReply = timeout;
  await callPay(data.id, await signedBody(data.id));
  getSession(data.id).expiresAt = Date.now() - 1; // the 30 min checkout runs out while the outcome is unknown
  const stillPending = await callPay(data.id, await signedBody(data.id));
  assert.equal(stillPending.status, 409);
  assert.match((await stillPending.json()).error, /Don't pay again/);
  settled = async () => "6";
  const paid = await callPay(data.id, await signedBody(data.id));
  assert.deepEqual([paid.status, (await paid.json()).receiptId], [409, data.id]);
  assert.equal(getSession(data.id).payment.paymentId, "6");
});

test("a malformed signature is a 400 mismatch, never a 500", async () => {
  const { data } = await newSession();
  const body = { ...(await signedBody(data.id)), signature: `0x${"00".repeat(64)}1b` }; // r = s = 0
  const res = await callPay(data.id, body);
  assert.equal(res.status, 400);
  assert.equal(relayCalls.length, 0);
});

test("the shop's poll says 'pending' while a payment is in flight", async () => {
  const { data } = await newSession();
  let release;
  relayReply = () => new Promise((resolve) => (release = () => resolve(Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "3" }))));
  const paying = callPay(data.id, await signedBody(data.id));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await (await poll(data.id)).json()).status, "pending");
  release();
  assert.equal((await paying).status, 200);
});

// Batch 005 round 2 (UX F1, security F1): the relayer never answers insufficient_funds today, so our server checks the
// guest's balance itself, before taking the lock or calling the relayer.
test("a guest holding less than the total gets the demo message from our server: 400, nothing locked, relayed or pending", async () => {
  const { data } = await newSession();
  balance = 24_999_999n;
  const res = await callPay(data.id, await signedBody(data.id));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "This is a demo: paying needs test USDT, and this browser doesn't have enough yet. Nothing was charged.");
  assert.equal(relayCalls.length, 0);
  assert.equal(getSession(data.id).pending, undefined);
  balance = 25_000_000n; // exactly the total: no lock was left behind
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
});

test("a failed balance read still relays the checkout (the relayer checks the balance too)", async () => {
  const { data } = await newSession();
  balanceReadFails = true;
  assert.equal((await callPay(data.id, await signedBody(data.id))).status, 200);
  assert.equal(relayCalls.length, 1);
});
