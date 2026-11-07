-- Batch 031-PW4 Part C (FR-REL-5, FR-REL-10 theme; owner: "restart preserves ... rate-limit state"): the web app's
-- request limits (lib/server/http.ts sharedRateLimit) move out of process memory, so every Vercel instance counts against
-- the same window and a restart or a fresh instance doesn't reset it. One row per limit key ("quotes:<ip>",
-- "sessions:<merchant>", ...; keys over 200 characters are stored as "sha256:<hex>"): a fixed window that starts at the
-- key's first call and ends at reset_at. Counted by one INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement.
-- House rules (lib/server/db.ts): times BIGINT unix ms, read back as ::text. Our own app_web_ prefix, so the tests'
-- resetDb() truncates it. Idempotent and additive: safe to re-run on Neon.
-- Rollback: the pre-031 code never reads it; DROP TABLE IF EXISTS app_web_rate_limits after deploying that code.
CREATE TABLE IF NOT EXISTS app_web_rate_limits (
  key TEXT PRIMARY KEY,
  count BIGINT NOT NULL,
  reset_at BIGINT NOT NULL
);
-- pruneRateLimits(): DELETE ... WHERE reset_at < $1, run every PRUNE_EVERY calls per instance
CREATE INDEX IF NOT EXISTS app_web_rate_limits_reset ON app_web_rate_limits (reset_at);
