// claude-frontend batch 015: a discount code on a link or page checkout (FR-GW-12, AT-12) and the pay route's order for
// it (batch-009 security review F1, F2, F3, F5). Real SQL on PGlite; the chain and the relayer are faked.
// Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { setupDb, resetDb, req, params, MERCHANT, expireSession, agePending } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";

// The chain: `chain.paid` = the sale MerchantPay holds for an order ({payer, amount}), else none. saleSettled answers
// like lib/onchain.ts: the payment id only for that payer at exactly that amount. `chain.fails` = the RPC is down. A
// relayer 200 lands on chain unless `chain.dropsRelayed`.
const chain = { paid: null, fails: false, reads: [], dropsRelayed: false };
let balance = 1_000_000_000n;
mock.module("../lib/onchain.ts", {
  namedExports: {
    saleSettled: async (sale) => {
      chain.reads.push(sale.amount);
      if (chain.fails) throw new Error("rpc down");
      return chain.paid && chain.paid.amount === sale.amount && chain.paid.payer === sale.payer ? "7" : null;
    },
    readUsdtBalance: async () => balance,
    readPayment: async () => ({ merchant: MERCHANT, gross: 1n, payer: MERCHANT, refunded: 0n }),
  },
});

const relayCalls = [];
let relayReply;
globalThis.fetch = async (url, init) => {
  const { args } = JSON.parse(init.body);
  relayCalls.push(args);
  const res = await relayReply();
  if (res.ok && !chain.dropsRelayed) chain.paid = { payer: args.from, amount: BigInt(args.amount) };
  return res;
};
const relayed = () => Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "9" });

const { POST: pay } = await import("../app/api/v1/sessions/[id]/pay/route.ts");
const voucherRoute = await import("../app/api/v1/sessions/[id]/voucher/route.ts");
const { createSession, getSession, claimPayment, releasePayment, isInFlight } = await import("../lib/sessions.ts");
const { settlePending } = await import("../lib/settle.ts");
const { recordCheckout, markCheckoutPaid } = await import("../lib/server/checkouts.ts");
const { applyVoucher, claimAmountDue, HOLD_MS } = await import("../lib/server/vouchers.ts");
const { query, setTestDb } = await import("../lib/server/db.ts");
const { saleAuthorization } = await import("../lib/pay.ts");

const customer = privateKeyToAccount(generatePrivateKey());
const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const DAY = 24 * 60 * 60 * 1000;

let pg;
before(async () => {
  pg = await setupDb();
});
beforeEach(async () => {
  await resetDb();
  Object.assign(chain, { paid: null, fails: false, reads: [], dropsRelayed: false });
  balance = 1_000_000_000n;
  relayCalls.length = 0;
  relayReply = async () => relayed();
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://relayer.test";
});

/** A link checkout as lib/server/links.ts opens one: the session (app_web_sessions), its row in app_gw_checkouts. */
async function linkCheckout(amount = USDT(100)) {
  const session = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount, reference: "", items: [] });
  await recordCheckout(session.id, "link", "lnk_test", MERCHANT, amount);
  return session.id;
}
let vouchers = 0;
async function newVoucher(code, { kind = "percent", value = "50", max = 1 } = {}) {
  await query(
    "INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [`vch_t${++vouchers}`, MERCHANT.toLowerCase(), code, kind, value, Date.now() + 30 * DAY, max, Date.now()],
  );
}
const voucherCall = async (method, id, body) => {
  const res = await voucherRoute[method](req(method, `/api/v1/sessions/${id}/voucher`, { body, headers: { "x-forwarded-for": "203.0.113.7" } }), params({ id }));
  return { status: res.status, data: await res.json() };
};
const applyCode = (id, code) => voucherCall("POST", id, { code });

