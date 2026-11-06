-- Batch 031 (FR-REL-10, FR-REL-5, FR-REL-6): the relayer's send lock, replay set, daily WBT budget, rate limits and
-- breaker move out of process memory into Postgres, so they hold across Vercel Fluid instances (vercel.json "fluid").
-- House rules as in apps/web/lib/server/db.ts: times BIGINT unix ms, wei NUMERIC(78,0), both read back as ::text.
-- Idempotent and additive: safe to re-run. No functions or DO blocks (db/statements.ts splits on a semicolon at a line end).
-- Apply from apps/relayer: npm run db:migrate   (node --env-file=../../.env db/migrate.ts; prints table names only)

-- The send lock: one lease row per relayer address. Not an advisory lock: Neon's HTTP driver runs each statement as its
-- own request, so no session survives between statements to hold one. `fence` goes up by one on every take and a
-- release only expires the row (never deletes it), so a fence number is never handed out twice for one relayer.
CREATE TABLE IF NOT EXISTS rel_lease (
  relayer TEXT PRIMARY KEY,
  fence BIGINT NOT NULL,
  until TIMESTAMPTZ NOT NULL
);

-- Every signed relay transaction, written before it is broadcast (write-ahead) and only while the writer's lease is live.
-- One row per payer authorization ("<payer>:<authorization nonce>", lowercase): the replay set. fee_wei is the 0.0024 WBT
-- cap until a receipt gives the real cost: the daily budget. sent_at: the per-payer and per-merchant hourly limits.
-- reverted_at: the breaker (a mined revert bans the payer; three in an hour stop every relay).
-- status: signed (written ahead) | mined | reverted | unknown (broadcast failed or no receipt: it may still be mined).
-- ponytail: rows are never pruned (one per relayed payment). Upgrade: past ~1M rows, delete rows older than 2 days that
-- have no reverted_at (replay needs ≤ 15 min, limits 1 h, the budget today, bans keep their reverted rows).
CREATE TABLE IF NOT EXISTS rel_sent (
  auth_key TEXT PRIMARY KEY,
  relayer TEXT NOT NULL,
  payer TEXT NOT NULL,
  merchant TEXT,
  tx_hash TEXT NOT NULL,
  tx_nonce BIGINT NOT NULL,
  fence BIGINT NOT NULL,
  fee_wei NUMERIC(78, 0) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('signed', 'mined', 'reverted', 'unknown')),
  sent_at BIGINT NOT NULL,
  reverted_at BIGINT
);
CREATE INDEX IF NOT EXISTS rel_sent_relayer ON rel_sent (relayer, sent_at);
CREATE INDEX IF NOT EXISTS rel_sent_payer ON rel_sent (relayer, payer, sent_at);
CREATE INDEX IF NOT EXISTS rel_sent_merchant ON rel_sent (relayer, merchant, sent_at) WHERE merchant IS NOT NULL;
CREATE INDEX IF NOT EXISTS rel_sent_reverted ON rel_sent (relayer, reverted_at) WHERE reverted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS rel_sent_tx ON rel_sent (tx_hash);
