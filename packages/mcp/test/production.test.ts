// Batch 052 round 2: the production review's connector findings, as regression tests (written RED first).
// F2: an unresolved write keeps its operation identity across time, restart, many entries and key rotation, and is
//     never silently re-created; F3: a write's success is checked against the request (amount, currency, URL origin,
//     shape) before the tool calls it a success. Offline. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, NOW, TESTNET_KEY, connect, fakeFetch, tempDir, type Call } from "./helpers.ts";

const ENV = { WHITEFLOW_MODE: "testnet", WHITEFLOW_API_KEY: TESTNET_KEY, WHITEFLOW_BASE_URL: BASE, WHITEFLOW_TIMEZONE: "Asia/Kolkata" };
const ROTATED = ["sk", "test", "ZyXwVuTsRqPoNmLkJiHgFeDcBa987654"].join("_");
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
const link = (over: Record<string, unknown> = {}) => ({ id: "lnk_AbCdEfGhIjKlMnOp", slug: "Ab3dE6gH9k", url: "/l/Ab3dE6gH9k", amount: "10", currency: "USDT", description: "Coffee", reference_id: null, single_use: true, status: "active", expires_at: null, created_at: "2026-11-06T12:00:00.000Z", payments: 0, ...over });
const ASK = { amount: "10", currency: "USDT", description: "Coffee" };

function gateway(post: (call: Call) => { status: number; body: unknown; headers?: Record<string, string> } | Error) {
  return fakeFetch((call) => {
    const { pathname } = new URL(call.url);
    if (call.method === "GET" && pathname === "/api/v1/account") return { status: 200, body: ACCOUNT };
    if (call.method === "POST" && pathname === "/api/v1/links") return post(call);
    return { status: 404, body: "<html>404</html>" };
  });
}
const postKeys = (calls: Call[]) => calls.filter((c) => c.method === "POST").map((c) => c.headers.get("idempotency-key"));
const lost = () => new DOMException("The operation timed out.", "TimeoutError");

test("F2: an unknown outcome is still resumed with the same key 16 minutes and 23 hours later", async () => {
  const stateDir = tempDir();
  let clock = NOW, up = false;
  const { calls, fetch } = gateway(() => (up ? { status: 201, body: link(), headers: { "idempotent-replayed": "true" } } : lost()));
  const first = await connect(ENV, { fetch, stateDir, now: () => clock });
  assert.equal((await first.call("create_payment_link", ASK)).json.outcome, "unknown");
  for (const later of [16 * 60_000, 23 * 3_600_000]) {
    clock = NOW + later;
    up = true;
    const again = await connect(ENV, { fetch, stateDir, now: () => clock });
    const r = await again.call("create_payment_link", ASK);
    assert.equal(r.isError, false, r.text);
    up = false;
  }
  assert.equal(new Set(postKeys(calls)).size, 1, "one operation identity throughout");
});

test("F2: past the server's 24-hour retention an unresolved write is reported, not silently re-created", async () => {
  const stateDir = tempDir();
  let clock = NOW;
  const { calls, fetch } = gateway(() => lost());
  const first = await connect(ENV, { fetch, stateDir, now: () => clock });
  await first.call("create_payment_link", ASK);
  const sent = postKeys(calls).length;
  clock = NOW + 25 * 3_600_000;
  const later = await connect(ENV, { fetch, stateDir, now: () => clock });
  const r = await later.call("create_payment_link", ASK);
  assert.equal(r.isError, true);
  assert.equal(r.json.outcome, "needs_reconciliation");
  assert.equal(postKeys(calls).length, sent, "nothing new was sent");
  // the merchant can see it, and can deliberately create a new one once they've checked
  const status = await later.call("get_operation_status", {});
  assert.equal(status.json.unresolved.length, 1);
  assert.equal(status.json.unresolved[0].state, "needs_reconciliation");
});

test("F2: more than 500 settled entries never evict an unresolved one", async () => {
  const stateDir = tempDir();
  let n = 0, up = false;
  const { calls, fetch } = gateway((call) => (up || n++ > 0 ? { status: 201, body: link({ description: JSON.parse(call.body!).description }) } : lost()));
  const { call } = await connect(ENV, { fetch, stateDir });
  await call("create_payment_link", ASK); // unresolved
  for (let i = 0; i < 520; i++) await call("create_payment_link", { ...ASK, description: `Order ${i}` });
  up = true;
  await call("create_payment_link", ASK);
  assert.equal(postKeys(calls).at(-1), postKeys(calls)[0], "the first, unresolved operation is resumed");
});

test("F2: a rotated key for the same merchant resumes the operation; create_another starts a new one", async () => {
  const stateDir = tempDir();
  let up = false;
  const { calls, fetch } = gateway(() => (up ? { status: 201, body: link() } : lost()));
  await (await connect(ENV, { fetch, stateDir })).call("create_payment_link", ASK);
  up = true;
  const rotated = await connect({ ...ENV, WHITEFLOW_API_KEY: ROTATED }, { fetch, stateDir });
  await rotated.call("create_payment_link", ASK);
  assert.equal(postKeys(calls).at(-1), postKeys(calls)[0]);
  await rotated.call("create_payment_link", { ...ASK, create_another: true });
  assert.notEqual(postKeys(calls).at(-1), postKeys(calls)[0]);
});

test("F3: a reply for a different amount, currency or URL origin is never reported as a success", async () => {
  for (const wrong of [{ amount: "999" }, { currency: "EUR" }, { url: "https://unrelated.example/collect" }, { description: "Something else" }, { single_use: false }]) {
    const { fetch } = gateway(() => ({ status: 201, body: link(wrong) }));
    const { call } = await connect(ENV, { fetch, stateDir: tempDir() });
    const r = await call("create_payment_link", ASK);
    assert.equal(r.isError, true, JSON.stringify(wrong));
    assert.equal(r.json.outcome, "needs_reconciliation", JSON.stringify(wrong));
    assert.match(r.json.error, /doesn't match what was asked|not on a trusted WhiteFlow origin/);
    assert.ok(!/Send .* to the customer/.test(r.text), "no share instruction");
  }
});

test("F3: a malformed or oversized 2xx keeps the write unresolved, and the retry uses the same key", async () => {
  for (const reply of [{ status: 201, body: { id: 42 } }, { status: 201, body: { ...link(), description: "x".repeat(2_000_000) } }]) {
    let n = 0;
    const { calls, fetch } = gateway(() => (n++ === 0 ? reply : { status: 201, body: link(), headers: { "idempotent-replayed": "true" } }));
    const { call } = await connect(ENV, { fetch, stateDir: tempDir() });
    const first = await call("create_payment_link", ASK);
    assert.equal(first.isError, true);
    assert.equal(first.json.outcome, "unknown");
    const second = await call("create_payment_link", ASK);
    assert.equal(second.isError, false, second.text);
    assert.equal(new Set(postKeys(calls)).size, 1);
  }
});
