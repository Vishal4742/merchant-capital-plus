// claude-contracts checks for FX (SRS FR-GW-11, AT-13 backend half; batch 008: the app's single FX source with the SDK's
// conventions): USD 1:1, Frankfurter v2 per-USD rates, rounding UP to the cent, the sanity bands, the 7-day freshness
// rule, the 10-minute lock and the bounds. fetch is mocked; nothing hits the network.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-quotes.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { req, resetDb, setupDb } from "./gw-helpers.mjs";

before(setupDb);
beforeEach(async () => {
  await resetDb();
  mock.restoreAll();
});

const { POST } = await import("../app/api/v1/quotes/route.ts");
const { createQuote, getQuote, pricedJson, toUsdtUnits, usdRate, QUOTE_TTL_MS } = await import("../lib/server/quotes.ts");

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const RATES = { AED: 3.6725, EUR: 0.88875, GBP: 0.74225, INR: 94.5, SGD: 1.2774 };
const v2 = (over = {}, date = today) =>
  mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), "https://api.frankfurter.dev/v2/rates?base=usd&quotes=aed,eur,gbp,inr,sgd");
    return Response.json(Object.entries({ ...RATES, ...over }).map(([quote, rate]) => ({ date, base: "USD", quote, rate })));
  });
const quote = (body, ip = "203.0.113.7") => POST(req("POST", "/api/v1/quotes", { body, headers: { "x-forwarded-for": ip } }));

