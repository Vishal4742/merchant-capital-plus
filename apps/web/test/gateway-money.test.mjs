// claude-frontend checks for lib/gateway-money.ts (SRS FR-GW-12 vouchers, FR-GW-9 reports, FR-GW-10 settlements):
// the client parses claude-contracts' snake_case answers and refuses malformed ones, the voucher form and the report
// range are checked before any call, the CSV link carries the same range and tz, and the tiles show exactly what the
// API sent. fetch is faked; the preview fixtures go through the real report code. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayError } from "../lib/gateway-client.ts";
import { MAX_REPORT_DAYS, csvHref, moneyClient, reportRange, reportTiles, voucherBody, voucherStatus } from "../lib/gateway-money.ts";
import { PREVIEW_VOUCHERS, previewFetch } from "../lib/gateway-preview.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status) => new Response("<!doctype html><title>404</title>", { status, headers: { "content-type": "text/html" } });

function fake(reply) {
  const calls = [];
  const client = moneyClient({
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return reply(String(url), init);
    },
  });
  return { client, calls };
}

async function refused(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GatewayError, `a GatewayError, got ${error}`);
    return error;
  }
  assert.fail("expected the call to fail");
}

const RANGE = { from: "2026-10-31", to: "2026-11-06" };
const REPORT = {
  from: "2026-10-31",
  to: "2026-11-01",
  days: [
    { date: "2026-10-31", gross: "30", fees: "0.2", net: "29.8", refunds: "0", count: 2 },
    { date: "2026-11-01", gross: "12.5", fees: "0.1", net: "12.4", refunds: "3.5", count: 1 },
  ],
  // deliberately not gross − fees: the screen must show the API's own figures
  totals: { gross: "42.5", fees: "0.3", net: "40", refunds: "3.5", count: 3 },
  kpis: { new_payers: 1, returning_payers: 2 },
};
const SETTLEMENTS = {
  balance: "1284.35",
  settlements: [
    { payment_id: "41", gross: "12.5", fee: "0.1", to_investors: "2.5", net: "9.9", tx_hash: `0x${"ab".repeat(32)}`, settled_at: "2026-11-06T03:00:00.000Z", explorer_url: `https://explorer.testnet.whitechain.io/tx/0x${"ab".repeat(32)}` },
    { payment_id: "40", gross: "5", fee: "0.1", to_investors: "0", net: "4.9", tx_hash: null, settled_at: "2026-11-05T03:00:00.000Z", explorer_url: null },
  ],
};

// ── client parsing ──

test("lists vouchers and reads every snake_case field", async () => {
  const { client, calls } = fake(() => json({ vouchers: PREVIEW_VOUCHERS }));
  const vouchers = await client.listVouchers();
  assert.equal(calls[0].url, "/api/v1/vouchers");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(vouchers.length, PREVIEW_VOUCHERS.length);
  assert.deepEqual(Object.keys(vouchers[0]).sort(), ["active", "arkiv_entity_key", "code", "created_at", "expires_at", "id", "kind", "max_redemptions", "min_amount", "times_redeemed", "value"]);
  assert.ok(vouchers.some((v) => v.kind === "percent") && vouchers.some((v) => v.kind === "fixed"));
  assert.ok(vouchers.some((v) => v.min_amount === null) && vouchers.some((v) => v.arkiv_entity_key === null));
});

test("refuses a malformed voucher answer", async () => {
  const good = PREVIEW_VOUCHERS[0];
  for (const broken of [{ ...good, kind: "bogo" }, { ...good, value: "-5" }, { ...good, times_redeemed: "3" }, { ...good, active: "yes" }, { ...good, arkiv_entity_key: "<script>" }, { ...good, expires_at: "soon" }]) {
    const error = await refused(fake(() => json({ vouchers: [broken] })).client.listVouchers());
    assert.equal(error.status, 502);
  }
  assert.equal((await refused(fake(() => json({ list: [] })).client.listVouchers())).status, 502);
});

test("creates and deactivates a voucher with the right calls", async () => {
  const { client, calls } = fake((url) => (url.endsWith("/deactivate") ? json({ id: "vch_a/b", active: false }) : json(PREVIEW_VOUCHERS[0], 201)));
  const body = { code: "SAVE10", kind: "percent", value: "10", expires_at: "2026-12-01T00:00:00.000Z", max_redemptions: 100 };
  const created = await client.createVoucher(body);
  assert.equal(created.code, PREVIEW_VOUCHERS[0].code);
  assert.equal(calls[0].url, "/api/v1/vouchers");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
  await client.deactivateVoucher("vch_a/b");
  assert.equal(calls[1].url, "/api/v1/vouchers/vch_a%2Fb/deactivate");
  assert.equal(calls[1].init.method, "POST");
});

