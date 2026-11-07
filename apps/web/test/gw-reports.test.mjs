// claude-contracts checks for reports (SRS FR-GW-9, AT-15): built from MerchantPay's Paid and Refunded logs in
// Blockscout's index (fetch mocked), bucketed by UTC day, scoped to the signed-in merchant; and the CSV of the same rows.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-reports.test.mjs
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, pad, parseAbi, toEventSelector, toHex } from "viem";
import { MERCHANT, OTHER_MERCHANT, req, setupDb, signedIn } from "./gw-helpers.mjs";

const MERCHANT_PAY = "0xab817593253a0a37de723072827d88fe0ca54251";
process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
process.env.RELAYER_URL = "https://relayer.test";
await setupDb(); // batch 051: the signed-in workspace (who the merchant is) lives in the database

const { GET: report } = await import("../app/api/v1/reports/route.ts");
const { GET: csv } = await import("../app/api/v1/reports.csv/route.ts");

const PAYER_A = "0x3333333333333333333333333333333333333333";
const PAYER_B = "0x4444444444444444444444444444444444444444";
const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const tx = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const events = parseAbi([
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
  "event Refunded(uint256 indexed paymentId, uint256 amount, uint256 totalRefunded)",
]);
const PAID = toEventSelector(events[0]);
const REFUNDED = toEventSelector(events[1]);
const at = (iso) => toHex(Date.parse(iso) / 1000);

const paid = ({ id, payer, time, gross, fee = 0.1, toInvestors = 0, merchant = MERCHANT, block = id }) => ({
  address: MERCHANT_PAY,
  blockNumber: toHex(block),
  logIndex: "0x0",
  topics: encodeEventTopics({ abi: events, eventName: "Paid", args: { paymentId: BigInt(id), merchant, payer } }),
  data: encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [0n, `0x${"ab".repeat(32)}`, USDT(gross), USDT(fee), USDT(toInvestors), USDT(gross) - USDT(fee) - USDT(toInvestors)],
  ),
  transactionHash: tx(100 + id),
  timeStamp: at(time),
});
const refunded = ({ id, amount, total = amount, time, block = 50 }) => ({
  address: MERCHANT_PAY,
  blockNumber: toHex(block),
  logIndex: "0x1",
  topics: encodeEventTopics({ abi: events, eventName: "Refunded", args: { paymentId: BigInt(id) } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [USDT(amount), USDT(total)]),
  transactionHash: tx(200 + id),
  timeStamp: at(time),
});

// two days of history: A paid before the range (so A is returning), B is new and pays twice; one refund in range;
// another merchant's payment and refund, and a junk log, that must never show up
const PAID_LOGS = [
  paid({ id: 1, payer: PAYER_A, time: "2026-10-01T10:00:00Z", gross: 10 }),
  paid({ id: 2, payer: PAYER_A, time: "2026-11-04T23:59:59Z", gross: 25, toInvestors: 5 }),
  paid({ id: 3, payer: PAYER_B, time: "2026-11-05T00:00:00Z", gross: 4 }),
  paid({ id: 4, payer: PAYER_B, time: "2026-11-05T12:00:00Z", gross: 99, merchant: OTHER_MERCHANT }),
  paid({ id: 5, payer: PAYER_B, time: "2026-11-05T13:00:00Z", gross: 2 }),
  { junk: true },
];
const REFUND_LOGS = [refunded({ id: 2, amount: 5, time: "2026-11-05T15:00:00Z" }), refunded({ id: 4, amount: 1, time: "2026-11-05T16:00:00Z" })];

let paidLogs, refundLogs, indexDown;
const urls = [];
beforeEach(() => {
  paidLogs = PAID_LOGS;
  refundLogs = REFUND_LOGS;
  indexDown = false;
  urls.length = 0;
  mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(String(url));
    urls.push(u);
    if (indexDown) return new Response("bad gateway", { status: 502 });
    const from = BigInt(u.searchParams.get("fromBlock"));
    const all = u.searchParams.get("topic0") === PAID ? paidLogs : u.searchParams.get("topic0") === REFUNDED ? refundLogs : [];
    const result = all.filter((log) => !log.blockNumber || BigInt(log.blockNumber) >= from).slice(0, 1000);
    return Response.json({ message: result.length ? "OK" : "No logs found", status: result.length ? "1" : "0", result });
  });
});
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

