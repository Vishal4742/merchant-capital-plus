-- FR-GW-1 payment links. amount is the price in `currency` as 6-decimal units (NULL: the payer enters the amount);
-- a fiat price becomes USDT at checkout. Status is computed from cancelled_at, paid checkouts and expires_at.
-- House rules (lib/server/db.ts): merchant addresses lowercase, times BIGINT unix ms, money BIGINT 6-decimal units.
CREATE TABLE IF NOT EXISTS app_gw_links (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  merchant TEXT NOT NULL,
  amount BIGINT,
  currency TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_id TEXT,
  single_use BOOLEAN NOT NULL,
  expires_at BIGINT,
  cancelled_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (merchant, reference_id)
);
