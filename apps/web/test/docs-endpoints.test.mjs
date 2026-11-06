// claude-frontend docs-drift checks for /docs (FR-GW-8), part 3: the full endpoint pages and the test scenarios, from
// the real route handlers. Each page's example request (lib/docs-reference.ts `detail`, the same data its curl is built
// from) is sent to its route, and the reply must have exactly the example response's keys. Each test scenario's status
// and message is what the gateway really answers. Its own file because the chain is faked with a module mock (like
// payments-api.test.mjs), which must come before any route is imported. Real SQL on PGlite; nothing leaves the process.
// Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, req, params, MERCHANT, expireSession } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "docs-endpoints-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = "0x2222222222222222222222222222222222222222";
process.env.RELAYER_URL = "http://relayer.test";

// the chain: payment 42 is 22.51 USDT to MERCHANT, nothing refunded
const PAYMENT = { paymentId: 42n, invoiceId: 0n, gross: 22_510_000n, txHash: `0x${"7d".repeat(32)}`, time: Date.UTC(2026, 10, 6, 10, 32, 5) };
mock.module("../lib/onchain.ts", {
  namedExports: {
    paidLogs: async () => [PAYMENT],
    readPayment: async () => ({ merchant: MERCHANT, gross: PAYMENT.gross, payer: "0x5555555555555555555555555555555555555555", refunded: 0n }),
    saleSettled: async () => null,
    readUsdtBalance: async () => 1_000_000_000n,
  },
});

const { ENDPOINTS, EVENT_FIELDS, TEST_SCENARIOS } = await import("../lib/docs-reference.ts");
const { WEBHOOK } = await import("../components/docs/snippets.ts");
const routes = {
  "POST /api/v1/sessions": (await import("../app/api/v1/sessions/route.ts")).POST,
  "GET /api/v1/sessions/{id}": (await import("../app/api/v1/sessions/[id]/route.ts")).GET,
  "GET /api/v1/payments": (await import("../app/api/v1/payments/route.ts")).GET,
};
const { POST: pay } = await import("../app/api/v1/sessions/[id]/pay/route.ts");
const { POST: openLink } = await import("../app/api/v1/public/links/[slug]/checkout/route.ts");
const { getSession, recordPayment, claimPayment, releasePayment } = await import("../lib/sessions.ts");
const { recordCheckout, markCheckoutPaid } = await import("../lib/server/checkouts.ts");
const { createLink } = await import("../lib/server/links.ts");
const { createWebhook, attemptDelivery, enqueueEvent, signWebhook } = await import("../lib/server/webhooks.ts");
const { onSessionPaid } = await import("../lib/server/events.ts");
const sdk = await import("../../../packages/sdk/index.ts");

const shopKey = { authorization: `Bearer ${process.env.SHOP_API_KEY}` };
const detailOf = (key) => ENDPOINTS.find((e) => `${e.method} ${e.path}` === key);
const scenario = (id) => TEST_SCENARIOS.find((t) => t.id === id);
/** The keys of a JSON value, all the way down ("priced.rate", "data[].paymentId"), sorted. */
const shape = (value, at = "") =>
  Array.isArray(value)
    ? value.flatMap((item) => shape(item, `${at}[]`))
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => [`${at}${k}`, ...shape(v, `${at}${k}.`)]).sort()
      : [];

