// Batch 052 round 2: the production review's connector findings, as regression tests (F2/F3 written RED first; F4 with the
// human's Owner-approval decision).
// F2: an unresolved write keeps its operation identity across time, restart, many entries and key rotation, and is
//     never silently re-created; F3: a write's success is checked against the request (amount, currency, URL origin,
//     shape) before the tool calls it a success. Offline. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { change } from "../src/sandbox/store.ts";
import { BASE, NOW, TESTNET_KEY, approveAs, connect, fakeFetch, sandbox, tempDir, type Call } from "./helpers.ts";

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
  // 16 minutes later (a restart in between): still no answer, still the same operation
  clock = NOW + 16 * 60_000;
  const second = await connect(ENV, { fetch, stateDir, now: () => clock });
  assert.equal((await second.call("create_payment_link", ASK)).json.outcome, "unknown");
  // 23 hours after the first attempt, still inside the server's retention: the same key settles it
  clock = NOW + 23 * 3_600_000;
  up = true;
  const third = await connect(ENV, { fetch, stateDir, now: () => clock });
  const r = await third.call("create_payment_link", ASK);
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json.replayed, true);
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
    assert.match(r.json.error, /doesn't match what was asked|not on a trusted Whiteflow origin/);
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

// ---- F4: publication is the Owner's decision, bound to one exact revision, consumed once ---------------------------

const LINES = [{ description: "Consulting session", quantity: 3, unit_price: "20.00" }];
async function draftFor(call: Awaited<ReturnType<typeof sandbox>>["call"]) {
  const customer = (await call("create_customer", { name: "Priya Sharma", email: "priya@example.com" })).json.customer.id;
  return (await call("create_invoice_draft", { customer_id: customer, currency: "USDT", line_items: LINES, due_date: "2026-11-13" })).json.invoice;
}

test("F4: finalize only requests publication; no tool can approve; the Owner's approval publishes that exact version once", async () => {
  const { call, client, stateDir } = await sandbox();
  const draft = await draftFor(call);
  const requested = await call("finalize_invoice", { invoice: draft.id });
  assert.equal(requested.json.invoice.number, null);
  assert.equal((await call("get_invoice", { invoice: draft.id })).json.invoice.status, "draft (awaiting Owner approval)");
  // asking again (even with "the merchant said yes") returns the same pending request, never a publication
  const again = await call("finalize_invoice", { invoice: draft.id, idempotency_key: "merchant-said-yes-confirmed" });
  assert.equal(again.json.approval.id, requested.json.approval.id);
  assert.equal(again.json.invoice.number, null);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(!tools.some((n) => /approve|confirm|publish_now|decide/.test(n)), tools.join(","));
  for (const t of (await client.listTools()).tools) {
    // (create_customer's confirm_new is a duplicate-customer answer, not an approval: it publishes nothing)
    assert.ok(!Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).some((p) => /^(confirmed|approved?|approval\w*|owner_ok)$/i.test(p)), `${t.name} takes an approval-like argument`);
  }
  assert.equal(approveAs(stateDir, requested.json.approval.id).code, 0);
  assert.equal((await call("get_invoice", { invoice: draft.id })).json.invoice.number, "WF-1001");
  assert.throws(() => approveAs(stateDir, requested.json.approval.id), /approved; it can't be decided \(again\)/);
});

test("F4: editing the draft cancels the pending approval; the old approval can't publish the new version", async () => {
  const { call, stateDir } = await sandbox();
  const draft = await draftFor(call);
  const requested = await call("finalize_invoice", { invoice: draft.id });
  const edited = await call("update_invoice_draft", { invoice: draft.id, line_items: [{ description: "Consulting session", quantity: 4, unit_price: "20.00" }] });
  assert.equal(edited.isError, false, edited.text);
  assert.equal(edited.json.invoice.revision, 2);
  assert.equal(edited.json.invoice.total, "80.00");
  assert.match(edited.json.summary, /pending approval request for the old version was cancelled/);
  assert.throws(() => approveAs(stateDir, requested.json.approval.id), /superseded/);
  assert.equal((await call("get_invoice", { invoice: draft.id })).json.invoice.status, "draft");
  // a fresh request binds revision 2 and its 80.00
  const second = await call("finalize_invoice", { invoice: draft.id });
  assert.deepEqual([second.json.approval.revision, second.json.approval.total], [2, "80.00"]);
  assert.equal(approveAs(stateDir, second.json.approval.id).code, 0);
  assert.equal((await call("get_invoice", { invoice: draft.id })).json.invoice.total, "80.00");
  // a published invoice can't be edited
  assert.match((await call("update_invoice_draft", { invoice: draft.id, memo: "late change" })).json.error, /only a draft can be edited/);
});

test("F4: an expired or rejected request can't publish, and a total that doesn't add up blocks the request", async () => {
  let clock = NOW;
  const { call, stateDir } = await sandbox({ now: () => clock });
  const draft = await draftFor(call);
  const requested = await call("finalize_invoice", { invoice: draft.id });
  clock = NOW + 49 * 3_600_000;
  assert.throws(() => approveAs(stateDir, requested.json.approval.id, "approve", () => clock), /expired/);
  const rejected = await call("finalize_invoice", { invoice: draft.id, idempotency_key: "second-request-key" });
  assert.notEqual(rejected.json.approval.id, requested.json.approval.id);
  assert.equal(approveAs(stateDir, rejected.json.approval.id, "reject").code, 0);
  assert.equal((await call("get_invoice", { invoice: draft.id })).json.invoice.status, "draft");
  // corrupt the stored total: the connector's own arithmetic refuses to ask for publication
  change(stateDir, (s) => ({ next: { ...s, invoices: s.invoices.map((i) => ({ ...i, total: "61000000" })) }, result: undefined }));
  const blocked = await call("finalize_invoice", { invoice: draft.id, idempotency_key: "third-request-key" });
  assert.equal(blocked.isError, true);
  assert.match(blocked.json.error, /doesn't match its own line items/);
});

test("operations: a settled write is visible by key in the sandbox; an unknown key is refused", async () => {
  const { call } = await sandbox();
  const link = await call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "beans-order-0001" });
  assert.equal(link.isError, false, link.text);
  const status = await call("get_operation_status", { idempotency_key: "beans-order-0001" });
  assert.equal(status.json.operation.state, "done");
  assert.equal(status.json.operation.whiteflow_record.state, "succeeded");
  assert.equal(status.json.operation.whiteflow_record.record_id, link.json.link.id);
  assert.deepEqual((await call("get_operation_status", {})).json.unresolved, []);
  assert.equal((await call("get_operation_status", { idempotency_key: "no-such-key-0001" })).isError, true);
});