const get = (handler, query, headers = signedIn()) => handler(req("GET", `/api/v1/reports${query}`, { headers }));

test("?tz=Asia/Kolkata buckets by IST days: 23:59:59 UTC on the 4th is 05:29:59 IST on the 5th (batch 008)", async () => {
  const days = async (q) => Object.fromEntries((await (await get(report, q)).json()).days.map((d) => [d.date, d.count]));
  assert.deepEqual(await days("?from=2026-11-04&to=2026-11-05"), { "2026-11-04": 1, "2026-11-05": 2 }, "UTC by default");
  assert.deepEqual(await days("?from=2026-11-04&to=2026-11-05&tz=Asia/Kolkata"), { "2026-11-04": 0, "2026-11-05": 3 });
  const ist = await (await get(report, "?from=2026-11-05&to=2026-11-05&tz=Asia/Kolkata")).json();
  assert.deepEqual(ist.totals, { gross: "31", fees: "0.3", net: "30.7", refunds: "5", count: 3 });
  assert.equal(ist.tz, "Asia/Kolkata");
  assert.equal((await get(report, "?tz=Mars/Olympus")).status, 400);
  assert.equal((await get(report, "?tz=" + "A".repeat(80))).status, 400);
});

test("the default 'today' follows the zone: at 02:00 IST on the 6th, today is the 6th in IST and the 5th in UTC", async () => {
  const { rangeOf } = await import("../lib/server/reports.ts");
  const now = Date.parse("2026-11-05T20:30:00Z"); // 02:00 IST on the 6th
  assert.equal(rangeOf(req("GET", "/api/v1/reports?tz=Asia/Kolkata"), now).to, "2026-11-06");
  assert.equal(rangeOf(req("GET", "/api/v1/reports"), now).to, "2026-11-05");
  const r = rangeOf(req("GET", "/api/v1/reports?from=2026-11-06&to=2026-11-06&tz=Asia/Kolkata"), now);
  assert.equal(new Date(r.start).toISOString(), "2026-11-05T18:30:00.000Z", "IST midnight");
  assert.equal(r.end - r.start, 86_400_000);
});

test("every report route needs the dashboard cookie", async () => {
  assert.equal((await get(report, "", {})).status, 401);
  assert.equal((await get(csv, "", {})).status, 401);
  assert.equal(urls.length, 0, "nothing is fetched for a stranger");
});

test("the report buckets by UTC day, includes zero days, and counts only this merchant's payments and refunds", async () => {
  const res = await get(report, "?from=2026-11-03&to=2026-11-05");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.from, "2026-11-03");
  assert.equal(body.to, "2026-11-05");
  assert.deepEqual(body.days, [
    { date: "2026-11-03", gross: "0", fees: "0", net: "0", refunds: "0", count: 0 },
    { date: "2026-11-04", gross: "25", fees: "0.1", net: "24.9", refunds: "0", count: 1 }, // 23:59:59 stays on the 4th
    { date: "2026-11-05", gross: "6", fees: "0.2", net: "5.8", refunds: "5", count: 2 }, // 00:00:00 starts the 5th
  ]);
  assert.deepEqual(body.totals, { gross: "31", fees: "0.3", net: "30.7", refunds: "5", count: 3 });
  assert.deepEqual(body.kpis, { new_payers: 1, returning_payers: 1 });
  // the index is asked for this merchant's Paid logs (topic2) and the contract's Refunded logs
  const paidUrl = urls.find((u) => u.searchParams.get("topic0") === PAID);
  assert.equal(paidUrl.origin, "https://explorer.testnet.whitechain.io");
  assert.equal(paidUrl.searchParams.get("address"), MERCHANT_PAY);
  assert.equal(paidUrl.searchParams.get("topic2"), pad(MERCHANT).toLowerCase());
  assert.ok(urls.some((u) => u.searchParams.get("topic0") === REFUNDED));
});

