// Batch 058 A4 (FR-GW-9): the Overview's net figure = gross − fees, never a guess when the fee can't be read.
import { test } from "node:test";
import assert from "node:assert/strict";

const { netAfterFees } = await import("../lib/dashboard.ts");

test("net is gross minus the fee on each payment", () => {
  assert.equal(netAfterFees(3_000_000n, 100_000n, 3), 2_700_000n); // 3.00 gross, 0.10 each → 2.70
  assert.equal(netAfterFees(1_000_000n, 100_000n, 1), 900_000n); // the verified testnet payment: 1.00 / 0.10 / 0.90
});

test("no payments is a calm zero", () => {
  assert.equal(netAfterFees(0n, 100_000n, 0), 0n);
});

test("an unreadable fee gives no net, not gross", () => {
  assert.equal(netAfterFees(3_000_000n, null, 3), null);
});

test("net never goes below zero", () => {
  assert.equal(netAfterFees(50_000n, 100_000n, 1), 0n);
});
