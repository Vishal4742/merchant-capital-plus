// Batch 058 phase C (FR-MCP-1..3; SRS-CHANGE FR-MCP-18/19/20 proposed): the hosted MCP service end to end over real HTTP:
// discovery, client registration, authorization code + PKCE S256, consent hand-off to the dashboard, tokens, the MCP endpoint,
// and every way it must say no: denial, code replay, expiry, wrong audience, PKCE mismatch, insufficient scope, cross-merchant
// reads, revocation, refresh reuse. Real Postgres (PGlite), real Express, the SDK's own MCP client. Offline.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ALL_SCOPES, MERCHANT_A, MERCHANT_B, READ_SCOPES, REDIRECT, SECRET, pkce, sha, start } from "./helpers.ts";
import { issuerOf, verifyConsentRequest } from "../../web/lib/server/mcp-grants.ts";
import { createOAuthMetadata } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { parseConfig } from "../src/config.ts";
import { PgOAuthProvider } from "../src/provider.ts";

const open: { close: () => Promise<void> }[] = [];
const boot = async (opts: Parameters<typeof start>[0] = {}) => {
  const s = await start(opts);
  open.push(s);
  return s;
};
after(async () => {
  for (const s of open) await s.close();
});

// ── discovery ──
test("discovery: protected-resource metadata names the MCP URL and the issuer; the server metadata allows only S256", async () => {
  const s = await boot();
  const resource = await s.json("/.well-known/oauth-protected-resource/mcp");
  assert.equal(resource.status, 200);
  assert.equal(resource.body.resource, s.config.mcpUrl.href);
  assert.deepEqual(resource.body.authorization_servers.map((u: string) => u.replace(/\/$/, "")), [s.config.issuerUrl.href.replace(/\/$/, "")]);
  assert.ok(resource.body.scopes_supported.includes("links:write"));
  const server = await s.json("/.well-known/oauth-authorization-server");
  assert.equal(server.status, 200);
  assert.deepEqual(server.body.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(server.body.response_types_supported, ["code"]);
  assert.ok(server.body.registration_endpoint.endsWith("/register"));
  assert.ok(server.body.grant_types_supported.includes("refresh_token") && !server.body.grant_types_supported.includes("client_credentials"));
});

test("an unauthenticated MCP request is 401 with a resource-metadata challenge, and a garbage token is the same", async () => {
  const s = await boot();
  for (const headers of [{} as Record<string, string>, { authorization: "Bearer not-a-real-token" }]) {
    const res = await fetch(s.config.mcpUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata="[^"]+oauth-protected-resource/);
  }
});

