// claude-frontend checks for paying an invoice (FR-PAY-3, FR-PAY-7) on the Phase 3 MerchantPay: the fee goes on top
// (value = amount + relayFee, nonce over the credited amount only), partial payments are allowed, and an invoice is Paid
// only when fully paid. POST /api/v1/invoices/:id/pay keeps the checkout's money rules. The relayer doesn't relay
// payInvoice yet, so it is faked via globalThis.fetch. Run from apps/web: npm test
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex, verifyTypedData } from "viem";

const MERCHANT = "0x1111111111111111111111111111111111111111";
const OTHER_MERCHANT = "0x4444444444444444444444444444444444444444";
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";
// /pay serves only the shop's own invoices (human, 2026-11-06 02:3x): the shop is MERCHANT_ADDRESS
process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
const FEE = 100_000n; // MerchantPay.relayFee(): 0.10 USDT

// The chain (lib/onchain.ts has its own tests): the invoice, the relay fee, and the invoice consumer rule. A relayed
// payment credits the invoice like MerchantPay does: paid += amount, Paid once fully paid.
let invoice;
let fee;
let balance; // the guest's test USDT, read on the server before anything is locked or relayed
let invoiceReadFails;
let feeReadFails;
let balanceReadFails;
let readDelays = []; // per call: a slow invoice read returns the state from when it was called
let confirmed;
const confirmCalls = [];
mock.module("../lib/onchain.ts", {
  namedExports: {
    readInvoice: async (merchantPay, id) => {
      if (invoiceReadFails) throw new Error("rpc down");
      const snapshot = { id, ...invoice };
      const delay = readDelays.shift();
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return snapshot;
    },
    readUsdtBalance: async () => {
      if (balanceReadFails) throw new Error("rpc down");
      return balance;
    },
    readRelayFee: async () => {
      if (feeReadFails) throw new Error("rpc down");
      return fee;
    },
    invoicePaid: async (...args) => (confirmCalls.push(args), confirmed(...args)),
    saleSettled: async () => null,
  },
});

const { POST: pay } = await import("../app/api/v1/invoices/[id]/pay/route.ts");
const { invoiceAuthorization, invoiceNonce, KIND_INVOICE } = await import("../lib/pay.ts");
const { invoiceAttempt, invoiceLock, claimPayment, releasePayment } = await import("../lib/sessions.ts");
const { isShopInvoice, pageState } = await import("../lib/settle.ts");

const customer = privateKeyToAccount(generatePrivateKey());
const relayCalls = [];
const OK = () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "5", paymentId: "41" });
let relayReply;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  relayCalls.push({ url: String(url), body });
  const res = await relayReply();
  if (res.ok) {
    const paid = invoice.paid + BigInt(body.args.amount);
    invoice = { ...invoice, paid, status: paid === invoice.amount ? "paid" : "open" };
  }
  return res;
};

let nextId = 7;
let id;
beforeEach(() => {
  id = String(nextId++); // the server remembers attempts per invoice id: a fresh invoice per test
  invoice = { merchant: MERCHANT, dueDate: 1_900_000_000n, status: "open", amount: 25_000_000n, paid: 0n };
  fee = FEE;
  balance = 1_000_000_000n;
  invoiceReadFails = false;
  feeReadFails = false;
  balanceReadFails = false;
  readDelays = [];
  confirmed = async (ref) => invoice.paid === ref.paidBefore + ref.amount; // like the chain after the relay
  confirmCalls.length = 0;
  relayCalls.length = 0;
  relayReply = async () => OK();
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://relayer.test";
});

const now = () => Math.floor(Date.now() / 1000);
async function signed({ amount = invoice.amount - invoice.paid, withFee = fee, invoiceId = BigInt(id), signer = customer, validBefore = BigInt(now() + 600) } = {}) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const terms = { merchantPay: MERCHANT_PAY, invoiceId, amount, fee: withFee };
  const signature = await signer.signTypedData(invoiceAuthorization(terms, customer.address, salt, validBefore));
  return { from: customer.address, salt, validBefore: validBefore.toString(), signature };
}
const callPay = (body, invoiceId = id) => pay(new Request(`http://shop.test/api/v1/invoices/${invoiceId}/pay`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: invoiceId }) });
const timeout = async () => {
  throw new DOMException("timed out", "TimeoutError");
};