async function signed(id, amount, { validBefore = BigInt(Math.floor(Date.now() / 1000) + 600) } = {}) {
  const s = await getSession(id);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const sale = { merchantPay: MERCHANT_PAY, merchant: s.merchant, orderRef: s.orderRef, amount };
  const signature = await customer.signTypedData(saleAuthorization(sale, customer.address, salt, validBefore));
  return { from: customer.address, salt, validBefore: validBefore.toString(), signature };
}
const callPay = async (id, body) => {
  const res = await pay(new Request(`http://shop.test/api/v1/sessions/${id}/pay`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  return { status: res.status, data: await res.json() };
};

const frozen = async (id) => (await query("SELECT frozen_at FROM app_gw_redemptions WHERE session_id = $1", [id]))[0]?.frozen_at != null;
const timesRedeemed = async (code) => Number((await query("SELECT times_redeemed FROM app_gw_vouchers WHERE code = $1", [code]))[0].times_redeemed);
/** onSessionPaid runs after the reply (announcePaid); wait until its effect shows. */
async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("timed out waiting for onSessionPaid");
}

// --- F1: the named test ---------------------------------------------------------------------------------------------

test("F1: apply A → claim → 422 with the order paid on chain → no release → apply B is refused → confirm counts A", async () => {
  await newVoucher("HALF", { value: "50", max: 1 });
  await newVoucher("ONE", { value: "1", max: 1000 });
  const id = await linkCheckout(USDT(100));
  assert.equal((await applyCode(id, "HALF")).data.amountDue, "50.00");
  chain.paid = { payer: customer.address, amount: USDT(50) }; // the payer sent paySale at 50 straight to the chain
  relayReply = async () => Response.json({ error: "execution reverted: OrderPaid()", code: "would_revert" }, { status: 422 });
  const res = await callPay(id, await signed(id, USDT(50)));
  assert.deepEqual([res.status, res.data.receiptId], [200, id], "the chain says paid: the receipt, never 'start again'");
  assert.equal(await frozen(id), true, "no release: the paid hold stays frozen");
  assert.deepEqual(chain.reads, [USDT(50)], "findPayment read the chain at the claimed price, never a re-claimed one");
  const b = await applyCode(id, "ONE");
  assert.equal(b.status, 410, "apply B is refused");
  assert.equal((await applyVoucher(MERCHANT, "ONE", id, USDT(100))).ok, false, "and refused by vouchers.ts itself");
  await eventually(async () => (await timesRedeemed("HALF")) === 1);
  assert.equal(await timesRedeemed("ONE"), 0);
  assert.equal((await getSession(id)).payment.amount, USDT(50), "recordPayment stores the paid amount");
  const other = await linkCheckout(USDT(100));
  assert.match((await applyCode(other, "HALF")).data.error, /used up/, "HALF's only use went to the paid checkout");
});

// --- F1 (i): refusals after the claim, before the relay -------------------------------------------------------------

test("F1 (i): a bad signature after the claim releases the hold, relays nothing, and the use is free again (F2)", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  const res = await callPay(id, await signed(id, USDT(100))); // signed the old full price
  assert.equal(res.status, 400);
  assert.match(res.data.error, /doesn't match the checkout. Nothing was charged/);
  assert.equal(relayCalls.length, 0);
  assert.equal(await frozen(id), false, "released");
  const junk = await callPay(id, { ...(await signed(id, USDT(50))), signature: `0x${"00".repeat(64)}1b` });
  assert.equal(junk.status, 400, "a junk signature is a mismatch");
  assert.equal(await frozen(id), false);
  // F2: a frozen hold would count forever; released, it lapses with its checkout like any hold
  const later = Date.now() + HOLD_MS + 1;
  const other = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: USDT(100), reference: "", items: [] });
  await recordCheckout(other.id, "link", "lnk_test", MERCHANT, USDT(100), { now: later });
  assert.equal((await applyVoucher(MERCHANT, "HALF", other.id, USDT(100), later)).ok, true, "posting junk locked no use");
});

