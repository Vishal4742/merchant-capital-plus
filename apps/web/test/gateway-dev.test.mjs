// claude-frontend checks for lib/gateway-dev.ts (FR-GW-6, FR-GW-7): the typed client for the API keys and webhooks
// routes. Shapes are parsed from snake_case, anything malformed is refused, a new key or signing secret comes back from
// create only and is never kept, and every failure is one plain sentence. fetch is faked. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayError } from "../lib/gateway-client.ts";
import { DELIVERY_LABEL, devClient, httpsProblem, keyOf, nextTryText, webhookOf } from "../lib/gateway-dev.ts";
import { previewDev } from "../lib/gateway-dev-preview.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status) => new Response("<!doctype html><title>404</title>", { status, headers: { "content-type": "text/html" } });

const KEY = "sk_test_" + "Ab3_-".repeat(6) + "Zz";
const SECRET = "whsec_" + "s".repeat(43);
const keyJson = { id: "key_1", label: "Shop server", kind: "sk", prefix: KEY.slice(0, 12), created_at: "2026-11-06T03:00:00.000Z", last_used_at: null };
const delivery = { id: "dlv_1", event: "payment.succeeded", status: "pending", attempts: 2, next_attempt_at: "2026-11-06T03:05:00.000Z", response_status: 500, at: "2026-11-06T03:00:00.000Z" };
const hook = { id: "whk_1", url: "https://shop.example/hooks", created_at: "2026-11-06T03:00:00.000Z", deliveries: [delivery] };

function fake(reply) {
  const calls = [];
  const client = devClient({ fetch: async (url, init) => (calls.push({ url: String(url), init }), reply(String(url), init)) });
  return { client, calls };
}

async function refused(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GatewayError, `a GatewayError, got ${error}`);
    return error;
  }
  assert.fail("expected the call to fail");
}

test("creates a key: POST {label, kind}, and the answer's snake_case fields are read, the key included", async () => {
  const { client, calls } = fake(() => json({ ...keyJson, key: KEY }, 201));
  const created = await client.createKey("Shop server", "sk");
  assert.equal(calls[0].url, "/api/v1/keys");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { label: "Shop server", kind: "sk" });
  assert.deepEqual(created, { ...keyJson, key: KEY });
});

