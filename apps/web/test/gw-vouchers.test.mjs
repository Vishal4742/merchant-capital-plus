// Batch 007 Builder B: vouchers (FR-GW-12, FR-ARK-4). Real SQL on PGlite; the Arkiv writer is mocked.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-vouchers.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ExpirationTime } from "@arkiv-network/sdk";
import { setupDb, resetDb, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const ACCESS_KEY = "ak_test_secret/access+key";
const HASH_SECRET = "voucher-hash-secret-for-tests";
const ENTITY_KEY = `0x${"ab".repeat(32)}`;

// the Arkiv writer: records every createEntity call; arkiv.fail makes the write throw
const arkiv = { calls: [], fail: null };
mock.module("../lib/arkiv.ts", {
  namedExports: {
    arkivClients: () => ({
      address: "0x3333333333333333333333333333333333333333",
      writer: {
        createEntity: async (...args) => {
          arkiv.calls.push(args);
          if (arkiv.fail) throw arkiv.fail;
          return { entityKey: ENTITY_KEY, txHash: `0x${"cd".repeat(32)}`, expiresAt: 123n };
        },
      },
    }),
    redactArkivError: (err, key) => (err instanceof Error ? err.message : String(err)).replaceAll(key, "<access-key>"),
  },
});

const { POST: create, GET: list } = await import("../app/api/v1/vouchers/route.ts");
const { POST: deactivate } = await import("../app/api/v1/vouchers/[id]/deactivate/route.ts");
const { applyVoucher, confirmRedemption } = await import("../lib/server/vouchers.ts");
const { recordCheckout, markCheckoutPaid } = await import("../lib/server/checkouts.ts");

const DAY = 24 * 60 * 60 * 1000;
const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const future = () => new Date(Date.now() + 30 * DAY).toISOString();
const voucher = (over = {}) => ({ code: "save10", kind: "percent", value: "10", expires_at: future(), max_redemptions: 100, ...over });
async function newVoucher(over = {}, merchant = MERCHANT) {
  const res = await create(req("POST", "/api/v1/vouchers", { body: voucher(over), headers: signedIn(merchant) }));
  return { res, data: await res.json() };
}
let n = 0;
async function checkout(amount = USDT(25), merchant = MERCHANT, at = Date.now()) {
  const id = `ses_test_${++n}`;
  await recordCheckout(id, "link", "lnk_1", merchant, amount, { now: at });
  return id;
}

before(setupDb);
beforeEach(async () => {
  await resetDb();
  arkiv.calls.length = 0;
  arkiv.fail = null;
  process.env.VOUCHER_HASH_SECRET = HASH_SECRET;
  process.env.ARKIV_ACCESS_KEY = ACCESS_KEY;
});

test("voucher routes need the dashboard cookie", async () => {
  assert.equal((await create(req("POST", "/api/v1/vouchers", { body: voucher() }))).status, 401);
  assert.equal((await list(req("GET", "/api/v1/vouchers"))).status, 401);
  assert.equal((await deactivate(req("POST", "/api/v1/vouchers/x/deactivate"), params({ id: "x" }))).status, 401);
});

test("creating a voucher stores the code uppercase and mirrors only its hash to Arkiv", async () => {
  const expires = future();
  const { res, data } = await newVoucher({ expires_at: expires, min_amount: "5.00" });
  assert.equal(res.status, 201);
  assert.match(data.id, /^vch_/);
  assert.deepEqual(
    { code: data.code, kind: data.kind, value: data.value, times_redeemed: data.times_redeemed, max_redemptions: data.max_redemptions, min_amount: data.min_amount, active: data.active, arkiv_entity_key: data.arkiv_entity_key, expires_at: data.expires_at },
    { code: "SAVE10", kind: "percent", value: "10", times_redeemed: 0, max_redemptions: 100, min_amount: "5", active: true, arkiv_entity_key: ENTITY_KEY, expires_at: new Date(Date.parse(expires)).toISOString() },
  );
  assert.equal(arkiv.calls.length, 1);
  const [schema, values, options] = arkiv.calls[0];
  assert.equal(schema.name, "mcplus.voucher.v1");
  const expectedHash = createHmac("sha256", HASH_SECRET).update(`${MERCHANT.toLowerCase()}:SAVE10`).digest("hex");
  assert.equal(values.type, "mcplus.voucher.v1");
  assert.equal(values.merchant, MERCHANT.toLowerCase());
  assert.equal(values.code_hash, expectedHash);
  assert.equal(values.kind, "percent");
  assert.equal(values.value, "10");
  assert.deepEqual(values.expires_at, { type: "u64", value: BigInt(Math.floor(Date.parse(expires) / 1000)) }, "unix seconds");
  assert.deepEqual(options.expiration, ExpirationTime.atDate(new Date(Date.parse(expires))), "the entity expires with the code");
  const onChain = JSON.stringify(values, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.ok(!/save10/i.test(onChain), "FR-ARK-4: the plain code never goes to Arkiv");
});

test("a fixed voucher keeps its USDT value", async () => {
  const { res, data } = await newVoucher({ code: "FIVE-OFF_1", kind: "fixed", value: "5.50" });
  assert.equal(res.status, 201);
  assert.equal(data.value, "5.5");
  assert.equal(data.min_amount, null);
});

test("bad voucher input is refused with 400", async () => {
  const bad = [
    { code: "ab" }, { code: "A".repeat(33) }, { code: "SAVE 10" }, { code: "SAVE!" }, { code: undefined },
    { kind: "bogo" },
    { value: "0" }, { value: "101" }, { value: "10.5" }, { value: 10 }, { value: "-5" },
    { kind: "fixed", value: "0" }, { kind: "fixed", value: "1.1234567" }, { kind: "fixed", value: "1001" },
    { expires_at: undefined }, { expires_at: new Date(Date.now() - 1000).toISOString() }, { expires_at: "soon" },
    { max_redemptions: 0 }, { max_redemptions: 100_001 }, { max_redemptions: 1.5 }, { max_redemptions: "ten" },
    { min_amount: "0.5" }, { min_amount: "abc" },
  ];
  for (const over of bad) {
    const { res, data } = await newVoucher(over);
    assert.equal(res.status, 400, JSON.stringify(over));
    assert.equal(typeof data.error, "string");
  }
  assert.equal(arkiv.calls.length, 0, "nothing is mirrored for refused input");
});

test("a code is unique per merchant, case-insensitively", async () => {
  assert.equal((await newVoucher({ code: "SAVE10" })).res.status, 201);
  const dup = await newVoucher({ code: "save10" });
  assert.equal(dup.res.status, 409);
  assert.equal(arkiv.calls.length, 1, "a duplicate is not mirrored");
  assert.equal((await newVoucher({ code: "SAVE10" }, OTHER_MERCHANT)).res.status, 201, "another merchant may use the same code");
});

test("an Arkiv failure still creates the voucher, with no entity key and a redacted log", async () => {
  arkiv.fail = new Error(`HTTP request failed. URL: https://rpc.example/${ACCESS_KEY}`);
  const logged = [];
  const spy = mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  try {
    const { res, data } = await newVoucher();
    assert.equal(res.status, 201);
    assert.equal(data.arkiv_entity_key, null);
  } finally {
    spy.mock.restore();
  }
  assert.ok(logged.length >= 1, "the failure is logged");
  assert.ok(logged.every((l) => !l.includes(ACCESS_KEY)), "the access key never reaches the log");
  const { data: listed } = { data: await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json() };
  assert.equal(listed.vouchers.length, 1);
});

test("without VOUCHER_HASH_SECRET the voucher is created but not mirrored", async () => {
  delete process.env.VOUCHER_HASH_SECRET;
  const spy = mock.method(console, "error", () => {});
  try {
    const { res, data } = await newVoucher();
    assert.equal(res.status, 201);
    assert.equal(data.arkiv_entity_key, null);
  } finally {
    spy.mock.restore();
  }
  assert.equal(arkiv.calls.length, 0);
});

test("the list is the merchant's own vouchers, newest first", async () => {
  await newVoucher({ code: "FIRST" });
  await new Promise((r) => setTimeout(r, 5));
  await newVoucher({ code: "SECOND" });
  await newVoucher({ code: "THEIRS" }, OTHER_MERCHANT);
  const data = await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json();
  assert.deepEqual(data.vouchers.map((v) => v.code), ["SECOND", "FIRST"]);
});

test("deactivate: owner only (another merchant's id is 404), then the code stops working", async () => {
  const { data } = await newVoucher();
  const other = await deactivate(req("POST", `/api/v1/vouchers/${data.id}/deactivate`, { headers: signedIn(OTHER_MERCHANT) }), params({ id: data.id }));
  assert.equal(other.status, 404);
  const res = await deactivate(req("POST", `/api/v1/vouchers/${data.id}/deactivate`, { headers: signedIn() }), params({ id: data.id }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: data.id, active: false });
  const session = await checkout();
  const applied = await applyVoucher(MERCHANT, "SAVE10", session, USDT(25));
  assert.equal(applied.ok, false);
});

test("applyVoucher: percent off, rounded down in the merchant's favour", async () => {
  await newVoucher({ value: "15" });
  const session = await checkout(USDT(9.99));
  const r = await applyVoucher(MERCHANT, " save10 ", session, USDT(9.99));
  // 15% of 9.99 = 1.4985 USDT exactly; floor at 6 dp
  assert.deepEqual(r, { ok: true, discount: 1_498_500n, usdtAmount: 8_491_500n });
  const odd = await checkout(1_000_001n);
  const r2 = await applyVoucher(MERCHANT, "SAVE10", odd, 1_000_001n);
  assert.equal(r2.ok, false, "1.000001 - 15% is under 1 USDT");
});

test("applyVoucher: fixed off and the 1 USDT floor", async () => {
  await newVoucher({ code: "FIVE", kind: "fixed", value: "5.00" });
  const session = await checkout(USDT(25));
  assert.deepEqual(await applyVoucher(MERCHANT, "FIVE", session, USDT(25)), { ok: true, discount: USDT(5), usdtAmount: USDT(20) });
  const small = await checkout(USDT(5.5));
  const r = await applyVoucher(MERCHANT, "FIVE", small, USDT(5.5));
  assert.equal(r.ok, false);
  assert.match(r.reason, /1 USDT/);
  const exact = await checkout(USDT(6));
  assert.deepEqual(await applyVoucher(MERCHANT, "FIVE", exact, USDT(6)), { ok: true, discount: USDT(5), usdtAmount: USDT(1) }, "exactly 1 USDT is allowed");
});

test("applyVoucher refuses shop sessions, other merchants' sessions, unknown codes and mismatched amounts", async () => {
  await newVoucher();
  const shop = await applyVoucher(MERCHANT, "SAVE10", "ses_from_sk_key", USDT(25));
  assert.deepEqual(shop, { ok: false, reason: "Vouchers work on payment links and pages only." });
  const theirs = await checkout(USDT(25), OTHER_MERCHANT);
  assert.deepEqual(await applyVoucher(MERCHANT, "SAVE10", theirs, USDT(25)), { ok: false, reason: "Vouchers work on payment links and pages only." });
  const mine = await checkout(USDT(25));
  assert.equal((await applyVoucher(OTHER_MERCHANT, "SAVE10", mine, USDT(25))).ok, false, "the other merchant has no such code");
  assert.equal((await applyVoucher(MERCHANT, "NOPE", mine, USDT(25))).ok, false);
  assert.equal((await applyVoucher(MERCHANT, "", mine, USDT(25))).ok, false);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", mine, USDT(1))).ok, false, "the amount must be the checkout's own amount");
});

test("applyVoucher refuses expired, used-up and below-minimum codes, and paid checkouts", async () => {
  const { data } = await newVoucher({ max_redemptions: 1, min_amount: "20.00" });
  const session = await checkout(USDT(25));
  const atExpiry = Date.parse(data.expires_at);
  const late = await checkout(USDT(25), MERCHANT, atExpiry - 60_000); // a fresh checkout opened a minute before the code expires
  const expired = await applyVoucher(MERCHANT, "SAVE10", late, USDT(25), atExpiry);
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "That code has expired.");
  const low = await checkout(USDT(19.99));
  const below = await applyVoucher(MERCHANT, "SAVE10", low, USDT(19.99));
  assert.equal(below.ok, false);
  assert.match(below.reason, /at least 20 USDT/);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", session, USDT(25))).ok, true);
  assert.deepEqual(await confirmRedemption(session, USDT(22.5)), { voucherId: data.id, code: "SAVE10" });
  const next = await checkout(USDT(25));
  const usedUp = await applyVoucher(MERCHANT, "SAVE10", next, USDT(25));
  assert.equal(usedUp.ok, false);
  assert.match(usedUp.reason, /used up/);
  const paid = await checkout(USDT(25));
  await markCheckoutPaid(paid);
  await newVoucher({ code: "OTHER" });
  assert.equal((await applyVoucher(MERCHANT, "OTHER", paid, USDT(25))).ok, false, "a paid checkout can't take a code");
});

test("re-applying replaces the session's voucher; a confirmed one can't be replaced", async () => {
  await newVoucher({ code: "TEN", value: "10" });
  await newVoucher({ code: "TWENTY", value: "20" });
  const session = await checkout(USDT(50));
  assert.equal((await applyVoucher(MERCHANT, "TEN", session, USDT(50))).usdtAmount, USDT(45));
  assert.equal((await applyVoucher(MERCHANT, "TWENTY", session, USDT(50))).usdtAmount, USDT(40));
  const confirmed = await confirmRedemption(session, USDT(40));
  assert.equal(confirmed.code, "TWENTY", "only the latest code counts");
  const listed = await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json();
  assert.deepEqual(Object.fromEntries(listed.vouchers.map((v) => [v.code, v.times_redeemed])), { TEN: 0, TWENTY: 1 });
  assert.equal((await applyVoucher(MERCHANT, "TEN", session, USDT(50))).ok, false);
});

test("confirmRedemption counts once per session and is a no-op without a reservation", async () => {
  const { data } = await newVoucher();
  const session = await checkout();
  await applyVoucher(MERCHANT, "SAVE10", session, USDT(25));
  assert.deepEqual(await confirmRedemption(session, USDT(22.5)), { voucherId: data.id, code: "SAVE10" });
  assert.equal(await confirmRedemption(session, USDT(22.5)), null, "second call: no change");
  assert.equal(await confirmRedemption("ses_without_voucher", USDT(25)), null);
  const listed = await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json();
  assert.equal(listed.vouchers[0].times_redeemed, 1);
});

test("security H1: a 1-use code applied to many open checkouts discounts only the first (holds count)", async () => {
  await newVoucher({ max_redemptions: 1 });
  const sessions = [await checkout(), await checkout(), await checkout(), await checkout()];
  const results = [];
  for (const s of sessions) results.push(await applyVoucher(MERCHANT, "SAVE10", s, USDT(25)));
  assert.deepEqual(results.map((r) => r.ok), [true, false, false, false]);
  assert.match(results[1].reason, /used up/);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", sessions[0], USDT(25))).ok, true, "the holder may re-apply its own code");
});

test("a hold ends with its checkout session (+15 min grace, S2): then another checkout can use the code", async () => {
  const { SESSION_TTL_MS } = await import("../lib/sessions.ts");
  const { HOLD_MS } = await import("../lib/server/vouchers.ts");
  assert.equal(HOLD_MS, SESSION_TTL_MS + 15 * 60_000, "the relayer accepts signatures up to 900 s");
  await newVoucher({ max_redemptions: 1 });
  const t = Date.now();
  const a = await checkout(USDT(25), MERCHANT, t);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", a, USDT(25), t)).ok, true);
  const b = await checkout(USDT(25), MERCHANT, t + SESSION_TTL_MS);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", b, USDT(25), t + SESSION_TTL_MS + 1)).ok, false, "a's hold still counts in the grace");
  const c = await checkout(USDT(25), MERCHANT, t + HOLD_MS);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", c, USDT(25), t + HOLD_MS + 1)).ok, true, "a's hold is over");
  // a's (lapsed) hold and c's hold both exist; if both were somehow paid, the last-use guard still counts exactly one
  const results = await Promise.all([confirmRedemption(a, USDT(22.5)), confirmRedemption(c, USDT(22.5)), confirmRedemption(a, USDT(22.5))]);
  assert.equal(results.filter(Boolean).length, 1);
  const listed = await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json();
  assert.equal(listed.vouchers[0].times_redeemed, 1);
});

test("R2-M2: an expired checkout can't take a code, and re-applying late never extends a hold", async () => {
  const { SESSION_TTL_MS } = await import("../lib/sessions.ts");
  const { HOLD_MS } = await import("../lib/server/vouchers.ts");
  await newVoucher({ max_redemptions: 1 });
  const t = Date.now();
  const a = await checkout(USDT(25), MERCHANT, t);
  const old = await applyVoucher(MERCHANT, "SAVE10", a, USDT(25), t + SESSION_TTL_MS);
  assert.deepEqual(old, { ok: false, reason: "This checkout has expired." });
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", a, USDT(25), t)).ok, true);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", a, USDT(25), t + SESSION_TTL_MS - 1)).ok, true, "re-apply inside the session");
  const fresh = await checkout(USDT(25), MERCHANT, t + HOLD_MS);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", fresh, USDT(25), t + HOLD_MS + 1)).ok, true, "a's hold ended at its checkout's start + HOLD_MS, not at the re-apply");
});

