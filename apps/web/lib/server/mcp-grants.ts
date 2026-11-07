// The grant lifecycle for assistant connections (batch 058; FR-MCP-1..3; SRS-CHANGE FR-MCP-19/20 proposed). The dashboard
// owns it because the SIWE session lives here: the MCP service (apps/mcp) hands a signed CONSENT REQUEST to the dashboard,
// the signed-in merchant approves or denies it, and approval creates the grant (bound to that session's merchant, never to
// anything in the request) and a single-use authorization code. The grant list and Disconnect read and change the same rows.
// Server only. The MCP service has its own signConsentRequest; tests pin the two.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { connectionState, type ConnectionState } from "../ai-connect.ts";
import { query, transaction } from "./db.ts";
import { GRANT_SCOPES } from "./mcp-principal.ts";

export const CONSENT_PREFIX = "wfc1.";
export const CONSENT_AUDIENCE = "whiteflow-consent";
export const CONSENT_TTL_MS = 10 * 60_000;
export const CODE_TTL_MS = 60_000;
export const GRANT_TTL_MS = 30 * 24 * 60 * 60_000;

/** The authorization server's issuer, or null when the service isn't configured here. It must be byte-identical to the
 *  `issuer` the MCP service advertises, which the SDK writes as `new URL(origin).href` (with the trailing slash): clients that
 *  check RFC 9207's `iss` compare the two exactly (review 058 R1 M1). */
export const issuerOf = (): string | null => {
  const url = process.env.WHITEFLOW_MCP_PUBLIC_URL;
  return url && URL.canParse(url) && new URL(url).protocol === "https:" ? new URL(new URL(url).origin).href : null;
};

// ── who is asking (review 058 R1 H1) ──
// Anyone can register a client and call it "ChatGPT". The name is chosen by the client, so it proves nothing; where the
// authorization code is SENT is what decides who gets access. The consent screen therefore names a vendor only when the
// redirect goes to that vendor's own host, and otherwise shows the real host with a warning.
const VENDOR_HOSTS: { vendor: string; hosts: string[] }[] = [
  { vendor: "ChatGPT", hosts: ["chatgpt.com", "openai.com"] },
  { vendor: "Claude", hosts: ["claude.ai", "claude.com"] },
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const onHost = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

/** A client-chosen name, made safe to show: no control, format (zero-width, bidi) or surrogate characters, spaces collapsed. */
export const cleanName = (name: string): string =>
  name.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 100) || "An app";

export interface ClientDescription {
  /** what the page calls it: the vendor when proven by the redirect host, else the client's own name marked unverified */
  title: string;
  /** the host the code will be sent to */
  host: string;
  verifiedAs: string | null;
  /** shown prominently whenever the vendor isn't proven; null for a verified vendor */
  warning: string | null;
}

export function describeClient(name: string, redirectUri: string): ClientDescription {
  const host = URL.canParse(redirectUri) ? new URL(redirectUri).hostname.toLowerCase() : "an unknown address";
  const vendor = VENDOR_HOSTS.find((v) => v.hosts.some((h) => onHost(host, h)))?.vendor ?? null;
  if (vendor) return { title: vendor, host, verifiedAs: vendor, warning: null };
  const named = `“${cleanName(name)}” (unverified app)`;
  if (LOOPBACK_HOSTS.has(host)) {
    return { title: named, host, verifiedAs: null, warning: `This app runs on your own computer (it returns to ${host}), for example Claude Code. Allow it only if you started this connection from a program on this computer just now.` };
  }
  return { title: named, host, verifiedAs: null, warning: `WhiteFlow can't confirm who runs this app. If you allow access, it is sent to ${host}. Only continue if you started this connection yourself and recognise that address.` };
}

/** A refusal worded for the merchant (safe to show); anything else thrown here is an internal failure. */
export class GrantRefusal extends Error {}

/** A token proving a state-changing post came from our own page for THIS merchant and THIS subject (a consent request or a
 *  grant id). The session cookie is SameSite=Lax; this is the second, independent check. */
