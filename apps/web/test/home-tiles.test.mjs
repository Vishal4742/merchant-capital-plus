// claude-frontend batch 041: the home's "Vouchers used" tile (FR-GW-12) from the vouchers module, and the Capital
// entry points (FR-ADV-1, FR-INV-1) that replace "Soon". Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { vouchersUsed } = await import("../lib/gateway-money.ts");
const NOW = Date.parse("2026-11-06T12:00:00Z");
const code = (over) => ({ active: true, expires_at: "2026-12-01T00:00:00.000Z", max_redemptions: 10, times_redeemed: 0, ...over });

test("vouchersUsed: unreadable is a dash with a reason", () => {
  assert.deepEqual(vouchersUsed(null, NOW), { value: "—", sub: "can't read vouchers now" });
});

test("vouchersUsed: no codes is a calm zero", () => {
  assert.deepEqual(vouchersUsed([], NOW), { value: "0", sub: "No codes yet" });
});

test("vouchersUsed: counts every redemption, and only codes that still work as live", () => {
  const codes = [
    code({ times_redeemed: 3 }), // works
    code({ times_redeemed: 2, active: false }), // switched off
    code({ times_redeemed: 1, expires_at: "2026-11-01T00:00:00.000Z" }), // ended
    code({ times_redeemed: 10 }), // used up
  ];
  assert.deepEqual(vouchersUsed(codes, NOW), { value: "16", sub: "all time · 1 of 4 codes live" });
  assert.deepEqual(vouchersUsed([code({ times_redeemed: 1 })], NOW), { value: "1", sub: "all time · 1 of 1 code live" });
});

const home = readFileSync(new URL("../app/merchant/page.tsx", import.meta.url), "utf8");
const invoices = readFileSync(new URL("../components/merchant/Invoices.tsx", import.meta.url), "utf8");

test("home: Get paid early links to the Capital tab, and nothing says Soon", () => {
  assert.match(home, /href="\/merchant\/capital"[^>]*>\s*Get paid early/);
  assert.doesNotMatch(home, /Soon/);
});

test("invoices: an open invoice nothing is paid on links to Sell this invoice with its id", () => {
  assert.match(invoices, /href=\{`\/merchant\/capital\?invoice=\$\{invoice\.id\}`\}[^>]*>\s*Sell this invoice/);
});
