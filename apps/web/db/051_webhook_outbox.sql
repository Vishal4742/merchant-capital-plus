-- Batch 031-PW4 (FR-GW-7, FR-PAY-10): one lease shared by the inline attempt, the dispatcher and a manual replay, so a
-- delivery is never POSTed by two of them at once. NULL or a past time = free; a live time = an attempt is in flight.
-- Additive and re-run safe. Rollback: the column is unused by the pre-031 code, so it can stay or be dropped with
-- ALTER TABLE app_gw_deliveries DROP COLUMN IF EXISTS leased_until (after deploying the pre-031 code).
ALTER TABLE app_gw_deliveries ADD COLUMN IF NOT EXISTS leased_until BIGINT;
