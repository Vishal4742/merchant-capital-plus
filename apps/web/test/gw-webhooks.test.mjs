// Batch 007 Builder B: webhooks (FR-GW-7, FR-PAY-10). Real SQL on PGlite; DNS and fetch are mocked (no network).
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-webhooks.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import { setupDb, resetDb, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const { POST: create, GET: list } = await import("../app/api/v1/webhooks/route.ts");
const { DELETE: remove } = await import("../app/api/v1/webhooks/[id]/route.ts");
const { POST: sendTest } = await import("../app/api/v1/webhooks/[id]/test/route.ts");
const { POST: replay } = await import("../app/api/v1/webhooks/deliveries/[id]/replay/route.ts");
const { POST: dispatch, GET: dispatchGet } = await import("../app/api/v1/webhooks/dispatch/route.ts");
const { enqueueEvent, dispatchDue, signWebhook, SIGNATURE_HEADER } = await import("../lib/server/webhooks.ts");

const MIN = 60_000;
// what each host resolves to; anything else is NXDOMAIN
let dnsTable = {};
mock.method(dns, "lookup", async (host, opts) => {
  assert.equal(opts?.all, true, "every address is checked, not just the first");
  const answers = dnsTable[host];
  if (!answers) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  return answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
});
// the merchant's endpoints: every call recorded; reply() decides the answer
let calls = [];
let reply = async () => new Response("ok", { status: 200 });
mock.method(globalThis, "fetch", async (url, init) => {
  calls.push({ url: String(url), init });
  return reply(url, init);
});

const hook = (url = "https://shop.example/hooks", merchant = MERCHANT) => create(req("POST", "/api/v1/webhooks", { body: { url }, headers: signedIn(merchant) }));
async function newHook(url, merchant) {
  const res = await hook(url, merchant);
  assert.equal(res.status, 201, url);
  return res.json();
}
const listHooks = async (merchant = MERCHANT) => (await (await list(req("GET", "/api/v1/webhooks", { headers: signedIn(merchant) }))).json()).webhooks;
const verify = (secret, header, body) => {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) ?? [];
  assert.ok(t && v1, `header shape: ${header}`);
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex") === v1;
};

before(setupDb);
beforeEach(async () => {
  await resetDb();
  calls = [];
  reply = async () => new Response("ok", { status: 200 });
  dnsTable = { "shop.example": ["93.184.216.34"], "other.example": ["93.184.216.35", "2606:2800:220:1::1"] };
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
});

test("the signature matches claude-sdk's format (fixed test vector)", () => {
  assert.equal(SIGNATURE_HEADER, "MC-Signature");
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded" });
  assert.equal(signWebhook(body, "whsec_test_vector", 1700000000), "t=1700000000,v1=4a374d4cd5792c4ce8d27bcc29d9d16157b2afeff2d6f29c52c5018500e63ee0");
});

test("webhook routes need the dashboard cookie", async () => {
  assert.equal((await create(req("POST", "/api/v1/webhooks", { body: { url: "https://shop.example/h" } }))).status, 401);
  assert.equal((await list(req("GET", "/api/v1/webhooks"))).status, 401);
  assert.equal((await remove(req("DELETE", "/api/v1/webhooks/x"), params({ id: "x" }))).status, 401);
  assert.equal((await sendTest(req("POST", "/api/v1/webhooks/x/test"), params({ id: "x" }))).status, 401);
  assert.equal((await replay(req("POST", "/api/v1/webhooks/deliveries/x/replay"), params({ id: "x" }))).status, 401);
});

