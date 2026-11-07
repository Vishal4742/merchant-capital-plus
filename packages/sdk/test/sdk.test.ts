// claude-sdk checks for packages/sdk (FR-GW-5, FR-PAY-4, FR-GW-7, FR-GW-11 guard). Run from packages/sdk: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Gateway, GatewayError, WebhookSignatureError, constructEvent, signWebhook, SIGNATURE_HEADER } from "../index.ts";

const BASE = "https://gateway.test";
const KEY = "test-shop-key-0123456789abcdef";
const SECRET = "whsec-test-0123456789abcdef";

type Call = { url: string; init: RequestInit };
/** A fetch that answers each call with the next reply; an Error reply is thrown like a network failure. */
function fakeFetch(...replies: ({ status: number; body: unknown } | Error)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    if (reply instanceof Error) throw reply;
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}
const ok = (body: unknown, status = 200) => ({ status, body });
const gw = (fetch: typeof globalThis.fetch, opts: { maxRetries?: number; baseUrl?: string } = {}) =>
  new Gateway(KEY, { baseUrl: BASE, fetch, ...opts });

test("sessions.create posts the checkout with the secret key and returns the hosted URL (FR-PAY-4)", async () => {
  const reply = { id: "abc123", url: `${BASE}/checkout/abc123`, amount: "25.00", currency: "USDT", expiresAt: "2026-11-06T03:30:00.000Z" };
  const { calls, fetch } = fakeFetch(ok(reply, 201));
  const items = [{ name: "Flat white", qty: 1, price: "25.00" }];

  const session = await gw(fetch).sessions.create({ amount: "25.00", orderId: "order-42", items, returnUrl: "https://shop.test/" }, { idempotencyKey: "k-1" });

  assert.deepEqual(session, reply);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/api/v1/sessions`);
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${KEY}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("idempotency-key"), "k-1");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { amount: "25.00", reference: "order-42", items, returnUrl: "https://shop.test/" });
});

test("sessions.create sends a number amount as a string and leaves out fields that weren't given", async () => {
  const { calls, fetch } = fakeFetch(ok({ id: "x", url: "u", amount: "25.00", currency: "USDT", expiresAt: "t" }, 201));
  await gw(fetch, { baseUrl: `${BASE}/` }).sessions.create({ amount: 25 });
  assert.equal(calls[0].url, `${BASE}/api/v1/sessions`);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { amount: "25" });
  // no key given: the SDK makes one, so a retry can't create a second checkout (audit 7 Nov, D LOW)
  assert.match(new Headers(calls[0].init.headers).get("idempotency-key") ?? "", /^[0-9a-f-]{36}$/);
});

test("without an idempotencyKey, every retry of one create reuses the same generated key", async () => {
  const flaky = fakeFetch(ok({ error: "busy" }, 503), ok({ id: "x", url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  await gw(flaky.fetch).sessions.create({ amount: "1.00" });
  const keys = flaky.calls.map((c) => new Headers(c.init.headers).get("idempotency-key"));
  assert.equal(keys.length, 2);
  assert.ok(keys[0] && keys[0] === keys[1]);
  const other = fakeFetch(ok({ id: "y", url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  await gw(other.fetch).sessions.create({ amount: "1.00" });
  assert.notEqual(new Headers(other.calls[0].init.headers).get("idempotency-key"), keys[0]); // a new create, a new key
});

test("a non-USDT price is refused if the gateway doesn't echo the currency, so 25 EUR is never charged as 25 USDT (FR-GW-11)", async () => {
  const old = fakeFetch(ok({ id: "x", url: "u", amount: "25.00", expiresAt: "t" }, 201));
  await assert.rejects(gw(old.fetch).sessions.create({ amount: "25.00", currency: "EUR" }), (err: unknown) => err instanceof GatewayError && /EUR/.test(err.message));
  assert.equal(JSON.parse(String(old.calls[0].init.body)).currency, "EUR");

  const priced = { id: "x", url: "u", amount: "27.012345", currency: "EUR", priced: { currency: "EUR", amount: "25.00", rate: "1.0805", rateAt: "2026-11-06T02:00:00Z", source: "ecb" }, expiresAt: "t" };
  assert.deepEqual(await gw(fakeFetch(ok(priced, 201)).fetch).sessions.create({ amount: "25.00", currency: "EUR" }), priced);
});

test("sessions.retrieve reads the session by id, and refuses anything that isn't an id", async () => {
  const id = "70359474-3587-4bc8-8eca-80eb35d5cbdc";
  const reply = { id, status: "paid", amount: "25.00", currency: "USDT", reference: "order-42", paymentId: "7", txHash: "0xabc" };
  const { calls, fetch } = fakeFetch(ok(reply));
  assert.deepEqual(await gw(fetch).sessions.retrieve(id), reply);
  assert.equal(calls[0].url, `${BASE}/api/v1/sessions/${id}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  for (const bad of ["", "..", "a/b", "x?y", "a".repeat(65)]) {
    await assert.rejects(gw(fetch).sessions.retrieve(bad), (err: unknown) => err instanceof GatewayError && err.status === 400);
  }
  assert.equal(calls.length, 1); // none of them reached the network
});

