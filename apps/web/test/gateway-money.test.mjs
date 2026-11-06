// claude-frontend checks for lib/gateway-money.ts (SRS FR-GW-12 vouchers, FR-GW-9 reports, FR-GW-10 settlements):
// the browser's voucher calls parse claude-contracts' snake_case answers and refuse malformed ones, the voucher form and
// the report range are checked before any call, the CSV link carries the same range and tz, and the tiles show exactly
// what the API sent. fetch is faked; test/gateway-server.test.mjs reads real reports and vouchers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayError } from "../lib/gateway-client.ts";
import { MAX_REPORT_DAYS, csvHref, moneyClient, reportRange, reportTiles, voucherBody, voucherStatus } from "../lib/gateway-money.ts";

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
// the API's voucher shape (API.md)
const VOUCHER = { id: "vch_FLAT5", code: "FLAT5", kind: "fixed", value: "5", expires_at: "2026-11-16T03:00:00.000Z", max_redemptions: 50, times_redeemed: 12, min_amount: "20", active: true, arkiv_entity_key: `0x${"4c".repeat(32)}`, created_at: "2026-11-03T03:00:00.000Z" };
const VOUCHER_BODY = { code: "SAVE10", kind: "percent", value: "10", expires_at: "2026-12-01T00:00:00.000Z", max_redemptions: 100 };

// ── client parsing ──

test("refuses a malformed voucher answer", async () => {
  const good = VOUCHER;
  for (const broken of [{ ...good, kind: "bogo" }, { ...good, value: "-5" }, { ...good, times_redeemed: "3" }, { ...good, active: "yes" }, { ...good, arkiv_entity_key: "<script>" }, { ...good, expires_at: "soon" }]) {
    const error = await refused(fake(() => json(broken, 201)).client.createVoucher(VOUCHER_BODY));
    assert.equal(error.status, 502);
  }
  assert.equal((await refused(fake(() => json({ list: [] }, 201)).client.createVoucher(VOUCHER_BODY))).status, 502);
});

test("creates and deactivates a voucher with the right calls", async () => {
  const { client, calls } = fake((url) => (url.endsWith("/deactivate") ? json({ id: "vch_a/b", active: false }) : json(VOUCHER, 201)));
  const body = VOUCHER_BODY;
  const created = await client.createVoucher(body);
  assert.deepEqual(created, VOUCHER, "every snake_case field read");
  assert.equal(calls[0].url, "/api/v1/vouchers");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
  await client.deactivateVoucher("vch_a/b");
  assert.equal(calls[1].url, "/api/v1/vouchers/vch_a%2Fb/deactivate");
  assert.equal(calls[1].init.method, "POST");
});

test("a 404 page says the screen isn't on this server yet; 401 says sign in; the gateway's own sentence wins", async () => {
  const missing = await refused(fake(() => html(404)).client.createVoucher(VOUCHER_BODY));
  assert.equal(missing.status, 503);
  assert.equal(missing.message, "Vouchers aren't available on this server yet.");
  assert.equal((await refused(fake(() => json({}, 401)).client.deactivateVoucher("vch_a"))).message, "Sign in to your merchant dashboard first.");
  assert.equal((await refused(fake(() => json({ error: "You already have a code SAVE10." }, 409)).client.createVoucher(VOUCHER_BODY))).message, "You already have a code SAVE10.");
  const offline = await refused(moneyClient({ fetch: async () => { throw new TypeError("fetch failed: 10.0.0.1"); } }).createVoucher(VOUCHER_BODY));
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
  const v = { ...VOUCHER, active: true, expires_at: "2026-12-01T00:00:00.000Z", times_redeemed: 3, max_redemptions: 10 };
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