test("round-2 probe: a write reply the connector can't verify is flagged for reconciliation, never re-sent under a new key", async () => {
  // a backend that offers invoices and answers with a schema-valid draft whose discount the connector can't read back
  const account = { ...ACCOUNT, capabilities: { ...ACCOUNT.capabilities, customers: true, invoices: true } };
  const reply = {
    id: "inv_test0001", number: null, status: "draft", revision: 1, overdue: false, customer: { id: "cus_test0001", name: "Priya" }, currency: "USDT",
    line_items: [{ description: "x", quantity: 1, unit_price: "10.00", amount: "10.00" }], subtotal: "10.00", discount: { type: "percent", percent: "abc", amount: "1.00" }, tax: null,
    total: "9.00", amount_paid: "0.00", amount_due: "9.00", overpaid: "0.00", due_date: "2026-11-13", timezone: "Asia/Kolkata", memo: null, hosted_url: null, pdf_url: null,
    created_at: "2026-11-06T12:00:00.000Z", finalized_at: null, paid_at: null, approval: null, payments: [],
  };
  const { calls, fetch } = fakeFetch((call) => {
    const { pathname } = new URL(call.url);
    if (pathname === "/api/v1/account") return { status: 200, body: account };
    if (call.method === "POST" && pathname === "/api/v1/invoices") return { status: 201, body: reply };
    return { status: 404, body: "<html>404</html>" };
  });
  const { call } = await connect(ENV, { fetch, stateDir: tempDir() });
  const ask = { customer_id: "cus_test0001", currency: "USDT", line_items: [{ description: "x", quantity: 1, unit_price: "10.00" }], due_date: "2026-11-13", discount: { type: "percent", percent: "10" } };
  const first = await call("create_invoice_draft", ask);
  assert.equal(first.isError, true);
  assert.equal(first.json.outcome, "needs_reconciliation", first.text);
  const second = await call("create_invoice_draft", ask);
  assert.equal(second.json.outcome, "needs_reconciliation");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1, "not re-sent under a fresh key");
});

test("round-2 probe: the sandbox operation lookup finds a key that contains ':' and '.'", async () => {
  const { call } = await sandbox();
  const link = await call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "order:2026.11:a1" });
  assert.equal(link.isError, false, link.text);
  const status = await call("get_operation_status", { idempotency_key: "order:2026.11:a1" });
  assert.equal(status.json.operation.whiteflow_record.state, "succeeded", status.text);
  assert.equal(status.json.operation.whiteflow_record.record_id, link.json.link.id);
});