test("F1 (i): the signed amount must equal the claimed price: a code removed after the payer saw it fails, nothing relayed", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  const body = await signed(id, USDT(50)); // the payer saw 50.00
  assert.equal((await voucherCall("DELETE", id)).data.amountDue, "100.00");
  const res = await callPay(id, body);
  assert.equal(res.status, 400);
  assert.equal(relayCalls.length, 0);
  await applyCode(id, "HALF");
  assert.equal((await callPay(id, await signed(id, USDT(50)))).status, 200);
  assert.equal(relayCalls[0].amount, "50000000", "relaySale gets exactly the claimed price");
});

test("F1 (i): a payer without enough USDT for the claimed price is refused and the hold released", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  balance = USDT(49.99);
  const res = await callPay(id, await signed(id, USDT(50)));
  assert.equal(res.status, 400);
  assert.match(res.data.error, /^This is a demo: paying needs test USDT/);
  assert.equal(await frozen(id), false);
  balance = USDT(50); // the balance check is against the claimed 50, not the checkout's 100
  assert.equal((await callPay(id, await signed(id, USDT(50)))).status, 200);
});

// --- F1 (ii) and (3): relayer answers ---------------------------------------------------------------------------------

test("F1 (3): unknown (5xx, timeout) never releases; the attempt goes pending with its price", async () => {
  await newVoucher("HALF");
  for (const reply of [async () => Response.json({ error: "rpc" }, { status: 502 }), async () => { throw new DOMException("timed out", "TimeoutError"); }]) {
    const id = await linkCheckout();
    await resetHolds();
    await applyCode(id, "HALF");
    relayReply = reply;
    const res = await callPay(id, await signed(id, USDT(50)));
    assert.equal(res.status, 504);
    assert.match(res.data.error, /Don't pay again/);
    assert.equal(await frozen(id), true);
    assert.equal((await getSession(id)).pending.amount, USDT(50), "session.pending stores the claimed price");
    const again = await callPay(id, { ...(await signed(id, USDT(50))), signature: `0x${"00".repeat(64)}1b` });
    assert.equal(again.status, 409, "STILL_PENDING: refused before any claim");
    assert.equal(await frozen(id), true, "and never released");
  }
});
async function resetHolds() {
  await query("DELETE FROM app_gw_redemptions");
}

test("F1 (3): a relayer 200 the chain doesn't confirm never releases", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  chain.dropsRelayed = true; // the relayer says 200, the chain doesn't show it
  const res = await callPay(id, await signed(id, USDT(50)));
  assert.equal(res.status, 504);
  assert.equal(await frozen(id), true);
  assert.deepEqual([(await getSession(id)).pending.amount, chain.reads], [USDT(50), [USDT(50)]]);
});

test("F1 (ii): BUSY (503, 429, relayer unreachable) and other 4xx release the hold", async () => {
  await newVoucher("HALF", { max: 10 });
  const replies = [
    async () => Response.json({ code: "gas_price_cap" }, { status: 503 }),
    async () => Response.json({ code: "rate_limited" }, { status: 429 }),
    async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    },
    async () => Response.json({ error: "bad input" }, { status: 400 }),
  ];
  for (const [i, reply] of replies.entries()) {
    const id = await linkCheckout();
    await applyCode(id, "HALF");
    relayReply = reply;
    const res = await callPay(id, await signed(id, USDT(50)));
    assert.equal(res.status, i < 3 ? 503 : 400, `reply ${i}`);
    assert.match(res.data.error, /Nothing was charged/);
    assert.equal(await frozen(id), false, `reply ${i} released`);
    assert.equal((await getSession(id)).pending, undefined);
  }
});

