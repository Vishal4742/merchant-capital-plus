// claude-frontend docs-drift checks for /docs (FR-GW-8), part 2: the limits only a request can show. Each rate limit
// in lib/docs-reference.ts lets exactly `limit` calls through and answers the next one 429; the checkout fields refuse
// one past their documented length; webhook endpoints stop at 5 and retries follow the documented schedule.
// Real route handlers on PGlite (gw-helpers); nothing leaves the process.
// Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, params, MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "docs-test-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = "0x2222222222222222222222222222222222222222";
process.env.RELAYER_URL = "http://relayer.test";

const { LIMITS, RATE_LIMITS } = await import("../lib/docs-reference.ts");
const { createSession } = await import("../lib/sessions.ts");
const { recordCheckout } = await import("../lib/server/checkouts.ts");
const { createWebhook, enqueueEvent, attemptDelivery } = await import("../lib/server/webhooks.ts");
const { query } = await import("../lib/server/db.ts");
const routes = {
  "POST /api/v1/sessions": (await import("../app/api/v1/sessions/route.ts")).POST,
  "POST /api/v1/quotes": (await import("../app/api/v1/quotes/route.ts")).POST,
  "POST /api/v1/public/links/{slug}/checkout": (await import("../app/api/v1/public/links/[slug]/checkout/route.ts")).POST,
  "POST /api/v1/public/pages/{slug}/checkout": (await import("../app/api/v1/public/pages/[slug]/checkout/route.ts")).POST,
  ...(await import("../app/api/v1/sessions/[id]/voucher/route.ts").then((m) => ({ "POST /api/v1/sessions/{id}/voucher": m.POST, "DELETE /api/v1/sessions/{id}/voucher": m.DELETE }))),
  "POST /api/v1/vouchers": (await import("../app/api/v1/vouchers/route.ts")).POST,
  "POST /api/v1/webhooks/{id}/test": (await import("../app/api/v1/webhooks/[id]/test/route.ts")).POST,
  "POST /api/v1/webhooks/deliveries/{id}/replay": (await import("../app/api/v1/webhooks/deliveries/[id]/replay/route.ts")).POST,
  "GET /api/v1/payments": (await import("../app/api/v1/payments/route.ts")).GET,
};

const shopKey = { authorization: `Bearer ${process.env.SHOP_API_KEY}` };
const ip = { "x-forwarded-for": "203.0.113.7" };
let voucherCode = 0;

/** A request for one documented endpoint that passes auth and reaches its rate limit (and nothing more). */
async function call(endpoint, checkoutId) {
  const [method, path] = endpoint.split(" ");
  const route = routes[endpoint];
  assert.ok(route, `no handler wired for ${endpoint}`);
  if (endpoint === "POST /api/v1/sessions") return route(req(method, path, { body: {}, headers: shopKey }));
  if (endpoint === "POST /api/v1/quotes") return route(req(method, path, { body: {}, headers: ip }));
  if (path.includes("{slug}")) return route(req(method, path.replace("{slug}", "no-such-slug"), { body: {}, headers: ip }), params({ slug: "no-such-slug" }));
  if (path.endsWith("{id}/voucher")) return route(req(method, path.replace("{id}", checkoutId), { body: { code: "" }, headers: ip }), params({ id: checkoutId }));
  if (endpoint === "POST /api/v1/vouchers") {
    const body = { code: `DOCS${++voucherCode}`, kind: "percent", value: "10", expires_at: new Date(Date.now() + 864e5).toISOString(), max_redemptions: 5 };
    return route(req(method, path, { body, headers: signedIn() }));
  }
  return route(req(method, path.replace("{id}", "whk_none"), { headers: signedIn() }), params({ id: "whk_none" })); // webhook test and replay
}

before(setupDb);
beforeEach(async () => {
  await resetDb(); // also resets the rate limiter
  mock.method(console, "error", () => {}); // vouchers log that Arkiv isn't configured
  delete process.env.VOUCHER_HASH_SECRET;
});

for (const limit of RATE_LIMITS) {
  const names = limit.endpoints.map((e) => `${e.method} ${e.path}`);
  test(`rate limit: ${names.join(" + ")} lets ${limit.limit} through per ${limit.per}, then 429 until the window ends`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); // the clock stands still until we tick it
    const session = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: 25_000_000n, reference: "docs", items: [] });
    await recordCheckout(session.id, "link", "lnk_docs", MERCHANT, 25_000_000n); // the voucher route works on link checkouts
    // spread over every endpoint that shares the limit, so "together" is checked too
    for (let i = 0; i < limit.limit; i++) {
      const res = await call(names[i % names.length], session.id);
      assert.notEqual(res.status, 429, `call ${i + 1} of ${limit.limit} to ${names[i % names.length]}`);
    }
    for (const name of names) assert.equal((await call(name, session.id)).status, 429, `${name} after ${limit.limit}`);
    t.mock.timers.tick(limit.windowMs - 1);
    assert.equal((await call(names[0], session.id)).status, 429, "still limited just before the window ends");
    t.mock.timers.tick(1);
    assert.notEqual((await call(names[0], session.id)).status, 429, `open again ${limit.windowMs / 60_000} min after the first call`);
  });
}