test("R2-M1: amountDue is the live hold's total, else the checkout's amount, else null", async () => {
  const { amountDue, HOLD_MS } = await import("../lib/server/vouchers.ts");
  await newVoucher({ code: "TEN", value: "10" });
  await newVoucher({ code: "TWENTY", value: "20" });
  const t = Date.now();
  const s = await checkout(USDT(50), MERCHANT, t);
  assert.equal(await amountDue(s, t), USDT(50), "no code yet");
  await applyVoucher(MERCHANT, "TEN", s, USDT(50), t);
  assert.equal(await amountDue(s, t), USDT(45));
  await applyVoucher(MERCHANT, "TWENTY", s, USDT(50), t);
  assert.equal(await amountDue(s, t), USDT(40), "the switched code wins");
  assert.equal(await amountDue(s, t + HOLD_MS + 1), USDT(50), "a lapsed hold no longer discounts");
  assert.equal(await amountDue("ses_shop_own", t), null, "a shop's own session: not ours to price");
});

test("code review M3: paying the full price after applying a code doesn't count a use", async () => {
  await newVoucher();
  const s = await checkout();
  await applyVoucher(MERCHANT, "SAVE10", s, USDT(25));
  assert.equal(await confirmRedemption(s, USDT(25)), null, "the session was paid at the full price, not 22.50");
  const listed = await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json();
  assert.equal(listed.vouchers[0].times_redeemed, 0);
});

