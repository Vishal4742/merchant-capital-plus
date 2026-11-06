-- Which checkout session came from which payment link or page (FR-GW-1, FR-GW-2). Vouchers apply only to these
-- sessions (FR-GW-12), single-use links flip to paid from here, and webhooks carry link_id / page_id from here.
CREATE TABLE IF NOT EXISTS app_gw_checkouts (
  session_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'page')),
  ref_id TEXT NOT NULL,
  merchant TEXT NOT NULL,
  usdt_amount BIGINT NOT NULL,
  -- The price the payer saw and the rate that set usdt_amount (FR-GW-11, AT-13): checkout shows them, and the
  -- session's fixed amount is the lock. USD/USDT rows say "USD = USDT 1:1".
  fx_currency TEXT,
  fx_amount BIGINT,
  fx_rate TEXT,
  fx_source TEXT,
  fx_fetched_at BIGINT,
  created_at BIGINT NOT NULL,
  paid_at BIGINT
);
CREATE INDEX IF NOT EXISTS app_gw_checkouts_ref ON app_gw_checkouts (kind, ref_id);
