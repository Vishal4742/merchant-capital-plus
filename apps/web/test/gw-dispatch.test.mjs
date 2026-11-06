// Batch 024 (FR-GW-7, NFR-4): webhook retries in production without a frequent cron. dispatchSoon runs dispatchDue after
// the response of a hosted link or page read and of the dashboard's webhook list, at most once per server instance per
// 30 s. Real SQL on PGlite; DNS, fetch and Next's after() are mocked (no network, no request scope).
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-dispatch.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { setupDb, resetDb, signedIn, req, MERCHANT } from "./gw-helpers.mjs";

// after(): the tasks a request scheduled, run by the test as Next would after the response
const scheduled = [];
mock.module("next/server.js", { namedExports: { after: (task) => void scheduled.push(task) } });
mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
let status = 500;
mock.method(globalThis, "fetch", async () => new Response("x", { status }));

const { POST: create, GET: list } = await import("../app/api/v1/webhooks/route.ts");
const { enqueueEvent, dispatchSoon } = await import("../lib/server/webhooks.ts");
const { linkBySlug } = await import("../lib/server/links.ts");
const { pageBySlug } = await import("../lib/server/pages.ts");
const { query } = await import("../lib/server/db.ts");

const MIN = 60_000;
// the throttle's clock for tests that pass `now`: far ahead and a minute apart, so they never throttle each other
let clock = Date.now() + 1000 * MIN;
const tick = () => (clock += MIN);
const runScheduled = () => Promise.all(scheduled.splice(0).map((task) => task()));

before(setupDb);
beforeEach(async () => {
  await resetDb();
  status = 500;
  scheduled.length = 0;
  dispatchSoon(() => {}, Date.now() - MIN); // a dispatch a minute ago: the next real-time one isn't throttled
});

/** A delivery whose first attempt failed 2 min ago, so its 1-min retry is due; the endpoint answers 200 from now on. */
async function dueDelivery() {
  const res = await create(req("POST", "/api/v1/webhooks", { body: { url: "https://shop.example/hooks" }, headers: signedIn() }));
  assert.equal(res.status, 201);
  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "pay_1" }, Date.now() - 2 * MIN);
  assert.equal(await statusOf(), "pending");
  status = 200;
}
const statusOf = async () => (await query("SELECT status FROM app_gw_deliveries"))[0]?.status;

for (const [name, read] of [
  ["a hosted link read", () => linkBySlug("no-such-link")],
  ["a hosted page read", () => pageBySlug("no-such-page")],
  ["the dashboard's webhook list", () => list(req("GET", "/api/v1/webhooks", { headers: signedIn() }))],
]) {
  test(`batch 024: ${name} retries a due delivery after the response`, async () => {
    await dueDelivery();
    await read();
    assert.equal(scheduled.length, 1, "one dispatch scheduled");
    assert.equal(await statusOf(), "pending", "nothing sent before the response");
    await runScheduled();
    assert.equal(await statusOf(), "succeeded");
  });
}

test("batch 024: at most one dispatch per server instance per 30 s", () => {
  const t = tick();
  const ran = [];
  const schedule = (task) => ran.push(task);
  assert.equal(dispatchSoon(schedule, t), true);
  assert.equal(dispatchSoon(schedule, t + 1000), false, "inside 30 s: skipped");
  assert.equal(dispatchSoon(schedule, t + 29_999), false);
  assert.equal(dispatchSoon(schedule, t + 30_000), true, "30 s later: dispatches again");
  assert.equal(ran.length, 2);
  clock = t + 30_000;
});

test("batch 024: outside a request (after() throws) nothing runs and nothing throws", () => {
  const t = tick();
  assert.equal(dispatchSoon(() => { throw new Error("`after` was called outside a request scope"); }, t), false);
  assert.equal(dispatchSoon(() => {}, t + 1000), true, "a skipped schedule doesn't use up the 30 s");
});

test("batch 024: a failing dispatch logs its error's name only and never rejects", async () => {
  await dueDelivery();
  await query("ALTER TABLE app_gw_deliveries ADD CONSTRAINT batch024 CHECK (next_attempt_at < 0) NOT VALID"); // the lease UPDATE fails
  const spy = mock.method(console, "error", () => {});
  let lines;
  try {
    let task;
    dispatchSoon((t) => (task = t), tick());
    await task(); // resolves: the failure is caught and logged
    lines = spy.mock.calls.map((c) => c.arguments.join(" "));
  } finally {
    spy.mock.restore();
    await query("ALTER TABLE app_gw_deliveries DROP CONSTRAINT IF EXISTS batch024");
  }
  assert.deepEqual(lines.length, 1);
  assert.match(lines[0], /^webhook dispatch failed \(\w+\)$/);
  assert.equal(await statusOf(), "pending", "left for the next dispatch");
});