// Frankfurter at the docs' example rate (0.88875 EUR per USD, dated today); webhook POSTs are recorded and answered
// with `hookStatus`. Anything else fails the test: never the network.
let hookStatus = 200;
const delivered = [];
before(async () => {
  await setupDb();
});
beforeEach(async () => {
  await resetDb();
  hookStatus = 200;
  delivered.length = 0;
  mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).startsWith("https://api.frankfurter.dev/v2/rates?base=usd")) {
      return Response.json([{ date: new Date().toISOString().slice(0, 10), base: "USD", quote: "EUR", rate: 0.88875 }]);
    }
    if (String(url).startsWith("https://93.184.215.10/")) {
      delivered.push({ body: init.body, signature: init.headers["MC-Signature"] });
      return new Response("", { status: hookStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

/** POST /api/v1/sessions with the documented example body. Each call gets its own Idempotency-Key unless it passes the
 *  documented one: the same key and body would (rightly) get the first checkout back. */
let keys = 0;
async function createExample(key = `docs-${++keys}`) {
  const { detail } = detailOf("POST /api/v1/sessions");
  const res = await routes["POST /api/v1/sessions"](req("POST", "/api/v1/sessions", { body: detail.body, headers: { ...shopKey, ...detail.headers, "Idempotency-Key": key } }));
  return { res, json: await res.json() };
}
const getCheckout = async (id) => (await routes["GET /api/v1/sessions/{id}"](req("GET", `/api/v1/sessions/${id}`, { headers: shopKey }), params({ id }))).json();
const markPaid = async (id) => recordPayment(id, { txHash: PAYMENT.txHash, blockNumber: "9", paymentId: "42", from: MERCHANT, paidAt: Date.now(), amount: (await getSession(id)).amount });

test("POST /api/v1/sessions: the documented example gets the documented status and exactly the documented keys", async () => {
  const { detail } = detailOf("POST /api/v1/sessions");
  const { res, json } = await createExample(detail.headers["Idempotency-Key"]); // exactly the documented request
  assert.equal(res.status, detail.status);
  assert.deepEqual(shape(json), shape(detail.response));
  // the example's money is the gateway's own answer: 20.00 EUR at 0.88875 is 22.51 USDT, with that quote locked
  for (const key of ["amount", "currency"]) assert.equal(json[key], detail.response[key], key);
  const { rateAt, ...quote } = detail.response.priced;
  assert.deepEqual({ ...json.priced, rateAt }, { ...quote, rateAt });
});

test("GET /api/v1/sessions/{id}: a paid checkout's reply has exactly the documented keys", async () => {
  const { detail } = detailOf("GET /api/v1/sessions/{id}");
  const { json: created } = await createExample();
  await markPaid(created.id);
  const json = await getCheckout(created.id);
  assert.deepEqual(shape(json), shape(detail.response));
  for (const key of ["status", "amount", "currency", "reference", "paymentId", "refunded"]) assert.equal(json[key], detail.response[key], key);
});

test("GET /api/v1/payments: the documented query gets exactly the documented keys", async () => {
  const { detail } = detailOf("GET /api/v1/payments");
  const { json: created } = await createExample();
  await markPaid(created.id);
  const res = await routes["GET /api/v1/payments"](req("GET", `/api/v1/payments${detail.query}`, { headers: shopKey }));
  assert.equal(res.status, detail.status);
  const json = await res.json();
  assert.deepEqual(shape(json), shape(detail.response));
  // checkouts live in this process's memory, so earlier tests' paid checkouts share payment 42: it names one of them
  assert.equal((await getSession(json.data[0].sessionId))?.payment?.paymentId, "42", "a checkout's payment names its checkout");
});

test("scenario paid: the checkout reads paid, and payment.succeeded carries the documented data fields", async () => {
  assert.ok(scenario("paid"));
  await createWebhook(MERCHANT, "https://93.184.215.10/hook");
  const { json: created } = await createExample();
  const session = await markPaid(created.id);
  await onSessionPaid(session, session.amount);
  assert.equal((await getCheckout(created.id)).status, "paid");
  assert.equal(delivered.length, 1, "one delivery");
  const event = JSON.parse(delivered[0].body);
  assert.equal(event.type, "payment.succeeded");
  assert.deepEqual(Object.keys(event.data), EVENT_FIELDS.flatMap(([names]) => names.split(", ")));
});

// Batch 023: checkouts are in the database, so the clock isn't mocked here: PGlite run under a mocked Date keeps the test
// process alive for the whole mocked span (30 min). The documented times are read from the stored checkouts instead.
test("scenario expired: after the documented time the checkout reads expired, and paying it answers the documented 410", async () => {
  const { status, messages } = scenario("expired");
  const usdt = await routes["POST /api/v1/sessions"](req("POST", "/api/v1/sessions", { body: { amount: "25.00" }, headers: shopKey }));
  const { json: eur } = await createExample(); // priced in EUR: ends with its 10-minute quote
  const { id } = await usdt.json();
  const lasts = async (sessionId) => ((s) => s.expiresAt - s.createdAt)(await getSession(sessionId));
  assert.equal(await lasts(eur.id), 10 * 60_000, "a EUR checkout ends with its 10-minute quote");
  assert.equal(await lasts(id), 30 * 60_000, "a USDT checkout lasts 30 minutes");
  assert.equal((await getCheckout(id)).status, "open");
  await expireSession(eur.id);
  assert.equal((await getCheckout(eur.id)).status, "expired");
  assert.equal((await getCheckout(id)).status, "open", "only the one past its time");
  await expireSession(id);
  assert.equal((await getCheckout(id)).status, "expired");
  const res = await pay(req("POST", `/api/v1/sessions/${id}/pay`, { body: {} }), params({ id }));
  assert.equal(res.status, status);
  assert.deepEqual([(await res.json()).error], messages);
});

test("scenario paid twice: 409 while the first payment is going through, and 409 with the receipt after it", async () => {
  const { status, messages } = scenario("paid-twice");
  const { json: created } = await createExample();
  const id = created.id;
  await recordCheckout(id, "link", "lnk_docs", MERCHANT, (await getSession(id)).amount); // a link checkout locks before checking the signature
  const approval = { from: MERCHANT, salt: `0x${"11".repeat(32)}`, signature: `0x${"22".repeat(65)}`, validBefore: String(Math.floor(Date.now() / 1000) + 300) };
  const held = await claimPayment(id);
  assert.ok(held, "the first payment is in flight");
  try {
    const during = await pay(req("POST", `/api/v1/sessions/${id}/pay`, { body: approval }), params({ id }));
    assert.equal(during.status, status);
    assert.equal((await during.json()).error, messages[0]);
  } finally {
    await releasePayment(id, held);
  }
  await markPaid(id);
  const after = await pay(req("POST", `/api/v1/sessions/${id}/pay`, { body: approval }), params({ id }));
  assert.equal(after.status, status);
  const body = await after.json();
  assert.equal(body.error, messages[1]);
  assert.equal(body.receiptId, id, "the reply carries the receipt");
});

test("scenario link already paid: opening a paid single-use link answers the documented 410", async () => {
  const { status, messages } = scenario("link-paid");
  const link = await createLink(MERCHANT, { currency: "USDT", description: "Cold brew", amount: "5.00", single_use: true });
  const open = () => openLink(req("POST", `/api/v1/public/links/${link.slug}/checkout`, { headers: { "x-forwarded-for": "203.0.113.9" } }), params({ slug: link.slug }));
  const first = await open();
  assert.equal(first.status, 303);
  await markCheckoutPaid(new URL(first.headers.get("location")).pathname.split("/").pop());
  const again = await open();
  assert.equal(again.status, status);
  assert.deepEqual([(await again.json()).error], messages);
});

test("scenario Idempotency-Key reused: another body with the same key answers the documented 422", async () => {
  const { status, messages } = scenario("idempotency");
  const key = { "idempotency-key": "order-77" };
  assert.equal((await routes["POST /api/v1/sessions"](req("POST", "/api/v1/sessions", { body: { amount: "25.00" }, headers: { ...shopKey, ...key } }))).status, 201);
  const res = await routes["POST /api/v1/sessions"](req("POST", "/api/v1/sessions", { body: { amount: "26.00" }, headers: { ...shopKey, ...key } }));
  assert.equal(res.status, status);
  assert.deepEqual([(await res.json()).error], messages);
});

test("scenario endpoint down and bad signature: the snippet answers 400 to a bad signature, and we retry any non-2xx", async () => {
  const { status } = scenario("bad-signature");
  assert.match(scenario("endpoint-down").result, /after 1 minute, then 5, then 30 more/);
  // a secret that doesn't match: constructEvent throws WebhookSignatureError, and the docs' handler answers 400 to it
  const body = '{"id":"evt_1","type":"payment.succeeded","created":1,"data":{"test":true}}';
  assert.throws(() => sdk.constructEvent(body, signWebhook(body, "whsec_wrong"), "whsec_right"), sdk.WebhookSignatureError);
  assert.match(WEBHOOK, new RegExp(`err instanceof WebhookSignatureError\\) \\{\\s*return new Response\\("bad signature", \\{\\s*status: ${status},`));
  // our side: that 400 is a failed attempt, retried in a minute (the full schedule is in docs-limits.test.mjs)
  hookStatus = status;
  await createWebhook(MERCHANT, "https://93.184.215.10/hook");
  const [delivery] = await enqueueEvent(MERCHANT, "payment.succeeded", { test: true });
  assert.equal(delivery.status, "pending");
  assert.equal(delivery.response_status, status);
  assert.equal((await attemptDelivery(delivery.id, Date.parse(delivery.next_attempt_at))).attempts, 2, "tried again");
});
