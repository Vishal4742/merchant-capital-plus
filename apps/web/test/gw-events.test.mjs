// claude-contracts checks for the payment hook (lib/server/events.ts): link checkout marked paid, voucher confirmed,
// one webhook per payment event even when the caller retries, and a failed enqueue can be retried.
// vouchers.ts and webhooks.ts are replaced with recorders (their own tests cover them).
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-events.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { MERCHANT, resetDb, setupDb } from "./gw-helpers.mjs";

const sent = [];
const confirmed = [];
const confirmedAmounts = [];
let failNext = false;
mock.module("../lib/server/webhooks.ts", {
  namedExports: {
    enqueueEvent: async (merchant, type, data) => {
      if (failNext) {
        failNext = false;
        throw new Error("db down");
      }
      sent.push({ merchant, type, data });
    },
  },
});
mock.module("../lib/server/vouchers.ts", {
  namedExports: {
    confirmRedemption: async (sessionId, paidAmount) => {
      confirmed.push(sessionId);
      confirmedAmounts.push([sessionId, paidAmount]);
    },
  },
});

const { onSessionPaid, onRefund } = await import("../lib/server/events.ts");
const { recordCheckout, checkoutOf } = await import("../lib/server/checkouts.ts");

before(setupDb);
beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  confirmed.length = 0;
});

const session = (id = "sess_1") => ({
  id,
  merchant: "0x1111111111111111111111111111111111111111",
  merchantName: "Bandra Beans",
  amount: 25_000_000n,
  reference: "A-1042",
  payment: { paymentId: "7", txHash: "0xabc", from: "0x3333333333333333333333333333333333333333", paidAt: 1, blockNumber: "5" },
});

test("a paid link checkout: marked paid, voucher confirmed, one payment.succeeded with link_id", async () => {
  await recordCheckout("sess_1", "link", "lnk_1", MERCHANT, 25_000_000n);
  await onSessionPaid(session());
  await onSessionPaid(session()); // the caller retried
  assert.ok((await checkoutOf("sess_1")).paidAt, "checkout marked paid");
  assert.deepEqual(confirmed, ["sess_1", "sess_1"], "confirmRedemption is called each time; it is idempotent itself");
  assert.equal(sent.length, 1, "exactly one webhook");
  assert.equal(sent[0].type, "payment.succeeded");
  // the SDK's Session shape (packages/sdk GatewayEvent.data) + where it came from
  assert.deepEqual(sent[0].data, { id: "sess_1", status: "paid", amount: "25.00", currency: "USDT", reference: "A-1042", paymentId: "7", txHash: "0xabc", link_id: "lnk_1", page_id: null });
});

test("the voucher is confirmed against the amount actually paid", async () => {
  await onSessionPaid({ ...session("sess_v"), amount: 22_500_000n });
  assert.deepEqual(confirmedAmounts.at(-1), ["sess_v", 22_500_000n]);
});

test("a shop's own session (no link or page) still sends its webhook, with null link_id and page_id", async () => {
  await onSessionPaid(session("sess_shop"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.link_id, null);
  assert.equal(sent[0].data.page_id, null);
});

test("refunds: one webhook per new refunded total, retries ignored", async () => {
  await recordCheckout("sess_2", "page", "pg_1", MERCHANT, 25_000_000n);
  await onRefund(session("sess_2"), 5_000_000n, 5_000_000n);
  await onRefund(session("sess_2"), 5_000_000n, 5_000_000n); // retry
  await onRefund(session("sess_2"), 2_500_000n, 7_500_000n); // a second partial refund
  // refunded = the running total (SDK Session.refunded); refund_amount = this refund
  assert.deepEqual(sent.map((e) => [e.type, e.data.refunded, e.data.refund_amount, e.data.page_id]), [
    ["payment.refunded", "5.00", "5.00", "pg_1"],
    ["payment.refunded", "7.50", "2.50", "pg_1"],
  ]);
});

test("if queuing the webhook fails, a retry still sends it", async () => {
  failNext = true;
  await assert.rejects(onSessionPaid(session("sess_3")), /db down/);
  assert.equal(sent.length, 0);
  await onSessionPaid(session("sess_3"));
  assert.equal(sent.length, 1);
});

test("amounts of 1,000 USDT have no thousands separator in the webhook", async () => {
  await onSessionPaid({ ...session("sess_4"), amount: 1_000_000_000n });
  assert.equal(sent[0].data.amount, "1000.00");
});
