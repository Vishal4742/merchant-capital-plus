// Batch 058 phase C (FR-MCP-1..3; SRS-CHANGE FR-MCP-19/20 proposed): the dashboard routes behind the consent page and the
// Disconnect button. The merchant is always the signed-in session's, never anything in the request; every state change needs
// the session AND a CSRF token bound to that merchant and that request. Real SQL on PGlite. Run: npm test
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const SECRET = "mcp-internal-test-secret-0123456789abcdef";
process.env.MCP_INTERNAL_SECRET = SECRET;
process.env.WHITEFLOW_MCP_PUBLIC_URL = "https://mcp.example/mcp";

const { signConsentRequest, csrfToken, approveGrant, listGrants } = await import("../lib/server/mcp-grants.ts");
const { POST: consentRoute } = await import("../app/api/mcp/consent/route.ts");
const { POST: revokeRoute } = await import("../app/api/mcp/grants/[id]/revoke/route.ts");
const { query } = await import("../lib/server/db.ts");

before(async () => {
  await setupDb();
});

const NOW = Date.now();
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const REQUEST = { clientId: "client_1", redirectUri: REDIRECT, codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", scopes: ["account:read", "links:read", "links:write"], state: "abc", resource: "https://mcp.example/mcp" };
const token = () => signConsentRequest(REQUEST, SECRET, Date.now());

beforeEach(async () => {
  await resetDb();
  await query("INSERT INTO app_mcp_clients (client_id, metadata, created_at) VALUES ('client_1', $1::jsonb, $2)", [JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }), NOW]);
});

const consent = (body, headers = signedIn()) => consentRoute(req("POST", "/api/mcp/consent", { body, headers: { ...headers, "content-type": "application/json" } }));
const good = (t = token(), over = {}) => ({ request: t, csrf: csrfToken(MERCHANT, t, SECRET), decision: "approve", scopes: ["account:read", "links:read"], ...over });
const grantCount = async () => (await query("SELECT count(*)::int AS n FROM app_mcp_grants"))[0].n;

test("no session is 401 and creates nothing", async () => {
  const res = await consent(good(), {});
  assert.equal(res.status, 401);
  assert.equal(await grantCount(), 0);
});

test("a missing, wrong or another merchant's CSRF token is 403 and creates nothing", async () => {
  const t = token();
  for (const csrf of [undefined, "nope", csrfToken(OTHER_MERCHANT, t, SECRET), csrfToken(MERCHANT, "another-request", SECRET)]) {
    assert.equal((await consent({ ...good(t), csrf })).status, 403, String(csrf));
  }
  assert.equal(await grantCount(), 0);
});

test("approve returns the client's callback with a code, and the grant belongs to the SESSION's merchant whatever the body says", async () => {
  const res = await consent({ ...good(), merchant: OTHER_MERCHANT, owner: OTHER_MERCHANT });
  assert.equal(res.status, 200);
  const { redirect } = await res.json();
  const url = new URL(redirect);
  assert.equal(`${url.origin}${url.pathname}`, REDIRECT);
  assert.ok(url.searchParams.get("code"));
  assert.equal(url.searchParams.get("state"), "abc");
  assert.equal(url.searchParams.get("iss"), "https://mcp.example");
  const [grant] = await listGrants(MERCHANT);
  assert.deepEqual(grant.scopes, ["account:read", "links:read"], "exactly what was ticked, so links:write stays off");
  assert.equal((await listGrants(OTHER_MERCHANT)).length, 0);
});

test("links:write is granted only when ticked", async () => {
  await consent(good(token(), { scopes: ["account:read", "links:read", "links:write"] }));
  assert.deepEqual((await listGrants(MERCHANT))[0].scopes, ["account:read", "links:read", "links:write"]);
});

test("deny returns access_denied to the client and creates nothing", async () => {
  const res = await consent(good(token(), { decision: "deny" }));
  assert.equal(res.status, 200);
  const url = new URL((await res.json()).redirect);
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("code"), null);
  assert.equal(await grantCount(), 0);
});

test("a scope that wasn't requested, an empty approval, a forged or expired request, and a missing secret are all refused", async () => {
  assert.equal((await consent(good(token(), { scopes: ["account:read", "reports:read"] }))).status, 400, "reports:read wasn't requested");
  assert.equal((await consent(good(token(), { scopes: [] }))).status, 400);
  const forged = `${token().slice(0, -3)}abc`;
  assert.equal((await consent({ request: forged, csrf: csrfToken(MERCHANT, forged, SECRET), decision: "approve", scopes: ["account:read"] })).status, 400);
  const stale = signConsentRequest(REQUEST, SECRET, Date.now() - 11 * 60_000);
  assert.equal((await consent({ request: stale, csrf: csrfToken(MERCHANT, stale, SECRET), decision: "approve", scopes: ["account:read"] })).status, 400);
  assert.equal(await grantCount(), 0);
  delete process.env.MCP_INTERNAL_SECRET;
  try {
    assert.equal((await consent(good())).status, 503);
  } finally {
    process.env.MCP_INTERNAL_SECRET = SECRET;
  }
});

test("a form-encoded cross-site-style post is refused: the route only takes JSON", async () => {
  const t = token();
  const res = await consentRoute(req("POST", "/api/mcp/consent", { body: `request=${encodeURIComponent(t)}`, headers: { ...signedIn(), "content-type": "application/x-www-form-urlencoded" } }));
  assert.ok([400, 415].includes(res.status));
  assert.equal(await grantCount(), 0);
});

// ── Disconnect ──
const grantFor = async (merchant) => (await approveGrant({ owner: merchant, merchant, request: REQUEST, approved: ["account:read"], issuer: "https://mcp.example", now: NOW })).grantId;
const revoke = (id, body, headers = signedIn()) => revokeRoute(req("POST", `/api/mcp/grants/${id}/revoke`, { body, headers: { ...headers, "content-type": "application/json" } }), { params: Promise.resolve({ id }) });

test("Disconnect needs the session and a CSRF token for that grant; another merchant's grant is 404", async () => {
  const id = await grantFor(MERCHANT);
  assert.equal((await revoke(id, { csrf: csrfToken(MERCHANT, id, SECRET) }, {})).status, 401);
  assert.equal((await revoke(id, {})).status, 403);
  assert.equal((await revoke(id, { csrf: csrfToken(OTHER_MERCHANT, id, SECRET) })).status, 403);
  const theirs = await grantFor(OTHER_MERCHANT);
  assert.equal((await revoke(theirs, { csrf: csrfToken(MERCHANT, theirs, SECRET) })).status, 404, "never reveals or touches another merchant's grant");
  assert.equal((await query("SELECT revoked_at FROM app_mcp_grants WHERE id = $1", [id]))[0].revoked_at, null);
  assert.equal((await revoke(id, { csrf: csrfToken(MERCHANT, id, SECRET) })).status, 200);
  assert.notEqual((await query("SELECT revoked_at FROM app_mcp_grants WHERE id = $1", [id]))[0].revoked_at, null);
  assert.equal((await query("SELECT revoked_at FROM app_mcp_grants WHERE id = $1", [theirs]))[0].revoked_at, null);
});