// ── registration ──
test("registration: a public client with https redirects is accepted; secrets, plain-http and fragment redirects are not", async () => {
  const s = await boot();
  const good = await s.register(["https://chatgpt.com/connector/oauth/abc123"]);
  assert.equal(good.status, 201, good.text);
  assert.ok(good.clientId);
  const reg = (over: Record<string, unknown>) => s.json("/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "X", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...over }) });
  assert.equal((await reg({ token_endpoint_auth_method: "client_secret_post" })).status, 400, "no confidential clients: we would have to store a secret");
  assert.equal((await reg({ redirect_uris: ["http://evil.example/cb"] })).status, 400, "plain http that isn't loopback");
  assert.equal((await reg({ redirect_uris: ["https://claude.ai/cb#frag"] })).status, 400);
  assert.equal((await reg({ redirect_uris: ["javascript:alert(1)"] })).status, 400);
  assert.equal((await reg({ redirect_uris: [] })).status, 400);
  assert.equal((await reg({ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://claude.ai/cb${i}`) })).status, 400, "too many");
  assert.equal((await reg({ grant_types: ["client_credentials"] })).status, 400);
  assert.equal((await reg({ redirect_uris: ["http://localhost:8123/callback"] })).status, 201, "a loopback native client (Claude Code)");
});

// ── authorize ──
test("authorize hands a signed consent request to the dashboard: client, redirect, PKCE, scopes and audience, nothing else", async () => {
  const s = await boot();
  const { clientId } = await s.register();
  const { challenge } = pkce();
  const a = await s.authorize(clientId, {}, challenge);
  assert.equal(a.status, 302);
  const url = new URL(a.location);
  assert.equal(url.origin, "https://web.example");
  assert.equal(url.pathname, "/merchant/ai/authorize");
  const request = verifyConsentRequest(url.searchParams.get("request")!, SECRET, s.clock.now);
  assert.deepEqual(request, { clientId, redirectUri: REDIRECT, codeChallenge: challenge, scopes: ALL_SCOPES, state: "xyz", resource: s.config.mcpUrl.href });
  assert.equal([...url.searchParams.keys()].join(), "request", "no merchant, address or token travels in the URL");
});

test("authorize refuses: unknown client, unregistered redirect, plain PKCE, no challenge, a foreign resource, unknown scope", async () => {
  const s = await boot();
  const { clientId } = await s.register();
  assert.equal((await s.authorize("no-such-client")).status, 400);
  assert.equal((await s.authorize(clientId, { redirect_uri: "https://evil.example/cb" })).status, 400, "no redirect to an unregistered address");
  const plain = await s.authorize(clientId, { code_challenge_method: "plain" });
  assert.ok(!plain.location.includes("/merchant/ai/authorize"), "plain PKCE never reaches consent");
  const noChallenge = await fetch(`${s.base}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge_method=S256`, { redirect: "manual" });
  assert.ok([302, 400].includes(noChallenge.status));
  assert.ok(!(noChallenge.headers.get("location") ?? "").includes("/merchant/ai/authorize"), "no consent without a challenge");
  const foreign = await s.authorize(clientId, { resource: "https://other.example/mcp" });
  assert.ok(!foreign.location.includes("/merchant/ai/authorize"), "a token for another audience is never started");
  const scope = await s.authorize(clientId, { scope: "account:read admin:everything" });
  assert.ok(!scope.location.includes("/merchant/ai/authorize"), "an unknown scope is refused");
});

// ── the full flow and the MCP endpoint ──
test("connect: tokens are issued after consent, the MCP client lists exactly the six tools, and reads work", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  assert.equal(c.tokenStatus, 200);
  assert.equal(c.tokens.token_type.toLowerCase(), "bearer");
  assert.equal(c.tokens.expires_in, 600, "short-lived access tokens");
  assert.notEqual(sha(c.tokens.access_token), c.tokens.access_token);
  const stored = (await s.sql.query("SELECT kind FROM app_mcp_tokens WHERE token_hash IN ($1, $2) ORDER BY kind", [sha(c.tokens.access_token), sha(c.tokens.refresh_token)])).map((r) => r.kind);
  assert.deepEqual(stored, ["access", "refresh"], "only hashes of the tokens are stored");
  const client = await s.mcpClient(c.tokens.access_token);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["create_payment_link", "get_business_profile", "get_collection_summary", "get_operation_status", "get_payment_link", "list_payments"]);
  const profile = (await client.callTool({ name: "get_business_profile", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
  assert.notEqual(profile.isError, true, profile.content[0].text);
  assert.match(profile.content[0].text, /Whitechain Testnet/);
  await client.close();
});

test("verification: consent alone leaves the grant unverified; only an authorized successful tool call records it", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const last = async () => (await s.sql.query("SELECT last_tool_ok_at::text AS at FROM app_mcp_grants WHERE id = $1", [c.grantId]))[0].at;
  assert.equal(await last(), null, "token exchange and a tools/list do not verify");
  const client = await s.mcpClient(c.tokens.access_token);
  await client.listTools();
  assert.equal(await last(), null, "listing tools is not a tool call");
  s.clock.now += 5000;
  await client.callTool({ name: "get_business_profile", arguments: {} });
  assert.equal(Number(await last()), s.clock.now);
  await client.close();
});

test("a failing tool call (gateway down) is not verification, and records a sanitized error category", async () => {
  const s = await boot({ gatewayDown: true });
  const c = await s.connect(MERCHANT_A);
  const client = await s.mcpClient(c.tokens.access_token);
  const result = (await client.callTool({ name: "get_business_profile", arguments: {} })) as { isError?: boolean };
  assert.equal(result.isError, true);
  const [g] = await s.sql.query("SELECT last_tool_ok_at, last_error_category FROM app_mcp_grants WHERE id = $1", [c.grantId]);
  assert.equal(g.last_tool_ok_at, null);
  assert.equal(g.last_error_category, "tool_error");
  await client.close();
});

// ── the ways to say no ──
test("PKCE: a wrong verifier is refused and the code stays unspent for the real client", async () => {
  const s = await boot();
  const { clientId } = await s.register();
  const { verifier, challenge } = pkce();
  const a = await s.authorize(clientId, {}, challenge);
  const c = await s.consent(a.location, MERCHANT_A);
  const wrong = await s.token({ grant_type: "authorization_code", client_id: clientId, code: c.code, code_verifier: pkce().verifier, redirect_uri: REDIRECT, resource: s.config.mcpUrl.href });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "invalid_grant");
  const right = await s.token({ grant_type: "authorization_code", client_id: clientId, code: c.code, code_verifier: verifier, redirect_uri: REDIRECT, resource: s.config.mcpUrl.href });
  assert.equal(right.status, 200);
});

test("code replay: a second exchange is refused AND the grant it produced is revoked", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const replay = await s.token({ grant_type: "authorization_code", client_id: c.clientId, code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT, resource: s.config.mcpUrl.href });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "invalid_grant");
  const res = await fetch(s.config.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${c.tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(res.status, 401, "the tokens from the replayed code no longer work");
});

test("an expired code, a wrong redirect URI and a wrong client are all refused", async () => {
  const s = await boot();
  const { clientId } = await s.register();
  const other = await s.register(["https://chatgpt.com/connector/oauth/zzz"]);
  const { verifier, challenge } = pkce();
  const a = await s.authorize(clientId, {}, challenge);
  const c = await s.consent(a.location, MERCHANT_A);
  const form = { grant_type: "authorization_code", client_id: clientId, code: c.code, code_verifier: verifier, redirect_uri: REDIRECT, resource: s.config.mcpUrl.href };
  assert.equal((await s.token({ ...form, client_id: other.clientId })).status, 400, "another client can't redeem it");
  assert.equal((await s.token({ ...form, redirect_uri: "https://claude.ai/api/mcp/auth_callback2" })).status, 400, "another redirect");
  s.clock.now += 61_000;
  const late = await s.token(form);
  assert.equal(late.status, 400);
  assert.equal(late.body.error, "invalid_grant");
});

test("audience: a token whose grant was issued for another resource is refused at the MCP endpoint", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  await s.sql.query("UPDATE app_mcp_grants SET resource = 'https://other.example/mcp' WHERE id = $1", [c.grantId]);
  const res = await fetch(s.config.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${c.tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(res.status, 401);
  assert.equal(s.gatewayCalls.length, 0);
});

test("an expired access token is refused, and the refresh token still gets a new one", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  s.clock.now += 601_000;
  const res = await fetch(s.config.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${c.tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(res.status, 401);
  const next = await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.tokens.refresh_token, resource: s.config.mcpUrl.href });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.access_token, c.tokens.access_token);
  assert.notEqual(next.body.refresh_token, c.tokens.refresh_token, "refresh tokens rotate");
});

test("refresh reuse: presenting a rotated refresh token again revokes the whole grant, including the newest tokens", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const first = await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.tokens.refresh_token });
  assert.equal(first.status, 200);
  const reuse = await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.tokens.refresh_token });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error, "invalid_grant");
  const newest = await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: first.body.refresh_token });
  assert.equal(newest.status, 400, "the family was revoked");
  const res = await fetch(s.config.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${first.body.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(res.status, 401);
});

