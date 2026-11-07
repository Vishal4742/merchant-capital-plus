// Batch 058 phase B/C (FR-MCP-1..3, FR-GW-6; SRS-CHANGE FR-MCP-18/19 proposed): the gateway side of the hosted MCP
// connection. The MCP service calls the gateway with a short-lived signed assertion naming a grant and a merchant; the
// gateway trusts nothing in it except the signature and re-reads the grant (merchant, scopes, expiry, revocation) from
// the database on every request. Real SQL on PGlite. Run: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, req, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const SECRET = "mcp-internal-test-secret-0123456789abcdef";
process.env.MCP_INTERNAL_SECRET = SECRET;
process.env.MERCHANT_PAY_ADDRESS = "0xab817593253a0a37de723072827d88fe0ca54251";
process.env.RELAYER_URL = "https://relayer.test";

const { signInternal, verifyInternal, internalScope } = await import("../lib/server/mcp-principal.ts");
const { GET: accountRoute } = await import("../app/api/v1/account/route.ts");
const { POST: createLinkRoute } = await import("../app/api/v1/links/route.ts");
const { GET: getLinkRoute } = await import("../app/api/v1/links/[id]/route.ts");
const { GET: paymentsRoute } = await import("../app/api/v1/payments/route.ts");
const { GET: reportsRoute } = await import("../app/api/v1/reports/route.ts");
const { GET: operationRoute } = await import("../app/api/v1/operations/[key]/route.ts");
const { createKey } = await import("../lib/server/keys.ts");
const { query } = await import("../lib/server/db.ts");

before(async () => {
  await setupDb();
});

const NOW = Date.now();
const ALL = "account:read links:read payments:read reports:read links:write";

async function grant({ id = "grant_1", merchant = MERCHANT, scopes = ALL, expiresAt = NOW + 3_600_000, revokedAt = null } = {}) {
  await query("INSERT INTO app_mcp_clients (client_id, metadata, created_at) VALUES ('client_1', '{}'::jsonb, $1) ON CONFLICT DO NOTHING", [NOW]);
  await query(
    "INSERT INTO app_mcp_grants (id, owner, merchant, client_id, scopes, resource, created_at, expires_at, revoked_at) VALUES ($1, $2, $3, 'client_1', $4, 'https://mcp.example/mcp', $5, $6, $7)",
    [id, merchant.toLowerCase(), merchant.toLowerCase(), scopes, NOW, expiresAt, revokedAt],
  );
  return id;
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const token = (grantId = "grant_1", merchant = MERCHANT) => signInternal({ merchant, grantId }, SECRET);

beforeEach(async () => {
  await resetDb();
  mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("module=logs")) return Response.json({ message: "No logs found", status: "0", result: [] });
    throw new Error(`unexpected fetch ${String(url)}`);
  });
});

test("an assertion verifies for its merchant and grant, and nothing else about it is trusted", () => {
  const t = token();
  const got = verifyInternal(t, SECRET);
  assert.equal(got.merchant.toLowerCase(), MERCHANT.toLowerCase());
  assert.equal(got.grantId, "grant_1");
  assert.ok(t.length < 1000, "fits the client's credential limit");
});

test("tampered, forged, expired, wrong-secret and wrong-audience assertions are refused", () => {
  const t = token();
  const [prefix, payload, mac] = t.split(".");
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), m: OTHER_MERCHANT.toLowerCase() })).toString("base64url");
  assert.equal(verifyInternal(`${prefix}.${edited}.${mac}`, SECRET), null, "edited merchant");
  assert.equal(verifyInternal(t, "another-secret-another-secret-0123456789"), null, "wrong secret");
  assert.equal(verifyInternal(`${t}x`, SECRET), null, "extra bytes");
  assert.equal(verifyInternal("wfi1.garbage", SECRET), null);
  assert.equal(verifyInternal("", SECRET), null);
  assert.equal(verifyInternal(t, SECRET, NOW + 10 * 60_000), null, "expired (5 minutes)");
  assert.equal(verifyInternal(signInternal({ merchant: MERCHANT, grantId: "grant_1" }, SECRET, NOW, "some-other-service"), SECRET), null, "wrong audience");
});

test("every assertion is unique (a jti), so one can be logged and still never reused as an identity", () => {
  assert.notEqual(token(), token());
});

test("the scope each gateway path needs", () => {
  assert.equal(internalScope("GET", "/api/v1/account"), "any");
  assert.equal(internalScope("GET", "/api/v1/links/lnk_abc"), "links:read");
  assert.equal(internalScope("POST", "/api/v1/links"), "links:write");
  assert.equal(internalScope("GET", "/api/v1/payments"), "payments:read");
  assert.equal(internalScope("GET", "/api/v1/reports"), "reports:read");
  assert.equal(internalScope("GET", "/api/v1/operations/some-key"), "links:read");
  // everything else is closed to an assistant: keys, webhooks, invoices, settlements, withdrawals, pages, vouchers
  for (const [m, p] of [["GET", "/api/v1/keys"], ["POST", "/api/v1/keys"], ["POST", "/api/v1/webhooks"], ["POST", "/api/v1/invoices"], ["GET", "/api/v1/settlements"], ["POST", "/api/v1/pages"], ["POST", "/api/v1/sessions"], ["DELETE", "/api/v1/links/lnk_abc"], ["POST", "/api/v1/links/lnk_abc"]]) {
    assert.equal(internalScope(m, p), null, `${m} ${p}`);
  }
});

