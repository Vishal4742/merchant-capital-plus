// Live check of the FX quote against the real Frankfurter v2 API. Skipped unless LIVE=1, so `npm test` stays offline:
// LIVE=1 node --test test/fx.live.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // rates skip weekends and holidays

test("Frankfurter v2 prices every currency in USDT with a recent rate date", { skip: !process.env.LIVE }, async () => {
  const { quote, FX_SOURCE } = await import("../lib/fx.ts");
  for (const currency of ["EUR", "GBP", "INR", "AED", "SGD"]) {
    const q = await quote(currency, "100.00");
    console.log(`${currency} 100.00 = ${Number(q.usdt) / 1e6} USDT · rate ${q.rate} of ${q.rateDate}`);
    assert.ok(q.usdt > 0n && q.usdt % 10_000n === 0n, `${currency}: a positive amount in whole cents`);
    assert.match(q.rate, /^\d+(\.\d+)?$/);
    assert.ok(Date.now() - Date.parse(q.rateDate) < WEEK_MS, `${currency}: rate of ${q.rateDate} is recent`);
    assert.equal(q.source, FX_SOURCE);
  }
});
