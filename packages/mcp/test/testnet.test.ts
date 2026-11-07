// Testnet mode against a scripted gateway that answers with the live shapes (apps/web: GET /api/v1/account, POST and
// GET /api/v1/links, GET /api/v1/payments, GET /api/v1/reports; batch 052). Checks the Bearer key, the Idempotency-Key
// on every write and on its retries, timeout recovery without duplicates, error mapping, and that tools the testnet
// backend can't serve refuse without calling it. Offline. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.ts";
import { BASE, NOW, TESTNET_KEY, connect, fakeFetch, tempDir, type Call } from "./helpers.ts";

const ENV = { WHITEFLOW_MODE: "testnet", WHITEFLOW_API_KEY: TESTNET_KEY, WHITEFLOW_BASE_URL: BASE, WHITEFLOW_TIMEZONE: "Asia/Kolkata" };
const ACCOUNT = {
  merchant: { address: "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1", name: "Bandra Beans" },
  environment: "test",
  network: { name: "Whitechain Testnet", chain_id: 1874, explorer: "https://explorer.testnet.whitechain.io" },
  settlement: { asset: "USDT", token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", decimals: 6 },
  price_currencies: ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"],
  payment_limits: { currency: "USDT", min: "1.00", max: "1000.00" },
  payment_methods: [{ id: "usdt_signature", label: "USDT on Whitechain Testnet" }],
  timezone: null,
  credential: { type: "secret_key", key_id: "key_abc", scopes: null, expires_at: null },
  capabilities: { links: true, payments: true, reports: true, customers: false, invoices: false, reminders: false },
};
const LINK = { id: "lnk_AbCdEfGhIjKlMnOp", slug: "Ab3dE6gH9k", url: "/l/Ab3dE6gH9k", amount: "15000", currency: "INR", description: "Acme website redesign", reference_id: null, single_use: true, status: "active", expires_at: null, created_at: "2026-11-06T12:00:00.000Z", payments: 0 };
const TX = `0x${"ab".repeat(32)}`;

/** A gateway: /account and the given routes; anything else is Next's HTML 404. */
function gateway(routes: Record<string, (call: Call) => { status: number; body: unknown; headers?: Record<string, string> } | Error> = {}) {
  return fakeFetch((call) => {
    const { pathname } = new URL(call.url);
    const route = routes[`${call.method} ${pathname}`];
    if (route) return route(call);
    if (call.method === "GET" && pathname === "/api/v1/account") return { status: 200, body: ACCOUNT };
    return { status: 404, body: "<!DOCTYPE html><html>404: This page could not be found.</html>" };
  });
}

test("profile: testnet label, the business time zone falls back to WHITEFLOW_TIMEZONE, no scopes on testnet keys", async () => {
  const { calls, fetch } = gateway();
  const { call } = await connect(ENV, { fetch });
  const p = await call("get_business_profile");
  assert.equal(p.json.environment, "testnet");
  assert.match(p.json.environment_note, /TESTNET.*Not real money/);
  assert.deepEqual(p.json.timezone, { zone: "Asia/Kolkata", source: "connector setting (WHITEFLOW_TIMEZONE)", today: "Friday 2026-11-06 (Asia/Kolkata)" });
  assert.match(p.json.permissions, /no scopes yet/);
  assert.deepEqual(p.json.invoice_currencies, []);
  assert.equal(calls[0].headers.get("authorization"), `Bearer ${TESTNET_KEY}`);
  assert.ok(!p.text.includes(TESTNET_KEY));
});

test("create_payment_link posts the live shape with the key and an Idempotency-Key, and returns the absolute URL", async () => {
  const { calls, fetch } = gateway({ "POST /api/v1/links": () => ({ status: 201, body: LINK }) });
  const { call } = await connect(ENV, { fetch });
  const r = await call("create_payment_link", { amount: "15,000", currency: "INR", description: "Acme website redesign" });
  assert.equal(r.isError, false, r.text);
  const post = calls.find((c) => c.method === "POST")!;
  assert.deepEqual(JSON.parse(post.body!), { amount: "15000.00", currency: "INR", description: "Acme website redesign", single_use: true });
  assert.match(post.headers.get("idempotency-key")!, /^wfmcp_[0-9a-f-]{36}$/);
  assert.equal(r.json.link.url, `${BASE}/l/Ab3dE6gH9k`);
  assert.equal(r.json.link.amount_display, "₹15,000.00");
  assert.equal(r.json.delivered, false);
});

test("a lost reply is retried with the same Idempotency-Key, so the gateway can replay instead of duplicating", async () => {
  let n = 0;
  const { calls, fetch } = gateway({ "POST /api/v1/links": () => (++n === 1 ? new TypeError("fetch failed") : { status: 201, body: LINK, headers: { "idempotent-replayed": "true" } }) });
  const { call } = await connect(ENV, { fetch });
  const r = await call("create_payment_link", { amount: "15000", currency: "INR", description: "Acme website redesign" });
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers.get("idempotency-key"), posts[1].headers.get("idempotency-key"));
  assert.equal(r.json.replayed, true);
});