test("reads a report and sends the range with tz=Asia/Kolkata", async () => {
  const { client, calls } = fake(() => json(REPORT));
  const report = await client.report(RANGE);
  const url = new URL(calls[0].url, "http://x.invalid");
  assert.equal(url.pathname, "/api/v1/reports");
  assert.deepEqual(Object.fromEntries(url.searchParams), { from: "2026-10-31", to: "2026-11-06", tz: "Asia/Kolkata" });
  assert.deepEqual(report, REPORT);
});

test("refuses a malformed report", async () => {
  for (const broken of [
    { ...REPORT, days: "none" },
    { ...REPORT, days: [{ ...REPORT.days[0], date: "31/10/2026" }] },
    { ...REPORT, totals: { ...REPORT.totals, net: 40 } },
    { ...REPORT, kpis: { new_payers: -1, returning_payers: 2 } },
    { ...REPORT, kpis: undefined },
  ]) {
    assert.equal((await refused(fake(() => json(broken)).client.report(RANGE))).status, 502);
  }
});

test("reads settlements; the tx link is built from a checked hash, never taken from the answer", async () => {
  const { client, calls } = fake(() => json(SETTLEMENTS));
  const result = await client.settlements(RANGE);
  assert.match(calls[0].url, /^\/api\/v1\/settlements\?from=2026-10-31&to=2026-11-06&tz=Asia%2FKolkata$/);
  assert.equal(result.balance, "1284.35");
  assert.deepEqual(Object.keys(result.settlements[0]).sort(), ["fee", "gross", "net", "payment_id", "settled_at", "to_investors", "tx_hash"]);
  assert.equal(result.settlements[1].tx_hash, null);
  const evil = { ...SETTLEMENTS, settlements: [{ ...SETTLEMENTS.settlements[0], tx_hash: "javascript:alert(1)" }] };
  assert.equal((await refused(fake(() => json(evil)).client.settlements(RANGE))).status, 502);
  const noId = { ...SETTLEMENTS, settlements: [{ ...SETTLEMENTS.settlements[0], payment_id: "abc" }] };
  assert.equal((await refused(fake(() => json(noId)).client.settlements(RANGE))).status, 502);
});

test("a 404 page says the screen isn't on this server yet; 401 says sign in; the gateway's own sentence wins", async () => {
  const missing = await refused(fake(() => html(404)).client.listVouchers());
  assert.equal(missing.status, 503);
  assert.equal(missing.message, "Vouchers aren't available on this server yet.");
  assert.equal((await refused(fake(() => html(404)).client.report(RANGE))).message, "Reports aren't available on this server yet.");
  assert.equal((await refused(fake(() => html(404)).client.settlements(RANGE))).message, "Settlements aren't available on this server yet.");
  assert.equal((await refused(fake(() => json({}, 401)).client.listVouchers())).message, "Sign in to your merchant dashboard first.");
  assert.equal((await refused(fake(() => json({ error: "A report covers at most 92 days." }, 400)).client.report(RANGE))).message, "A report covers at most 92 days.");
  const offline = await refused(moneyClient({ fetch: async () => { throw new TypeError("fetch failed: 10.0.0.1"); } }).listVouchers());
  assert.equal(offline.status, 0);
  assert.doesNotMatch(offline.message, /10\.0\.0\.1/);
});

// ── the voucher form ──

const NOW = Date.parse("2026-11-06T03:00:00Z");
const form = (fields = {}) => ({ code: "save10", kind: "percent", value: "10", expires: "2026-12-01T23:59", limit: "100", minOrder: "", ...fields });

test("a good voucher form becomes the API body, code uppercased, no min_amount when empty", () => {
  const checked = voucherBody(form({ code: "  save-10_x " }), NOW);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value, { code: "SAVE-10_X", kind: "percent", value: "10", expires_at: new Date(Date.parse("2026-12-01T23:59")).toISOString(), max_redemptions: 100 });
  const fixed = voucherBody(form({ kind: "fixed", value: "5.50", minOrder: "20" }), NOW);
  assert.deepEqual([fixed.ok, fixed.value.value, fixed.value.min_amount], [true, "5.50", "20"]);
});

test("the voucher code check: 3 to 32 of A–Z 0–9 _ -", () => {
  for (const code of ["AB", "x".repeat(33), "SAVE 10", "SAVE!", "ÉTÉ10", ""]) {
    const checked = voucherBody(form({ code }), NOW);
    assert.equal(checked.ok, false, code);
    assert.match(checked.error, /3 to 32/);
  }
  for (const code of ["ABC", "x".repeat(32), "A_B-9"]) assert.equal(voucherBody(form({ code }), NOW).ok, true, code);
});

