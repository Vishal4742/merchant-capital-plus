-- Batch 050-PW2 (Stage 3, SRS v3.1 FR-BIZ-1..7, FR-AUTH-1..5, CON-11; adapted from whiteflow-ef's batch-032 draft for
-- Privy sign-in): principals, business workspaces, memberships,
-- server-revocable sessions, single-use challenges, immutable settlement-policy versions, idempotency, in-app
-- notifications and an append-only audit log. Additive and re-run safe (IF NOT EXISTS everywhere); splitter-compatible
-- (no DO blocks or functions). Times are BIGINT unix ms (house rule, lib/server/db.ts).
-- Rollback: the pre-032 code never reads these tables or columns; after redeploying it, the wf_* tables and the two
-- added columns may stay or be dropped (DROP TABLE IF EXISTS wf_...; ALTER TABLE app_gw_keys DROP COLUMN IF EXISTS business_id).

-- The signed-in account: one row per Privy user (FR-BIZ-6 v3.1). The login identity is the Privy DID, never a wallet.
-- email: the address Privy verified for this user, if any (display and member lookup only).
CREATE TABLE IF NOT EXISTS wf_principals (
  id TEXT PRIMARY KEY,
  privy_did TEXT NOT NULL UNIQUE CHECK (privy_did ~ '^did:privy:[A-Za-z0-9]{1,64}$'),
  email TEXT CHECK (email IS NULL OR char_length(email) <= 254),
  created_at BIGINT NOT NULL,
  last_sign_in_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS wf_principals_email ON wf_principals (lower(email));

-- External wallets Privy verified for a principal (from the verified identity token at each sign-in; the set is
-- replaced each time). Only these can sign an Owner's policy approval (step-up, FR-BIZ-4). Never embedded wallets.
CREATE TABLE IF NOT EXISTS wf_principal_wallets (
  principal_id TEXT NOT NULL REFERENCES wf_principals (id),
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (principal_id, address)
);
CREATE INDEX IF NOT EXISTS wf_principal_wallets_address ON wf_principal_wallets (address);

-- A workspace. owner_count is maintained in the SAME statement as every membership change that adds or removes an
-- owner; the CHECK makes the last owner impossible to remove or demote, even under concurrency (spec A, R1-2).
-- legacy_merchant links a backfilled workspace to the existing gateway rows keyed by merchant wallet (R1-4).
CREATE TABLE IF NOT EXISTS wf_businesses (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  timezone TEXT NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  created_by TEXT NOT NULL REFERENCES wf_principals (id),
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  owner_count INTEGER NOT NULL CHECK (owner_count >= 1),
  legacy_merchant TEXT UNIQUE CHECK (legacy_merchant IS NULL OR legacy_merchant ~ '^0x[0-9a-f]{40}$'),
  v1_obligations BOOLEAN NOT NULL DEFAULT false,
  created_at BIGINT NOT NULL,
  UNIQUE (created_by, idem_key)
);

-- Exactly one membership per principal and business; no ON DELETE CASCADE (owner_count must move with every removal).
CREATE TABLE IF NOT EXISTS wf_memberships (
  business_id TEXT NOT NULL REFERENCES wf_businesses (id),
  principal_id TEXT NOT NULL REFERENCES wf_principals (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (business_id, principal_id)
);
CREATE INDEX IF NOT EXISTS wf_memberships_principal ON wf_memberships (principal_id);

-- Server-revocable sessions: the cookie holds a random token; only its sha256 is stored (FR-AUTH-2).
CREATE TABLE IF NOT EXISTS wf_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL REFERENCES wf_principals (id),
  active_business_id TEXT REFERENCES wf_businesses (id),
  privy_sid TEXT,
  created_at BIGINT NOT NULL,
  last_auth_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS wf_sessions_principal ON wf_sessions (principal_id);

-- Single-use, purpose-bound challenges: receiving (wallet-control proof), approval (Owner step-up), enroll (an enrolled
-- approval wallet endorses another; round 2 H1). Login is Privy's.
CREATE TABLE IF NOT EXISTS wf_challenges (
  nonce TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('receiving', 'approval', 'enroll')),
  principal_id TEXT REFERENCES wf_principals (id),
  business_id TEXT REFERENCES wf_businesses (id),
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL CHECK (char_length(message) <= 2048),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX IF NOT EXISTS wf_challenges_expiry ON wf_challenges (expires_at);

-- Immutable settlement-policy versions (insert-only; no UPDATE/DELETE path in code). Both proofs are stored (R1-1).
CREATE TABLE IF NOT EXISTS wf_settlement_policies (
  business_id TEXT NOT NULL REFERENCES wf_businesses (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  recipient TEXT NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$'),
  policy_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES wf_principals (id),
  proof_nonce TEXT NOT NULL UNIQUE REFERENCES wf_challenges (nonce),
  approval_nonce TEXT NOT NULL UNIQUE REFERENCES wf_challenges (nonce),
  approval_wallet TEXT NOT NULL CHECK (approval_wallet ~ '^0x[0-9a-f]{40}$'),
  v1_obligations BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (business_id, version)
);

-- Pinned approval wallets (round 2 H1, owner decision 2026-11-06): only these sign an Owner's policy approval. The
-- first is pinned by the workspace's first activation (no policy, none enrolled); every later one needs an endorsement
-- signed by an already-enrolled wallet of a current Owner (endorsed_by). Never deleted when Privy's linked set changes,
-- so a newly linked wallet (e.g. after an email takeover) can't approve. No delete path in code.
CREATE TABLE IF NOT EXISTS wf_approval_wallets (
  business_id TEXT NOT NULL REFERENCES wf_businesses (id),
  wallet TEXT NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  principal_id TEXT NOT NULL REFERENCES wf_principals (id),
  enrolled_at BIGINT NOT NULL,
  endorsed_by TEXT CHECK (endorsed_by IS NULL OR endorsed_by ~ '^0x[0-9a-f]{40}$'),
  -- round 3 (review S-H1): set when the wallet's Owner is removed or demoted, in the same statement. A revoked wallet
  -- never approves; coming back needs a fresh endorsement (which clears it). Rows are never deleted.
  revoked_at BIGINT,
  PRIMARY KEY (business_id, wallet)
);
CREATE INDEX IF NOT EXISTS wf_approval_wallets_principal ON wf_approval_wallets (business_id, principal_id);

-- Idempotency for every Stage 3 write (FR-AUTH-4, R1-8, R2-4): a plain INSERT in the same statement as the mutation.
CREATE TABLE IF NOT EXISTS wf_idempotency (
  business_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  request_hash TEXT NOT NULL,
  response JSONB,
  created_at BIGINT NOT NULL,
  CONSTRAINT wf_idempotency_pkey PRIMARY KEY (business_id, principal_id, operation, key)
);

-- In-app notices (e.g. "receiving policy changed") for the other Owners (R1-9); no email in Stage 3.
CREATE TABLE IF NOT EXISTS wf_notifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES wf_businesses (id),
  principal_id TEXT NOT NULL REFERENCES wf_principals (id),
  kind TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  read_at BIGINT
);
CREATE INDEX IF NOT EXISTS wf_notifications_principal ON wf_notifications (principal_id, created_at);

-- Append-only audit log (FR-AUTH-5): never updated or deleted by the code. No tokens, signatures or messages in detail.
CREATE TABLE IF NOT EXISTS wf_audit_events (
  id TEXT PRIMARY KEY,
  business_id TEXT,
  actor_principal_id TEXT,
  role TEXT,
  source TEXT NOT NULL,
  credential_id TEXT,
  request_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  version_hash TEXT,
  outcome TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS wf_audit_business ON wf_audit_events (business_id, at);

-- API keys belong to a business (backfilled from the legacy merchant wallet).
ALTER TABLE app_gw_keys ADD COLUMN IF NOT EXISTS business_id TEXT;
CREATE INDEX IF NOT EXISTS app_gw_keys_business ON app_gw_keys (business_id);