test("revocation: Disconnect denies the very next tool call and the next refresh", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const client = await s.mcpClient(c.tokens.access_token);
  assert.notEqual(((await client.callTool({ name: "get_business_profile", arguments: {} })) as { isError?: boolean }).isError, true);
  assert.equal(await s.revoke(MERCHANT_A, c.grantId, s.clock.now), true);
  await assert.rejects(client.callTool({ name: "get_business_profile", arguments: {} }), /invalid_token|revoked/i);
  assert.equal((await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.tokens.refresh_token })).status, 400);
  await client.close().catch(() => undefined);
});

test("scope: a read-only grant can read but can't create, and nothing reaches the gateway for the denied write", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A, READ_SCOPES);
  const client = await s.mcpClient(c.tokens.access_token);
  const denied = (await client.callTool({ name: "create_payment_link", arguments: { amount: "25", currency: "USDT", description: "Beans" } })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /links:write/);
  assert.equal(s.gatewayCalls.filter((g) => g.method === "POST").length, 0);
  await client.close();
});

test("with links:write a link is created, through the gateway as THIS merchant, with an idempotency key from the durable journal", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const client = await s.mcpClient(c.tokens.access_token);
  const made = (await client.callTool({ name: "create_payment_link", arguments: { amount: "25", currency: "USDT", description: "Beans" } })) as { isError?: boolean; content: { text: string }[] };
  assert.notEqual(made.isError, true, made.content[0].text);
  const post = s.gatewayCalls.find((g) => g.method === "POST")!;
  assert.deepEqual([post.merchant, post.grantId], [MERCHANT_A, c.grantId]);
  assert.equal((await s.sql.query("SELECT count(*)::int AS n FROM app_mcp_journal"))[0].n, 1);
  await client.close();
});