test("our invoice nonce equals the final MerchantPay 0xab81…4251's invoiceNonce view (KIND_INVOICE = 1)", () => {
  // vector read on 2026-11-06 from MerchantPay 0xab81…4251 on chain 1874 (rpc.ankr.com/whitechain_testnet):
  // invoiceNonce(7, 25000000, 0x33…33). A wrong kind or encoding here makes every invoice signature fail.
  assert.equal(KIND_INVOICE, 1);
  const terms = { merchantPay: "0xab817593253a0a37de723072827d88fe0ca54251", invoiceId: 7n, amount: 25_000_000n, fee: FEE };
  assert.equal(invoiceNonce(terms, `0x${"33".repeat(32)}`), "0xf2300c68a4df04862b77b4e641edcac28db3b75a8a1d70629cbc108a827358bb");
});

test("the customer signs the credited amount plus the fee on top; the nonce covers the credited amount only", async () => {
  const salt = `0x${"44".repeat(32)}`;
  const terms = { merchantPay: MERCHANT_PAY, invoiceId: 7n, amount: 25_000_000n, fee: FEE };
  const auth = invoiceAuthorization(terms, customer.address, salt, 1_900_000_000n);
  assert.deepEqual(auth.message, { from: customer.address, to: MERCHANT_PAY, value: 25_100_000n, validAfter: 0n, validBefore: 1_900_000_000n, nonce: invoiceNonce(terms, salt) });
  assert.equal(invoiceNonce({ ...terms, fee: 0n }, salt), auth.message.nonce, "the fee isn't in the nonce");
  assert.notEqual(invoiceNonce({ ...terms, invoiceId: 8n }, salt), auth.message.nonce, "bound to the invoice");
  assert.equal(auth.domain.verifyingContract, "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", "the prize USDT");
  assert.ok(await verifyTypedData({ ...auth, address: customer.address, signature: await customer.signTypedData(auth) }));
});

test("each attempt in the browser signs with a fresh salt (on-chain InvoiceNotOpen stops a second full payment)", async () => {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  const { signInvoice } = await import("../lib/sign-sale.ts");
  const terms = { merchantPay: MERCHANT_PAY, invoiceId: "7", amount: "25000000", fee: "100000" };
  const [a, b] = [await signInvoice(terms), await signInvoice(terms)];
  assert.notEqual(a.salt, b.salt);
  assert.equal(a.from, b.from, "the same guest key");
  const auth = invoiceAuthorization({ merchantPay: MERCHANT_PAY, invoiceId: 7n, amount: 25_000_000n, fee: FEE }, a.from, a.salt, BigInt(a.validBefore));
  assert.equal(auth.message.value, 25_100_000n);
  assert.ok(await verifyTypedData({ ...auth, address: a.from, signature: a.signature }));
  const { signSale } = await import("../lib/sign-sale.ts");
  const sale = { merchantPay: MERCHANT_PAY, merchant: MERCHANT, orderRef: `0x${"22".repeat(32)}`, amount: "25000000" };
  const [c, d] = [await signSale(sale), await signSale(sale)];
  assert.notEqual(c.salt, d.salt, "a checkout's attempts get fresh salts too (004 security S2)");
});

