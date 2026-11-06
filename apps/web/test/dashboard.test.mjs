// claude-frontend checks for the merchant home's numbers (lib/dashboard.ts): which payments it shows, the amounts it
// trusts, today's figures and the gross series (security review 005 F-N6: mutants P1, P2). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { paymentRows, confirmed, dailyGross, figures, change, chartPaths, istDay, formatWbt } = await import("../lib/dashboard.ts");

const MERCHANT = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const OTHER = "0x9999999999999999999999999999999999999999";
const PAYER = "0x5555555555555555555555555555555555555555";
const NOW = Date.UTC(2026, 10, 6, 6, 0); // 11:30 IST on 6 Nov
const HOUR = 60 * 60 * 1000;
const log = (id, { invoiceId = 0n, gross = 10_000_000n, time = NOW - HOUR } = {}) => ({ paymentId: id, invoiceId, gross, txHash: `0x${id.toString(16).padStart(64, "0")}`, time });
const record = (gross, { merchant = MERCHANT, refunded = 0n } = {}) => ({ merchant, gross, payer: PAYER, refunded });

test("three rows: the chain's amount wins over the index, another merchant's payment and an unconfirmed index row are dropped", () => {
  const rows = paymentRows([], [log(1n, { gross: 99_000_000n }), log(2n), log(3n)]);
  const shown = confirmed(rows, [record(10_000_000n), record(10_000_000n, { merchant: OTHER }), null], MERCHANT.toLowerCase());
  assert.deepEqual(
    shown.map(({ row }) => [row.paymentId, row.amount]),
    [["1", 10_000_000n]],
    "1: the index said 99.00, the chain 10.00 (P1); 2: another merchant's on chain (P2); 3: index only, unread",
  );
});

test("our own checkout shows before the chain is read; it carries the shop's reference and the relayer's tx", () => {
  const session = { id: "s-1", reference: "A-1042", amount: 25_000_000n };
  const payment = { txHash: `0x${"ab".repeat(32)}`, blockNumber: "1", paymentId: "4", from: PAYER, paidAt: NOW - 2 * HOUR };
  const rows = paymentRows([{ session, payment }], [log(4n, { gross: 25_000_000n })]);
  assert.equal(rows.length, 1, "one row per payment id");
  assert.deepEqual([rows[0].label, rows[0].ours, rows[0].txHash], ["A-1042", true, payment.txHash]);
  assert.equal(rows[0].receiptId, "s-1", "the receipt page is keyed by our checkout id, not the payment number");
  assert.equal(paymentRows([], [log(5n)])[0].receiptId, null, "a row only the log index knows has no receipt page");
  assert.equal(confirmed(rows, [null], MERCHANT).length, 1);
});

test("rows are newest first; invoices are labelled by invoice number", () => {
  const rows = paymentRows([], [log(1n, { time: NOW - 3 * HOUR }), log(2n, { invoiceId: 7n, time: NOW - HOUR })]);
  assert.deepEqual(rows.map((row) => row.label), ["Invoice 7", "Payment 1"]);
});

test("days are IST days: 23:59 IST is yesterday, 00:01 IST today", () => {
  const midnightIst = Date.UTC(2026, 10, 5, 18, 30); // 00:00 IST on 6 Nov
  assert.equal(istDay(midnightIst - 60_000), istDay(NOW) - 1);
  assert.equal(istDay(midnightIst + 60_000), istDay(NOW));
});

test("today's figures: gross and count for today and yesterday, refunds summed from the chain records", () => {
  const rows = paymentRows([], [log(1n, { time: NOW - HOUR }), log(2n, { time: NOW - 2 * HOUR }), log(3n, { time: NOW - 30 * HOUR })]);
  const shown = confirmed(rows, [record(10_000_000n), record(5_000_000n, { refunded: 2_000_000n }), record(8_000_000n)], MERCHANT);
  assert.deepEqual(figures(shown, NOW), { grossToday: 15_000_000n, grossYesterday: 8_000_000n, countToday: 2, countYesterday: 1, refunded: 2_000_000n, refundedPayments: 1 });
  assert.equal(figures([], NOW).refunded, null, "no record read: unknown, never 0");
});

test("the gross series has one entry per IST day, oldest first, today last; older payments fall off", () => {
  const rows = [
    { amount: 10_000_000n, paidAt: NOW - HOUR },
    { amount: 2_000_000n, paidAt: NOW - 25 * HOUR },
    { amount: 1_000_000n, paidAt: NOW - 8 * 24 * HOUR },
  ];
  assert.deepEqual(dailyGross(rows, 7, NOW), [0n, 0n, 0n, 0n, 0n, 2_000_000n, 10_000_000n]);
  assert.equal(dailyGross(rows, 30, NOW).reduce((a, b) => a + b, 0n), 13_000_000n);
});

test("change is a whole percent, and null with nothing to compare against", () => {
  assert.equal(change(15_000_000n, 10_000_000n), 50);
  assert.equal(change(5_000_000n, 10_000_000n), -50);
  assert.equal(change(5_000_000n, 0n), null);
});

test("the chart's line spans the box and ends at the last value; an all-zero series stays on the floor", () => {
  const { line, area, last } = chartPaths([0, 50, 100], 600, 220, 24);
  assert.match(line, /^M24\.0 196\.0 L300\.0 \d+\.\d L576\.0 \d+\.\d$/);
  assert.equal(last.x, 576);
  assert.ok(area.endsWith("L576.0 196 L24 196 Z"));
  assert.ok(chartPaths([0, 0], 600, 220, 24).line.endsWith("196.0"));
});

test("formatWbt: 6 decimals, half up, no exponent, and a tiny fee isn't shown as 0", () => {
  assert.equal(formatWbt(21_000_000_000_000n), "0.000021");
  assert.equal(formatWbt(123_456_789_012_345_678n), "0.123457");
  assert.equal(formatWbt(1_500_000_000_000_000_000n), "1.5");
  assert.equal(formatWbt(0n), "0");
  assert.equal(formatWbt(1n), "<0.000001");
  assert.equal(formatWbt(500_000_000_000n), "0.000001", "half a step rounds up");
});