test("USD and USDT are 1:1 with no rate fetch", async () => {
  const fetchMock = v2();
  const body = await (await quote({ amount: "25.00", currency: "usd" })).json();
  assert.equal(body.usdt_amount, "25");
  assert.equal(body.rate, "1");
  assert.equal(body.source, "USD = USDT 1:1");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("20 EUR at 0.88875 per USD → 22.51 USDT (22.5035… rounded UP to the cent), locked 10 minutes (AT-13)", async () => {
  v2();
  const now = Date.now();
  const q = await createQuote("20.00", "EUR", now);
  assert.equal(q.usdtAmount, 22_510_000n);
  assert.equal(q.rate, "0.88875");
  assert.equal(q.rateAt, today);
  assert.equal(q.expiresAt, now + QUOTE_TTL_MS);
  assert.equal((await getQuote(q.id, now + QUOTE_TTL_MS - 1)).usdtAmount, 22_510_000n);
  assert.equal(await getQuote(q.id, now + QUOTE_TTL_MS), null, "expired at exactly 10 minutes");
  assert.equal(await getQuote("quote_unknown", now), null);
  assert.deepEqual(pricedJson(q), { currency: "EUR", amount: "20.00", rate: "0.88875", rateAt: today, source: q.source }, "the SDK's priced shape");
});

test("rounding is up to the cent, never down, and exact amounts stay exact", () => {
  assert.equal(toUsdtUnits("1", { num: 3n, den: 1n }), 340_000n); // 0.3333… → 0.34
  assert.equal(toUsdtUnits("3", { num: 3n, den: 1n }), 1_000_000n); // exactly 1.00
  assert.equal(toUsdtUnits("10.001", { num: 1n, den: 1n }), 10_010_000n); // 10.001 → 10.01 (half-up would give 10.00)
  assert.throws(() => toUsdtUnits("1.1234567", { num: 1n, den: 1n }), /decimal string/);
  assert.throws(() => toUsdtUnits("-1", { num: 1n, den: 1n }), /decimal string/);
});

test("AED comes from the same fetch and must sit within 1% of the 3.6725 peg", async () => {
  v2();
  const q = await createQuote("36.725", "AED", Date.now());
  assert.equal(q.usdtAmount, 10_000_000n); // 36.725 AED = 10.00 USD
});

test("a rate outside its band, AED off its peg, or a stale or future date makes that currency unavailable (503)", async () => {
  const cases = [
    [{ EUR: 5 }, "EUR"],
    [{ EUR: 1.1251 }, "EUR"], // a flipped rate (USD per EUR read as EUR per USD): passed the old 0.5–2 band (human 06:18)
    [{ GBP: 1.3459 }, "GBP"], // flipped GBP
    [{ SGD: 0.783 }, "SGD"], // flipped SGD
    [{ INR: 10 }, "INR"],
    [{ AED: 3.8 }, "AED"],
  ];
  for (const [over, currency] of cases) {
    mock.restoreAll();
    const { resetRateCache } = await import("../lib/server/quotes.ts");
    resetRateCache();
    v2(over);
    const err = await usdRate(currency).catch((e) => e);
    assert.equal(err.status, 503, `${currency} ${JSON.stringify(over)}`);
    assert.match(err.message, new RegExp(`Prices in ${currency} are unavailable`));
    const control = currency === "GBP" ? "INR" : "GBP";
    assert.equal((await usdRate(control)).rate, String(RATES[control]), "the other currencies still work");
  }
  for (const date of [daysAgo(8), daysAgo(-2), "2026-02-30", "garbage"]) {
    mock.restoreAll();
    (await import("../lib/server/quotes.ts")).resetRateCache();
    v2({}, date);
    assert.equal((await usdRate("EUR").catch((e) => e)).status, 503, `date ${date}`);
  }
  mock.restoreAll();
  (await import("../lib/server/quotes.ts")).resetRateCache();
  v2({}, daysAgo(7));
  assert.equal((await usdRate("EUR")).rateAt, daysAgo(7), "7 days old is still fine");
});

test("rates are cached for 15 minutes (one request for all currencies)", async () => {
  const fetchMock = v2();
  const t = Date.now();
  await usdRate("GBP", t);
  await usdRate("SGD", t + 60_000);
  await usdRate("GBP", t + 14 * 60_000);
  assert.equal(fetchMock.mock.callCount(), 1);
  await usdRate("GBP", t + 15 * 60_000);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("the source being down: 503 without a cached rate, the checked cached rate with one", async () => {
  mock.method(globalThis, "fetch", async () => new Response("down", { status: 502 }));
  assert.equal((await usdRate("SGD").catch((e) => e)).status, 503);
  mock.restoreAll();
  const t = Date.now();
  v2();
  await usdRate("SGD", t);
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response("down", { status: 502 }));
  assert.equal((await usdRate("SGD", t + 16 * 60_000)).rate, "1.2774");
});

test("S3: during an outage a cached rate still obeys the 7-day rule", async () => {
  (await import("../lib/server/quotes.ts")).resetRateCache();
  const t = Date.now();
  v2({}, daysAgo(7)); // accepted today: exactly 7 days old
  assert.equal((await usdRate("EUR", t)).rateAt, daysAgo(7));
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response("down", { status: 502 }));
  const err = await usdRate("EUR", t + 86_400_000 + 16 * 60_000).catch((e) => e); // a day later: now 8 days old
  assert.equal(err.status, 503);
});

test("the bands are ±15% of the 06 Nov rates (AED: peg ± 1%), the same numbers claude-frontend uses", async () => {
  const { BANDS } = await import("../lib/server/quotes.ts");
  assert.deepEqual(BANDS, { EUR: [0.7555, 1.0221], GBP: [0.6309, 0.8536], SGD: [1.0858, 1.469], INR: [80.33, 108.68], AED: [3.635775, 3.709225] });
});

test("bad input is refused; the public route is rate-limited per IP", async () => {
  assert.equal((await quote({ amount: "20", currency: "JPY" })).status, 400);
  assert.equal((await quote({ amount: "abc", currency: "USD" })).status, 400);
  assert.equal((await quote({ amount: "0.50", currency: "USD" })).status, 400, "below 1 USDT");
  assert.equal((await quote({ amount: "1000.01", currency: "USD" })).status, 400, "above 1,000 USDT");
  let last;
  for (let i = 0; i < 31; i++) last = await quote({ amount: "5", currency: "USD" }, "198.51.100.9");
  assert.equal(last.status, 429);
  assert.equal((await quote({ amount: "5", currency: "USD" }, "198.51.100.10")).status, 201, "another IP is unaffected");
});