test("two merchants never share context: each tool call reaches the gateway with its own merchant and grant, and journals apart", async () => {
  const s = await boot();
  const a = await s.connect(MERCHANT_A);
  const b = await s.connect(MERCHANT_B);
  const [ca, cb] = [await s.mcpClient(a.tokens.access_token), await s.mcpClient(b.tokens.access_token)];
  await Promise.all([
    ca.callTool({ name: "create_payment_link", arguments: { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "order-0001-same" } }),
    cb.callTool({ name: "create_payment_link", arguments: { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "order-0001-same" } }),
  ]);
  const posts = s.gatewayCalls.filter((g) => g.method === "POST");
  assert.deepEqual(new Set(posts.map((p) => `${p.merchant}|${p.grantId}`)), new Set([`${MERCHANT_A}|${a.grantId}`, `${MERCHANT_B}|${b.grantId}`]));
  assert.equal((await s.sql.query("SELECT count(*)::int AS n FROM app_mcp_journal"))[0].n, 2, "one journal document per merchant");
  const statusB = (await cb.callTool({ name: "get_operation_status", arguments: {} })) as { content: { text: string }[] };
  assert.doesNotMatch(statusB.content[0].text, /order-0001-same.*pending/s);
  await Promise.all([ca.close(), cb.close()]);
});

// ── transport hygiene ──
test("a browser Origin that isn't allowed is refused (403) before anything runs; no Origin is fine for server-to-server clients", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const call = (origin?: string) => fetch(s.config.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${c.tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...(origin ? { origin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal((await call("https://evil.example")).status, 403);
  assert.equal((await call("https://claude.ai")).status, 200);
  assert.equal((await call()).status, 200);
});

test("the session id is not a credential: a request with one but no bearer is still 401", async () => {
  const s = await boot();
  const res = await fetch(s.config.mcpUrl, { method: "POST", headers: { "mcp-session-id": "a-session-id-that-exists-somewhere", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(res.status, 401);
});

test("liveness is separate from readiness: /health never touches the database; /ready checks it", async () => {
  const s = await boot();
  assert.equal((await s.json("/health")).status, 200);
  const ready = await s.json("/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(Object.keys(ready.body).sort(), ["database", "status"], "no keys, hosts or customer data in diagnostics");
  await s.pg.close();
  assert.equal((await s.json("/health")).status, 200);
  assert.equal((await s.json("/ready")).status, 503);
});

test("20 simultaneous identical creates through the endpoint all carry ONE idempotency key and leave one journal entry (PGlite; the hosted run is staging-concurrency.mjs)", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A);
  const args = { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "order-race-0001" };
  const clients = await Promise.all(Array.from({ length: 20 }, () => s.mcpClient(c.tokens.access_token)));
  const results = await Promise.all(clients.map((client) => client.callTool({ name: "create_payment_link", arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[] }>));
  const posts = s.gatewayCalls.filter((g) => g.method === "POST");
  assert.ok(posts.length >= 1);
  assert.deepEqual([...new Set(posts.map((p) => p.idempotencyKey))], ["order-race-0001"], "every attempt that reached the gateway used the caller's key");
  assert.equal((await s.sql.query("SELECT jsonb_array_length(entries) AS n FROM app_mcp_journal"))[0].n, 1);
  // each caller got either the link or a plain refusal, never a different link
  const links = new Set(results.filter((r) => !r.isError).map((r) => JSON.parse(r.content[0].text).link.id));
  assert.equal(links.size, 1);
  await Promise.all(clients.map((client) => client.close()));
});

// ── review 058 round 1 ──
test("H1: a client can't register under a vendor's name unless its redirects go to that vendor; invisible characters are stripped", async () => {
  const s = await boot();
  const reg = (name: string, redirect: string) => s.json("/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none" }) });
  for (const name of ["ChatGPT", "chat gpt", "OpenAI connector", "Claude", "Anthropic", "ＣｈａｔＧＰＴ", "Chat​GPT"]) {
    assert.equal((await reg(name, "https://attacker.example/cb")).status, 400, name);
  }
  assert.equal((await reg("ChatGPT", "https://chatgpt.com/connector_platform_oauth_redirect")).status, 201);
  assert.equal((await reg("Claude", "https://claude.ai/api/mcp/auth_callback")).status, 201);
  assert.equal((await reg("Claude Code", "http://localhost:3118/callback")).status, 201, "Claude Code's own loopback callback");
  const odd = await reg("My‮app​", "https://tool.example/cb");
  assert.equal(odd.status, 201);
  assert.equal(odd.body.client_name, "Myapp");
});

test("M1: the issuer the SDK advertises and the iss the dashboard returns are byte-identical", () => {
  const before = process.env.WHITEFLOW_MCP_PUBLIC_URL;
  process.env.WHITEFLOW_MCP_PUBLIC_URL = "https://mcp.example/mcp";
  try {
    const parsed = parseConfig({ WHITEFLOW_MCP_PUBLIC_URL: "https://mcp.example/mcp", WHITEFLOW_WEB_ORIGIN: "https://web.example", MCP_INTERNAL_SECRET: SECRET, DATABASE_URL: "postgres://unused" });
    assert.ok(parsed.ok);
    const provider = new PgOAuthProvider({ sql: { query: async () => [] }, config: parsed.config, now: Date.now });
    const advertised = createOAuthMetadata({ provider, issuerUrl: parsed.config.issuerUrl }).issuer;
    assert.equal(issuerOf(), advertised);
  } finally {
    if (before === undefined) delete process.env.WHITEFLOW_MCP_PUBLIC_URL;
    else process.env.WHITEFLOW_MCP_PUBLIC_URL = before;
  }
});

test("code review M3: a refresh naming a scope the grant lacks gets the granted scopes; a wrong resource doesn't burn the token", async () => {
  const s = await boot();
  const c = await s.connect(MERCHANT_A, READ_SCOPES);
  const wrong = await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.tokens.refresh_token, resource: "https://other.example/mcp" });
  assert.equal(wrong.status, 400);
  const asked = await s.token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.tokens.refresh_token, scope: ALL_SCOPES.join(" ") });
  assert.equal(asked.status, 200, "the same refresh token still works: the refused attempt didn't spend it");
  assert.equal(asked.body.scope, READ_SCOPES.join(" "), "the answer says what was really granted; links:write was never approved");
  const [g] = await s.sql.query("SELECT revoked_at FROM app_mcp_grants WHERE id = $1", [c.grantId]);
  assert.equal(g.revoked_at, null, "no reuse alarm");
});