test("a correct approval is relayed once as payInvoice (credited amount, fee on top), counted only when the chain confirms it", async () => {
  const body = await signed();
  const res = await callPay(body);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { receiptId: "41", txHash: `0x${"ab".repeat(32)}` });
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].url, "http://relayer.test/relay");
  assert.deepEqual(relayCalls[0].body, {
    action: "payInvoice",
    args: { invoiceId: id, from: customer.address, amount: "25000000", validAfter: "0", validBefore: body.validBefore, salt: body.salt },
    sig: body.signature,
  });
  const [rule, opts] = confirmCalls[0];
  assert.deepEqual(rule, { merchantPay: MERCHANT_PAY, invoiceId: BigInt(id), paymentId: 41n, amount: 25_000_000n, fee: FEE, payer: customer.address, paidBefore: 0n });
  assert.equal(opts.blockNumber, 5n, "read at the relay's block");
  assert.deepEqual(invoiceAttempt(id).receipt, { paymentId: "41", txHash: `0x${"ab".repeat(32)}` });
  assert.equal(invoice.status, "paid", "fully paid");
  const again = await callPay(await signed({ amount: 25_000_000n }));
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: "This invoice is already paid.", paid: true, receiptId: "41", txHash: `0x${"ab".repeat(32)}` });
  assert.equal(relayCalls.length, 1, "no second relay");
});

test("a partly paid invoice: the customer pays the rest plus the fee, the rule checks paid rose by it, and it turns Paid", async () => {
  invoice = { ...invoice, paid: 5_000_000n }; // someone paid 5.00 of 25.00 earlier
  const res = await callPay(await signed());
  assert.equal(res.status, 200);
  assert.equal(relayCalls[0].body.args.amount, "20000000");
  const [rule] = confirmCalls[0];
  assert.deepEqual([rule.amount, rule.fee, rule.paidBefore], [20_000_000n, FEE, 5_000_000n]);
  assert.deepEqual([invoice.paid, invoice.status], [25_000_000n, "paid"]);
});

test("the amount and the fee come from the chain, never the browser: another amount, fee, invoice or signer is refused unrelayed", async () => {
  assert.equal((await callPay(await signed({ amount: 1_000_000n }))).status, 400, "a partial amount the server didn't offer");
  assert.equal((await callPay(await signed({ withFee: 0n }))).status, 400, "without the fee");
  assert.equal((await callPay(await signed({ withFee: 50_000n }))).status, 400, "another fee");
  assert.equal((await callPay(await signed({ invoiceId: 999n }))).status, 400, "another invoice");
  const intruder = privateKeyToAccount(generatePrivateKey());
  assert.equal((await callPay(await signed({ signer: intruder }))).status, 400, "signed by someone else, claims the customer");
  const body = await signed();
  fee = 150_000n; // the owner changed relayFee after the page loaded: the old approval no longer matches
  const stale = await callPay(body);
  assert.equal(stale.status, 400);
  assert.match((await stale.json()).error, /Reload this page/, "a stale page says how to recover (code review F5)");
  assert.equal(relayCalls.length, 0);
});

test("a failed read of the fee or the invoice is 503 and nothing is sent", async () => {
  feeReadFails = true;
  const res = await callPay(await signed());
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Nothing was charged/);
  feeReadFails = false;
  invoiceReadFails = true;
  assert.equal((await callPay(await signed())).status, 503);
  assert.equal(relayCalls.length, 0);
});

test("a missing, cancelled or paid invoice is closed (404, 410, 409) and nothing is relayed", async () => {
  invoice = { ...invoice, status: "missing", merchant: "0x0000000000000000000000000000000000000000" };
  assert.equal((await callPay(await signed())).status, 404);
  invoice = { ...invoice, status: "cancelled", merchant: MERCHANT };
  const cancelled = await callPay(await signed());
  assert.equal(cancelled.status, 410);
  assert.match((await cancelled.json()).error, /cancelled/);
  invoice = { ...invoice, status: "paid", paid: invoice.amount };
  const paid = await callPay(await signed({ amount: 25_000_000n }));
  assert.equal(paid.status, 409);
  assert.equal((await paid.json()).paid, true);
  for (const bad of ["0", "abc", "7.5", "1".repeat(21)]) assert.equal((await callPay(await signed(), bad)).status, 404, bad);
  assert.equal(relayCalls.length, 0);
});

