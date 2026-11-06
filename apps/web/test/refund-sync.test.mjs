// claude-frontend batch 027: after a dashboard refund's receipt, the browser names the tx to the gateway so it sends
// payment.refunded (FR-GW-7, AT-15). Only a 502 (receipt not readable yet) is retried. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { syncRefund } = await import("../lib/refund-sync.ts");
const TX = `0x${"ab".repeat(32)}`;

function fakeFetch(statuses) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response("{}", { status: statuses[Math.min(calls.length - 1, statuses.length - 1)] });
  };
  return { calls, fetcher };
}

test("syncRefund: posts the tx hash to the payment's sync route once when it is accepted", async () => {
  const { calls, fetcher } = fakeFetch([200]);
  assert.equal(await syncRefund("42", TX, fetcher, async () => {}), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/payments/42/refunds/sync");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { tx_hash: TX });
});

test("syncRefund: a 502 is retried twice with 1.5 s pauses, then gives up without throwing", async () => {
  const { calls, fetcher } = fakeFetch([502]);
  const waits = [];
  assert.equal(await syncRefund("42", TX, fetcher, async (ms) => void waits.push(ms)), false);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1500, 1500]);
});

test("syncRefund: a 502 then 200 succeeds on the second try", async () => {
  const { calls, fetcher } = fakeFetch([502, 200]);
  assert.equal(await syncRefund("42", TX, fetcher, async () => {}), true);
  assert.equal(calls.length, 2);
});

for (const status of [400, 401, 429]) {
  test(`syncRefund: a ${status} is not retried`, async () => {
    const { calls, fetcher } = fakeFetch([status]);
    assert.equal(await syncRefund("42", TX, fetcher, async () => {}), false);
    assert.equal(calls.length, 1);
  });
}

test("syncRefund: a 404 (no checkout record, e.g. an invoice) is done, not a failure, and not retried", async () => {
  const { calls, fetcher } = fakeFetch([404]);
  assert.equal(await syncRefund("42", TX, fetcher, async () => {}), true);
  assert.equal(calls.length, 1);
});

test("syncRefund: a network error is retried like a 502 and never throws", async () => {
  let n = 0;
  const fetcher = async () => {
    n++;
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await syncRefund("42", TX, fetcher, async () => {}), false);
  assert.equal(n, 3);
});
