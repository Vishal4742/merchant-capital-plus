// Batch 031 A14 (owner Stage-2 outcome): an attempt the relayer may have broadcast keeps a recoverable transaction
// reference (the relayer's txHash) with its pending state; status still comes from the chain.
// Run from apps/web: node --experimental-test-module-mocks --test test/pending-ref.test.mjs
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, MERCHANT } from "./gw-helpers.mjs";

const TX = `0x${"ab".repeat(32)}`;
let answer = () => Response.json({}, { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => (String(url).includes("relayer.test") ? answer() : realFetch(url, init));

const { relaySale } = await import("../lib/relay.ts");
const { createSession, markPending, getSession, clearPending, invoiceAttempt, setInvoiceAttempt, clearInvoicePending } = await import("../lib/sessions.ts");
const sale = { relayerUrl: "https://relayer.test", merchant: MERCHANT, orderRef: `0x${"2".repeat(64)}`, from: `0x${"3".repeat(40)}`, amount: 25_000_000n, validBefore: 999n, salt: `0x${"4".repeat(64)}`, signature: `0x${"5".repeat(130)}` };

before(setupDb);
beforeEach(resetDb);

test("a 502 that may have been sent keeps the relayer's tx reference; a malformed one is dropped", async () => {
  answer = () => Response.json({ code: "rpc_error", txHash: TX.toUpperCase().replace("0X", "0x") }, { status: 502 });
  const r = await relaySale(sale);
  assert.deepEqual([r.ok, r.unknown, r.txHash], [false, true, TX]);
  answer = () => Response.json({ code: "rpc_error", txHash: "0x123" }, { status: 502 });
  assert.equal((await relaySale(sale)).txHash, undefined);
});

test("a checkout's pending attempt stores and returns the reference, and clears by value", async () => {
  const s = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: 25_000_000n, reference: "A-1", items: [] });
  const attempt = { from: sale.from, validBefore: 999n, amount: 25_000_000n, txHash: TX };
  await markPending(s.id, attempt);
  assert.deepEqual((await getSession(s.id)).pending, attempt);
  await clearPending(s.id, attempt);
  assert.equal((await getSession(s.id)).pending, undefined);
});

test("an invoice's pending attempt stores and returns the reference, and clears by value", async () => {
  const pending = { from: sale.from, validBefore: 999n, txHash: TX };
  await setInvoiceAttempt("inv-7", { pending });
  assert.deepEqual((await invoiceAttempt("inv-7")).pending, pending);
  await clearInvoicePending("inv-7", pending);
  assert.equal((await invoiceAttempt("inv-7")).pending, undefined);
});
