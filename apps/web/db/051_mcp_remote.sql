-- Batch 058 phase B/C: the remote MCP connection's shared state (FR-MCP-1..3; SRS-CHANGE FR-MCP-18..20 proposed).
-- House rules (lib/server/db.ts): merchant addresses lowercase, times BIGINT unix ms.
-- NOT applied to any shared database by this batch: an owner runs it (apps/web/db/migrate.mjs) after review.

-- The write journal for the remote endpoint: one document per tenant scope (a hash of backend + environment + merchant,
-- packages/mcp Journal.scope), changed only by compare-and-swap on `version`, so concurrent requests on any instance
-- serialize without interactive transactions (Neon's HTTP driver has none).
-- ponytail: one document per merchant scope, capped by the journal's own pruning (200 unresolved, 2,000 settled);
-- upgrade to a row per entry if a single merchant ever approaches that.
CREATE TABLE IF NOT EXISTS app_mcp_journal (
  scope TEXT PRIMARY KEY,
  version BIGINT NOT NULL,
  entries JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Delegated authorization for the hosted MCP endpoint (OAuth 2.1 authorization code + PKCE S256). Credentials are opaque
-- and only their SHA-256 is stored; the plain value is shown to the client once. Scopes, expiry and revocation live on the
-- grant and are read from here on every request, so a revoke or a scope change takes effect on the next call.

-- Registered clients (dynamic client registration). redirect_uris inside `metadata` are matched exactly.
CREATE TABLE IF NOT EXISTS app_mcp_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  metadata JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

-- One row per approved connection: who approved (the SIWE address), the merchant it is bound to (never changes), the
-- client, the approved scopes, and the audience (`resource`) its tokens are valid for. last_tool_ok_at is set ONLY by a
-- successful authenticated tool call under this grant: it is the sole source of "Verified".
CREATE TABLE IF NOT EXISTS app_mcp_grants (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  merchant TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES app_mcp_clients (client_id),
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  last_tool_ok_at BIGINT,
  last_error_category TEXT
);
CREATE INDEX IF NOT EXISTS app_mcp_grants_merchant ON app_mcp_grants (merchant);

-- Authorization codes: single use (used_at), 60 seconds, bound to the client, redirect URI, PKCE challenge and audience.
CREATE TABLE IF NOT EXISTS app_mcp_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES app_mcp_grants (id),
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

-- Access tokens (10 minutes) and rotating refresh tokens. A refresh token is used once; presenting a used one again
-- (reuse) revokes its whole family and the grant.
CREATE TABLE IF NOT EXISTS app_mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id TEXT NOT NULL REFERENCES app_mcp_grants (id),
  family_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS app_mcp_tokens_grant ON app_mcp_tokens (grant_id);
-- revoking a refresh token ends its whole family (review 058 R1 M3)
CREATE INDEX IF NOT EXISTS app_mcp_tokens_family ON app_mcp_tokens (family_id);