test("code review L2: the code exchange accepts the resource with or without its trailing slash, like authorize does", async () => {
  const s = await boot();
  const { clientId } = await s.register();
  const { verifier, challenge } = pkce();
  const a = await s.authorize(clientId, {}, challenge);
  const c = await s.consent(a.location, MERCHANT_A);
  const t = await s.token({ grant_type: "authorization_code", client_id: clientId, code: c.code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${s.config.mcpUrl.href}/` });
  assert.equal(t.status, 200);
});

test("M3: registration stops at the client cap instead of growing without bound", async () => {
  const s = await boot();
  await s.sql.query("INSERT INTO app_mcp_clients (client_id, metadata, created_at) SELECT 'bulk_' || g, '{}'::jsonb, 0 FROM generate_series(1, 5000) g");
  const r = await s.register();
  assert.equal(r.status, 400);
  assert.match(r.text, /too many|limit/i);
});


test("removing the approving Owner denies access and refresh even after rejoining", async () => {
  const h = await start();
  try {
    const connection = await h.connect(MERCHANT_A);
    assert.equal(connection.tokenStatus, 200);
    await h.pg.query("DELETE FROM wf_memberships WHERE business_id = $1 AND principal_id = $1", [MERCHANT_A]);
    await h.pg.query("INSERT INTO wf_memberships (business_id, principal_id, role, created_at) VALUES ($1, $1, 'owner', 0)", [MERCHANT_A]);
    const denied = await h.json("/mcp", { method: "POST", headers: { authorization: `Bearer ${connection.tokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(denied.status, 401);
    const refresh = await h.token({ grant_type: "refresh_token", client_id: connection.clientId, refresh_token: connection.tokens.refresh_token });
    assert.equal(refresh.status, 400);
  } finally { await h.close(); await h.pg.close(); }
});
