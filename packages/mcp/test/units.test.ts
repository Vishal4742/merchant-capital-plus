// Pure logic (batch 052): integer money and precision, invoice rounding, business-zone dates, untrusted text, the
// redactor and the idempotency-key journal. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { endOfDay, resolvePeriod, resolveRange, startOfDay } from "../src/dates.ts";
import { Journal, REUSE_WINDOW_MS } from "../src/journal.ts";
import { applyBps, decimal, display, invoiceTotals, parseMoney, percentToBps } from "../src/money.ts";
import { maskEmail, redactor, untrusted } from "../src/safety.ts";
import { tempDir } from "./helpers.ts";
import { join } from "node:path";

test("parseMoney: exact minor units at each currency's precision; refuses what it can't represent exactly", () => {
  assert.equal(parseMoney("15000", "INR").units, 1_500_000n);
  assert.equal(parseMoney("15,000.50", "INR").units, 1_500_050n);
  assert.equal(parseMoney("0.1", "USD").units, 10n);
  assert.equal(parseMoney("25.123456", "USDT").units, 25_123_456n);
  assert.equal(parseMoney(" 2000.5 ", "EUR").units, 200_050n);
  for (const [text, currency, why] of [
    ["10.001", "INR", /3 decimals, but INR has 2/],
    ["1.0000001", "USDT", /7 decimals/],
    ["0", "USD", /more than 0/],
    ["0.00", "USD", /more than 0/],
    ["-5", "USD", /positive decimal/],
    ["1e3", "USD", /positive decimal/],
    ["₹500", "INR", /no symbol/],
    ["1,50", "EUR", /dot for decimals/],
    ["1,5000.00", "USD", /dot for decimals/],
    ["", "USD", /positive decimal/],
    ["1234567890123", "USD", /too large/],
  ] as const) {
    assert.throws(() => parseMoney(text, currency), why, `${text} ${currency}`);
  }
});

test("decimal and display: no floats, at least two decimals, grouping only for people", () => {
  assert.equal(decimal(1_500_000n, "INR"), "15000.00");
  assert.equal(decimal(60_000_000n, "USDT"), "60.00");
  assert.equal(decimal(41_703_750n, "USDT"), "41.70375");
  assert.equal(decimal(1n, "USDT"), "0.000001");
  assert.equal(display(1_500_000n, "INR"), "₹15,000.00");
  assert.equal(display(1_234_567_890_000n, "USDT"), "1,234,567.89 USDT");
  // 0.1 + 0.2 in integers is exactly 0.3
  assert.equal(decimal(parseMoney("0.1", "USD").units + parseMoney("0.2", "USD").units, "USD"), "0.30");
});

test("invoice totals: Σ qty × price, percent discount and tax each rounded once, half up", () => {
  assert.equal(applyBps(1n, 5_000n), 1n); // 0.5 → 1 (half up)
  assert.equal(applyBps(1n, 4_999n), 0n);
  assert.equal(percentToBps("18", "tax"), 1_800n);
  assert.equal(percentToBps("12.5", "d"), 1_250n);
  assert.throws(() => percentToBps("12.555", "d"), /at most 2 decimals/);
  assert.throws(() => percentToBps("0", "d"), /more than 0/);
  assert.throws(() => percentToBps("150", "d"), /at most 100%/);
  // INR to show the 2-decimal rounding: 3 × 333.33 = 999.99; 10% = 99.999 → 100.00; taxable 899.99; 18% = 161.9982 → 162.00
  const t = invoiceTotals("INR", [{ description: "x", quantity: 3, unit_price: "333.33" }], { type: "percent", percent: "10" }, { name: "GST", rate_percent: "18" });
  assert.deepEqual([t.subtotal, t.discount!.amount, t.tax!.amount, t.total], [99_999n, 10_000n, 16_200n, 106_199n]);
  assert.throws(() => invoiceTotals("USDT", []), /at least one line/);
  assert.throws(() => invoiceTotals("USDT", [{ description: "x", quantity: 1.5, unit_price: "1" }]), /whole number/);
  assert.throws(() => invoiceTotals("USDT", [{ description: "x", quantity: 1, unit_price: "10" }], { type: "amount", amount: "10" }), /less than the subtotal/);
  assert.throws(() => invoiceTotals("USDT", [{ description: "x", quantity: 1, unit_price: "10" }], null, { name: "", rate_percent: "5" }), /tax.name/);
});

