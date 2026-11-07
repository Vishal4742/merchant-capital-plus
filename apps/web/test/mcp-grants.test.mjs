// Batch 058 phase C (FR-MCP-1..3; SRS-CHANGE FR-MCP-19/20 proposed): the grant lifecycle on the web side: the signed consent
// request the MCP service hands to the dashboard, approval (grant + single-use code, bound to the SIWE merchant), denial,
// listing with honest states, and revocation. Real SQL on PGlite. Run: npm test
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, seedWorkspace, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const SECRET = "mcp-internal-test-secret-0123456789abcdef";
const { signConsentRequest, verifyConsentRequest, approveGrant, denyRedirect, listGrants, revokeGrant, grantState, GRANT_TTL_MS, CODE_TTL_MS } = await import("../lib/server/mcp-grants.ts");
const { query } = await import("../lib/server/db.ts");

before(async () => {
  await setupDb();
});

const NOW = Date.now();
const RESOURCE = "https://mcp.example/mcp";
const ISSUER = "https://mcp.example";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const REQUEST = { clientId: "client_1", redirectUri: REDIRECT, codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", scopes: ["account:read", "links:read", "links:write"], state: "st 1&x=2", resource: RESOURCE };

beforeEach(async () => {
  await resetDb();
  await query("INSERT INTO app_mcp_clients (client_id, metadata, created_at) VALUES ('client_1', $1::jsonb, $2)", [JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }), NOW]);
});

const approve = async (over = {}) => approveGrant({ ...(await seedWorkspace(over.merchant ?? MERCHANT)), owner: MERCHANT, merchant: MERCHANT, request: REQUEST, approved: ["account:read", "links:read"], issuer: ISSUER, now: NOW, ...over });

test("a consent request round-trips and any edit, expiry, wrong secret or wrong audience is refused", () => {
  const token = signConsentRequest(REQUEST, SECRET, NOW);
  assert.deepEqual(verifyConsentRequest(token, SECRET, NOW + 1000), REQUEST);
  const [p, payload, mac] = token.split(".");
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), ru: "https://evil.example/cb" })).toString("base64url");
  assert.equal(verifyConsentRequest(`${p}.${edited}.${mac}`, SECRET, NOW), null);
  assert.equal(verifyConsentRequest(token, "another-secret-another-secret-0123456789", NOW), null);
  assert.equal(verifyConsentRequest(token, SECRET, NOW + 11 * 60_000), null, "expires after 10 minutes");
  assert.equal(verifyConsentRequest(signConsentRequest(REQUEST, SECRET, NOW, "whiteflow-gateway"), SECRET, NOW), null, "an internal gateway assertion is not a consent request");
});

test("approval creates a grant for the SIWE merchant with exactly the approved scopes, and a single-use code in the redirect", async () => {
  const { redirect, grantId } = await approve();
  const url = new URL(redirect);
  assert.equal(`${url.origin}${url.pathname}`, REDIRECT);
  assert.equal(url.searchParams.get("state"), REQUEST.state, "state is returned untouched");
  assert.equal(url.searchParams.get("iss"), ISSUER, "RFC 9207 issuer");
  const code = url.searchParams.get("code");
  assert.ok(code && code.length >= 32);
  const [g] = await query("SELECT owner, merchant, scopes, resource, expires_at::text, revoked_at FROM app_mcp_grants WHERE id = $1", [grantId]);
  assert.deepEqual([g.owner, g.merchant, g.scopes, g.resource, g.revoked_at], [MERCHANT.toLowerCase(), MERCHANT.toLowerCase(), "account:read links:read", RESOURCE, null]);
  assert.equal(Number(g.expires_at), NOW + GRANT_TTL_MS);
  const [c] = await query("SELECT code_hash, redirect_uri, code_challenge, resource, expires_at::text, used_at FROM app_mcp_codes WHERE grant_id = $1", [grantId]);
  assert.notEqual(c.code_hash, code, "only a hash of the code is stored");
  assert.deepEqual([c.redirect_uri, c.code_challenge, c.resource, c.used_at], [REDIRECT, REQUEST.codeChallenge, RESOURCE, null]);
  assert.equal(Number(c.expires_at), NOW + CODE_TTL_MS);
});

