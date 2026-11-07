// The OAuth authorization server's storage and rules (batch 058; FR-MCP-1..3; SRS-CHANGE FR-MCP-19 proposed), implementing the
// MCP SDK's OAuthServerProvider (whose handlers do the HTTP, PKCE S256 checks, redirect matching and metadata). Everything here
// is decided against Postgres, never process memory, so any instance gives the same answer:
//  - codes are single-use (one atomic UPDATE) and a replayed code revokes the grant it produced;
//  - refresh tokens rotate, and presenting a used one (reuse) revokes the whole grant;
//  - tokens are opaque 256-bit values stored only as SHA-256, bound to the grant's audience (the MCP URL);
//  - a token is valid only while its grant is live: revocation, expiry and scopes are read from the grant on every request.
import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SqlRunner } from "../../../packages/mcp/src/journal-pg.ts";
import type { ServiceConfig } from "./config.ts";
import { signConsentRequest } from "./internal.ts";

export const ACCESS_TTL_S = 600;
export const SCOPES = ["account:read", "links:read", "payments:read", "reports:read", "links:write"] as const;
const DEFAULT_SCOPES = ["account:read", "links:read", "payments:read", "reports:read"]; // never write by default
const MAX_REDIRECTS = 10;
const MAX_NAME = 100;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const sameUrl = (a: string | URL, b: string | URL) => String(a).replace(/\/$/, "") === String(b).replace(/\/$/, "");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// ponytail: a hard ceiling on registered clients (open dynamic registration). Real use is a handful per merchant; past this,
// registration refuses until old rows are reviewed. Upgrade: expire clients that never completed a grant.
export const MAX_CLIENTS = 5000;

/** Names only a vendor may use, and the hosts its redirects must go to (loopback: the vendor's own local tool, Claude Code). */
const RESERVED_NAMES: { pattern: RegExp; hosts: string[]; loopback: boolean }[] = [
  { pattern: /chat\s*gpt|open\s*ai/i, hosts: ["chatgpt.com", "openai.com"], loopback: false },
  { pattern: /claude|anthropic/i, hosts: ["claude.ai", "claude.com"], loopback: true },
];
const onHost = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

/** The client's own name made safe to show (review 058 R1 H1): full-width forms folded, no control, format (zero-width,
 *  bidi), surrogate or private-use characters, spaces collapsed. The consent screen still trusts only the redirect host. */
export const cleanName = (name: string): string =>
  name.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

interface GrantRow {
  id: string;
  client_id: string;
  merchant: string;
  scopes: string;
  resource: string;
  expires_at: string;
  revoked_at: string | null;
}

export class PgOAuthProvider implements OAuthServerProvider {
  readonly #sql: SqlRunner;
  readonly #config: ServiceConfig;
  readonly #now: () => number;

  constructor(opts: { sql: SqlRunner; config: ServiceConfig; now: () => number }) {
    this.#sql = opts.sql;
    this.#config = opts.config;
    this.#now = opts.now;
  }