test("the once-only key: never in a URL or browser storage, and a list row never carries it", async () => {
  const touched = [];
  const spy = { getItem: () => null, setItem: (k) => touched.push(k), removeItem: (k) => touched.push(k), clear: () => touched.push("*") };
  globalThis.localStorage = spy;
  globalThis.sessionStorage = spy;
  try {
    const { client, calls } = fake(() => json({ ...keyJson, key: KEY }, 201));
    await client.createKey("Shop server", "sk");
    assert.ok(calls.every((c) => !c.url.includes(KEY)), "the key is not in any URL");
    assert.deepEqual(touched, [], "nothing goes to localStorage or sessionStorage");
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
  // a list row is built from known fields only: a `key` the server shouldn't send never reaches the screen
  const row = keyOf({ ...keyJson, key: KEY });
  assert.equal("key" in row, false);
  assert.ok(!JSON.stringify(row).includes(KEY));
});

test("a create answer without a well-formed key, or a key of the other kind, is refused", async () => {
  for (const key of [undefined, "", "sk_test_short", "sk_live_" + "A".repeat(32), "pk_test_" + "A".repeat(32)]) {
    const { client } = fake(() => json({ ...keyJson, key }, 201));
    assert.equal((await refused(client.createKey("Shop server", "sk"))).status, 502, String(key));
  }
});

test("revoking DELETEs the key by id, url-encoded", async () => {
  const { client, calls } = fake(() => json({ id: "key_1/x", revoked: true }));
  await client.revokeKey("key_1/x");
  assert.equal(calls[0].url, "/api/v1/keys/key_1%2Fx");
  assert.equal(calls[0].init.method, "DELETE");
});

test("key rows: kind, prefix and times are checked", () => {
  assert.deepEqual(keyOf(keyJson), keyJson);
  assert.equal(keyOf({ ...keyJson, last_used_at: "2026-11-06T04:00:00.000Z" }).last_used_at, "2026-11-06T04:00:00.000Z");
  for (const bad of [{ kind: "live" }, { prefix: "pk_test_abcd" }, { created_at: "yesterday" }, { label: 7 }, { id: null }]) {
    assert.throws(() => keyOf({ ...keyJson, ...bad }), GatewayError, JSON.stringify(bad));
  }
});

test("webhook rows with their deliveries are read; a bad status, url or count is refused", () => {
  assert.deepEqual(webhookOf(hook), hook);
  assert.deepEqual(webhookOf({ ...hook, deliveries: [{ ...delivery, status: "succeeded", next_attempt_at: null, response_status: null }] }).deliveries[0].response_status, null);
  for (const bad of [{ url: "http://shop.example/hooks" }, { deliveries: null }, { deliveries: [{ ...delivery, status: "sent" }] }, { deliveries: [{ ...delivery, attempts: -1 }] }, { deliveries: [{ ...delivery, response_status: 99 }] }]) {
    assert.throws(() => webhookOf({ ...hook, ...bad }), GatewayError, JSON.stringify(bad));
  }
  assert.equal("secret" in webhookOf({ ...hook, secret: SECRET }), false, "a list row never carries the signing secret");
});

test("adding an endpoint returns its signing secret once; test, resend and delete hit their routes", async () => {
  const { client, calls } = fake((url, init) => {
    if (url === "/api/v1/webhooks") return json({ id: "whk_1", url: hook.url, secret: SECRET, created_at: hook.created_at }, 201);
    if (init.method === "DELETE") return json({ id: "whk_1", deleted: true });
    return json(delivery);
  });
  assert.deepEqual(await client.addWebhook(hook.url), { id: "whk_1", url: hook.url, secret: SECRET, created_at: hook.created_at });
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: hook.url });
  assert.deepEqual(await client.sendTest("whk_1"), delivery);
  assert.deepEqual(await client.resend("dlv_1"), delivery);
  await client.deleteWebhook("whk_1");
  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url}`),
    ["POST /api/v1/webhooks", "POST /api/v1/webhooks/whk_1/test", "POST /api/v1/webhooks/deliveries/dlv_1/replay", "DELETE /api/v1/webhooks/whk_1"],
  );
  assert.ok(calls.every((c) => !c.url.includes(SECRET)), "the secret is not in any URL");
  const { client: noSecret } = fake(() => json({ id: "whk_1", url: hook.url, created_at: hook.created_at }, 201));
  assert.equal((await refused(noSecret.addWebhook(hook.url))).status, 502);
});

test("failures in plain words: route missing, sign-in ended, too many tries, the gateway's own sentence, offline", async () => {
  const cases = [
    [() => html(404), 503, "API keys aren't available on this server yet."],
    [() => json({ error: "Sign in to your merchant dashboard first." }, 401), 401, "Your sign-in has ended. Sign in again."],
    [() => json({ error: "Too many requests. Wait a minute and try again." }, 429), 429, "Too many tries. Wait a minute and try again."],
    [() => json({ error: "You can have at most 20 keys. Revoke one first." }, 409), 409, "You can have at most 20 keys. Revoke one first."],
    [() => html(500), 500, "The gateway had a problem. Nothing was changed; try again in a minute."],
    [() => Promise.reject(new TypeError("fetch failed: 10.0.0.7")), 0, "We couldn't reach the gateway. Check your connection and try again."],
  ];
  for (const [reply, status, message] of cases) {
    const error = await refused(fake(reply).client.createKey("x", "sk"));
    assert.deepEqual([error.status, error.message], [status, message]);
  }
  assert.equal((await refused(fake(() => html(404)).client.addWebhook(hook.url))).message, "Webhooks aren't available on this server yet.");
});

test("the https check: full https URLs only, no credentials, said plainly", () => {
  assert.equal(httpsProblem("https://shop.example/hooks"), null);
  assert.equal(httpsProblem("  https://shop.example/hooks  "), null);
  assert.equal(httpsProblem(""), "Enter your endpoint's URL.");
  assert.equal(httpsProblem("shop.example/hooks"), "Enter the full URL, starting with https://.");
  assert.equal(httpsProblem("http://shop.example/hooks"), "Use an https:// URL. We only send events over https.");
  assert.equal(httpsProblem("https://user:pw@shop.example/hooks"), "Leave the user name and password out of the URL.");
  assert.equal(httpsProblem("https://" + "a".repeat(500) + ".example"), "That URL is too long (500 characters at most).");
});

test("delivery status → pill copy, and the next-try line", () => {
  assert.deepEqual(DELIVERY_LABEL, { pending: "Pending", succeeded: "Delivered", failed: "Failed" });
  assert.equal(nextTryText({ status: "pending", next_attempt_at: "x" }, "09:05"), "Next try 09:05");
  assert.equal(nextTryText({ status: "failed", next_attempt_at: null }, null), "No more tries");
  assert.equal(nextTryText({ status: "succeeded", next_attempt_at: null }, null), null);
});

test("preview fixtures parse, and only the demo shop has any", () => {
  const demo = previewDev("0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1", "0x37f9315edf71d9c27b0f650c59e4c96ad6a442b1");
  assert.ok(demo.keys.length > 0 && demo.webhooks.length > 0);
  demo.keys.forEach((k) => keyOf(k));
  demo.webhooks.forEach((w) => webhookOf(w));
  assert.deepEqual(new Set(demo.webhooks.flatMap((w) => w.deliveries.map((d) => d.status))), new Set(["pending", "succeeded", "failed"]));
  assert.deepEqual(previewDev("0x2222222222222222222222222222222222222222", "0x37f9315edf71d9c27b0f650c59e4c96ad6a442b1"), { keys: [], webhooks: [] });
});
