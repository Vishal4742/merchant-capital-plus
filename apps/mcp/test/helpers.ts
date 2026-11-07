// Test harness for the hosted MCP service (batch 058): a real Express app on an ephemeral port, real Postgres (PGlite with the
// shipped migration), the web app's own grant code for the consent step (the dashboard side), and a scripted gateway that
// checks each request's assertion with the web app's verifier. Nothing leaves the process.
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type ServiceConfig } from "../src/app.ts";
import type { SqlRunner } from "../../../packages/mcp/src/journal-pg.ts";
import { setTestDb } from "../../web/lib/server/db.ts";
import { approveGrant, revokeGrant, verifyConsentRequest } from "../../web/lib/server/mcp-grants.ts";
import { verifyInternal } from "../../web/lib/server/mcp-principal.ts";

export const SECRET = "mcp-internal-test-secret-0123456789abcdef";
export const MERCHANT_A = "0x1111111111111111111111111111111111111111";
export const MERCHANT_B = "0x2222222222222222222222222222222222222222";
export const ALL_SCOPES = ["account:read", "links:read", "payments:read", "reports:read", "links:write"];
export const READ_SCOPES = ["account:read", "links:read", "payments:read", "reports:read"];
export const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const MIGRATION = readFileSync(new URL("../../web/db/051_mcp_remote.sql", import.meta.url), "utf8");
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

const ACCOUNT = (address: string) => ({
  merchant: { address, name: "Shop" },
  environment: "test",
  network: { name: "Whitechain Testnet", chain_id: 1874, explorer: "https://explorer.testnet.whitechain.io" },
  settlement: { asset: "USDT", token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", decimals: 6 },
  price_currencies: ["USDT"],
  payment_limits: { currency: "USDT", min: "1.00", max: "1000.00" },
  payment_methods: [{ id: "usdt_signature", label: "USDT on Whitechain Testnet" }],
  timezone: null,
  credential: { type: "mcp_grant", key_id: null, scopes: null, expires_at: null },
  capabilities: { links: true, payments: true, reports: true, customers: false, invoices: false, reminders: false, operations: true },
});
const LINK = { id: "lnk_AbCdEfGhIjKlMnOp", slug: "Ab3dE6gH9k", url: "/l/Ab3dE6gH9k", amount: "25.00", currency: "USDT", description: "Beans", reference_id: null, single_use: true, status: "active", expires_at: null, created_at: "2026-11-06T12:00:00.000Z", payments: 0 };

export interface GatewayCall {
  method: string;
  path: string;
  merchant: string | null;
  grantId: string | null;
}

export async function start(opts: { clock?: { now: number }; gatewayDown?: boolean } = {}) {
  const pg = new PGlite();
  await pg.exec(MIGRATION);
  const sql: SqlRunner = { query: async (text, params) => (await pg.query(text, params as unknown[])).rows as Record<string, unknown>[] };
  setTestDb({
    query: async (text, params) => (await pg.query(text, params)).rows as Record<string, unknown>[],
    transaction: (statements) =>
      pg.transaction(async (tx) => {
        const out = [];
        for (const s of statements) out.push((await tx.query(s.text, s.params ?? [])).rows as Record<string, unknown>[]);
        return out;
      }),
  });
  const clock = opts.clock ?? { now: Date.now() };
  const gatewayCalls: GatewayCall[] = [];
  const gatewayFetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const claim = auth.startsWith("Bearer ") ? verifyInternal(auth.slice(7), SECRET, clock.now) : null;
    gatewayCalls.push({ method: init.method ?? "GET", path: u.pathname, merchant: claim?.merchant ?? null, grantId: claim?.grantId ?? null });
    if (opts.gatewayDown) return new Response("down", { status: 503 });
    if (!claim) return Response.json({ error: "no" }, { status: 401 });
    if (u.pathname === "/api/v1/account") return Response.json(ACCOUNT(claim.merchant));
    if (u.pathname === "/api/v1/links" && init.method === "POST") return Response.json(LINK, { status: 201 });
    return Response.json({ error: "not found" }, { status: 404 });
  }) as typeof globalThis.fetch;

  // the port is only known after listen, and the config (issuer, resource) must name it: listen first, then build the app
  const holder: { app?: ReturnType<typeof createApp> } = {};
  const server: Server = await new Promise((resolve) => {
    const s = createServer((req, res) => holder.app!(req, res));
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;
  const config: ServiceConfig = { mcpUrl: new URL(`${base}/mcp`), issuerUrl: new URL(base), webOrigin: new URL("https://web.example"), internalSecret: SECRET, allowedOrigins: ["https://claude.ai", "https://chatgpt.com"] };
  holder.app = createApp({ config, sql, now: () => clock.now, gatewayFetch, log: { info: () => undefined, error: () => undefined } });

  const json = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, { redirect: "manual", ...init });
    const text = await res.text();
    let body: Record<string, any> = {};
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, body, text };
  };

  /** Registers a public client (what ChatGPT or Claude do), returning its id. */
  const register = async (redirectUris = [REDIRECT]) => {
    const r = await json("/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
    return { ...r, clientId: r.body.client_id as string };
  };

  /** /authorize as the browser would call it; returns the consent URL the service redirects to (the dashboard page). */
  const authorize = async (clientId: string, over: Record<string, string> = {}, challenge = pkce().challenge) => {
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", scope: ALL_SCOPES.join(" "), state: "xyz", resource: config.mcpUrl.href, ...over });
    for (const [k, v] of [...q]) if (v === "") q.delete(k);
    const res = await fetch(`${base}/authorize?${q}`, { redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") ?? "" };
  };

  /** The dashboard side: verify the signed request in the consent URL, then approve as `merchant` with `approved` scopes. */
  const consent = async (location: string, merchant: string, approved = ALL_SCOPES) => {
    const url = new URL(location);
    const request = verifyConsentRequest(url.searchParams.get("request") ?? "", SECRET, clock.now);
    if (!request) throw new Error("the consent request did not verify");
    const done = await approveGrant({ owner: merchant, merchant, request, approved, issuer: config.issuerUrl.href.replace(/\/$/, ""), now: clock.now });
    const code = new URL(done.redirect).searchParams.get("code")!;
    return { ...done, code, request };
  };

  const token = (form: Record<string, string>) => json("/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });

  /** register → authorize → consent → token, for `merchant` with `approved` scopes. */
  const connect = async (merchant: string, approved = ALL_SCOPES) => {
    const { clientId } = await register();
    const { verifier, challenge } = pkce();
    const a = await authorize(clientId, {}, challenge);
    const c = await consent(a.location, merchant, approved);
    const t = await token({ grant_type: "authorization_code", client_id: clientId, code: c.code, code_verifier: verifier, redirect_uri: REDIRECT, resource: config.mcpUrl.href });
    return { clientId, verifier, grantId: c.grantId, code: c.code, tokens: t.body as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope?: string }, tokenStatus: t.status };
  };

  /** An MCP client over real Streamable HTTP with this access token. */
  const mcpClient = async (accessToken: string) => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
    return client;
  };

  return { pg, sql, base, config, clock, gatewayCalls, json, register, authorize, consent, token, connect, mcpClient, revoke: revokeGrant, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