test("the voucher form refuses bad values, expiries, limits and minimums with one plain sentence each", () => {
  const bad = [
    form({ value: "0" }),
    form({ value: "101" }),
    form({ value: "12.5" }),
    form({ kind: "fixed", value: "0" }),
    form({ kind: "fixed", value: "1000.01" }),
    form({ kind: "fixed", value: "5.1234567" }),
    form({ kind: "bogo" }),
    form({ expires: "" }),
    form({ expires: "2026-11-05T10:00" }),
    form({ expires: "2032-01-01T00:00" }),
    form({ limit: "0" }),
    form({ limit: "100001" }),
    form({ limit: "2.5" }),
    form({ minOrder: "0.5" }),
    form({ minOrder: "1000.5" }),
    form({ minOrder: "abc" }),
  ];
  for (const f of bad) {
    const checked = voucherBody(f, NOW);
    assert.equal(checked.ok, false, JSON.stringify(f));
    assert.ok(checked.error.length > 10 && !/undefined|NaN/.test(checked.error), checked.error);
  }
  assert.equal(voucherBody(form({ value: "100", limit: "100000", minOrder: "1000" }), NOW).ok, true);
});

test("a voucher's status: deactivated, expired and used up beat active", () => {
  const v = { ...PREVIEW_VOUCHERS[0], active: true, expires_at: "2026-12-01T00:00:00.000Z", times_redeemed: 3, max_redemptions: 10 };
  assert.equal(voucherStatus(v, NOW), "active");
  assert.equal(voucherStatus({ ...v, active: false }, NOW), "off");
  assert.equal(voucherStatus({ ...v, expires_at: "2026-11-06T02:59:59.000Z" }, NOW), "expired");
  assert.equal(voucherStatus({ ...v, times_redeemed: 10 }, NOW), "used_up");
});

// ── the report range ──

test("the default range is the last 7 days in India time", () => {
  // 20:00 UTC on 5 Nov is 01:30 on 6 Nov in IST: today is the 6th
  assert.deepEqual(reportRange(undefined, undefined, Date.parse("2026-11-05T20:00:00Z")), { ok: true, value: { from: "2026-10-31", to: "2026-11-06" } });
  assert.deepEqual(reportRange("", "", Date.parse("2026-11-05T18:00:00Z")), { ok: true, value: { from: "2026-10-30", to: "2026-11-05" } });
  assert.deepEqual(reportRange(undefined, "2026-03-01", NOW), { ok: true, value: { from: "2026-02-23", to: "2026-03-01" } });
});

test("the range check: from on or before to, at most 92 days, real dates only", () => {
  assert.equal(MAX_REPORT_DAYS, 92);
  assert.deepEqual(reportRange("2026-11-06", "2026-11-06", NOW), { ok: true, value: { from: "2026-11-06", to: "2026-11-06" } });
  assert.equal(reportRange("2026-08-07", "2026-11-06", NOW).ok, true); // 92 days, both ends counted
  const tooLong = reportRange("2026-08-06", "2026-11-06", NOW);
  assert.deepEqual(tooLong, { ok: false, error: "Pick a range of up to 92 days." });
  assert.deepEqual(reportRange("2026-11-07", "2026-11-06", NOW), { ok: false, error: "The start date must be on or before the end date." });
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-11-01", "06/11/2026"], ["yesterday", "2026-11-06"]]) assert.equal(reportRange(from, to, NOW).ok, false, `${from}..${to}`);
});

test("the CSV link carries the same range and tz", () => {
  assert.equal(csvHref(RANGE), "/api/v1/reports.csv?from=2026-10-31&to=2026-11-06&tz=Asia%2FKolkata");
});

// ── the tiles ──

test("the tiles show exactly what the API sent, formatted for display only", () => {
  const { money, people } = reportTiles(REPORT);
  assert.deepEqual(
    money.map((t) => [t.label, t.value]),
    [
      ["Gross", "42.50"],
      ["Fees", "0.30"],
      ["Net", "40.00"], // the API's net, not gross − fees (42.20)
      ["Refunds", "3.50"],
    ],
  );
  assert.deepEqual(
    people.map((t) => [t.label, t.value]),
    [
      ["Payments", "3"],
      ["New payers", "1"],
      ["Returning payers", "2"],
    ],
  );
  const big = reportTiles({ ...REPORT, totals: { ...REPORT.totals, gross: "1234567.123456" } });
  assert.equal(big.money[0].value, "1,234,567.123456"); // never rounded
});

// ── the preview fixtures go through the client like the real routes ──

test("the preview answers vouchers, reports and settlements in the API's shapes, range included", async () => {
  const client = moneyClient({ fetch: previewFetch });
  assert.equal((await client.listVouchers()).length, PREVIEW_VOUCHERS.length);
  const report = await client.report(RANGE);
  assert.equal(report.days.length, 7);
  assert.ok(report.totals.count > 0 && report.kpis.returning_payers > 0);
  const settled = await client.settlements(RANGE);
  assert.equal(settled.settlements.length, report.totals.count);
  assert.ok(settled.settlements.some((s) => s.to_investors !== "0"));
  const old = await client.report({ from: "2025-01-01", to: "2025-01-07" });
  assert.equal(old.totals.count, 0);
  assert.equal((await client.settlements({ from: "2025-01-01", to: "2025-01-07" })).settlements.length, 0);
  assert.equal((await refused(client.report({ from: "2026-01-01", to: "2026-11-06" }))).message, "A report covers at most 92 days.");
  assert.equal((await refused(client.createVoucher({}))).status, 503);
});
