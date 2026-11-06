// Batch 050 round 2 (CON-11, review L4): which wallets carry V1 Capital obligations, read from CapitalMarket with a
// fake chain. It mirrors the contract's own hasClaimsOn: a running or listed advance (advanceOf != 0, which covers
// liensOf), or an invoice claim of the merchant's that isn't cancelled or settled and still has units outstanding.
// Fail closed: any failed or unexpected read throws, and so does a book too large to check completely.
import { test } from "node:test";
import assert from "node:assert/strict";

const { v1Obligations } = await import("../lib/server/capital.ts");

const ME = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";
const INVOICE = 1, ADVANCE = 2;
// offers(id) → [kind, merchant, offerDeadline, bps, cancelled, settled, invoiceId, face, price, maturity, sold]
const offer = (kind, merchant, { cancelled = false, settled = false } = {}) => [kind, merchant, 0n, 100, cancelled, settled, 9n, 1_000_000n, 900_000n, 0n, 0n];

/** A fake CapitalMarket: `advance` for advanceOf, `book` is offers by id (1-based), `left` is outstanding by id. */
function chain({ advance = 0n, book = [], left = {}, fail = null } = {}) {
  const calls = [];
  const read = async ({ functionName, args }) => {
    calls.push(functionName);
    if (fail === functionName) throw new Error("rpc down");
    if (functionName === "advanceOf") return advance;
    if (functionName === "offerCount") return BigInt(book.length);
    if (functionName === "offers") return book[Number(args[0]) - 1] ?? [0, ZERO, 0n, 0, false, false, 0n, 0n, 0n, 0n, 0n];
    if (functionName === "outstanding") return left[String(args[0])] ?? 0n;
    throw new Error(`unexpected read ${functionName}`);
  };
  return { read, calls };
}

test("a running or listed advance is an obligation, even when its offer can't be read (the L4 fail-open)", async () => {
  const c = chain({ advance: 7n, fail: "offers" });
  assert.equal(await v1Obligations(ME, { read: c.read }), true);
  assert.deepEqual(c.calls, ["advanceOf"], "no offer read needed");
});

test("no advance and no invoice claims: no obligations", async () => {
  assert.equal(await v1Obligations(ME, { read: chain().read }), false);
});

test("an invoice claim of mine with units outstanding is an obligation; sold-out, cancelled, settled or others' are not", async () => {
  const book = [offer(INVOICE, ME), offer(INVOICE, ME, { cancelled: true }), offer(INVOICE, ME, { settled: true }), offer(INVOICE, OTHER), offer(ADVANCE, ME, { settled: true })];
  assert.equal(await v1Obligations(ME, { read: chain({ book, left: { 1: 5n, 2: 5n, 3: 5n, 4: 5n } }).read }), true, "claim 1 has units outstanding");
  assert.equal(await v1Obligations(ME, { read: chain({ book, left: { 2: 5n, 3: 5n, 4: 5n } }).read }), false, "claim 1 has none outstanding; 2 cancelled, 3 settled, 4 not mine");
});

test("fail closed: a failed or unexpected read throws", async () => {
  await assert.rejects(v1Obligations(ME, { read: chain({ fail: "advanceOf" }).read }));
  await assert.rejects(v1Obligations(ME, { read: chain({ book: [offer(INVOICE, ME)], fail: "outstanding" }).read }));
  await assert.rejects(v1Obligations(ME, { read: chain({ book: [offer(INVOICE, ME)], fail: "offers" }).read }));
  await assert.rejects(v1Obligations(ME, { read: async () => null }), "advanceOf answered something that isn't a number");
});

test("fail closed: a book larger than can be checked completely throws instead of skipping older offers", async () => {
  const book = Array.from({ length: 201 }, () => offer(INVOICE, OTHER));
  await assert.rejects(v1Obligations(ME, { read: chain({ book }).read }), /too large/);
});