test("timeout with an unknown outcome: the tool says it's safe to retry, and the retry (no key given) reuses the same key", async () => {
  const stateDir = tempDir();
  let up = false;
  const { calls, fetch } = gateway({ "POST /api/v1/links": () => (up ? { status: 201, body: LINK, headers: { "idempotent-replayed": "true" } } : new DOMException("The operation timed out.", "TimeoutError")) });
  const first = await connect(ENV, { fetch, stateDir });
  const lost = await first.call("create_payment_link", { amount: "15000", currency: "INR", description: "Acme website redesign" });
  assert.equal(lost.isError, true);
  assert.equal(lost.json.outcome, "unknown");
  assert.match(lost.json.error, /didn't answer in time.*resumes this operation .* until 2026-11-07T12:00:00\.000Z, while WhiteFlow can still replay it/);
  assert.equal(lost.json.resumable_until, '2026-11-07T12:00:00.000Z');
  const key = lost.json.idempotency_key;
  assert.equal(calls.filter((c) => c.method === "POST").length, 3); // the first try and two retries, one key
  assert.ok(calls.filter((c) => c.method === "POST").every((c) => c.headers.get("idempotency-key") === key));
  // the client restarts (a new server, same state dir); the model retries the same request without a key
  up = true;
  const second = await connect(ENV, { fetch, stateDir });
  const recovered = await second.call("create_payment_link", { amount: "15000", currency: "INR", description: "Acme website redesign" });
  assert.equal(recovered.isError, false, recovered.text);
  assert.equal(calls.at(-1)!.headers.get("idempotency-key"), key);
  assert.match(recovered.json.note, /resumed that unresolved attempt/);
});

test("a lost reply then 429s, or a 'still being processed' 409, stays ambiguous: the next call reuses the key (review 052 M1)", async () => {
  for (const after of [{ status: 429, body: { error: "Too many requests. Wait a minute and try again." } }, { status: 409, body: { error: "A request with this Idempotency-Key is still being processed. Try again in a moment." } }]) {
    const stateDir = tempDir();
    let n = 0, up = false;
    const { calls, fetch } = gateway({ "POST /api/v1/links": () => (up ? { status: 201, body: LINK, headers: { "idempotent-replayed": "true" } } : ++n === 1 ? new TypeError("fetch failed") : after) });
    const { call } = await connect(ENV, { fetch, stateDir });
    const lost = await call("create_payment_link", { amount: "15000", currency: "INR", description: "Acme website redesign" });
    assert.equal(lost.isError, true);
    assert.equal(lost.json.outcome, "unknown", `${after.status}: ${lost.text}`);
    up = true;
    await call("create_payment_link", { amount: "15000", currency: "INR", description: "Acme website redesign" });
    const keys = new Set(calls.filter((c) => c.method === "POST").map((c) => c.headers.get("idempotency-key")));
    assert.equal(keys.size, 1, `${after.status}: one key across every attempt and the retry`);
  }
});

test("a definite refusal frees the journal: a corrected request gets a fresh key", async () => {
  let n = 0;
  const { calls, fetch } = gateway({ "POST /api/v1/links": () => (++n === 1 ? { status: 409, body: { error: "You already have a link with that reference_id." } } : { status: 201, body: LINK }) });
  const { call } = await connect(ENV, { fetch });
  const refused = await call("create_payment_link", { amount: "10", currency: "USDT", description: "x", reference: "A-1" });
  assert.equal(refused.isError, true);
  assert.match(refused.json.error, /already have a link with that reference_id/);
  await call("create_payment_link", { amount: "10", currency: "USDT", description: "x", reference: "A-1" });
  const keys = calls.filter((c) => c.method === "POST").map((c) => c.headers.get("idempotency-key"));
  assert.notEqual(keys[0], keys[1]);
});

test("401 and 403 become plain reasons that never contain the key", async () => {
  const { fetch } = fakeFetch(() => ({ status: 401, body: { error: `bad key ${TESTNET_KEY}` } }));
  const { call } = await connect(ENV, { fetch });
  const r = await call("get_business_profile");
  assert.match(r.json.error, /missing, revoked or expired.*Developers screen/);
  assert.ok(!r.text.includes(TESTNET_KEY));
  const forbidden = fakeFetch(() => ({ status: 403, body: { error: `A publishable key can't do this (${TESTNET_KEY})` } }));
  const f = await connect(ENV, { fetch: forbidden.fetch });
  const denied = await f.call("get_business_profile");
  assert.match(denied.json.error, /publishable key/);
  assert.ok(!denied.text.includes(TESTNET_KEY));
});

test("customers, invoices and reminders refuse plainly on testnet, without calling routes the backend doesn't have", async () => {
  const { calls, fetch } = gateway();
  const { call } = await connect(ENV, { fetch });
  for (const [tool, args] of [
    ["search_customers", { query: "Acme" }],
    ["create_customer", { name: "Acme" }],
    ["create_invoice_draft", { customer_id: "cus_x", currency: "USDT", line_items: [{ description: "x", quantity: 1, unit_price: "5" }], due_date: "2026-11-13" }],
    ["finalize_invoice", { invoice: "WF-1001" }],
    ["get_invoice", { invoice: "WF-1001" }],
    ["list_invoices", {}],
    ["prepare_invoice_reminder", { invoice: "WF-1001" }],
  ] as const) {
    const r = await call(tool, args);
    assert.equal(r.isError, true, tool);
    assert.match(r.json.error, /isn't available on the WhiteFlow testnet backend yet/, tool);
    assert.match(r.json.next_action, /create_payment_link/);
  }
  assert.ok(calls.every((c) => new URL(c.url).pathname === "/api/v1/account"));
});

test("list_payments and get_payment_link: verified records with explorer links; the summary is in the business zone", async () => {
  const { calls, fetch } = gateway({
    "GET /api/v1/payments": () => ({ status: 200, body: { data: [{ paymentId: "42", sessionId: "ses_1", invoiceId: null, amount: "180.00", refunded: "0.00", txHash: TX, paidAt: "2026-11-06T10:00:00.000Z", reference: "ACME-WEB" }], next: null } }),
    "GET /api/v1/links/lnk_AbCdEfGhIjKlMnOp": () => ({ status: 200, body: { ...LINK, status: "paid", payments: 1, paid_checkouts: [{ session_id: "ses_1", payment_id: "42", amount: "180", currency: "USDT", tx_hash: TX, paid_at: "2026-11-06T10:00:00.000Z" }] } }),
    "GET /api/v1/reports": () => ({ status: 200, body: { from: "2026-11-02", to: "2026-11-06", tz: "Asia/Kolkata", days: [{ date: "2026-11-06", gross: "180", fees: "0.1", net: "179.9", refunds: "0", count: 1 }], totals: { gross: "180", fees: "0.1", net: "179.9", refunds: "0", count: 1 }, kpis: {} } }),
  });
  const { call } = await connect(ENV, { fetch });
  const list = await call("list_payments", {});
  assert.equal(list.json.payments[0].evidence, `https://explorer.testnet.whitechain.io/tx/${TX}`);
  assert.equal(list.json.payments[0].status, "confirmed");
  const link = await call("get_payment_link", { link_id: LINK.id });
  assert.equal(link.json.paid, true);
  assert.equal(link.json.payments[0].amount, "180.00");
  const summary = await call("get_collection_summary", { period: "this_week" });
  const reportCall = calls.find((c) => c.url.includes("/api/v1/reports"))!;
  assert.deepEqual(Object.fromEntries(new URL(reportCall.url).searchParams), { from: "2026-11-02", to: "2026-11-06", tz: "Asia/Kolkata" });
  assert.deepEqual(summary.json.collected.USDT, { gross: "180.00 USDT", fees: "0.10 USDT", refunds: "0.00 USDT", net: "179.90 USDT", payments: 1 });
  assert.equal(summary.json.receivables_now, null);
  assert.match(summary.json.receivables_note, /need invoices/);
  assert.equal((await call("get_payment_link", { link_id: "../../etc/passwd" })).isError, true);
});

test('ids "." and ".." are refused before any fetch: they would be another same-origin path, sent with the key', async () => {
  const { calls, fetch } = gateway();
  const { call } = await connect(ENV, { fetch });
  for (const id of [".", ".."]) {
    for (const [tool, args] of [
      ["get_payment_link", { link_id: id }],
      ["get_invoice", { invoice: id }],
      ["finalize_invoice", { invoice: id }],
      ["prepare_invoice_reminder", { invoice: id }],
    ] as const) {
      const r = await call(tool, args);
      assert.equal(r.isError, true, `${tool} ${id}`);
      assert.match(r.text, /letters, digits, _ or -/, `${tool} ${id}`);
    }
  }
  assert.deepEqual(calls, []);
});

test("a dashboard link priced finer than its currency's minor unit (10.555 INR) is shown as stored, not rounded or refused", async () => {
  const { fetch } = gateway({ "GET /api/v1/links/lnk_AbCdEfGhIjKlMnOp": () => ({ status: 200, body: { ...LINK, amount: "10.555", paid_checkouts: [] } }) });
  const { call } = await connect(ENV, { fetch });
  const r = await call("get_payment_link", { link_id: LINK.id });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json.link.amount, "10.555");
  assert.equal(r.json.link.amount_display, "10.555 INR");
});

test("startup refuses bad settings without repeating the key; sandbox is the default mode", () => {
  const make = (env: Record<string, string>) => () => createServer({ env, stateDir: tempDir(), now: () => NOW });
  assert.throws(make({ WHITEFLOW_MODE: "testnet" }), /needs WHITEFLOW_API_KEY/);
  const pk = ["pk", "test", "AbCdEfGhIjKlMnOpQrStUvWxYz012345"].join("_");
  assert.throws(make({ WHITEFLOW_MODE: "testnet", WHITEFLOW_API_KEY: pk }), (e: Error) => /publishable/.test(e.message) && !e.message.includes(pk));
  assert.throws(make({ ...ENV, WHITEFLOW_BASE_URL: "http://gateway.test" }), /https/);
  assert.throws(make({ ...ENV, WHITEFLOW_BASE_URL: "https://user:pw@gateway.test" }), /https origin/);
  assert.throws(make({ WHITEFLOW_MODE: "live" }), /sandbox.*testnet/);
  assert.throws(make({ WHITEFLOW_TIMEZONE: "Mars/Olympus" }), /IANA/);
  assert.throws(make({ WHITEFLOW_API_KEY: TESTNET_KEY }), (e: Error) => /WHITEFLOW_MODE=testnet/.test(e.message) && !e.message.includes(TESTNET_KEY));
  assert.doesNotThrow(make({}));
});

test("the old MCP_SECRET_KEY alone stops startup, naming WHITEFLOW_API_KEY, instead of silently starting the sandbox", () => {
  const make = (env: Record<string, string>) => () => createServer({ env, stateDir: tempDir(), now: () => NOW });
  for (const env of [{ MCP_SECRET_KEY: TESTNET_KEY }, { MCP_SECRET_KEY: TESTNET_KEY, WHITEFLOW_MODE: "testnet" }] as Record<string, string>[]) {
    assert.throws(make(env), (e: Error) => /WHITEFLOW_API_KEY/.test(e.message) && !e.message.includes(TESTNET_KEY));
  }
  assert.doesNotThrow(make({ ...ENV, MCP_SECRET_KEY: TESTNET_KEY }));
});