// Batch 009 Builder A: security S1 (batch 008). The pay route claims the price, which freezes the hold, so a re-apply
// during the relay can't switch the code and free the paid one's use.
const timesRedeemed = async (code) => (await (await list(req("GET", "/api/v1/vouchers", { headers: signedIn() }))).json()).vouchers.find((v) => v.code === code).times_redeemed;

test("S1 PoC: apply HALF, claim, re-apply ONE is refused; confirm counts HALF; HALF then refuses another checkout", async () => {
  const { claimAmountDue } = await import("../lib/server/vouchers.ts");
  await newVoucher({ code: "HALF", value: "50", max_redemptions: 1 });
  await newVoucher({ code: "ONE", value: "1", max_redemptions: 1000 });
  const t = Date.now();
  const s1 = await checkout(USDT(100), MERCHANT, t);
  const s2 = await checkout(USDT(100), MERCHANT, t);
  assert.equal((await applyVoucher(MERCHANT, "HALF", s1, USDT(100), t)).ok, true);
  const claimed = await claimAmountDue(s1, t); // the pay route: charge this, relay starts
  assert.equal(claimed, USDT(50));
  assert.equal((await applyVoucher(MERCHANT, "HALF", s2, USDT(100), t)).ok, false, "HALF is held by s1");
  assert.deepEqual(await applyVoucher(MERCHANT, "ONE", s1, USDT(100), t + 1000), { ok: false, reason: "This checkout is being paid." });
  assert.deepEqual(await applyVoucher(MERCHANT, "HALF", s1, USDT(100), t + 1000), { ok: false, reason: "This checkout is being paid." }, "not even the same code");
  assert.equal((await confirmRedemption(s1, claimed, t + 2000))?.code, "HALF", "the relay settled at the claimed price");
  const second = await applyVoucher(MERCHANT, "HALF", s2, USDT(100), t + 3000);
  assert.equal(second.ok, false);
  assert.match(second.reason, /used up/);
  assert.equal(await timesRedeemed("HALF"), 1);
  assert.equal(await timesRedeemed("ONE"), 0);
});

