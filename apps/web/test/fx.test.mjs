// claude-frontend checks for FX quotes (FR-GW-11): Frankfurter v2 rows, the 15-minute cache, rounding, the sanity
// bands on each rate and its date (security review 006 F1, human 05:4x), and failure.
// fetch is faked; test/fx.live.test.mjs calls the real API (LIVE=1). Run from apps/web: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const ROWS = [
  { date: "2026-11-05", base: "USD", quote: "AED", rate: 3.6725 },
  { date: "2026-11-05", base: "USD", quote: "EUR", rate: 0.88877 },
  { date: "2026-11-05", base: "USD", quote: "GBP", rate: 0.7423 },
  { date: "2026-11-05", base: "USD", quote: "INR", rate: 94.5 },
  { date: "2026-11-05", base: "USD", quote: "SGD", rate: 1.2775 },
];
const calls = [];
let reply = async () => Response.json(ROWS);
globalThis.fetch = async (url) => (calls.push(String(url)), reply());

const { quote, toUsdt, FxUnavailableError, FX_SOURCE } = await import("../lib/fx.ts");

// The cache lasts 15 minutes, so each test quotes at its own hour of 5 Nov (the rows' date) and starts with an empty cache.
const hour = (h) => Date.UTC(2026, 10, 5, h);

beforeEach(() => {
  calls.length = 0;
  reply = async () => Response.json(ROWS);
});

test("asks Frankfurter v2 for USD-based rates of the five priced currencies", async () => {
  await quote("EUR", "20.00", hour(1));
  assert.deepEqual(calls, ["https://api.frankfurter.dev/v2/rates?base=usd&quotes=aed,eur,gbp,inr,sgd"]);
});

test("every currency converts to USDT (amount ÷ rate), with its rate, rate date, fetch time and source", async () => {
  const now = hour(2);
  // up to the cent: 22.503 → 22.51, 13.4716 → 13.48, 10.5820 → 10.59, 27.2294 → 27.23, 39.1389 → 39.14
  const expected = { EUR: ["20.00", 22_510_000n, "0.88877"], GBP: ["10.00", 13_480_000n, "0.7423"], INR: ["1000", 10_590_000n, "94.5"], AED: ["100.00", 27_230_000n, "3.6725"], SGD: ["50.00", 39_140_000n, "1.2775"] };
  for (const [currency, [amount, usdt, rate]] of Object.entries(expected)) {
    assert.deepEqual(await quote(currency, amount, now), { usdt, rate, rateDate: "2026-11-05", fetchedAt: now, source: FX_SOURCE }, currency);
  }
  assert.equal(calls.length, 1, "one fetch serves every currency");
});

test("USD is 1:1 and rounded up to the cent; USDT is exact; neither calls the FX source", async () => {
  const now = hour(3);
  assert.deepEqual(await quote("USD", "25.00", now), { usdt: 25_000_000n, rate: "1", rateDate: "2026-11-05", fetchedAt: now, source: "1 USDT = 1 USD" });
  assert.equal((await quote("USD", "25.121", now)).usdt, 25_130_000n, "USD goes up to the cent too");
  assert.equal((await quote("USDT", "25.123456", now)).usdt, 25_123_456n, "a USDT price is charged exactly");
  assert.equal(calls.length, 0);
});

// Up to the cent, like claude-contracts' quotes module (the single FX source, human 05:4x): the merchant is never short,
// and a link checkout and a direct one at the same rate charge the same cent.
test("the USDT amount is rounded UP to the cent, in exact integer maths", () => {
  assert.equal(toUsdt("10.004", "1"), 10_010_000n, "an exact 10.004 goes up to 10.01 (half up would say 10.00)");
  assert.equal(toUsdt("1.2345", "1"), 1_240_000n, "123.45 cents → 124 (half up would say 123)");
  assert.equal(toUsdt("20.00", "0.8"), 25_000_000n, "an exact 25.00 stays put");
  assert.equal(toUsdt("10.00", "1"), 10_000_000n, "an exact whole cent stays put");
  assert.equal(toUsdt("0.21", "2"), 110_000n, "0.105 → 0.11");
  assert.equal(toUsdt("0.209999", "2"), 110_000n, "0.1049995 → 0.11");
  assert.equal(toUsdt("20.00", "0.88877"), 22_510_000n, "22.5030… → 22.51");
  assert.equal(toUsdt("1", "3"), 340_000n, "0.333… → 0.34");
  assert.equal(toUsdt("2", "3"), 670_000n, "0.666… → 0.67");
  assert.throws(() => toUsdt("20.00", "0"), /rate/);
  assert.throws(() => toUsdt("20.00", "1e-7"), /rate/);
  assert.throws(() => toUsdt("twenty", "1"), /amount like 25\.00/);
});

test("rates are cached for at most 15 minutes (ARCHITECTURE §4b), then fetched again", async () => {
  const MIN = 60 * 1000;
  const first = await quote("EUR", "20.00", hour(4));
  await quote("GBP", "10.00", hour(4) + 15 * MIN - 1);
  assert.equal(calls.length, 1, "inside 15 minutes: cached");
  reply = async () => Response.json(ROWS.map((row) => ({ ...row, date: "2026-11-06", rate: row.quote === "EUR" ? 0.9 : row.rate })));
  const next = await quote("EUR", "18.00", hour(4) + 15 * MIN);
  assert.equal(calls.length, 2, "after 15 minutes: fetched again");
  assert.equal(first.fetchedAt, hour(4));
  assert.deepEqual([next.usdt, next.rate, next.rateDate, next.fetchedAt], [20_000_000n, "0.9", "2026-11-06", hour(4) + 15 * MIN]);
});

