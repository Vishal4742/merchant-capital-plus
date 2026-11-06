// claude-contracts checks for FX quotes (SRS FR-GW-11, AT-13 backend half): USD 1:1, ECB rate via Frankfurter,
// rounding up, the 10-minute lock, the 1..1,000 USDT bounds. fetch is mocked; nothing hits the network.
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
const { createQuote, getQuote, toUsdtUnits, usdRate, QUOTE_TTL_MS } = await import("../lib/server/quotes.ts");

const frankfurter = (usd, date = "2026-11-05") =>
  mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /^https:\/\/api\.frankfurter\.dev\/v1\/latest\?base=[A-Z]{3}&symbols=USD$/);
    return Response.json({ amount: 1, base: new URL(url).searchParams.get("base"), date, rates: { USD: usd } });
  });
const quote = (body, ip = "203.0.113.7") => POST(req("POST", "/api/v1/quotes", { body, headers: { "x-forwarded-for": ip } }));

test("USD and USDT are 1:1 with no rate fetch", async () => {
  const fetchMock = frankfurter(9);
  const body = await (await quote({ amount: "25.00", currency: "usd" })).json();
  assert.equal(body.usdt_amount, "25");
  assert.equal(body.rate, "1");
  assert.equal(body.source, "USD = USDT 1:1");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a 20 EUR price uses the ECB rate, rounds up to the micro-USDT, and is locked 10 minutes (AT-13)", async () => {
  frankfurter(1.1224);
  const now = 1_800_000_000_000;
  const q = await createQuote("20.00", "EUR", now);
  assert.equal(q.usdtAmount, 22_448_000n); // 20 × 1.1224 exactly
  assert.equal(q.expiresAt, now + QUOTE_TTL_MS);
  assert.match(q.source, /ECB reference rate 2026-11-05 via Frankfurter/);
  assert.equal((await getQuote(q.id, now + QUOTE_TTL_MS - 1)).usdtAmount, 22_448_000n);
  assert.equal(await getQuote(q.id, now + QUOTE_TTL_MS), null, "expired at exactly 10 minutes");
  assert.equal(await getQuote("quote_unknown", now), null);
});

test("conversion rounds up, never down", () => {
  assert.equal(toUsdtUnits("1", { num: 1n, den: 3n }), 333_334n); // 0.333333… → 0.333334
  assert.equal(toUsdtUnits("3", { num: 1n, den: 3n }), 1_000_000n); // exact stays exact
  assert.throws(() => toUsdtUnits("1.1234567", { num: 1n, den: 1n }), /decimal string/);
  assert.throws(() => toUsdtUnits("-1", { num: 1n, den: 1n }), /decimal string/);
});

test("AED uses the 3.6725 peg without a fetch", async () => {
  const fetchMock = frankfurter(9);
  const q = await createQuote("36.725", "AED");
  assert.equal(q.usdtAmount, 10_000_000n); // 36.725 AED = 10 USD
  assert.match(q.source, /3\.6725/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rates are cached for 15 minutes per currency", async () => {
  const fetchMock = frankfurter(1.3459);
  const t = 1_900_000_000_000;
  await usdRate("GBP", t);
  await usdRate("GBP", t + 14 * 60_000);
  assert.equal(fetchMock.mock.callCount(), 1);
  await usdRate("GBP", t + 15 * 60_000);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("bad input and an unusable rate source are refused", async () => {
  assert.equal((await quote({ amount: "20", currency: "JPY" })).status, 400);
  assert.equal((await quote({ amount: "abc", currency: "USD" })).status, 400);
  assert.equal((await quote({ amount: "0.50", currency: "USD" })).status, 400, "below 1 USDT");
  assert.equal((await quote({ amount: "1000.01", currency: "USD" })).status, 400, "above 1,000 USDT");
  mock.method(globalThis, "fetch", async () => new Response("down", { status: 502 }));
  assert.equal((await createQuote("20", "SGD", 2_000_000_000_000).catch((e) => e)).status, 503);
  mock.restoreAll();
  frankfurter("1.2");
  assert.equal((await createQuote("20", "INR", 2_100_000_000_000).catch((e) => e)).status, 503, "a non-numeric rate is refused");
});

test("the public route is rate-limited per IP", async () => {
  let last;
  for (let i = 0; i < 31; i++) last = await quote({ amount: "5", currency: "USD" }, "198.51.100.9");
  assert.equal(last.status, 429);
  assert.equal((await quote({ amount: "5", currency: "USD" }, "198.51.100.10")).status, 201, "another IP is unaffected");
});