test("releaseHold after a definitely refused relay: the payer can change the code, and nothing stays locked", async () => {
  const { claimAmountDue, releaseHold, amountDue } = await import("../lib/server/vouchers.ts");
  await newVoucher({ code: "HALF", value: "50", max_redemptions: 1 });
  await newVoucher({ code: "ONE", value: "1", max_redemptions: 1000 });
  const t = Date.now();
  const s = await checkout(USDT(100), MERCHANT, t);
  await applyVoucher(MERCHANT, "HALF", s, USDT(100), t);
  assert.equal(await claimAmountDue(s, t), USDT(50));
  assert.equal(await releaseHold(s), true, "the relay said no: nothing was sent");
  assert.equal(await releaseHold(s), false, "releasing twice changes nothing");
  assert.equal((await applyVoucher(MERCHANT, "ONE", s, USDT(100), t + 1000)).ok, true, "unfrozen: the payer may switch codes");
  assert.equal(await amountDue(s, t + 1000), USDT(99));
  const other = await checkout(USDT(100), MERCHANT, t);
  assert.equal((await applyVoucher(MERCHANT, "HALF", other, USDT(100), t + 1000)).ok, true, "HALF's use was freed");
  assert.equal(await releaseHold("ses_no_hold"), false);
});

test("F1: releaseHold never unfreezes a paid checkout's hold", async () => {
  const { claimAmountDue, releaseHold } = await import("../lib/server/vouchers.ts");
  await newVoucher({ code: "HALF", value: "50", max_redemptions: 1 });
  const t = Date.now();
  const s = await checkout(USDT(100), MERCHANT, t);
  await applyVoucher(MERCHANT, "HALF", s, USDT(100), t);
  assert.equal(await claimAmountDue(s, t), USDT(50));
  await markCheckoutPaid(s, t + 1000); // the payment landed (e.g. someone else submitted the signed authorization)
  assert.equal(await releaseHold(s), false, "a paid checkout keeps its hold");
  // N5: checked after HOLD_MS, where an unfrozen hold would no longer count: only "frozen stays frozen" keeps HALF held
  const { HOLD_MS } = await import("../lib/server/vouchers.ts");
  const later = t + HOLD_MS + 60_000;
  const other = await checkout(USDT(100), MERCHANT, later);
  assert.equal((await applyVoucher(MERCHANT, "HALF", other, USDT(100), later + 1)).ok, false, "HALF stays held after HOLD_MS");
});