export const csrfToken = (merchant: string, subject: string, secret: string): string => mac(`csrf1|${merchant.toLowerCase()}|${subject}`, secret).toString("base64url");
export function csrfOk(given: unknown, merchant: string, subject: string, secret: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given), b = Buffer.from(csrfToken(merchant, subject, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();

export interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string;
  resource: string;
}

export function signConsentRequest(request: ConsentRequest, secret: string, now = Date.now(), audience = CONSENT_AUDIENCE): string {
  const payload = Buffer.from(
    JSON.stringify({ ci: request.clientId, ru: request.redirectUri, cc: request.codeChallenge, sc: request.scopes, st: request.state, rs: request.resource, aud: audience, exp: now + CONSENT_TTL_MS, jti: randomBytes(9).toString("base64url") }),
  ).toString("base64url");
  return `${CONSENT_PREFIX}${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The request the MCP service signed, or null (malformed, edited, expired, wrong secret or audience). */
export function verifyConsentRequest(token: string, secret: string, now = Date.now()): ConsentRequest | null {
  if (!token.startsWith(CONSENT_PREFIX)) return null;
  const [payload, tag, extra] = token.slice(CONSENT_PREFIX.length).split(".");
  if (!payload || !tag || extra !== undefined) return null;
  const given = Buffer.from(tag, "base64url"), expected = mac(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (c.aud !== CONSENT_AUDIENCE || typeof c.exp !== "number" || c.exp <= now) return null;
    if (typeof c.ci !== "string" || typeof c.ru !== "string" || typeof c.cc !== "string" || typeof c.rs !== "string" || !Array.isArray(c.sc) || !c.sc.every((s) => typeof s === "string")) return null;
    if (c.st !== undefined && typeof c.st !== "string") return null;
    return { clientId: c.ci, redirectUri: c.ru, codeChallenge: c.cc, scopes: c.sc as string[], ...(c.st !== undefined ? { state: c.st } : {}), resource: c.rs };
  } catch {
    return null;
  }
}

/** The client's redirect back with a refusal (RFC 6749 §4.1.2.1): nothing was granted. */
export function denyRedirect(request: ConsentRequest, issuer: string): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", "access_denied");
  if (request.state !== undefined) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The MCP SDK's own rule (RFC 8252 §7.3), kept identical so the dashboard never refuses what the service accepted:
 *  exact match, except that a loopback address may use any port. */
export function redirectMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  if (!URL.canParse(requested) || !URL.canParse(registered)) return false;
  const [a, b] = [new URL(requested), new URL(registered)];
  return LOOPBACK.has(a.hostname) && LOOPBACK.has(b.hostname) && a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

export interface ApproveInput {
  /** the SIWE address that approved */
  owner: string;
  businessId: string;
  principalId: string;
  /** the merchant the grant is bound to: from the session, never from the request */
  merchant: string;
  request: ConsentRequest;
  approved: string[];
  issuer: string;
  now?: number;
}

/** Creates the grant and a single-use code; returns where to send the browser. Throws a plain Error (safe to show) when the
 *  approval doesn't fit the request: nothing is created then. */
export async function approveGrant(input: ApproveInput): Promise<{ redirect: string; grantId: string }> {
  const { request, now = Date.now() } = input;
  const [authority] = await query("SELECT 1 FROM wf_memberships m JOIN wf_businesses b ON b.id = m.business_id WHERE m.business_id = $1 AND m.principal_id = $2 AND m.role = 'owner' AND b.legacy_merchant = $3", [input.businessId, input.principalId, input.merchant.toLowerCase()]);
  if (!authority) throw new GrantRefusal("An active workspace Owner must approve this connection.");
  const approved = [...new Set(input.approved)];
  if (approved.length === 0) throw new GrantRefusal("Approve at least one permission, or deny the request.");
  const known = GRANT_SCOPES as readonly string[];
  for (const scope of approved) if (!request.scopes.includes(scope) || !known.includes(scope)) throw new GrantRefusal(`The permission ${scope} was not requested by this assistant.`);
  const [client] = await query<{ metadata: { redirect_uris?: string[] } | string }>("SELECT metadata FROM app_mcp_clients WHERE client_id = $1", [request.clientId]);
  if (!client) throw new GrantRefusal("This assistant isn't registered with WhiteFlow. Start the connection again from your assistant.");
  const metadata = typeof client.metadata === "string" ? (JSON.parse(client.metadata) as { redirect_uris?: string[] }) : client.metadata;
  if (!metadata.redirect_uris?.some((registered) => redirectMatches(request.redirectUri, registered))) throw new GrantRefusal("This request's redirect address isn't one the assistant registered. Start again from your assistant.");

  const grantId = `grant_${randomBytes(12).toString("base64url")}`;
  const code = randomBytes(32).toString("base64url");
  const owner = input.owner.toLowerCase(), merchant = input.merchant.toLowerCase();
  await transaction([
    {
      text: "INSERT INTO app_mcp_grants (id, owner, merchant, client_id, scopes, resource, created_at, expires_at, business_id, approved_by) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM wf_memberships m JOIN wf_businesses b ON b.id = m.business_id WHERE m.business_id = $9 AND m.principal_id = $10 AND m.role = 'owner' AND b.legacy_merchant = $3 FOR SHARE OF m, b",
      params: [grantId, owner, merchant, request.clientId, approved.join(" "), request.resource, now, now + GRANT_TTL_MS, input.businessId, input.principalId],
    },
    {
      text: "INSERT INTO app_mcp_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      params: [sha256(code), grantId, request.clientId, request.redirectUri, request.codeChallenge, request.resource, now + CODE_TTL_MS],
    },
  ]);
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  if (request.state !== undefined) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", input.issuer);
  return { redirect: url.toString(), grantId };
}

export interface GrantRow {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastToolOkAt: number | null;
  lastErrorCategory: string | null;
}

const ms = (v: string | null) => (v === null ? null : Number(v));

export async function listGrants(merchant: string, businessId: string): Promise<GrantRow[]> {
  const rows = await query<{ id: string; client_id: string; client_name: string | null; scopes: string; created_at: string; expires_at: string; revoked_at: string | null; last_tool_ok_at: string | null; last_error_category: string | null }>(
    `SELECT g.id, g.client_id, c.metadata->>'client_name' AS client_name, g.scopes, g.created_at::text, g.expires_at::text, g.revoked_at::text, g.last_tool_ok_at::text, g.last_error_category
       FROM app_mcp_grants g JOIN app_mcp_clients c ON c.client_id = g.client_id
       JOIN wf_businesses b ON b.id = g.business_id AND b.legacy_merchant = g.merchant
       JOIN wf_memberships m ON m.business_id = g.business_id AND m.principal_id = g.approved_by AND m.role = 'owner'
      WHERE g.merchant = $1 AND g.business_id = $2 ORDER BY g.created_at DESC, g.id DESC LIMIT 50`,
    [merchant.toLowerCase(), businessId],
  );
  return rows.map((r) => ({ id: r.id, clientId: r.client_id, clientName: r.client_name ?? "An AI assistant", scopes: r.scopes.split(" ").filter(Boolean), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), revokedAt: ms(r.revoked_at), lastToolOkAt: ms(r.last_tool_ok_at), lastErrorCategory: r.last_error_category }));
}

/** The state a grant row shows. "Verified" only when a successful authenticated tool call was recorded against it. */
export const grantState = (grant: GrantRow, now: number): ConnectionState =>
  connectionState({ provisioned: true, grant: { revokedAt: grant.revokedAt, expiresAt: grant.expiresAt, reauthRequired: false, lastToolOkAt: grant.lastToolOkAt }, now });

/** Disconnect: true if this merchant's live grant was revoked. Its tokens stop working at once (they are checked against
 *  the grant on every request) and are marked revoked here too, so a refresh fails as well. */
export async function revokeGrant(merchant: string, grantId: string, now = Date.now()): Promise<boolean> {
  const done = await query("UPDATE app_mcp_grants SET revoked_at = $3 WHERE id = $1 AND merchant = $2 AND revoked_at IS NULL RETURNING id", [grantId, merchant.toLowerCase(), now]);
  if (done.length !== 1) return false;
  await query("UPDATE app_mcp_tokens SET revoked_at = $2 WHERE grant_id = $1 AND revoked_at IS NULL", [grantId, now]);
  return true;
}