test("a refund lands on the day it happened, not the day of the payment", async () => {
  const body = await (await get(report, "?from=2026-11-04&to=2026-11-04")).json();
  assert.deepEqual(body.totals, { gross: "25", fees: "0.1", net: "24.9", refunds: "0", count: 1 });
  assert.deepEqual(body.kpis, { new_payers: 0, returning_payers: 1 });
});

test("with no range the report covers the last 7 UTC days, today included", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T12:00:00Z") });
  const body = await (await get(report, "")).json();
  assert.equal(body.from, "2026-10-31");
  assert.equal(body.to, "2026-11-06");
  assert.equal(body.days.length, 7);
  assert.equal(body.totals.count, 3);
});

test("bad ranges are refused before anything is fetched", async () => {
  for (const query of ["?from=2026-11-5&to=2026-11-06", "?from=2026-02-30&to=2026-03-01", "?from=2026-11-06&to=2026-11-05", "?from=2026-08-01&to=2026-11-01", "?from=x"]) {
    const res = await get(report, query);
    assert.equal(res.status, 400, query);
    assert.match((await res.json()).error, /from|to|days/);
    assert.equal((await get(csv, query)).status, 400, query);
  }
  assert.equal(urls.length, 0);
  assert.equal((await get(report, "?from=2026-08-02&to=2026-11-01")).status, 200, "92 days is the maximum");
});

test("the CSV has a header and one quoted row per payment in range, oldest first", async () => {
  const res = await get(csv, "?from=2026-11-04&to=2026-11-05");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/csv/);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="payments-2026-11-04-2026-11-05.csv"');
  const lines = (await res.text()).trimEnd().split("\r\n");
  assert.equal(lines[0], '"payment_id","created_utc","currency","gross","fee","to_investors","net","refunded","payer","tx_hash"');
  assert.deepEqual(lines.slice(1), [
    `"2","2026-11-04T23:59:59.000Z","USDT","25","0.1","5","24.9","5","${PAYER_A}","${tx(102)}"`,
    `"3","2026-11-05T00:00:00.000Z","USDT","4","0.1","0","3.9","0","${PAYER_B}","${tx(103)}"`,
    `"5","2026-11-05T13:00:00.000Z","USDT","2","0.1","0","1.9","0","${PAYER_B}","${tx(105)}"`,
  ]);
});

test("an empty range still sends the CSV header", async () => {
  const text = await (await get(csv, "?from=2026-11-01&to=2026-11-01")).text();
  assert.equal(text.trimEnd().split("\r\n").length, 1);
});

test("history past Blockscout's 1,000-log page is fetched by moving fromBlock, without double counting", async () => {
  paidLogs = Array.from({ length: 1001 }, (_, i) => paid({ id: i + 1, payer: PAYER_A, time: "2026-11-05T10:00:00Z", gross: 1 }));
  refundLogs = [];
  const body = await (await get(report, "?from=2026-11-05&to=2026-11-05")).json();
  assert.equal(body.totals.count, 1001);
  assert.equal(body.totals.gross, "1001");
  assert.deepEqual(urls.filter((u) => u.searchParams.get("topic0") === PAID).map((u) => u.searchParams.get("fromBlock")), ["0", "1000"]);
});

test("the index being down is a 502 that names no internals; a missing MerchantPay config is a 503", async () => {
  indexDown = true;
  const down = await get(report, "?from=2026-11-04&to=2026-11-05");
  assert.equal(down.status, 502);
  assert.doesNotMatch((await down.json()).error, /explorer|http|whitechain/i);
  indexDown = false;
  const saved = process.env.MERCHANT_PAY_ADDRESS;
  delete process.env.MERCHANT_PAY_ADDRESS;
  try {
    assert.equal((await get(report, "")).status, 503);
    assert.equal((await get(csv, "")).status, 503);
  } finally {
    process.env.MERCHANT_PAY_ADDRESS = saved;
  }
});
