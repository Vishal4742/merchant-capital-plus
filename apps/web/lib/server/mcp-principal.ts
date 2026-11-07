// The gateway's side of the hosted MCP connection (batch 058; FR-MCP-1..3, FR-GW-6; SRS-CHANGE FR-MCP-18/19 proposed).
//
// The MCP service (apps/mcp) authenticates the assistant with OAuth. To act for that merchant it calls this gateway with a
// short-lived signed ASSERTION: "grant G, merchant M, for the gateway, until T". The assertion is never the assistant's
// OAuth token (that token's audience is the MCP endpoint and is never forwarded). The gateway trusts only its signature:
// the merchant, scopes, expiry and revocation are re-read from app_mcp_grants on EVERY request, so a revoke or a scope
// change applies at once, and what a route may be used for is fixed here by method and path, not by what a caller asks.
// Format: wfi1.<payload>.<mac>, HMAC-SHA256 with MCP_INTERNAL_SECRET (the same pattern as the dashboard session cookie,
// lib/auth.ts). apps/mcp has its own copy of signInternal; test/mcp-principal.test.mjs and apps/mcp's tests pin the two.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, type Address } from "viem";
import { query } from "./db.ts";

export const INTERNAL_PREFIX = "wfi1.";
export const INTERNAL_AUDIENCE = "whiteflow-gateway";
export const INTERNAL_TTL_MS = 5 * 60_000; // long enough for a tool call's retries, short enough to be useless if logged

export const GRANT_SCOPES = ["account:read", "links:read", "payments:read", "reports:read", "links:write"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();

/** MCP_INTERNAL_SECRET (at least 32 characters); without it assertions are refused: the connection fails closed. */
export const internalSecret = (): string | undefined => {
  const secret = process.env.MCP_INTERNAL_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
};

export function signInternal(principal: { merchant: string; grantId: string }, secret: string, now = Date.now(), audience = INTERNAL_AUDIENCE): string {
  const payload = Buffer.from(JSON.stringify({ m: principal.merchant.toLowerCase(), g: principal.grantId, aud: audience, exp: now + INTERNAL_TTL_MS, jti: randomBytes(9).toString("base64url") })).toString("base64url");
  return `${INTERNAL_PREFIX}${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The merchant and grant an assertion names, or null (malformed, forged, edited, expired or for another audience). */
export function verifyInternal(token: string, secret: string, now = Date.now()): { merchant: string; grantId: string } | null {
  if (!token.startsWith(INTERNAL_PREFIX)) return null;
  const [payload, tag, extra] = token.slice(INTERNAL_PREFIX.length).split(".");
  if (!payload || !tag || extra !== undefined) return null;
  const given = Buffer.from(tag, "base64url"), expected = mac(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { m, g, aud, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { m?: unknown; g?: unknown; aud?: unknown; exp?: unknown };
    if (typeof m !== "string" || typeof g !== "string" || aud !== INTERNAL_AUDIENCE || typeof exp !== "number" || exp <= now) return null;
    return { merchant: m, grantId: g };
  } catch {
    return null;
  }
}

/** What a gateway route needs from a grant: a scope, "any" (the profile every tool reads first), or null: closed to
 *  assistants (keys, webhooks, invoices, settlements, withdrawals, pages, vouchers, sessions, deletes, edits). */
export function internalScope(method: string, pathname: string): GrantScope | "any" | null {
  if (method === "GET" && pathname === "/api/v1/account") return "any";
  if (method === "POST" && pathname === "/api/v1/links") return "links:write";
  if (method === "GET" && /^\/api\/v1\/links\/[^/]+$/.test(pathname)) return "links:read";
  if (method === "GET" && pathname === "/api/v1/payments") return "payments:read";
  if (method === "GET" && pathname === "/api/v1/reports") return "reports:read";
  if (method === "GET" && /^\/api\/v1\/operations\/[^/]+$/.test(pathname)) return "links:read";
  return null;
}

export type InternalCaller = { merchant: Address; grantId: string; scopes: string[] };
export type InternalRefusal = { status: number; error: string };

/** null: this request carries no assertion (let the other credentials try). Otherwise the verified caller or the refusal. */
export async function internalCaller(request: Request, now = Date.now()): Promise<InternalCaller | InternalRefusal | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith(INTERNAL_PREFIX)) return null;
  const secret = internalSecret();
  const claim = secret ? verifyInternal(token, secret, now) : null;
  if (!claim) return { status: 401, error: "This connection's credential isn't valid. Authorize WhiteFlow again in your assistant." };
  const need = internalScope(request.method, new URL(request.url).pathname);
  if (need === null) return { status: 403, error: "Assistant connections can't use this part of WhiteFlow." };
  const [row] = await query<{ merchant: string; scopes: string; expires_at: string; revoked_at: string | null }>(
    "SELECT merchant, scopes, expires_at::text, revoked_at::text FROM app_mcp_grants WHERE id = $1",
    [claim.grantId],
  );
  // the grant's own row decides: an assertion naming another merchant than the grant's is refused like an unknown grant
  if (!row || row.merchant !== claim.merchant.toLowerCase() || row.revoked_at !== null || Number(row.expires_at) <= now) {
    return { status: 401, error: "This connection was disconnected or has expired. Authorize WhiteFlow again in your assistant." };
  }
  const scopes = row.scopes.split(" ").filter(Boolean);
  if (need !== "any" && !scopes.includes(need)) return { status: 403, error: `This connection doesn't have the ${need} permission.` };
  return { merchant: getAddress(row.merchant), grantId: claim.grantId, scopes };
}