test("F1 (ii): a 422 releases only after findPayment says exactly null; a failed read keeps it frozen (and pending)", async () => {
  await newVoucher("HALF", { max: 10 });
  relayReply = async () => Response.json({ error: "auth expired" }, { status: 422 });
  const refused = await linkCheckout();
  await applyCode(refused, "HALF");
  const a = await callPay(refused, await signed(refused, USDT(50)));
  assert.equal(a.status, 400);
  assert.match(a.data.error, /Nothing was charged/);
  assert.equal(await frozen(refused), false, "null: not paid, released");
  assert.deepEqual(chain.reads, [USDT(50)]);

  const unread = await linkCheckout();
  await applyCode(unread, "HALF");
  chain.fails = true;
  const b = await callPay(unread, await signed(unread, USDT(50)));
  assert.equal(b.status, 504, "we can't tell if the order is paid: never 'Nothing was charged'");
  assert.match(b.data.error, /Don't pay again/);
  assert.equal(await frozen(unread), true, "undefined: kept frozen");
  assert.equal((await getSession(unread)).pending.amount, USDT(50), "the chain decides later, at the claimed price");
});

test("F1 (ii): a 422 insufficient_funds is a refusal too: released after the chain says not paid", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  relayReply = async () => Response.json({ code: "insufficient_funds" }, { status: 422 });
  const res = await callPay(id, await signed(id, USDT(50)));
  assert.equal(res.status, 400);
  assert.equal(await frozen(id), false);
});

// --- F1 (iii) and F3: settlePending ----------------------------------------------------------------------------------

test("F1 (iii): settle 'open' (validBefore + 60 s passed, chain says not paid) releases the hold", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  relayReply = async () => Response.json({ error: "rpc" }, { status: 502 });
  await callPay(id, await signed(id, USDT(50)));
  await agePending(id, BigInt(Math.floor(Date.now() / 1000) - 30)); // within the 60 s margin
  assert.equal(await settlePending(await getSession(id), MERCHANT_PAY), "pending");
  assert.equal(await frozen(id), true);
  await agePending(id);
  const held = await claimPayment(id);
  assert.ok(held); // a payment is in flight right now: it settles the dead attempt itself
  try {
    assert.equal(await settlePending(await getSession(id), MERCHANT_PAY), "pending", "never released without the in-flight lock");
    assert.equal(await frozen(id), true);
  } finally {
    await releasePayment(id, held);
  }
  assert.equal(await settlePending(await getSession(id), MERCHANT_PAY), "open");
  assert.equal(await frozen(id), false, "released");
  assert.equal((await getSession(id)).pending, undefined);
  assert.equal((await applyCode(id, "HALF")).status, 200, "the payer may change or keep the code");
});

test("F3: settle 'paid' records with the claimed price and counts the code (webhook amount = paid)", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  relayReply = async () => {
    throw new DOMException("timed out", "TimeoutError");
  };
  await callPay(id, await signed(id, USDT(50)));
  chain.reads.length = 0;
  chain.paid = { payer: customer.address, amount: USDT(50) }; // it landed
  assert.equal(await settlePending(await getSession(id), MERCHANT_PAY), "paid");
  assert.deepEqual(chain.reads, [USDT(50)], "read at pending.amount, not the checkout's 100");
  assert.equal((await getSession(id)).payment.amount, USDT(50));
  assert.equal(await frozen(id), true, "never released once paid");
  await eventually(async () => (await query("SELECT key FROM app_gw_events WHERE key = $1", [`paid:${id}`])).length === 1); // payment.succeeded queued
  assert.equal(await timesRedeemed("HALF"), 1, "counted at the paid 50");
});

test("F3: the relay success path confirms at the claimed price, records it, and the checkout shows it paid", async () => {
  await newVoucher("TEN", { value: "10", max: 5 });
  const id = await linkCheckout(USDT(25));
  assert.deepEqual((await applyCode(id, "TEN")).data, { amountDue: "22.50", discount: "2.50", amountUnits: "22500000" });
  const res = await callPay(id, await signed(id, USDT(22.5)));
  assert.equal(res.status, 200);
  assert.equal(relayCalls[0].amount, "22500000");
  assert.equal((await getSession(id)).payment.amount, USDT(22.5));
  await eventually(async () => (await timesRedeemed("TEN")) === 1);
  const [row] = await query("SELECT paid_at FROM app_gw_checkouts WHERE session_id = $1", [id]);
  assert.notEqual(row.paid_at, null, "onSessionPaid marked the checkout paid");
});

// --- F5 and the apply route -------------------------------------------------------------------------------------------

