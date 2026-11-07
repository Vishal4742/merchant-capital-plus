// Batch 031 round 3 (A10, owner decision): a payer in the relayer's temporary cooldown (HTTP 429, code payer_cooldown,
// retry_after_s) sees a specific message — nothing was charged and when to try again — instead of the generic "busy"
// text. Decided before anything is sent, so it never asks to pay again while a payment may be in flight.
// Run from apps/web: node --experimental-test-module-mocks --test test/relay-cooldown.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

let answer = () => Response.json({}, { status: 200 });
globalThis.fetch = async () => answer();

const { relaySale, relayPayInvoice, BUSY } = await import("../lib/relay.ts");
const signed = {
  relayerUrl: "https://relayer.test",
  from: `0x${"3".repeat(40)}`,
  amount: 25_000_000n,
  validBefore: 999n,
  salt: `0x${"4".repeat(64)}`,
  signature: `0x${"5".repeat(130)}`,
};
const sale = { ...signed, merchant: `0x${"1".repeat(40)}`, orderRef: `0x${"2".repeat(64)}` };

test("a payer in cooldown is told nothing was charged and roughly when to retry (sale and invoice)", async () => {
  answer = () => Response.json({ error: "cooldown", code: "payer_cooldown", retry_after_s: 610 }, { status: 429 });
  for (const result of [await relaySale(sale), await relayPayInvoice({ ...signed, invoiceId: 7n })]) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
    assert.equal(result.unknown, undefined, "not 'maybe sent': nothing was sent");
    assert.match(result.message, /nothing was charged/i);
    assert.match(result.message, /11 minutes/, "rounded up from 610 s");
    assert.notEqual(result.message, BUSY);
    assert.doesNotMatch(result.message, /payer_cooldown|429/, "no relayer codes shown to customers");
  }
});

test("a cooldown without retry_after_s still gets the specific message; other 429s stay 'busy'", async () => {
  answer = () => Response.json({ code: "payer_cooldown" }, { status: 429 });
  const r1 = await relaySale(sale);
  assert.match(r1.message, /a few minutes/);
  answer = () => Response.json({ code: "rate_limited" }, { status: 429 });
  const r2 = await relaySale(sale);
  assert.deepEqual([r2.status, r2.message], [503, BUSY], "the relayer's ordinary rate limit is unchanged");
});

test("A12 (round 4): a replayed approval is never 'nothing was charged, start again'; it stays refused (no lock) and says don't pay again yet", async () => {
  answer = () => Response.json({ error: "authorization used", code: "replay" }, { status: 422 });
  for (const result of [await relaySale(sale), await relayPayInvoice({ ...signed, invoiceId: 7n })]) {
    assert.deepEqual([result.ok, result.status, result.refused, result.unknown], [false, 400, true, undefined]);
    assert.match(result.message, /already submitted/i);
    assert.match(result.message, /Don't pay again yet/);
    assert.doesNotMatch(result.message, /nothing was charged|start the checkout again/i);
  }
});