test("inputs are checked like the checkout's: an address, 32-byte salt, 65-byte signature, validBefore in the relayer's window", async () => {
  const good = await signed();
  for (const body of [{ ...good, from: "0x1234" }, { ...good, salt: "0x1234" }, { ...good, signature: "0x1234" }, { ...good, validBefore: String(now() + 10) }, { ...good, validBefore: String(now() + 16 * 60) }, { ...good, validBefore: 123 }]) {
    assert.equal((await callPay(body)).status, 400);
  }
  for (const signature of [`0x${"11".repeat(65)}`, `0x${"00".repeat(65)}`]) assert.equal((await callPay({ ...good, signature })).status, 400, "malformed signature: 400, not 500");
  assert.equal(relayCalls.length, 0);
});

test("two payments at the same moment: one goes through, the other is refused", async () => {
  relayReply = () => new Promise((resolve) => setTimeout(() => resolve(OK()), 50));
  const [a, b] = await Promise.all([callPay(await signed()), callPay(await signed())]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(relayCalls.length, 1);
});

test("an unknown outcome (timeout) is pending: 'Don't pay again' until its approval has expired, then open again", async () => {
  relayReply = timeout;
  const first = await callPay(await signed());
  assert.equal(first.status, 504);
  assert.match((await first.json()).error, /Don't pay again/);
  const pending = await callPay(await signed());
  assert.equal(pending.status, 409);
  assert.match((await pending.json()).error, /Don't pay again/);
  assert.equal(relayCalls.length, 1);
  invoiceAttempt(id).pending.validBefore = 0n; // past its validBefore: USDT can never settle it
  relayReply = async () => OK();
  assert.equal((await callPay(await signed())).status, 200);
  assert.equal(relayCalls.length, 2);
});

test("a pending invoice the chain shows paid is closed as paid, never offered again", async () => {
  relayReply = timeout;
  assert.equal((await callPay(await signed())).status, 504);
  invoice = { ...invoice, status: "paid", paid: invoice.amount };
  const res = await callPay(await signed({ amount: 25_000_000n }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).paid, true);
  assert.equal(relayCalls.length, 1);
});

test("a relayer 200 the chain doesn't confirm (or a failed read, or no payment id) stays pending and records nothing", async () => {
  for (const [chainSays, reply] of [
    [async () => false, OK],
    [async () => { throw new Error("rpc down"); }, OK],
    [async () => true, () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "5" })],
  ]) {
    id = String(nextId++);
    invoice = { ...invoice, status: "open", paid: 0n };
    confirmed = chainSays;
    relayReply = async () => reply();
    const res = await callPay(await signed());
    assert.equal(res.status, 504);
    assert.match((await res.json()).error, /Don't pay again/);
    assert.equal(invoiceAttempt(id).receipt, undefined);
    invoice = { ...invoice, status: "open", paid: 0n }; // still open on chain: the pending attempt holds it
    assert.equal((await callPay(await signed())).status, 409);
  }
});

test("an InvoiceNotOpen refusal (422): paid by someone else is the closed paid state, cancelled meanwhile is 410", async () => {
  relayReply = async () => {
    invoice = { ...invoice, status: "paid", paid: invoice.amount }; // another payment landed first
    return Response.json({ error: "execution reverted: InvoiceNotOpen()", code: "would_revert" }, { status: 422 });
  };
  const paid = await callPay(await signed());
  assert.equal(paid.status, 409);
  assert.deepEqual(await paid.json(), { error: "This invoice is already paid.", paid: true, receiptId: null, txHash: null });
  id = String(nextId++);
  invoice = { ...invoice, status: "open", paid: 0n };
  relayReply = async () => {
    invoice = { ...invoice, status: "cancelled" };
    return Response.json({ error: "execution reverted: InvoiceNotOpen()", code: "would_revert" }, { status: 422 });
  };
  assert.equal((await callPay(await signed())).status, 410);
});

test("a 422 the chain doesn't explain unlocks with plain words and no relayer text", async () => {
  relayReply = async () => Response.json({ error: "TetherToken: auth expired" }, { status: 422 });
  const res = await callPay(await signed());
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /Nothing was charged; please try again/);
  assert.doesNotMatch(error, /TetherToken|checkout/);
  relayReply = async () => OK();
  assert.equal((await callPay(await signed())).status, 200);
});

test("a guest holding less than amount + fee gets the demo message from our server: 400, nothing locked, relayed or pending", async () => {
  balance = 25_099_999n; // one unit short of 25.00 + 0.10
  const res = await callPay(await signed());
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.equal(error, "This is a demo: paying needs test USDT, and this browser doesn't have enough yet. Nothing was charged.");
  assert.doesNotMatch(error, /wallet/);
  assert.equal(relayCalls.length, 0);
  assert.equal(invoiceAttempt(id).pending, undefined);
  balance = 25_100_000n; // exactly enough: no lock was left behind
  assert.equal((await callPay(await signed())).status, 200);
});

test("a failed balance read still relays (the relayer checks the balance too)", async () => {
  balanceReadFails = true;
  assert.equal((await callPay(await signed())).status, 200);
  assert.equal(relayCalls.length, 1);
});

test("the relayer's own insufficient_funds (422) gives the same demo message", async () => {
  relayReply = async () => Response.json({ error: "balance", code: "insufficient_funds" }, { status: 422 });
  const res = await callPay(await signed());
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /^This is a demo: paying needs test USDT/);
});