test("links:write is granted only when it was requested AND approved; an approved scope that wasn't requested is refused", async () => {
  await assert.rejects(approve({ request: { ...REQUEST, scopes: ["account:read"] }, approved: ["account:read", "links:write"] }), /not requested/);
  const { grantId } = await approve({ approved: ["account:read", "links:read", "links:write"] });
  assert.match((await query("SELECT scopes FROM app_mcp_grants WHERE id = $1", [grantId]))[0].scopes, /links:write/);
  await assert.rejects(approve({ approved: [] }), /at least one/i);
  await assert.rejects(approve({ approved: ["admin:everything"] }), /not requested|unknown/i);
});

test("the redirect URI must be one the client registered, checked again at approval", async () => {
  await assert.rejects(approve({ request: { ...REQUEST, redirectUri: "https://evil.example/cb" } }), /redirect/i);
  await assert.rejects(approve({ request: { ...REQUEST, clientId: "no-such-client" } }), /isn't registered/i);
  assert.equal((await query("SELECT count(*)::int AS n FROM app_mcp_grants"))[0].n, 0, "no grant was created by a refused approval");
});

test("denying redirects with access_denied and state, and creates nothing", async () => {
  const url = new URL(denyRedirect(REQUEST, ISSUER));
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("state"), REQUEST.state);
  assert.equal(url.searchParams.get("code"), null);
  assert.equal((await query("SELECT count(*)::int AS n FROM app_mcp_grants"))[0].n, 0);
});

test("grants are listed per merchant, newest first, with states that never claim Verified without a successful call", async () => {
  const a = (await approve()).grantId;
  const b = (await approve({ now: NOW + 5000 })).grantId;
  await approve({ owner: OTHER_MERCHANT, merchant: OTHER_MERCHANT });
  const mine = await listGrants(MERCHANT, (await seedWorkspace(MERCHANT)).businessId);
  assert.deepEqual(mine.map((g) => g.id), [b, a]);
  assert.equal(mine.length, 2, "another merchant's grant is never listed");
  assert.equal(grantState(mine[0], NOW + 6000), "awaiting_verification");
  await query("UPDATE app_mcp_grants SET last_tool_ok_at = $2 WHERE id = $1", [b, NOW + 7000]);
  assert.equal(grantState((await listGrants(MERCHANT, (await seedWorkspace(MERCHANT)).businessId))[0], NOW + 8000), "verified");
  assert.equal(grantState((await listGrants(MERCHANT, (await seedWorkspace(MERCHANT)).businessId))[0], NOW + 5000 + GRANT_TTL_MS + 1), "reauthorization_required");
});

test("revoking disconnects at once: the grant and every token of it, only for its own merchant", async () => {
  const { grantId } = await approve();
  await query("INSERT INTO app_mcp_tokens (token_hash, kind, grant_id, family_id, expires_at) VALUES ('h1', 'access', $1, 'f1', $2), ('h2', 'refresh', $1, 'f1', $2)", [grantId, NOW + 3_600_000]);
  assert.equal(await revokeGrant(OTHER_MERCHANT, grantId, NOW + 10), false, "another merchant can't revoke it");
  assert.equal((await query("SELECT revoked_at FROM app_mcp_grants WHERE id = $1", [grantId]))[0].revoked_at, null);
  assert.equal(await revokeGrant(MERCHANT, grantId, NOW + 10), true);
  assert.notEqual((await query("SELECT revoked_at FROM app_mcp_grants WHERE id = $1", [grantId]))[0].revoked_at, null);
  assert.equal((await query("SELECT count(*)::int AS n FROM app_mcp_tokens WHERE grant_id = $1 AND revoked_at IS NULL", [grantId]))[0].n, 0);
  assert.equal(grantState((await listGrants(MERCHANT, (await seedWorkspace(MERCHANT)).businessId))[0], NOW + 20), "revoked");
  assert.equal(await revokeGrant(MERCHANT, grantId, NOW + 30), false, "already revoked");
});