test("sameAmount compares money, not formatting (round 2 H2: '1,000.00' from the API vs '1000.00' from a webhook)", async () => {
  const { sameAmount } = await import("../index.ts");
  for (const [a, b] of [["1,000.00", "1000.00"], ["25", "25.00"], ["27.012345", "27.012345"], ["0.10", "0.1"], [" 25.00", "25.000000"]]) assert.ok(sameAmount(a, b), `${a} = ${b}`);
  for (const [a, b] of [["1000.00", "100.00"], ["25.00", "25.01"], ["0.000001", "0"], ["", ""], ["abc", "abc"], ["1e3", "1000"], ["-1", "-1"], ["1.0000001", "1.0000001"]]) assert.ok(!sameAmount(a, b), `${a} != ${b}`);
  // commas only as thousands separators (audit 7 Nov LOW-4): a decimal comma is refused, never read as thousands
  for (const [a, b] of [["10,00", "1000"], ["1,0,0,0", "1000"], ["1,00", "100"], ["1.000,00", "1"], ["1,000,0", "10000"], [",100", "100"]]) assert.ok(!sameAmount(a, b), `${a} != ${b}`);
  for (const [a, b] of [["12,345,678.50", "12345678.5"], ["999", "999.000000"], ["1,000", "1000.00"]]) assert.ok(sameAmount(a, b), `${a} = ${b}`);
});

test("a bare ? or # on baseUrl doesn't drop the path prefix", async () => {
  for (const baseUrl of ["https://example.test/gw?", "https://example.test/gw#", "https://example.test/gw/"]) {
    const { calls, fetch } = fakeFetch(ok({ id: "x", status: "open" }));
    await gw(fetch, { baseUrl }).sessions.retrieve("abc");
    assert.equal(calls[0].url, "https://example.test/gw/api/v1/sessions/abc", baseUrl);
  }
});

