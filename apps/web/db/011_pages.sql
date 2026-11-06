-- FR-GW-2 payment pages: fixed items or an open amount, priced in `currency` (fiat becomes USDT at checkout).
-- items is JSON text [{"name": "...", "price": "<6-decimal units>"}], NULL for an open-amount page (open_min/open_max).
-- House rules (lib/server/db.ts): merchant addresses lowercase, times BIGINT unix ms, money BIGINT 6-decimal units.
CREATE TABLE IF NOT EXISTS app_gw_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  merchant TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  color TEXT,
  currency TEXT NOT NULL,
  items TEXT,
  open_min BIGINT,
  open_max BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_gw_pages_merchant ON app_gw_pages (merchant, created_at);
