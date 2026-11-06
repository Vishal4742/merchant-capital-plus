-- FR-GW-11 (batch 008): keep the FX source's publish date with every quote and checkout, so the checkout shows the
-- rate and its date (the SDK's priced.rateAt). Idempotent: safe to re-run; the 040 / 005 tables are already live on Neon.
ALTER TABLE app_gw_quotes ADD COLUMN IF NOT EXISTS rate_at TEXT;
ALTER TABLE app_gw_checkouts ADD COLUMN IF NOT EXISTS fx_rate_at TEXT;