test("creating an endpoint returns its secret once; the list never shows it", async () => {
  const data = await newHook("https://shop.example/hooks");
  assert.match(data.id, /^whk_/);
  assert.equal(data.url, "https://shop.example/hooks");
  assert.match(data.secret, /^whsec_[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
  assert.ok(!Number.isNaN(Date.parse(data.created_at)));
  const hooks = await listHooks();
  assert.equal(hooks.length, 1);
  assert.deepEqual(Object.keys(hooks[0]).sort(), ["created_at", "deliveries", "id", "url"]);
  assert.ok(!JSON.stringify(hooks).includes(data.secret));
});

test("SSRF: non-https, local names and private, loopback, link-local, CGNAT or unique-local addresses are refused", async () => {
  dnsTable = {
    ...dnsTable,
    "internal.example": ["10.1.2.3"],
    "mixed.example": ["93.184.216.34", "192.168.1.10"],
    "v6-local.example": ["fd00::1"],
    "mapped.example": ["::ffff:127.0.0.1"],
    "meta.example": ["169.254.169.254"],
  };
  const refused = [
    "http://shop.example/hooks", "ftp://shop.example/", "not a url", "https://user:pw@shop.example/",
    "https://localhost/hook", "https://LOCALHOST./hook", "https://api.localhost/hook", "https://printer.local/hook",
    "https://127.0.0.1/hook", "https://2130706433/hook", "https://0.0.0.0/", "https://[::1]/hook", "https://[::]/",
    "https://10.0.0.1/", "https://172.16.5.4/", "https://172.31.255.255/", "https://192.168.0.1/", "https://169.254.169.254/latest",
    "https://100.64.0.1/", "https://100.127.255.255/", "https://[fc00::1]/", "https://[fe80::1]/", "https://[::ffff:10.0.0.1]/",
    "https://internal.example/", "https://mixed.example/", "https://v6-local.example/", "https://mapped.example/", "https://meta.example/",
    "https://nxdomain.example/",
  ];
  for (const url of refused) {
    const res = await hook(url);
    assert.equal(res.status, 400, url);
    assert.equal(typeof (await res.json()).error, "string");
  }
  for (const url of ["https://172.32.0.1/", "https://100.128.0.1/", "https://other.example/x"]) assert.equal((await hook(url)).status, 201, url);
  assert.equal(calls.length, 0, "creating an endpoint sends nothing");
});

test("at most 5 endpoints per merchant", async () => {
  for (let i = 0; i < 5; i++) await newHook(`https://shop.example/h${i}`);
  assert.equal((await hook("https://shop.example/h5")).status, 409);
  await newHook("https://shop.example/h5", OTHER_MERCHANT);
});

test("enqueueEvent: one signed delivery per endpoint of that merchant, same body everywhere", async () => {
  const a = await newHook("https://shop.example/a");
  const b = await newHook("https://other.example/b");
  await newHook("https://shop.example/theirs", OTHER_MERCHANT);
  const now = Date.now();
  await enqueueEvent(MERCHANT, "payment.succeeded", { session_id: "ses_1", amount: "22.5" }, now);
  assert.deepEqual(calls.map((c) => c.url).sort(), ["https://other.example/b", "https://shop.example/a"]);
  const secrets = { "https://shop.example/a": a.secret, "https://other.example/b": b.secret };
  for (const { url, init } of calls) {
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual", "redirects are never followed");
    assert.ok(init.signal instanceof AbortSignal, "a timeout signal is set");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.ok(verify(secrets[url], headers.get("MC-Signature"), init.body), "signature verifies with an independent HMAC");
    assert.ok(!verify(secrets[url === "https://shop.example/a" ? "https://other.example/b" : "https://shop.example/a"], headers.get("MC-Signature"), init.body));
    const event = JSON.parse(init.body);
    assert.match(event.id, /^evt_/);
    assert.equal(event.type, "payment.succeeded");
    assert.equal(event.created, Math.floor(now / 1000));
    assert.deepEqual(event.data, { session_id: "ses_1", amount: "22.5" });
  }
  assert.equal(calls[0].init.body, calls[1].init.body, "one event, one body");
  const hooks = await listHooks();
  for (const h of hooks) {
    assert.equal(h.deliveries.length, 1);
    const d = h.deliveries[0];
    assert.deepEqual({ event: d.event, status: d.status, attempts: d.attempts, next_attempt_at: d.next_attempt_at, response_status: d.response_status }, { event: "payment.succeeded", status: "succeeded", attempts: 1, next_attempt_at: null, response_status: 200 });
    assert.match(d.id, /^dlv_/);
    assert.ok(!Number.isNaN(Date.parse(d.at)));
  }
  assert.equal((await listHooks(OTHER_MERCHANT))[0].deliveries.length, 0);
});

test("a merchant without endpoints gets no deliveries", async () => {
  await enqueueEvent(MERCHANT, "payment.refunded", { session_id: "ses_1" });
  assert.equal(calls.length, 0);
});

test("retries at 1 m, 5 m and 30 m, then failed after the 4th attempt; same body, fresh signature each time", async () => {
  const h = await newHook();
  reply = async () => new Response("nope", { status: 500 });
  const t0 = Date.now();
  await enqueueEvent(MERCHANT, "payment.succeeded", { n: 1 }, t0);
  const state = async () => (await listHooks())[0].deliveries[0];
  let d = await state();
  assert.deepEqual([d.status, d.attempts, d.response_status, d.next_attempt_at], ["pending", 1, 500, new Date(t0 + MIN).toISOString()]);

  await dispatchDue(t0 + MIN - 1);
  assert.equal(calls.length, 1, "not due yet");
  await dispatchDue(t0 + MIN);
  d = await state();
  assert.deepEqual([d.status, d.attempts, d.next_attempt_at], ["pending", 2, new Date(t0 + MIN + 5 * MIN).toISOString()]);

  const t2 = t0 + 6 * MIN;
  reply = async () => { throw new TypeError("fetch failed"); }; // network error / timeout
  await dispatchDue(t2);
  d = await state();
  assert.deepEqual([d.status, d.attempts, d.response_status, d.next_attempt_at], ["pending", 3, null, new Date(t2 + 30 * MIN).toISOString()]);

  reply = async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } });
  await dispatchDue(t2 + 30 * MIN);
  d = await state();
  assert.deepEqual([d.status, d.attempts, d.response_status, d.next_attempt_at], ["failed", 4, 302, null], "a redirect is a failure");
  await dispatchDue(t2 + 999 * MIN);
  assert.equal(calls.length, 4, "a failed delivery is not retried");
  assert.equal(new Set(calls.map((c) => c.init.body)).size, 1, "the same body on every attempt");
  const ts = calls.map((c) => /^t=(\d+)/.exec(new Headers(c.init.headers).get("MC-Signature"))[1]);
  assert.equal(new Set(ts).size, 4, "re-signed with a fresh t");
  assert.ok(calls.every((c) => verify(h.secret, new Headers(c.init.headers).get("MC-Signature"), c.init.body)));
});

