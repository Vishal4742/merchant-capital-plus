-- FR-GW-12 / FR-ARK-1 (batch 018): a voucher's Arkiv mirror never fails silently. Stores the last attempt's outcome:
-- the create tx hash on success, a fixed secret-free reason on failure, and when it was tried. Idempotent, ADD-only.
ALTER TABLE app_gw_vouchers ADD COLUMN IF NOT EXISTS arkiv_error TEXT;
ALTER TABLE app_gw_vouchers ADD COLUMN IF NOT EXISTS arkiv_tx_hash TEXT;
ALTER TABLE app_gw_vouchers ADD COLUMN IF NOT EXISTS arkiv_attempted_at BIGINT;