test("only the shop's own invoices are payable here: another merchant's is 404 before any relay", async () => {
  invoice = { ...invoice, merchant: OTHER_MERCHANT };
  const res = await callPay(await signed());
  assert.equal(res.status, 404);
  invoice = { ...invoice, merchant: MERCHANT };
  const saved = process.env.SHOP_API_KEY;
  delete process.env.SHOP_API_KEY; // no shop configured: nothing is ours
  try {
    assert.equal((await callPay(await signed())).status, 404);
  } finally {
    process.env.SHOP_API_KEY = saved;
  }
  assert.equal(relayCalls.length, 0);
});

test("isShopInvoice and pageState: what /pay shows (the shop's invoices only; in flight reads as pending)", () => {
  const ours = { id: 7n, merchant: MERCHANT, dueDate: 1n, status: "open", amount: 1n, paid: 0n };
  assert.equal(isShopInvoice(ours, MERCHANT), true);
  assert.equal(isShopInvoice(ours, MERCHANT.toUpperCase().replace("0X", "0x")), true, "case-insensitive");
  assert.equal(isShopInvoice({ ...ours, merchant: OTHER_MERCHANT }, MERCHANT), false);
  assert.equal(isShopInvoice(ours, undefined), false);
  assert.equal(invoiceLock("7"), "invoice:7", "the page and the route use the same lock key");
  assert.equal(pageState("open", invoiceLock("77")), "open");
  assert.ok(claimPayment(invoiceLock("77")));
  try {
    assert.equal(pageState("open", invoiceLock("77")), "pending");
    assert.equal(pageState("paid", invoiceLock("77")), "paid");
    assert.equal(pageState("open", "77"), "open", "the invoice lock isn't the checkout lock");
  } finally {
    releasePayment(invoiceLock("77"));
  }
});

test("a request that read 'open' before another paid it, and gets the lock after, answers paid and never relays again (S5)", async () => {
  readDelays = [80, 0]; // B reads first but slowly (it sees 'open'); A reads at once
  relayReply = () => new Promise((resolve) => setTimeout(() => resolve(OK()), 10));
  const [bodyA, bodyB] = [await signed(), await signed()];
  const b = callPay(bodyB);
  const a = callPay(bodyA);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 409);
  assert.deepEqual(await rb.json(), { error: "This invoice is already paid.", paid: true, receiptId: "41", txHash: `0x${"ab".repeat(32)}` });
  assert.equal(relayCalls.length, 1);
});

test("today's relayer (400 'supports pull') sent nothing: 400, nothing charged, the invoice stays payable", async () => {
  relayReply = async () => Response.json({ error: 'unknown action (this relayer supports "pull")' }, { status: 400 });
  const res = await callPay(await signed());
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Nothing was charged/);
  assert.equal(invoiceAttempt(id).pending, undefined);
});

test("without MerchantPay or a relayer configured, nothing is read or relayed", async () => {
  delete process.env.RELAYER_URL;
  assert.equal((await callPay(await signed())).status, 503);
  assert.equal(relayCalls.length, 0);
});