test("a loopback redirect may use any port (RFC 8252: Claude Code picks one), but nothing else may differ", async () => {
  const loop = "http://localhost:3118/callback";
  await query("UPDATE app_mcp_clients SET metadata = $1::jsonb WHERE client_id = 'client_1'", [JSON.stringify({ client_name: "Claude Code", redirect_uris: [loop, REDIRECT] })]);
  const ok = await approve({ request: { ...REQUEST, redirectUri: "http://localhost:51234/callback" } });
  assert.equal(new URL(ok.redirect).origin, "http://localhost:51234");
  await assert.rejects(approve({ request: { ...REQUEST, redirectUri: "http://localhost:51234/other" } }), /redirect/i, "another path");
  await assert.rejects(approve({ request: { ...REQUEST, redirectUri: "http://evil.example:51234/callback" } }), /redirect/i, "another host");
  await assert.rejects(approve({ request: { ...REQUEST, redirectUri: "https://claude.ai:8443/api/mcp/auth_callback" } }), /redirect/i, "a non-loopback address needs an exact match");
});

// ── review 058 R1 H1: an app can't pass itself off as ChatGPT or Claude on the consent screen ──
const { describeClient, issuerOf } = await import("../lib/server/mcp-grants.ts");

test("the consent screen trusts the redirect host, never the name: a 'ChatGPT' that sends codes elsewhere is unverified", () => {
  const fake = describeClient("ChatGPT", "https://attacker.example/cb");
  assert.equal(fake.verifiedAs, null);
  assert.equal(fake.host, "attacker.example");
  assert.match(fake.title, /unverified/i);
  assert.ok(fake.warning && /attacker\.example/.test(fake.warning));
  const real = describeClient("anything at all", "https://chatgpt.com/connector_platform_oauth_redirect");
  assert.deepEqual([real.verifiedAs, real.host, real.warning], ["ChatGPT", "chatgpt.com", null]);
  assert.equal(describeClient("Claude", "https://claude.ai/api/mcp/auth_callback").verifiedAs, "Claude");
  assert.equal(describeClient("Claude", "https://claude.com/api/mcp/auth_callback").verifiedAs, "Claude");
  assert.equal(describeClient("x", "https://chatgpt.com.attacker.example/cb").verifiedAs, null, "a look-alike suffix is not chatgpt.com");
  assert.equal(describeClient("x", "https://evilchatgpt.com/cb").verifiedAs, null);
});

test("a loopback redirect is a program on the merchant's own computer (Claude Code), labelled as such, not as a vendor", () => {
  const local = describeClient("Claude Code", "http://localhost:51234/callback");
  assert.equal(local.verifiedAs, null);
  assert.equal(local.host, "localhost");
  assert.match(local.warning, /your own computer/);
});

test("invisible and bidi characters can't disguise a name on the consent screen", () => {
  const d = describeClient("Chat​GPT‮", "https://attacker.example/cb");
  assert.doesNotMatch(d.title, /[​‮]/);
  assert.match(d.title, /unverified/i);
});

test("review 058 R1 M1: the iss the dashboard returns is byte-identical to the issuer the SDK advertises (with its slash)", () => {
  const before = process.env.WHITEFLOW_MCP_PUBLIC_URL;
  process.env.WHITEFLOW_MCP_PUBLIC_URL = "https://mcp.example/mcp";
  try {
    assert.equal(issuerOf(), "https://mcp.example/", "new URL(origin).href, as the SDK's createOAuthMetadata uses");
  } finally {
    if (before === undefined) delete process.env.WHITEFLOW_MCP_PUBLIC_URL;
    else process.env.WHITEFLOW_MCP_PUBLIC_URL = before;
  }
});