test("F5: an apply during in-flight or pending gives 409", async () => {
  await newVoucher("HALF");
  await newVoucher("ONE", { value: "1", max: 1000 });
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  let land;
  relayReply = () => new Promise((resolve) => (land = () => resolve(Response.json({ error: "rpc" }, { status: 502 }))));
  const paying = callPay(id, await signed(id, USDT(50)));
  await eventually(async () => relayCalls.length === 1);
  const during = await applyCode(id, "ONE");
  assert.deepEqual([during.status, during.data.error], [409, "Finish or wait for the current payment first."]);
  assert.equal((await voucherCall("DELETE", id)).status, 409, "nor removed");
  land();
  assert.equal((await paying).status, 504);
  assert.equal((await applyCode(id, "ONE")).status, 409, "pending: still refused");
  assert.equal((await voucherCall("GET", id)).data.amountDue, "50.00", "the frozen price stands");
});

test("the code route: link/page checkouts only, open ones only, plain words for each refusal", async () => {
  await newVoucher("HALF", { max: 1 });
  await newVoucher("FIVE", { kind: "fixed", value: "5000000", max: 10 });
  const shop = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: USDT(25), reference: "", items: [] });
  assert.deepEqual(await applyCode(shop.id, "FIVE"), { status: 404, data: { error: "Codes work on payment links and pages." } });
  assert.equal((await applyCode("no-such-session", "FIVE")).status, 404);
  const id = await linkCheckout(USDT(25));
  assert.deepEqual(await applyCode(id, " five "), { status: 200, data: { amountDue: "20.00", discount: "5.00", amountUnits: "20000000" } });
  assert.deepEqual((await voucherCall("GET", id)).data, { amountDue: "20.00", discount: "5.00", amountUnits: "20000000" });
  assert.deepEqual((await voucherCall("DELETE", id)).data, { amountDue: "25.00", discount: "0.00", amountUnits: "25000000" });
  for (const [code, error] of [["NOPE", "That code isn't valid."], ["", "Enter a code."]]) {
    assert.deepEqual(await applyCode(id, code), { status: 400, data: { error } }, code);
  }
  const holder = await linkCheckout(USDT(25));
  assert.equal((await applyCode(holder, "HALF")).status, 200);
  assert.deepEqual(await applyCode(id, "HALF"), { status: 400, data: { error: "That code has been used up." } });
  await expireSession(id);
  assert.equal((await applyCode(id, "FIVE")).status, 410, "expired");
  const paid = await linkCheckout(USDT(25));
  await markCheckoutPaid(paid);
  assert.equal((await applyCode(paid, "FIVE")).status, 410, "paid");
});

test("the code route is rate-limited per IP and checkout", async () => {
  await newVoucher("FIVE", { kind: "fixed", value: "5000000", max: 10 });
  const id = await linkCheckout(USDT(25));
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await applyCode(id, "NOPE")).status);
  assert.deepEqual(statuses, [...Array(10).fill(400), 429]);
  assert.equal((await applyCode(await linkCheckout(USDT(25)), "FIVE")).status, 200, "another checkout from the same IP is its own window");
});

// --- the shop's own session and a failed read ------------------------------------------------------------------------

test("a shop's own session (no checkout row) keeps today's path: its amount, no claim", async () => {
  const shop = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: USDT(25), reference: "", items: [] });
  const res = await callPay(shop.id, await signed(shop.id, USDT(25)));
  assert.equal(res.status, 200);
  assert.equal(relayCalls[0].amount, "25000000");
});

/** PGlite as gw-helpers wires it; `seen` collects each query's text. */
const pgDb = (seen = []) => ({
  query: async (text, values) => {
    seen.push(`${text} [${(values ?? []).map(String).join(",")}]`); // the values too: a check can pin which row was read
    return (await pg.query(text, values)).rows;
  },
  transaction: (statements) =>
    pg.transaction(async (tx) => {
      const results = [];
      for (const s of statements) results.push((await tx.query(s.text, s.params ?? [])).rows);
      return results;
    }),
});
const dbDown = { query: async () => Promise.reject(new Error("db down")), transaction: async () => Promise.reject(new Error("db down")) };
/** Only the gateway's tables fail: the checkout store (app_web_*) still answers. */
const gatewayDown = { ...pgDb(), query: async (text, values) => (text.includes("app_gw_") ? Promise.reject(new Error("db down")) : (await pg.query(text, values)).rows) };