test("a quote locks for 10 minutes (human, 03:02)", async () => {
  const { QUOTE_LOCK_MS } = await import("../lib/fx.ts");
  assert.equal(QUOTE_LOCK_MS, 10 * 60 * 1000);
});

test("when the rate can't be fetched, quoting throws FxUnavailableError in plain words, and the failure isn't cached", async () => {
  const failures = [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => new Response("busy", { status: 503 }),
    async () => Response.json({ rates: {} }), // not the v2 array
    async () => Response.json(ROWS.filter((row) => row.quote !== "INR")), // incomplete
    async () => Response.json(ROWS.map((row) => ({ ...row, rate: -1 }))),
  ];
  for (const [i, failure] of failures.entries()) {
    reply = failure;
    await assert.rejects(quote("EUR", "20.00", hour(6)), (error) => {
      assert.ok(error instanceof FxUnavailableError, `case ${i}`);
      assert.equal(error.currency, "EUR");
      assert.equal(error.message, "Prices in EUR are unavailable right now");
      return true;
    });
  }
  reply = async () => Response.json(ROWS);
  assert.equal((await quote("EUR", "20.00", hour(6))).usdt, 22_510_000n, "recovers on the next call");
  assert.equal(calls.length, failures.length + 1);
});

test("a currency without a rate is unavailable, not priced at 1", async () => {
  await assert.rejects(quote("JPY", "100", hour(7)), FxUnavailableError);
});

// Security review 006 F1, human 05:4x: one outside host sets the prices, so each rate must sit in a band of USD per unit
// of the currency, and its date must be recent. Anything else is "unavailable" (503, nothing created).
const rowsWith = (quoteCode, change) => ROWS.map((row) => (row.quote === quoteCode ? { ...row, ...change } : row));
async function refused(rows, now, currency) {
  reply = async () => Response.json(rows);
  await assert.rejects(quote(currency, "20.00", now), (error) => error instanceof FxUnavailableError && error.currency === currency);
}

test("each rate must sit in its band of USD per unit: EUR 0.5–2, GBP 0.6–2.5, SGD 0.4–1.5, INR 0.005–0.03", async () => {
  const cases = [
    ["EUR", 8.8877, 0.4], // 10× off: 1 EUR = 0.11 USD; and 1 EUR = 2.5 USD
    ["GBP", 1.7, 0.39],
    ["SGD", 2.6, 0.66],
    ["INR", 201, 33],
  ];
  let h = 8;
  for (const [currency, low, high] of cases) {
    await refused(rowsWith(currency, { rate: low }), hour(h++), currency);
    await refused(rowsWith(currency, { rate: high }), hour(h++), currency);
  }
  // the edges themselves are fine (1 / rate = exactly the bound)
  reply = async () => Response.json(ROWS.map((row) => ({ ...row, rate: { EUR: 2, GBP: 0.4, SGD: 2.5, INR: 200, AED: 3.6725 }[row.quote] })));
  for (const currency of ["EUR", "GBP", "SGD", "INR"]) assert.ok((await quote(currency, "20.00", hour(h))).usdt > 0n, currency);
});

test("AED must sit within ±1% of its 3.6725 peg", async () => {
  await refused(rowsWith("AED", { rate: 3.6725 * 1.011 }), hour(17), "AED");
  await refused(rowsWith("AED", { rate: 3.6725 * 0.989 }), hour(18), "AED");
  reply = async () => Response.json(rowsWith("AED", { rate: 3.7 }));
  assert.equal((await quote("AED", "100.00", hour(19))).rate, "3.7", "+0.75% is inside the band");
});

test("a rate quoted against anything but USD is refused (it would be the wrong number of dollars)", async () => {
  await refused(rowsWith("EUR", { base: "GBP" }), hour(20), "EUR");
  await refused(rowsWith("EUR", { base: "usd" }), hour(21), "EUR");
});

test("a rate's date must be at most 7 days old and at most tomorrow (UTC), and a real date", async () => {
  const at = Date.UTC(2026, 10, 12, 12); // 12 Nov: 5 Nov is exactly 7 days old
  reply = async () => Response.json(ROWS);
  assert.equal((await quote("EUR", "20.00", at)).rateDate, "2026-11-05", "7 days old is still fine");
  await refused(ROWS, Date.UTC(2026, 10, 13, 0, 30), "EUR"); // 8 days old
  await refused(ROWS, Date.UTC(2026, 10, 3, 23), "EUR"); // the 5th seen on the 3rd: later than tomorrow
  reply = async () => Response.json(ROWS);
  assert.equal((await quote("GBP", "20.00", Date.UTC(2026, 10, 4, 1))).rateDate, "2026-11-05", "tomorrow (a time zone ahead) is fine");
  for (const [i, date] of ["9999-99-99", "2026-02-30", "2026-11-5", "05-11-2026"].entries()) {
    await refused(rowsWith("EUR", { date }), Date.UTC(2026, 10, 6, i), "EUR");
  }
  // V8 reads "2026-11-31" as 1 Dec, which would pass the window on 1 Dec: it must still be refused
  await refused(ROWS.map((row) => ({ ...row, date: "2026-11-31" })), Date.UTC(2026, 11, 1, 12), "EUR");
});