const createCheckout = (body, headers = {}) => routes["POST /api/v1/sessions"](req("POST", "/api/v1/sessions", { body, headers: { ...shopKey, ...headers } }));
const errorOf = async (res) => (await res.json()).error;

test(`a checkout's reference may be ${LIMITS.referenceMax} characters, not one more`, async () => {
  assert.equal((await createCheckout({ amount: "5.00", reference: "r".repeat(LIMITS.referenceMax) })).status, 201);
  const res = await createCheckout({ amount: "5.00", reference: "r".repeat(LIMITS.referenceMax + 1) });
  assert.equal(res.status, 400);
  assert.equal(await errorOf(res), `reference must be at most ${LIMITS.referenceMax} characters.`);
});

test(`a checkout takes up to ${LIMITS.itemsMax} items, each qty 1 to ${LIMITS.itemQtyMax}`, async () => {
  const items = (n, qty = 1) => Array.from({ length: n }, (_, i) => ({ name: `Item ${i}`, qty, price: "1.00" }));
  assert.equal((await createCheckout({ amount: `${LIMITS.itemsMax}.00`, items: items(LIMITS.itemsMax) })).status, 201);
  const many = await createCheckout({ amount: `${LIMITS.itemsMax + 1}.00`, items: items(LIMITS.itemsMax + 1) });
  assert.equal(await errorOf(many), `items must be a list of at most ${LIMITS.itemsMax}.`);
  const heavy = await createCheckout({ amount: "1000.00", items: [{ name: "Bulk", qty: LIMITS.itemQtyMax + 1, price: "1.00" }] });
  assert.equal(heavy.status, 400);
  assert.match(await errorOf(heavy), new RegExp(`\\(1-${LIMITS.itemQtyMax}\\)`));
});

test(`an Idempotency-Key is 1 to ${LIMITS.idempotencyKeyMax} characters`, async () => {
  assert.equal((await createCheckout({ amount: "5.00" }, { "idempotency-key": "k".repeat(LIMITS.idempotencyKeyMax) })).status, 201);
  const res = await createCheckout({ amount: "5.00" }, { "idempotency-key": "k".repeat(LIMITS.idempotencyKeyMax + 1) });
  assert.equal(await errorOf(res), `Idempotency-Key must be 1 to ${LIMITS.idempotencyKeyMax} characters.`);
});

test(`a checkout below ${LIMITS.minPaymentUsdt} or above ${LIMITS.maxPaymentUsdt} USDT is refused`, async () => {
  assert.equal((await createCheckout({ amount: "1000.00" })).status, 201);
  assert.equal((await createCheckout({ amount: "1000.01" })).status, 400);
  assert.equal((await createCheckout({ amount: "0.99" })).status, 400);
});

test(`payments.list pages hold 1 to ${LIMITS.paymentsPageMax}`, async () => {
  const res = await routes["GET /api/v1/payments"](req("GET", `/api/v1/payments?limit=${LIMITS.paymentsPageMax + 1}`, { headers: shopKey }));
  assert.equal(await errorOf(res), `limit must be a whole number from 1 to ${LIMITS.paymentsPageMax}.`);
});

test(`a merchant has at most ${LIMITS.webhookEndpointsMax} webhook endpoints`, async () => {
  // public IP literals: no DNS lookup
  for (let i = 0; i < LIMITS.webhookEndpointsMax; i++) await createWebhook(MERCHANT, `https://93.184.215.${10 + i}/hook`);
  await assert.rejects(createWebhook(MERCHANT, "https://93.184.215.99/hook"), (e) => e.status === 409);
});

test(`a failing webhook is retried ${LIMITS.webhookRetryMinutes.join(", ")} minutes after each attempt, then marked failed`, async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("nope", { status: 500 }));
  await createWebhook(MERCHANT, "https://93.184.215.10/hook");
  let now = Date.now();
  const [first] = await enqueueEvent(MERCHANT, "payment.succeeded", { test: true }, now);
  const gaps = [];
  let delivery = first;
  while (delivery.status === "pending") {
    gaps.push((Date.parse(delivery.next_attempt_at) - now) / 60_000);
    now = Date.parse(delivery.next_attempt_at);
    delivery = await attemptDelivery(delivery.id, now);
  }
  assert.deepEqual(gaps, [...LIMITS.webhookRetryMinutes]);
  assert.equal(delivery.status, "failed");
  assert.equal(delivery.attempts, LIMITS.webhookRetryMinutes.length + 1);
  const [{ n }] = await query("SELECT count(*)::int AS n FROM app_gw_deliveries");
  assert.equal(n, 1, "one delivery row, retried in place");
});
