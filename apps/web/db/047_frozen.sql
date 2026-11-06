-- FR-GW-12, security S1 (batch 009): the pay route freezes a session's voucher hold when it claims the price, so a
-- re-apply during the relay can't switch the code. A frozen hold counts against the usage limit until it is confirmed.
-- Idempotent and ADD-only: safe to re-run on Neon.
ALTER TABLE app_gw_redemptions ADD COLUMN IF NOT EXISTS frozen_at BIGINT;