test("a database failure while reading the checkout refuses before anything is relayed", async () => {
  const id = await linkCheckout();
  setTestDb(gatewayDown);
  try {
    const res = await callPay(id, await signed(id, USDT(100)));
    assert.equal(res.status, 503);
    assert.match(res.data.error, /Nothing was charged/);
    assert.equal(relayCalls.length, 0);
    assert.equal((await callPay(id, { from: "nope" })).status, 400, "a bad body is still a 400, the failed read caught");
  } finally {
    setTestDb(pgDb());
  }
});

test("batch 023: the checkout store down is a 503 'nothing was charged' before anything is locked, claimed or relayed", async () => {
  const id = await linkCheckout();
  const body = await signed(id, USDT(100));
  setTestDb(dbDown);
  try {
    const res = await callPay(id, body);
    assert.deepEqual([res.status, res.data.error], [503, "Payments are busy right now. Nothing was charged; try again in a moment."]);
  } finally {
    setTestDb(pgDb());
  }
  assert.deepEqual([relayCalls.length, await frozen(id), await isInFlight(id)], [0, false, false]);
});

// --- batch 021 (NFR-4): the sheet signs the amount it shows and sends it; no voucher read before approving ------------

test("the sheet signs the amount it shows and sends it, with no voucher read before approving (security 015 INFO 8)", async () => {
  // a client component can't render in node:test, so this pins the source (the browser run is in the batch notes)
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("../components/Checkout.tsx", import.meta.url), "utf8");
  assert.equal(sheet.match(/\/voucher`/g)?.length, 1, "the code route is called only to apply or remove a code");
  assert.match(sheet, /amountUnits: sale\?\.amount/, "the first units are the server-rendered amount due");
  assert.match(sheet, /signSale\(\{ \.\.\.sale, amount: due\.amountUnits \}, expiresAt\)/, "it signs the units the sheet shows");
  assert.match(sheet, /JSON\.stringify\(\{ \.\.\.approval, amount: due\.amountUnits \}\)/, "and sends them as amount");
  assert.match(sheet, /res\.status === 409 && isDue\(data\)/, "a 409 with the amount due updates the sheet");
});

test("a sheet amount that isn't the claimed price: 409 with the amount due, the hold released, nothing relayed", async () => {
  await newVoucher("HALF", { max: 10 });
  const id = await linkCheckout();
  const sawFull = { ...(await signed(id, USDT(100))), amount: "100000000" }; // the payer saw 100.00
  await applyCode(id, "HALF"); // another tab applied HALF meanwhile: 50.00 is due
  const res = await callPay(id, sawFull);
  assert.equal(res.status, 409);
  assert.deepEqual(res.data, { error: "The total is now 50.00 USDT. Check it, then hold to pay again.", amountDue: "50.00", discount: "50.00", amountUnits: "50000000" });
  assert.equal(relayCalls.length, 0);
  assert.equal(await frozen(id), false, "this attempt froze it and signed nothing for it: released");
  assert.equal((await getSession(id)).pending, undefined);
  const again = await callPay(id, { ...(await signed(id, USDT(50))), amount: res.data.amountUnits });
  assert.equal(again.status, 200, "the payer approves the new total and pays");
  assert.equal(relayCalls[0].amount, "50000000");

  const other = await linkCheckout();
  await applyCode(other, "HALF");
  const sawHalf = { ...(await signed(other, USDT(50))), amount: "50000000" };
  await voucherCall("DELETE", other); // the code was removed elsewhere: 100.00 is due
  const up = await callPay(other, sawHalf);
  assert.deepEqual([up.status, up.data.amountDue, up.data.discount, up.data.amountUnits], [409, "100.00", "0.00", "100000000"]);
  assert.equal(relayCalls.length, 1, "nothing more relayed");
});

test("a sheet amount equal to the claimed price proceeds; the signature is still verified at that price", async () => {
  await newVoucher("HALF", { max: 10 });
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  const lying = await callPay(id, { ...(await signed(id, USDT(100))), amount: "50000000" }); // says 50, signed 100
  assert.deepEqual([lying.status, relayCalls.length, await frozen(id)], [400, 0, false], "MISMATCH, released: the verify is the backstop");
  const res = await callPay(id, { ...(await signed(id, USDT(50))), amount: "050000000" });
  assert.equal(res.status, 200);
  assert.equal(relayCalls[0].amount, "50000000");
});

test("no sheet amount (an older sheet) keeps today's path: verified at the claimed price", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  const res = await callPay(id, await signed(id, USDT(50)));
  assert.equal(res.status, 200);
  assert.equal(relayCalls[0].amount, "50000000");
});

test("a malformed sheet amount is a 400 before anything is locked or claimed", async () => {
  await newVoucher("HALF");
  const id = await linkCheckout();
  await applyCode(id, "HALF");
  for (const amount of [50000000, "5e7", "-1", "", "50.00", null]) {
    const res = await callPay(id, { ...(await signed(id, USDT(50))), amount });
    assert.deepEqual([res.status, res.data.error], [400, "amount must be USDT units."], String(amount));
  }
  assert.deepEqual([relayCalls.length, await frozen(id)], [0, false]);
  assert.equal((await voucherCall("DELETE", id)).status, 200, "not in flight, nothing frozen");
});

test("the sheet amount is checked after the lock and the open check: there, a 409 or STILL_PENDING releases nothing", async () => {
  await newVoucher("HALF", { max: 10 });
  const busy = await linkCheckout();
  await applyCode(busy, "HALF");
  const other = await claimPayment(busy);
  assert.ok(other); // another request is paying: it claimed and froze the hold
  try {
    assert.equal(await claimAmountDue(busy), USDT(50));
    const res = await callPay(busy, { ...(await signed(busy, USDT(100))), amount: "100000000" });
    assert.deepEqual([res.status, res.data.error, res.data.amountDue], [409, "This checkout is already being paid.", undefined]);
    assert.equal(await frozen(busy), true, "the other attempt's freeze stands");
  } finally {
    await releasePayment(busy, other);
  }

  const id = await linkCheckout();
  await applyCode(id, "HALF");
  relayReply = async () => Response.json({ error: "rpc" }, { status: 502 });
  assert.equal((await callPay(id, { ...(await signed(id, USDT(50))), amount: "50000000" })).status, 504); // pending at 50
  const res = await callPay(id, { ...(await signed(id, USDT(100))), amount: "100000000" });
  assert.deepEqual([res.status, res.data.amountDue], [409, undefined]);
  assert.match(res.data.error, /still confirming/);
  assert.equal(await frozen(id), true, "never released while pending");
});

test("the checkout read runs while the body is still arriving (NFR-4)", async () => {
  const id = await linkCheckout();
  const seen = [];
  setTestDb(pgDb(seen));
  try {
    let body;
    const stream = new ReadableStream({ start: (controller) => (body = controller) });
    const replied = pay(new Request(`http://shop.test/api/v1/sessions/${id}/pay`, { method: "POST", body: stream, duplex: "half" }), { params: Promise.resolve({ id }) });
    // this session's checkout row, not a background read from an earlier test (security review 021 F1)
    await eventually(async () => seen.some((text) => text.includes("FROM app_gw_checkouts") && text.includes(id)));
    body.enqueue(new TextEncoder().encode(JSON.stringify({ ...(await signed(id, USDT(100))), amount: "100000000" })));
    body.close();
    assert.equal((await replied).status, 200);
    assert.equal(relayCalls[0].amount, "100000000");
  } finally {
    setTestDb(pgDb());
  }
});
