-- Batch 031 round 3 (owner decisions at the human gate). Additive and re-run safe, like 001.
-- Apply from apps/relayer: npm run db:migrate

-- B8: the request that took a lease, so a take whose reply was lost (and is retried) is recognised as its own.
ALTER TABLE rel_lease ADD COLUMN IF NOT EXISTS holder TEXT;

-- B9: replaces the automatic ban. A mined revert is a payer-attributable failure only when a check at the revert block
-- shows the authorization still unused and the payer's USDT below the signed value (they moved it). Three of them
-- within 10 minutes start a 15-minute cooldown (RELAYER_COOLDOWN_* env, provisional testnet values). One row per
-- authorization, so failures are distinct by construction and a re-POST (a replay) can never add one.
ALTER TABLE rel_sent ADD COLUMN IF NOT EXISTS payer_fault_at BIGINT;
CREATE INDEX IF NOT EXISTS rel_sent_payer_fault ON rel_sent (payer, payer_fault_at) WHERE payer_fault_at IS NOT NULL;

-- B9: the audited unblock (db/unblock-payer.ts, operator CLI; no public endpoint). Failures at or before an unblock's
-- time no longer count. cooldown_until: the cooldown it lifted (NULL if none was active).
CREATE TABLE IF NOT EXISTS rel_payer_unblocks (
  id TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  cooldown_until BIGINT,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rel_payer_unblocks_payer ON rel_payer_unblocks (payer, at);
