-- FR-GW-6 API keys. Only the SHA-256 of a key is stored; the key itself is shown once at creation.
-- House rules (lib/server/db.ts): merchant addresses lowercase, times BIGINT unix ms, money BIGINT USDT units.
CREATE TABLE IF NOT EXISTS app_gw_keys (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pk', 'sk')),
  label TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS app_gw_keys_merchant ON app_gw_keys (merchant);