test("a retry that succeeds marks the delivery succeeded", async () => {
  await newHook();
  reply = async () => new Response("", { status: 503 });
  const t0 = Date.now();
  await enqueueEvent(MERCHANT, "payment.succeeded", {}, t0);
  reply = async () => new Response(null, { status: 204 });
  await dispatchDue(t0 + MIN);
  const d = (await listHooks())[0].deliveries[0];
  assert.deepEqual([d.status, d.attempts, d.response_status, d.next_attempt_at], ["succeeded", 2, 204, null]);
});

test("each attempt re-checks DNS: a host that now resolves to a private address gets nothing", async () => {
  await newHook("https://shop.example/hooks");
  dnsTable["shop.example"] = ["127.0.0.1"];
  const t0 = Date.now();
  await enqueueEvent(MERCHANT, "payment.succeeded", {}, t0);
  assert.equal(calls.length, 0);
  const d = (await listHooks())[0].deliveries[0];
  assert.deepEqual([d.status, d.attempts, d.response_status], ["pending", 1, null]);
});

test("dispatch needs the cron secret: 503 unset, 401 wrong or missing", async () => {
  const call = (headers) => dispatch(req("POST", "/api/v1/webhooks/dispatch", { headers }));
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
  assert.equal((await call({ authorization: `Bearer ${process.env.CRON_SECRET}x` })).status, 401);
  assert.equal((await call({ authorization: process.env.CRON_SECRET })).status, 401, "Bearer is required");
  const okRes = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` });
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), { processed: 0 });
  assert.equal((await dispatchGet(req("GET", "/api/v1/webhooks/dispatch", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))).status, 200, "Vercel Cron calls GET");
  delete process.env.CRON_SECRET;
  assert.equal((await call({ authorization: "Bearer " })).status, 503);
});

test("dispatch processes due deliveries", async () => {
  await newHook();
  reply = async () => new Response("", { status: 500 });
  await enqueueEvent(MERCHANT, "payment.succeeded", {}, Date.now() - 2 * MIN);
  reply = async () => new Response("", { status: 200 });
  const res = await dispatch(req("POST", "/api/v1/webhooks/dispatch", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  assert.deepEqual(await res.json(), { processed: 1 });
  assert.equal((await listHooks())[0].deliveries[0].status, "succeeded");
});

test("test send goes to that endpoint only, as a payment.succeeded with data {test: true}", async () => {
  const a = await newHook("https://shop.example/a");
  await newHook("https://shop.example/b");
  const res = await sendTest(req("POST", `/api/v1/webhooks/${a.id}/test`, { headers: signedIn() }), params({ id: a.id }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://shop.example/a");
  const event = JSON.parse(calls[0].init.body);
  assert.equal(event.type, "payment.succeeded");
  assert.deepEqual(event.data, { test: true });
  const other = await sendTest(req("POST", `/api/v1/webhooks/${a.id}/test`, { headers: signedIn(OTHER_MERCHANT) }), params({ id: a.id }));
  assert.equal(other.status, 404);
});

test("replay re-sends one delivery now, owner only", async () => {
  await newHook();
  reply = async () => new Response("", { status: 500 });
  await enqueueEvent(MERCHANT, "payment.refunded", { amount: "1" });
  const id = (await listHooks())[0].deliveries[0].id;
  const other = await replay(req("POST", `/api/v1/webhooks/deliveries/${id}/replay`, { headers: signedIn(OTHER_MERCHANT) }), params({ id }));
  assert.equal(other.status, 404);
  assert.equal(calls.length, 1);
  reply = async () => new Response("", { status: 200 });
  const res = await replay(req("POST", `/api/v1/webhooks/deliveries/${id}/replay`, { headers: signedIn() }), params({ id }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual([d.id, d.status, d.attempts, d.response_status], [id, "succeeded", 2, 200]);
  assert.equal(calls[0].init.body, calls[1].init.body, "the same event body");
});

test("the list keeps the last 20 deliveries per endpoint, newest first", async () => {
  await newHook();
  for (let i = 0; i < 22; i++) await enqueueEvent(MERCHANT, "payment.succeeded", { i }, Date.now() + i);
  const deliveries = (await listHooks())[0].deliveries;
  assert.equal(deliveries.length, 20);
  assert.ok(Date.parse(deliveries[0].at) > Date.parse(deliveries[19].at));
});

test("delete: owner only, then the endpoint gets nothing", async () => {
  const h = await newHook();
  assert.equal((await remove(req("DELETE", `/api/v1/webhooks/${h.id}`, { headers: signedIn(OTHER_MERCHANT) }), params({ id: h.id }))).status, 404);
  const res = await remove(req("DELETE", `/api/v1/webhooks/${h.id}`, { headers: signedIn() }), params({ id: h.id }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: h.id, deleted: true });
  assert.equal((await remove(req("DELETE", `/api/v1/webhooks/${h.id}`, { headers: signedIn() }), params({ id: h.id }))).status, 404);
  await enqueueEvent(MERCHANT, "payment.succeeded", {});
  assert.equal(calls.length, 0);
  assert.deepEqual(await listHooks(), []);
});

test("secrets never reach the logs", async () => {
  const logged = [];
  const spies = ["log", "error", "warn", "info"].map((m) => mock.method(console, m, (...args) => logged.push(args.map(String).join(" "))));
  try {
    const h = await newHook();
    reply = async () => { throw new Error("connect ECONNREFUSED"); };
    await enqueueEvent(MERCHANT, "payment.succeeded", {});
    assert.ok(logged.every((l) => !l.includes(h.secret)));
  } finally {
    for (const s of spies) s.mock.restore();
  }
});

test("batch 008: a shop's setup script registers and lists webhooks with its secret key (AT-14); publishable and revoked keys can't", async () => {
  const { createKey, revokeKey } = await import("../lib/server/keys.ts");
  const sk = await createKey(MERCHANT, "shop server", "sk");
  const pk = await createKey(MERCHANT, "pay button", "pk");
  const bearer = (key) => ({ authorization: `Bearer ${key}` });
  const res = await create(req("POST", "/api/v1/webhooks", { body: { url: "https://shop.example/hooks" }, headers: bearer(sk.key) }));
  assert.equal(res.status, 201);
  assert.match((await res.json()).secret, /^whsec_/);
  const viaKey = await (await list(req("GET", "/api/v1/webhooks", { headers: bearer(sk.key) }))).json();
  assert.equal(viaKey.webhooks.length, 1);
  assert.equal((await listHooks(MERCHANT)).length, 1, "the same merchant as the dashboard sees");
  assert.equal((await listHooks(OTHER_MERCHANT)).length, 0);
  assert.equal((await create(req("POST", "/api/v1/webhooks", { body: { url: "https://shop.example/x" }, headers: bearer(pk.key) }))).status, 401, "a publishable key can't");
  assert.equal((await list(req("GET", "/api/v1/webhooks", { headers: bearer("sk_test_" + "A".repeat(32)) }))).status, 401, "an unknown key can't");
  await revokeKey(MERCHANT, sk.record.id);
  assert.equal((await list(req("GET", "/api/v1/webhooks", { headers: bearer(sk.key) }))).status, 401, "a revoked key can't");
});

test("batch 021 (F2): a given event id is used as is, so a re-enqueue of the same event carries the same id", async () => {
  await newHook();
  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "ses_1" }, Date.now(), "evt_stable_for_ses_1_00000");
  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "ses_1" }, Date.now(), "evt_stable_for_ses_1_00000"); // the retry
  const ids = calls.map((c) => JSON.parse(c.init.body).id);
  assert.deepEqual(ids, ["evt_stable_for_ses_1_00000", "evt_stable_for_ses_1_00000"], "the receiver can dedupe the second");
  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "ses_2" });
  assert.match(JSON.parse(calls.at(-1).init.body).id, /^evt_/, "no id given: a fresh one");
});

test("batch 021: deliveredEvents tells a delivered test event from a delivered real payment, per merchant", async () => {
  const { deliveredEvents, sendTestEvent, TIMEOUT_MS } = await import("../lib/server/webhooks.ts");
  assert.equal(TIMEOUT_MS, 5_000);
  const h = await newHook();
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: false, payment: false });
  reply = async () => new Response("nope", { status: 500 });
  await sendTestEvent(MERCHANT, h.id);
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: false, payment: false }, "a 500 isn't 'answered'");
  reply = async () => new Response("ok", { status: 200 });
  await sendTestEvent(MERCHANT, h.id);
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: true, payment: false });
  await enqueueEvent(MERCHANT, "payment.succeeded", { id: "ses_real", amount: "25.00" });
  assert.deepEqual(await deliveredEvents(MERCHANT), { test: true, payment: true });
  assert.deepEqual(await deliveredEvents(OTHER_MERCHANT), { test: false, payment: false }, "scoped to the merchant");
});
