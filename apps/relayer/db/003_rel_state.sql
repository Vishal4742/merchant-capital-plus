-- Batch 049 (port of batch 031, FR-REL-10, FR-REL-5, FR-REL-6): a FORWARD migration from the batch-037 schema
-- (001_rel.sql: rel_sent with BIGINT fee_wei + reverted flag, rel_lock lease) to the batch-031 state that
-- src/state.ts uses: a fenced lease (rel_lease), write-ahead rows with tx nonce, fence and status, and NUMERIC wei.
-- 001_rel.sql and 002_relayer_role.sql stay exactly as applied; nothing here edits or drops what they created.
-- Idempotent and additive: safe to re-run. No functions or DO blocks (db/statements.ts splits on a semicolon at a
-- line end). Apply from apps/relayer: npm run db:migrate. Then the owner runs 005_relayer_role_state.sql.
-- CUTOVER (security review 049 M1): after this file the batch-037 relayer can no longer write (its insert has no
-- tx_nonce: 23502), so it answers 503 to every relay until the new relayer is live. That is fail-closed by design: the
-- NOT NULLs below are what stop the old and the new relayer from sending at the same time. Order: freeze merges →
-- owner runs db:migrate, then 005 → merge/deploy the new relayer at once → check /health and one test payment.
-- ROLLBACK: owner-only db/rollback/003_rollback.sql (never run by db:migrate), then redeploy the batch-037 relayer.
-- rel_lock is left in place (unused from here on).

-- The send lock: one lease row per relayer address. `fence` goes up by one on every take and a release only expires
-- the row (never deletes it), so a fence number is never handed out twice for one relayer.
CREATE TABLE IF NOT EXISTS rel_lease (
  relayer TEXT PRIMARY KEY,
  fence BIGINT NOT NULL,
  until TIMESTAMPTZ NOT NULL
);

-- Write-ahead columns. status: signed (written ahead) | mined | reverted | unknown (broadcast failed or no receipt).
ALTER TABLE rel_sent ADD COLUMN IF NOT EXISTS tx_nonce BIGINT;
ALTER TABLE rel_sent ADD COLUMN IF NOT EXISTS fence BIGINT;
ALTER TABLE rel_sent ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE rel_sent ADD COLUMN IF NOT EXISTS reverted_at BIGINT;

-- Wei as NUMERIC(78,0) like the web app (a uint256 never overflows). No USING clause: BIGINT casts implicitly, and
-- without USING a re-run on a column that is already NUMERIC(78,0) does not rewrite the table (review 049 L1).
ALTER TABLE rel_sent ALTER COLUMN fee_wei TYPE NUMERIC(78, 0);

-- Rows written by the batch-037 relayer recorded no nonce or fence and no mined/unknown distinction: say so honestly.
-- tx_nonce -1 and fence 0 never occur for new rows (nonces start at 0 but are real; fences start at 1).
UPDATE rel_sent SET status = CASE WHEN reverted THEN 'reverted' ELSE 'unknown' END WHERE status IS NULL;
UPDATE rel_sent SET reverted_at = sent_at WHERE reverted AND reverted_at IS NULL;
UPDATE rel_sent SET tx_nonce = -1 WHERE tx_nonce IS NULL;
UPDATE rel_sent SET fence = 0 WHERE fence IS NULL;
ALTER TABLE rel_sent ALTER COLUMN tx_nonce SET NOT NULL;
ALTER TABLE rel_sent ALTER COLUMN fence SET NOT NULL;
ALTER TABLE rel_sent ALTER COLUMN status SET NOT NULL;
ALTER TABLE rel_sent DROP CONSTRAINT IF EXISTS rel_sent_status_check;
ALTER TABLE rel_sent ADD CONSTRAINT rel_sent_status_check CHECK (status IN ('signed', 'mined', 'reverted', 'unknown'));

-- Indexes for the ledger read (001 already has (relayer, sent_at) and (payer)).
CREATE INDEX IF NOT EXISTS rel_sent_relayer_payer ON rel_sent (relayer, payer, sent_at);
CREATE INDEX IF NOT EXISTS rel_sent_merchant ON rel_sent (relayer, merchant, sent_at) WHERE merchant IS NOT NULL;
CREATE INDEX IF NOT EXISTS rel_sent_reverted ON rel_sent (relayer, reverted_at) WHERE reverted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS rel_sent_tx ON rel_sent (tx_hash);