test("F4: a fiat checkout (10-min lock) can't take a code after 10 minutes; USD keeps 30", async () => {
  const { QUOTE_TTL_MS } = await import("../lib/server/quotes.ts");
  await newVoucher();
  const t = Date.now();
  const fx = (currency) => ({ currency, amount: USDT(20), rate: currency === "USD" ? "1" : "0.8", rateAt: new Date(t).toISOString().slice(0, 10), source: "test", fetchedAt: t });
  await recordCheckout("ses_eur", "link", "lnk_1", MERCHANT, USDT(25), { fx: fx("EUR"), now: t });
  await recordCheckout("ses_usd", "link", "lnk_1", MERCHANT, USDT(20), { fx: fx("USD"), now: t });
  assert.deepEqual(await applyVoucher(MERCHANT, "SAVE10", "ses_eur", USDT(25), t + QUOTE_TTL_MS), { ok: false, reason: "This checkout has expired." });
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", "ses_eur", USDT(25), t + QUOTE_TTL_MS - 1)).ok, true);
  assert.equal((await applyVoucher(MERCHANT, "SAVE10", "ses_usd", USDT(20), t + QUOTE_TTL_MS + 60_000)).ok, true, "USD checkouts live 30 minutes");
});

test("S1: an apply racing the claim is refused by the upsert's own guard, and the claimed price stands", async () => {
  const { claimAmountDue, amountDue } = await import("../lib/server/vouchers.ts");
  await newVoucher({ code: "HALF", value: "50", max_redemptions: 1 });
  await newVoucher({ code: "ONE", value: "1", max_redemptions: 1000 });
  const t = Date.now();
  const s = await checkout(USDT(100), MERCHANT, t);
  await applyVoucher(MERCHANT, "HALF", s, USDT(100), t);
  // the apply's pre-check runs before the claim's UPDATE; its upsert runs after it
  const [applied, claimed] = await Promise.all([applyVoucher(MERCHANT, "ONE", s, USDT(100), t), claimAmountDue(s, t)]);
  assert.equal(applied.ok, false);
  assert.equal(claimed, USDT(50));
  assert.equal(await amountDue(s, t), USDT(50), "the hold is still HALF's");
  assert.equal((await confirmRedemption(s, claimed, t)).code, "HALF");
});

