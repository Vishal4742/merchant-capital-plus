-- FR-GW-1, G4 review M3 (batch 015): when the pay route last claimed this checkout's price (claimAmountDue), so a
-- single-use link refuses a second checkout while another one is paid or mid-payment; releaseHold clears it.
-- Idempotent and ADD-only: safe to re-run on Neon.
ALTER TABLE app_gw_checkouts ADD COLUMN IF NOT EXISTS claimed_at BIGINT;