test("dates: periods in the business zone (weeks start Monday), DST-safe day boundaries, range limits", () => {
  assert.deepEqual(resolvePeriod("this_week", "2026-11-06"), { from: "2026-11-02", to: "2026-11-06" });
  assert.deepEqual(resolvePeriod("this_week", "2026-11-02"), { from: "2026-11-02", to: "2026-11-02" });
  assert.deepEqual(resolvePeriod("last_week", "2026-11-08"), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(resolvePeriod("last_month", "2026-03-15"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(resolvePeriod("last_30_days", "2026-11-06"), { from: "2026-10-08", to: "2026-11-06" });
  assert.equal(startOfDay("2026-11-06", "Asia/Kolkata"), Date.parse("2026-11-05T18:30:00Z"));
  // London's clocks went back on 2026-10-25: that day is 25 hours long
  assert.equal(endOfDay("2026-10-25", "Europe/London") - startOfDay("2026-10-25", "Europe/London"), 25 * 3_600_000);
  assert.throws(() => resolveRange({ from: "2026-11-06", to: "2026-11-01" }, "2026-11-06"), /on or before/);
  assert.throws(() => resolveRange({ from: "2026-01-01", to: "2026-11-01" }, "2026-11-06"), /at most 92 days/);
  assert.throws(() => resolveRange({ period: "today", from: "2026-11-01" }, "2026-11-06"), /not both/);
});

test("untrusted text: control, zero-width and bidi characters removed, length bounded; emails masked", () => {
  assert.equal(untrusted("Acme\u0000​ Ltd‮⁦"), "Acme Ltd");
  assert.equal(untrusted("a".repeat(300), 10), `${"a".repeat(9)}…`);
  assert.equal(untrusted(null), "");
  assert.equal(maskEmail("priya@example.com"), "p***@example.com");
  assert.equal(maskEmail(null), null);
  const redact = redactor(["sk_test_SECRETSECRET", "0xABCDEF0123456789", "short"]);
  assert.equal(redact("key sk_test_SECRETSECRET and abcdef0123456789 and short"), "key [redacted] and [redacted] and short");
});

test("journal: a same-payload retry within the window reuses the key; a refusal, another payload, another account or an old entry don't", () => {
  let now = 1_000_000;
  const file = join(tempDir(), "journal.json");
  const a = new Journal(file, "https://gw|key-a", () => now);
  const first = a.claim("create_payment_link", { amount: "10", currency: "USDT" });
  assert.equal(first.source, "new");
  // property order doesn't matter
  const again = a.claim("create_payment_link", { currency: "USDT", amount: "10" });
  assert.deepEqual([again.key, again.source, again.previousOutcome], [first.key, "recovered", "pending"]);
  assert.equal(a.claim("create_payment_link", { amount: "11", currency: "USDT" }).source, "new");
  assert.equal(a.claim("create_payment_link", { amount: "10", currency: "USDT" }, "caller-key-123").key, "caller-key-123");
  const b = new Journal(file, "https://gw|key-b", () => now);
  assert.equal(b.claim("create_payment_link", { amount: "10", currency: "USDT" }).source, "new");
  const fresh = a.claim("finalize_invoice", { invoice: "inv_1" });
  a.settle(fresh.key, "refused");
  assert.equal(a.claim("finalize_invoice", { invoice: "inv_1" }).source, "new");
  now += REUSE_WINDOW_MS + 1;
  assert.equal(a.claim("create_payment_link", { amount: "10", currency: "USDT" }).source, "new");
});
