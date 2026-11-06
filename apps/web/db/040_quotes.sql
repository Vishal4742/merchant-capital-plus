-- FR-GW-11 FX quotes: a price in a fiat currency converted to USDT, locked for 10 minutes.
CREATE TABLE IF NOT EXISTS app_gw_quotes (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  usdt_amount BIGINT NOT NULL,
  rate TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