test("the currency-mismatch error is scrubbed of the key too", async () => {
  const { fetch } = fakeFetch(ok({ id: `x-${KEY}`, url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  await assert.rejects(gw(fetch).sessions.create({ amount: "1.00", currency: "EUR" }), (err: unknown) => err instanceof GatewayError && !err.message.includes(KEY));
});

test("requests refuse redirects and keep a path prefix in baseUrl", async () => {
  const { calls, fetch } = fakeFetch(ok({ id: "x", url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  await gw(fetch, { baseUrl: "https://example.test/gateway" }).sessions.create({ amount: "1.00" });
  assert.equal(calls[0].url, "https://example.test/gateway/api/v1/sessions");
  assert.equal(calls[0].init.redirect, "error");
});

test("an orderId the server would cut or trim is refused before any request", async () => {
  const { calls, fetch } = fakeFetch(ok({ id: "x", url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  for (const bad of ["", " order-1", "order-1 ", "o".repeat(41)]) {
    await assert.rejects(gw(fetch).sessions.create({ amount: "1.00", orderId: bad }), (err: unknown) => err instanceof GatewayError && /orderId/.test(err.message));
  }
  assert.equal(calls.length, 0);
  await gw(fetch).sessions.create({ amount: "1.00", orderId: "o".repeat(40) });
  assert.equal(calls.length, 1);
});

test("the currency guard checks the returned quote in both directions", async () => {
  const reply = (extra: object) => fakeFetch(ok({ id: "x", url: "u", amount: "27.00", currency: "EUR", expiresAt: "t", ...extra }, 201)).fetch;
  // a top-level currency without a quote is not proof that EUR was priced
  await assert.rejects(gw(reply({})).sessions.create({ amount: "25.00", currency: "EUR" }), GatewayError);
  // asked for USDT, got an EUR quote back
  const eurQuote = { priced: { currency: "EUR", amount: "25.00", rate: "1.08", rateAt: "t", source: "ecb" } };
  await assert.rejects(gw(reply(eurQuote)).sessions.create({ amount: "25.00" }), (err: unknown) => err instanceof GatewayError && /USDT/.test(err.message));
  assert.equal((await gw(reply(eurQuote)).sessions.create({ amount: "25.00", currency: "EUR" })).priced?.currency, "EUR");
});

test("a fetch error that quotes the key never puts the key in GatewayError's message", async () => {
  const { fetch } = fakeFetch(new TypeError(`Headers.append: "Bearer ${KEY}" is an invalid header value.`));
  await assert.rejects(gw(fetch, { maxRetries: 0 }).sessions.retrieve("abc"), (err: unknown) => {
    assert.ok(err instanceof GatewayError);
    assert.ok(!err.message.includes(KEY), err.message);
    assert.match(err.message, /\[secret key\]/);
    return true;
  });
});

test("payments.list pages through GET /api/v1/payments (FR-GW-5)", async () => {
  const page = { data: [{ paymentId: "7", sessionId: "abc123", invoiceId: null, amount: "25.00", refunded: "0.00", txHash: "0xabc", paidAt: "t", reference: "order-42" }], next: "c2" };
  const { calls, fetch } = fakeFetch(ok(page), ok({ data: [], next: null }));
  const gateway = gw(fetch);
  assert.deepEqual(await gateway.payments.list({ limit: 10, cursor: "c1" }), page);
  assert.equal(calls[0].url, `${BASE}/api/v1/payments?limit=10&cursor=c1`);
  await gateway.payments.list();
  assert.equal(calls[1].url, `${BASE}/api/v1/payments`);
});

test("a 4xx throws GatewayError with the status and the server's message, and is not retried", async () => {
  const { calls, fetch } = fakeFetch(ok({ error: "Missing or wrong API key." }, 401));
  await assert.rejects(gw(fetch).sessions.retrieve("abc"), (err: unknown) => {
    assert.ok(err instanceof GatewayError);
    assert.equal(err.status, 401);
    assert.match(err.message, /^Missing or wrong API key\. Check GATEWAY_SECRET_KEY and that baseUrl is the right gateway\.$/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a server error message that echoes the key is scrubbed too", async () => {
  const { fetch } = fakeFetch(ok({ error: `Bad header: Bearer ${KEY}` }, 400));
  await assert.rejects(gw(fetch).sessions.retrieve("abc"), (err: unknown) => err instanceof GatewayError && !err.message.includes(KEY) && /\[secret key\]/.test(err.message));
});

test("an orderId that isn't a string (from plain JS) is refused before any request", async () => {
  const { calls, fetch } = fakeFetch(ok({ id: "x", url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  await assert.rejects(gw(fetch).sessions.create({ amount: "1.00", orderId: 42 as unknown as string }), (err: unknown) => err instanceof GatewayError && /orderId/.test(err.message));
  assert.equal(calls.length, 0);
});

test("a 5xx or a network failure is retried with the same idempotency key, then reported", async () => {
  const flaky = fakeFetch(ok({ error: "busy" }, 503), new TypeError("fetch failed"), ok({ id: "x", url: "u", amount: "1.00", currency: "USDT", expiresAt: "t" }, 201));
  await gw(flaky.fetch).sessions.create({ amount: "1.00" }, { idempotencyKey: "k-2" });
  assert.equal(flaky.calls.length, 3);
  assert.deepEqual(flaky.calls.map((c) => new Headers(c.init.headers).get("idempotency-key")), ["k-2", "k-2", "k-2"]);

  const down = fakeFetch(ok({ error: "Checkout isn't set up on this server." }, 503));
  await assert.rejects(gw(down.fetch, { maxRetries: 1 }).sessions.retrieve("abc"), (err: unknown) => err instanceof GatewayError && err.status === 503);
  assert.equal(down.calls.length, 2);

  const offline = fakeFetch(new TypeError("fetch failed"));
  await assert.rejects(gw(offline.fetch, { maxRetries: 0 }).sessions.retrieve("abc"), (err: unknown) => err instanceof GatewayError && err.status === 0);
});

test("an answer that isn't JSON throws GatewayError, even with status 200", async () => {
  await assert.rejects(gw(fakeFetch(ok("<html>proxy page</html>")).fetch).sessions.retrieve("abc"), GatewayError);
  await assert.rejects(gw(fakeFetch(ok("Bad Gateway", 502)).fetch, { maxRetries: 0 }).sessions.retrieve("abc"), (err: unknown) => err instanceof GatewayError && err.status === 502);
});

test("the constructor refuses a missing key, a publishable key, a bad base URL, and running in a browser", () => {
  assert.throws(() => new Gateway("", { baseUrl: BASE }), /secret key/);
  assert.throws(() => new Gateway("pk_test_0123456789abcdef", { baseUrl: BASE }), /publishable/);
  assert.throws(() => new Gateway(KEY, { baseUrl: "" }), /baseUrl/);
  assert.throws(() => new Gateway(KEY, { baseUrl: "not a url" }), /baseUrl/);
  assert.throws(() => new Gateway(KEY, { baseUrl: "http://gateway.test" }), /https/); // the key would travel in cleartext
  assert.throws(() => new Gateway(KEY, { baseUrl: "ftp://gateway.test" }), /baseUrl/);
  for (const odd of ["https://user:pass@gateway.test", "https://user@gateway.test", "https://gateway.test/gw?x=1", "https://gateway.test/#top"]) {
    assert.throws(() => new Gateway(KEY, { baseUrl: odd }), /baseUrl/, odd); // credentials would leak into errors; a query or hash breaks the path join
  }
  assert.ok(new Gateway(KEY, { baseUrl: "http://localhost:3000" }));
  assert.ok(new Gateway(KEY, { baseUrl: "http://127.0.0.1:3000" }));
  for (const pasted of [`${KEY}\n`, `\r${KEY}`, `${KEY} `, "sk test"]) {
    assert.throws(() => new Gateway(pasted, { baseUrl: BASE }), (err: unknown) => err instanceof Error && /line breaks/.test(err.message) && !err.message.includes(KEY));
  }
  const g = globalThis as { window?: unknown };
  g.window = {};
  try {
    assert.throws(() => new Gateway(KEY, { baseUrl: BASE }), /server/);
  } finally {
    delete g.window;
  }
});

const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", created: 1, data: { id: "abc123", status: "paid", amount: "25.00", currency: "USDT", reference: "order-42", paymentId: "7", txHash: "0xabc", link_id: null, page_id: null } });
const now = () => Math.floor(Date.now() / 1000);

test("signWebhook makes the MC-Signature header and constructEvent accepts it (FR-GW-7)", () => {
  assert.equal(SIGNATURE_HEADER, "MC-Signature");
  const header = signWebhook(body, SECRET);
  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  const event = constructEvent(body, header, SECRET);
  assert.equal(event.type, "payment.succeeded");
  assert.equal(event.data.paymentId, "7");
  assert.equal(constructEvent(new TextEncoder().encode(body), header, SECRET).id, "evt_1"); // a raw Buffer body works too
  assert.equal(gw(fakeFetch().fetch).webhooks.constructEvent(body, header, SECRET).id, "evt_1");
});

test("the signature is HMAC-SHA256 of '<t>.<raw body>' in hex (the format the sender must match)", () => {
  // printf '%s' '1700000000.{}' | openssl dgst -sha256 -hmac k
  assert.equal(signWebhook("{}", "k", 1700000000), "t=1700000000,v1=c6ef4734033cee2367414a0939385eca0397754aa7a59716da7463a9298b5146");
});

test("constructEvent rejects a wrong secret, a changed body, and a missing or malformed header", () => {
  const header = signWebhook(body, SECRET);
  const bad = (fn: () => unknown, why: RegExp) => assert.throws(fn, (err: unknown) => err instanceof WebhookSignatureError && why.test(err.message));
  bad(() => constructEvent(body, header, "another-secret"), /signature/);
  bad(() => constructEvent(body.replace("25.00", "2500.00"), header, SECRET), /signature/);
  bad(() => constructEvent(body, null, SECRET), /header/);
  bad(() => constructEvent(body, "", SECRET), /header/);
  bad(() => constructEvent(body, "v1=abc", SECRET), /header/);
  bad(() => constructEvent(body, header.replace(/v1=.*/, "v1=zz"), SECRET), /header/);
  assert.throws(() => signWebhook(body, ""), /secret/);
});

// A config mistake is the shop's bug, not a bad request: a plain Error, so the handler answers 500 and the shop notices.
const configError = (why: RegExp) => (err: unknown) => err instanceof Error && !(err instanceof WebhookSignatureError) && why.test(err.message);

test("a missing webhook secret is a config error (plain Error), not a bad signature", () => {
  assert.throws(() => constructEvent(body, signWebhook(body, SECRET), ""), configError(/secret/));
});

test("a toleranceSec that is NaN, infinite or negative is refused as a config error, so the replay window can't switch off", () => {
  const old = signWebhook(body, SECRET, now() - 10 * 365 * 86400);
  for (const toleranceSec of [Number(undefined), Infinity, -1]) {
    assert.throws(() => constructEvent(body, old, SECRET, { toleranceSec }), configError(/toleranceSec/));
  }
});

test("constructEvent rejects a timestamp more than 300 s old or ahead (replay window)", () => {
  assert.throws(() => constructEvent(body, signWebhook(body, SECRET, now() - 301), SECRET), /timestamp/);
  assert.throws(() => constructEvent(body, signWebhook(body, SECRET, now() + 301), SECRET), /timestamp/);
  assert.equal(constructEvent(body, signWebhook(body, SECRET, now() - 290), SECRET).id, "evt_1");
  assert.equal(constructEvent(body, signWebhook(body, SECRET, now() - 900), SECRET, { toleranceSec: 1000 }).id, "evt_1");
});