test("a live grant reads the account; the credential type says mcp_grant and the merchant comes from the grant", async () => {
  await grant();
  const res = await accountRoute(req("GET", "/api/v1/account", { headers: bearer(token()) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.merchant.address.toLowerCase(), MERCHANT.toLowerCase());
  assert.equal(body.credential.type, "mcp_grant");
});

test("a revoked grant is 401 on the very next request", async () => {
  await grant();
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(token()) }))).status, 200);
  await query("UPDATE app_mcp_grants SET revoked_at = $1 WHERE id = 'grant_1'", [Date.now()]);
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(token()) }))).status, 401);
});

test("an expired grant, an unknown grant and a merchant that isn't the grant's are all 401", async () => {
  await grant({ id: "expired", expiresAt: NOW - 1 });
  await grant({ id: "grant_1" });
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(token("expired")) }))).status, 401);
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(token("no-such-grant")) }))).status, 401);
  // a validly signed assertion naming another merchant for this grant
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(token("grant_1", OTHER_MERCHANT)) }))).status, 401);
});

test("scope is enforced from the grant's row: reading is allowed, creating needs links:write", async () => {
  await grant({ scopes: "account:read links:read payments:read reports:read" });
  const t = token();
  assert.equal((await paymentsRoute(req("GET", "/api/v1/payments", { headers: bearer(t) }))).status === 403, false, "payments:read is granted");
  assert.equal((await reportsRoute(req("GET", "/api/v1/reports?from=2026-11-01&to=2026-11-02&tz=Asia/Kolkata", { headers: bearer(t) }))).status === 403, false);
  const create = await createLinkRoute(req("POST", "/api/v1/links", { body: { amount: "25", currency: "USDT", description: "Beans" }, headers: { ...bearer(t), "idempotency-key": "order-0001-aaaa" } }));
  assert.equal(create.status, 403);
  assert.match((await create.json()).error, /links:write/);
  assert.equal((await query("SELECT count(*)::int AS n FROM app_gw_links"))[0].n, 0, "nothing was created");
});

test("with links:write a grant creates a link for ITS merchant only, and another merchant's link can't be read", async () => {
  await grant({ id: "grant_1", merchant: MERCHANT });
  await grant({ id: "grant_2", merchant: OTHER_MERCHANT });
  const made = await createLinkRoute(req("POST", "/api/v1/links", { body: { amount: "25", currency: "USDT", description: "Beans" }, headers: { ...bearer(token("grant_1")), "idempotency-key": "order-0002-aaaa" } }));
  assert.equal(made.status, 201);
  const link = await made.json();
  assert.equal((await query("SELECT merchant FROM app_gw_links WHERE id = $1", [link.id]))[0].merchant, MERCHANT.toLowerCase());
  const own = await getLinkRoute(req("GET", `/api/v1/links/${link.id}`, { headers: bearer(token("grant_1")) }), { params: Promise.resolve({ id: link.id }) });
  assert.equal(own.status, 200);
  const foreign = await getLinkRoute(req("GET", `/api/v1/links/${link.id}`, { headers: bearer(token("grant_2", OTHER_MERCHANT)) }), { params: Promise.resolve({ id: link.id }) });
  assert.equal(foreign.status, 404, "another merchant's grant never sees it");
});

test("an assistant's grant can't use routes it isn't meant for", async () => {
  await grant();
  const t = token();
  const { GET: listKeys } = await import("../app/api/v1/keys/route.ts");
  assert.ok([401, 403].includes((await listKeys(req("GET", "/api/v1/keys", { headers: bearer(t) }))).status));
});

test("an operation lookup needs links:read and is tenant scoped", async () => {
  await grant({ scopes: "account:read" });
  const res = await operationRoute(req("GET", "/api/v1/operations/order-0001-aaaa", { headers: bearer(token()) }), { params: Promise.resolve({ key: "order-0001-aaaa" }) });
  assert.equal(res.status, 403);
});

test("without MCP_INTERNAL_SECRET configured, assertions are refused (fail closed)", async () => {
  await grant();
  const t = token();
  delete process.env.MCP_INTERNAL_SECRET;
  try {
    assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(t) }))).status, 401);
  } finally {
    process.env.MCP_INTERNAL_SECRET = SECRET;
  }
});

test("a secret API key still works exactly as before", async () => {
  const { key } = await createKey(MERCHANT, "mcp", "sk");
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(key) }))).status, 200);
});

test("payments and reports each need their own scope: a grant without them is 403", async () => {
  await grant({ scopes: "account:read links:read" });
  const t = token();
  assert.equal((await paymentsRoute(req("GET", "/api/v1/payments", { headers: bearer(t) }))).status, 403);
  assert.equal((await reportsRoute(req("GET", "/api/v1/reports?from=2026-11-01&to=2026-11-02&tz=Asia/Kolkata", { headers: bearer(t) }))).status, 403);
});
