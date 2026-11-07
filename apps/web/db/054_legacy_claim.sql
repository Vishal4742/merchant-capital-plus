-- Batch 051 (Stage 3, SRS v3.1 FR-BIZ-1, FR-BIZ-3 pattern, FR-AUTH-3, CON-11): single-use challenges for linking a
-- legacy merchant wallet to a WhiteFlow workspace. An Owner asks; the server builds the EIP-4361 message bound to that
-- principal, workspace and wallet; the wallet signs; lib/server/legacy.ts consumes it in the statement that sets
-- wf_businesses.legacy_merchant (UNIQUE, 053) and moves the wallet's app_gw_keys into the workspace.
-- Its own table on purpose: wf_challenges.purpose stays as 053 defines it. Additive and re-run safe; splitter-compatible.
-- Rollback: the pre-051 code never reads it; DROP TABLE IF EXISTS wf_legacy_claim_challenges (the 053 columns stay).
CREATE TABLE IF NOT EXISTS wf_legacy_claim_challenges (
  nonce TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES wf_principals (id),
  business_id TEXT NOT NULL REFERENCES wf_businesses (id),
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  message TEXT NOT NULL CHECK (char_length(message) <= 2048),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX IF NOT EXISTS wf_legacy_claim_challenges_expiry ON wf_legacy_claim_challenges (expires_at);
