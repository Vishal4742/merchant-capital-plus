// Tester round 1 (batch 007): route-level cross-merchant scoping, exact retry schedule, dispatch auth edges.
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { setupDb, resetDb, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const { POST: create, GET: list } = await import("../app/api/v1/webhooks/route.ts");
const { DELETE: remove } = await import("../app/api/v1/webhooks/[id]/route.ts");
const { POST: sendTest } = await import("../app/api/v1/webhooks/[id]/test/route.ts");
const { POST: replay } = await import("../app/api/v1/webhooks/deliveries/[id]/replay/route.ts");
const { POST: dispatch } = await import("../app/api/v1/webhooks/dispatch/route.ts");
const { enqueueEvent, dispatchDue } = await import("../lib/server/webhooks.ts");

mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
let status = 500;
mock.method(globalThis, "fetch", async () => new Response("x", { status }));

before(setupDb);
beforeEach(async () => {
  await resetDb();
  status = 500;
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
});

test("another merchant gets 404 on delete, test and replay; anonymous gets 401", async () => {
  const hook = await (await create(req("POST", "/api/v1/webhooks", { body: { url: "https://shop.example/h" }, headers: signedIn() }))).json();
  const [d] = await enqueueEvent(MERCHANT, "payment.succeeded", { a: 1 }, 1_000_000);
  const other = signedIn(OTHER_MERCHANT);
  assert.equal((await remove(req("DELETE", "/x", { headers: other }), params({ id: hook.id }))).status, 404);
  assert.equal((await sendTest(req("POST", "/x", { headers: other }), params({ id: hook.id }))).status, 404);
  assert.equal((await replay(req("POST", "/x", { headers: other }), params({ id: d.id }))).status, 404);
  assert.equal((await remove(req("DELETE", "/x"), params({ id: hook.id }))).status, 401);
  assert.equal((await list(req("GET", "/x"))).status, 401);
  assert.deepEqual(await (await list(req("GET", "/x", { headers: other }))).json(), { webhooks: [] });
});

test("retry schedule is exactly 1 m, 5 m, 30 m after each failure, then failed", async () => {
  await create(req("POST", "/api/v1/webhooks", { body: { url: "https://shop.example/h" }, headers: signedIn() }));
  const t0 = 2_000_000_000_000;
  const [d1] = await enqueueEvent(MERCHANT, "payment.succeeded", {}, t0);
  assert.equal(Date.parse(d1.next_attempt_at), t0 + 60_000);
  assert.equal(await dispatchDue(t0 + 59_999), 0, "not due before 1 m");
  assert.equal(await dispatchDue(t0 + 60_000), 1);
  const after2 = (await (await list(req("GET", "/x", { headers: signedIn() }))).json()).webhooks[0].deliveries[0];
  assert.equal(after2.attempts, 2);
  assert.equal(Date.parse(after2.next_attempt_at), t0 + 60_000 + 5 * 60_000);
  await dispatchDue(t0 + 6 * 60_000);
  const a3 = (await (await list(req("GET", "/x", { headers: signedIn() }))).json()).webhooks[0].deliveries[0];
  assert.equal(Date.parse(a3.next_attempt_at), t0 + 6 * 60_000 + 30 * 60_000);
  await dispatchDue(t0 + 40 * 60_000);
  const a4 = (await (await list(req("GET", "/x", { headers: signedIn() }))).json()).webhooks[0].deliveries[0];
  assert.deepEqual([a4.status, a4.attempts, a4.next_attempt_at], ["failed", 4, null]);
});

test("dispatch: wrong, empty and prefix-only secrets are 401; unset CRON_SECRET is 503", async () => {
  const call = (h) => dispatch(req("POST", "/api/v1/webhooks/dispatch", { headers: h }));
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ authorization: "Bearer " })).status, 401);
  assert.equal((await call({ authorization: "Bearer cron-secret-for-tests-012345678" })).status, 401);
  assert.equal((await call({ authorization: "Bearer cron-secret-for-tests-0123456789" })).status, 200);
  delete process.env.CRON_SECRET;
  assert.equal((await call({ authorization: "Bearer " })).status, 503);
});