  // ── clients (dynamic registration) ──
  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId) => {
        const [row] = await this.#sql.query("SELECT client_id, metadata, created_at::text AS created_at FROM app_mcp_clients WHERE client_id = $1", [clientId]);
        if (!row) return undefined;
        const metadata = (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>;
        return { ...metadata, client_id: row.client_id as string, client_id_issued_at: Math.floor(Number(row.created_at) / 1000) } as OAuthClientInformationFull;
      },
      registerClient: async (client) => {
        // Public clients only: PKCE protects the code, and a confidential client would mean storing a secret.
        if (client.token_endpoint_auth_method !== undefined && client.token_endpoint_auth_method !== "none") throw new InvalidClientMetadataError("Only public clients (token_endpoint_auth_method none) are supported; PKCE is required.");
        const grants = client.grant_types ?? ["authorization_code", "refresh_token"];
        if (!grants.every((g) => g === "authorization_code" || g === "refresh_token")) throw new InvalidClientMetadataError("grant_types may only be authorization_code and refresh_token.");
        const uris = client.redirect_uris ?? [];
        if (uris.length < 1 || uris.length > MAX_REDIRECTS) throw new InvalidClientMetadataError(`Give between 1 and ${MAX_REDIRECTS} redirect URIs.`);
        for (const raw of uris.map(String)) {
          const url = URL.canParse(raw) ? new URL(raw) : null;
          const safe = url && !url.hash && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname)));
          if (!safe) throw new InvalidClientMetadataError("Every redirect URI must be https (http only for localhost), with no credentials or fragment.");
        }
        const name = cleanName(String(client.client_name ?? "")) || "An AI assistant";
        // a vendor's name is reserved for clients whose every redirect goes to that vendor (review 058 R1 H1): an app called
        // "ChatGPT" that sends codes to its own server is refused here, and the consent screen labels by host anyway
        const hosts = uris.map((raw) => new URL(String(raw)).hostname.toLowerCase());
        for (const reserved of RESERVED_NAMES) {
          if (!reserved.pattern.test(name.replace(/[^\p{L}\p{N}\s]/gu, ""))) continue;
          const allowed = hosts.every((h) => reserved.hosts.some((v) => onHost(h, v)) || (reserved.loopback && LOOPBACK.has(h)));
          if (!allowed) throw new InvalidClientMetadataError("That client name belongs to another company's app. Use your own app's name.");
        }
        const [{ n }] = await this.#sql.query("SELECT count(*)::int AS n FROM app_mcp_clients");
        if (Number(n) >= MAX_CLIENTS) throw new InvalidClientMetadataError("Too many apps are registered with this server right now. Try again later.");
        const clientId = `client_${randomBytes(16).toString("base64url")}`;
        const now = this.#now();
        const metadata = { client_name: name, redirect_uris: uris.map(String), grant_types: grants, response_types: ["code"], token_endpoint_auth_method: "none", scope: SCOPES.join(" ") };
        await this.#sql.query("INSERT INTO app_mcp_clients (client_id, metadata, created_at) VALUES ($1, $2::jsonb, $3)", [clientId, JSON.stringify(metadata), now]);
        return { ...metadata, client_id: clientId, client_id_issued_at: Math.floor(now / 1000) } as OAuthClientInformationFull;
      },
    };
  }

  // ── authorization: hand the request to the dashboard, where the signed-in merchant approves it ──
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const resource = params.resource ?? this.#config.mcpUrl;
    if (!sameUrl(resource, this.#config.mcpUrl)) throw new InvalidTargetError("This server only issues tokens for its own MCP endpoint.");
    const scopes = params.scopes?.length ? params.scopes : DEFAULT_SCOPES;
    for (const scope of scopes) if (!(SCOPES as readonly string[]).includes(scope)) throw new InvalidScopeError(`Unknown scope ${scope}.`);
    const request = signConsentRequest(
      { clientId: client.client_id, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, scopes: [...new Set(scopes)], ...(params.state !== undefined ? { state: params.state } : {}), resource: this.#config.mcpUrl.href },
      this.#config.internalSecret,
      this.#now(),
    );
    const target = new URL("/merchant/ai/authorize", this.#config.webOrigin);
    target.searchParams.set("request", request);
    res.redirect(302, target.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const [row] = await this.#sql.query("SELECT code_challenge, grant_id, used_at::text AS used_at, expires_at::text AS expires_at FROM app_mcp_codes WHERE code_hash = $1 AND client_id = $2", [sha256(authorizationCode), client.client_id]);
    if (!row) throw new InvalidGrantError("The authorization code is invalid.");
    if (row.used_at !== null) {
      await this.#revokeGrant(row.grant_id as string); // a replayed code: whoever holds the first tokens loses them
      throw new InvalidGrantError("The authorization code was already used.");
    }
    if (Number(row.expires_at) <= this.#now()) throw new InvalidGrantError("The authorization code expired.");
    return row.code_challenge as string;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const now = this.#now();
    // one atomic statement spends the code: of two concurrent redemptions exactly one gets a row
    const [spent] = await this.#sql.query(
      "UPDATE app_mcp_codes SET used_at = $2 WHERE code_hash = $1 AND client_id = $3 AND used_at IS NULL AND expires_at > $2 AND ($4::text IS NULL OR redirect_uri = $4) AND ($5::text IS NULL OR rtrim(resource, '/') = rtrim($5, '/')) RETURNING grant_id",
      [sha256(authorizationCode), now, client.client_id, redirectUri ?? null, resource ? resource.href : null],
    );
    if (!spent) throw new InvalidGrantError("The authorization code, redirect URI or resource doesn't match, or it was already used or expired.");
    const grant = await this.#liveGrant(spent.grant_id as string);
    if (!grant || grant.client_id !== client.client_id) throw new InvalidGrantError("This authorization was revoked or has expired.");
    return this.#issue(grant, `family_${randomBytes(9).toString("base64url")}`);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, _scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const now = this.#now();
    const hash = sha256(refreshToken);
    // Check the request BEFORE spending the token (code review 058 M3): a refused request must leave the token usable, or
    // the client's corrected retry would look like reuse and revoke the grant. Requested scopes are not checked: the tokens
    // always carry exactly the grant's approved scopes (read from the grant on every request), and `scope` in the answer
    // says what they are. A client re-sending scopes it once asked for therefore can't widen anything, and isn't broken.
    if (resource) {
      const [target] = await this.#sql.query("SELECT g.resource FROM app_mcp_tokens t JOIN app_mcp_grants g ON g.id = t.grant_id WHERE t.token_hash = $1 AND t.kind = 'refresh' AND g.client_id = $2", [hash, client.client_id]);
      if (target && !sameUrl(resource, target.resource as string)) throw new InvalidTargetError("That resource isn't the one this authorization was issued for.");
    }
    const [spent] = await this.#sql.query(
      "UPDATE app_mcp_tokens t SET used_at = $2 FROM app_mcp_grants g WHERE t.token_hash = $1 AND t.kind = 'refresh' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > $2 AND g.id = t.grant_id AND g.client_id = $3 RETURNING t.grant_id, t.family_id",
      [hash, now, client.client_id],
    );
    if (!spent) {
      const [seen] = await this.#sql.query("SELECT t.grant_id, t.used_at::text AS used_at FROM app_mcp_tokens t JOIN app_mcp_grants g ON g.id = t.grant_id WHERE t.token_hash = $1 AND t.kind = 'refresh' AND g.client_id = $2", [hash, client.client_id]);
      if (seen && seen.used_at !== null) await this.#revokeGrant(seen.grant_id as string); // reuse: assume the token leaked
      throw new InvalidGrantError("The refresh token is invalid, expired or was already used.");
    }
    const grant = await this.#liveGrant(spent.grant_id as string);
    if (!grant) throw new InvalidGrantError("This authorization was revoked or has expired.");
    return this.#issue(grant, spent.family_id as string);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const now = this.#now();
    const [row] = await this.#sql.query(
      `SELECT t.expires_at::text AS token_expires, g.id, g.client_id, g.merchant, g.scopes, g.resource
         FROM app_mcp_tokens t JOIN app_mcp_grants g ON g.id = t.grant_id
         JOIN wf_businesses b ON b.id = g.business_id AND b.legacy_merchant = g.merchant
         JOIN wf_memberships m ON m.business_id = g.business_id AND m.principal_id = g.approved_by AND m.role = 'owner'
        WHERE t.token_hash = $1 AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > $2 AND g.revoked_at IS NULL AND g.expires_at > $2`,
      [sha256(token), now],
    );
    if (!row) throw new InvalidTokenError("The access token is invalid, expired or was revoked.");
    return {
      token,
      clientId: row.client_id as string,
      scopes: (row.scopes as string).split(" ").filter(Boolean),
      expiresAt: Math.floor(Number(row.token_expires) / 1000),
      resource: new URL(row.resource as string), // the audience this grant was issued for; the middleware compares it with ours
      extra: { grantId: row.id, merchant: row.merchant },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const now = this.#now();
    const hash = sha256(request.token);
    // RFC 7009: revoking a refresh token ends its whole family; an unknown token is not an error
    await this.#sql.query(
      "UPDATE app_mcp_tokens t SET revoked_at = $2 FROM app_mcp_grants g WHERE g.id = t.grant_id AND g.client_id = $3 AND t.revoked_at IS NULL AND (t.token_hash = $1 OR t.family_id IN (SELECT family_id FROM app_mcp_tokens WHERE token_hash = $1 AND kind = 'refresh'))",
      [hash, now, client.client_id],
    );
  }

  // ── internals ──
  async #liveGrant(id: string): Promise<GrantRow | undefined> {
    const now = this.#now();
    const [row] = await this.#sql.query("SELECT g.id, g.client_id, g.merchant, g.scopes, g.resource, g.expires_at::text AS expires_at, g.revoked_at::text AS revoked_at FROM app_mcp_grants g JOIN wf_businesses b ON b.id = g.business_id AND b.legacy_merchant = g.merchant JOIN wf_memberships m ON m.business_id = g.business_id AND m.principal_id = g.approved_by AND m.role = 'owner' WHERE g.id = $1 AND g.revoked_at IS NULL AND g.expires_at > $2", [id, now]);
    return row as unknown as GrantRow | undefined;
  }

  async #revokeGrant(grantId: string): Promise<void> {
    const now = this.#now();
    await this.#sql.query("UPDATE app_mcp_grants SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [grantId, now]);
    await this.#sql.query("UPDATE app_mcp_tokens SET revoked_at = $2 WHERE grant_id = $1 AND revoked_at IS NULL", [grantId, now]);
  }

  async #issue(grant: GrantRow, family: string): Promise<OAuthTokens> {
    const now = this.#now();
    const [access, refresh] = [opaque(), opaque()];
    await this.#sql.query(
      "INSERT INTO app_mcp_tokens (token_hash, kind, grant_id, family_id, expires_at) VALUES ($1, 'access', $3, $4, $5), ($2, 'refresh', $3, $4, $6)",
      [sha256(access), sha256(refresh), grant.id, family, now + ACCESS_TTL_S * 1000, Number(grant.expires_at)],
    );
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: grant.scopes };
  }
}