test("claimAmountDue is idempotent: a second claim returns the same amount and keeps the first freeze time", async () => {
  const { claimAmountDue } = await import("../lib/server/vouchers.ts");
  const { query } = await import("../lib/server/db.ts");
  await newVoucher({ code: "TEN", value: "10" });
  const t = Date.now();
  const s = await checkout(USDT(50), MERCHANT, t);
  await applyVoucher(MERCHANT, "TEN", s, USDT(50), t);
  assert.equal(await claimAmountDue(s, t + 1000), USDT(45));
  assert.equal(await claimAmountDue(s, t + 5000), USDT(45));
  const [{ frozen_at }] = await query("SELECT frozen_at::text FROM app_gw_redemptions WHERE session_id = $1", [s]);
  assert.equal(Number(frozen_at), t + 1000);
});

test("claimAmountDue: a shop's own session is null; no hold or a lapsed hold is the checkout's amount, not frozen", async () => {
  const { claimAmountDue, HOLD_MS } = await import("../lib/server/vouchers.ts");
  const { query } = await import("../lib/server/db.ts");
  assert.equal(await claimAmountDue("ses_from_sk_key"), null);
  await newVoucher({ code: "TEN", value: "10" });
  const t = Date.now();
  const plain = await checkout(USDT(50), MERCHANT, t);
  assert.equal(await claimAmountDue(plain, t), USDT(50), "no hold");
  const lapsed = await checkout(USDT(50), MERCHANT, t);
  await applyVoucher(MERCHANT, "TEN", lapsed, USDT(50), t);
  assert.equal(await claimAmountDue(lapsed, t + HOLD_MS + 1), USDT(50), "a lapsed hold no longer discounts");
  const [{ frozen_at }] = await query("SELECT frozen_at::text FROM app_gw_redemptions WHERE session_id = $1", [lapsed]);
  assert.equal(frozen_at, null);
});

test("a frozen hold keeps counting after HOLD_MS (its payment may still settle), and amountDue reports it", async () => {
  const { SESSION_TTL_MS } = await import("../lib/sessions.ts");
  const { claimAmountDue, amountDue, HOLD_MS } = await import("../lib/server/vouchers.ts");
  await newVoucher({ code: "HALF", value: "50", max_redemptions: 1 });
  const t = Date.now();
  const a = await checkout(USDT(100), MERCHANT, t);
  await applyVoucher(MERCHANT, "HALF", a, USDT(100), t);
  assert.equal(await claimAmountDue(a, t + SESSION_TTL_MS - 1), USDT(50), "claimed just before the session ends");
  const late = t + HOLD_MS + 60_000;
  const b = await checkout(USDT(100), MERCHANT, late);
  const r = await applyVoucher(MERCHANT, "HALF", b, USDT(100), late + 1);
  assert.equal(r.ok, false);
  assert.match(r.reason, /used up/);
  assert.equal(await amountDue(a, late), USDT(50));
  assert.equal(await claimAmountDue(a, late), USDT(50), "a retried claim still gets the frozen price");
});
