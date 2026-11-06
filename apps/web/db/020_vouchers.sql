-- FR-GW-12 vouchers. value is a whole percent (1..100) for kind 'percent', or USDT units for kind 'fixed'.
-- Codes are stored uppercase, unique per merchant. times_redeemed only counts confirmed (paid) redemptions.
CREATE TABLE IF NOT EXISTS app_gw_vouchers (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value BIGINT NOT NULL CHECK (value > 0),
  expires_at BIGINT NOT NULL,
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions BETWEEN 1 AND 100000),
  times_redeemed INTEGER NOT NULL DEFAULT 0 CHECK (times_redeemed BETWEEN 0 AND max_redemptions),
  min_amount BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  arkiv_entity_key TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (merchant, code)
);
-- One voucher per checkout session: reserved when applied, confirmed once the session is paid.
CREATE TABLE IF NOT EXISTS app_gw_redemptions (
  session_id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL REFERENCES app_gw_vouchers (id),
  discount BIGINT NOT NULL,
  usdt_amount BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  confirmed_at BIGINT
);
CREATE INDEX IF NOT EXISTS app_gw_redemptions_voucher ON app_gw_redemptions (voucher_id);
