// claude-frontend checks for the Developers screen's setup checklist and its plain reasons for failed deliveries
// (FR-GW-6, FR-GW-7). The reasons follow the gateway's real rules (lib/server/webhooks.ts: a 5 s wait, redirects never
// followed); the checklist reads the merchant's keys, endpoints and delivered events. Real SQL on PGlite; DNS and fetch
// are mocked (no network). Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { setupDb, resetDb, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const { ANSWER_WITHIN_S, deliveryProblem, setupSteps } = await import("../lib/gateway-dev.ts");
const { TIMEOUT_MS, createWebhook, deliveredEvents, enqueueEvent, sendTestEvent } = await import("../lib/server/webhooks.ts");

mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
let calls = [];
let status = 200;
mock.method(globalThis, "fetch", async (url, init) => {
  calls.push(init);
  return new Response(null, { status });
});

before(setupDb);
beforeEach(async () => {
  await resetDb();
  calls = [];
  status = 200;
});

const failed = (response_status, attempts = 1) => deliveryProblem({ status: "failed", attempts, response_status });

test("a failed delivery's reason follows its answer code", () => {
  assert.equal(failed(null), "Answer within 5 s");
  for (const code of [301, 302, 307, 308]) assert.equal(failed(code), "We don't follow redirects; use the final URL", code);
  for (const code of [401, 403]) assert.equal(failed(code), "Your route refused it: check the signature check and the secret", code);
  for (const code of [400, 404, 405, 410, 422, 429]) assert.equal(failed(code), "Your route refused it", code);
  for (const code of [500, 502, 503, 504]) assert.equal(failed(code), "Your handler failed", code);
});

test("a pending delivery that already failed once has a reason; a delivered one, or one not tried yet, has none", () => {
  assert.equal(deliveryProblem({ status: "pending", attempts: 2, response_status: 500 }), "Your handler failed");
  assert.equal(deliveryProblem({ status: "pending", attempts: 0, response_status: null }), null);
  assert.equal(deliveryProblem({ status: "succeeded", attempts: 1, response_status: 200 }), null);
});

test("the reasons match the gateway's own rules: a 5 s wait, and a redirect is recorded, never followed", async () => {
  assert.equal(TIMEOUT_MS, ANSWER_WITHIN_S * 1000);
  const hook = await createWebhook(MERCHANT, "https://shop.example/hooks");
  status = 302;
  const d = await sendTestEvent(MERCHANT, hook.id);
  assert.equal(calls[0].redirect, "manual");
  assert.equal(d.status, "pending");
  assert.equal(d.response_status, 302);
  assert.equal(deliveryProblem(d), "We don't follow redirects; use the final URL");
});

test("delivered events: a test event and a real payment.succeeded count only once answered with 2xx", async () => {
  const hook = await createWebhook(MERCHANT, "https://shop.example/hooks");
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: false, payment: false });

  status = 404;
  await sendTestEvent(MERCHANT, hook.id);
  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "s_1", status: "paid", link_id: "lnk_1", page_id: null });
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: false, payment: false }, "a 404 doesn't count");

  status = 200;
  await sendTestEvent(MERCHANT, hook.id);
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: true, payment: false }, "the test event isn't a real payment");

  await enqueueEvent(MERCHANT, "payment.refunded", { id: "s_1", status: "paid" });
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: true, payment: false }, "a refund isn't a payment");

  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "s_2", status: "paid", link_id: null, page_id: null });
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: true, payment: true });
  assert.deepEqual(await deliveredEvents(OTHER_MERCHANT), { test: false, payment: false }, "one merchant's events are theirs only");
});

const sk = { kind: "sk" };
const pk = { kind: "pk" };
const doneOf = (steps) => Object.fromEntries(steps.map((s) => [s.key, s.done]));

test("the setup checklist: four steps in order, each with a how-to and a jump link", () => {
  const steps = setupSteps({ keys: [], hooks: [], delivered: { test: false, payment: false } });
  assert.deepEqual(
    steps.map((s) => s.key),
    ["key", "endpoint", "test", "payment"],
  );
  for (const s of steps) {
    assert.equal(s.done, false, s.key);
    assert.ok(s.title && s.how && s.action, s.key);
    assert.match(s.href, /^(#[a-z-]+|\/merchant\/[a-z]+)$/, s.key);
  }
  assert.deepEqual(
    steps.map((s) => s.href),
    ["#new-key", "#new-endpoint", "#webhooks", "/merchant/links"],
  );
});

test("the setup checklist: partly and fully done", () => {
  assert.deepEqual(doneOf(setupSteps({ keys: [pk], hooks: [{}], delivered: { test: false, payment: false } })), { key: false, endpoint: true, test: false, payment: false }, "a publishable key isn't a secret key");
  assert.deepEqual(doneOf(setupSteps({ keys: [pk, sk], hooks: [{}], delivered: { test: true, payment: false } })), { key: true, endpoint: true, test: true, payment: false });
  assert.deepEqual(doneOf(setupSteps({ keys: [sk], hooks: [{}, {}], delivered: { test: true, payment: true } })), { key: true, endpoint: true, test: true, payment: true });
});
