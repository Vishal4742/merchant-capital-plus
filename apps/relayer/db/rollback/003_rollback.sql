-- OWNER-ONLY rollback of 003_rel_state.sql (security review 049 M1). Never run by db:migrate (it reads db/NNN_*.sql
-- only, not this folder). Use only with the new relayer STOPPED, then redeploy the batch-037 relayer (one nonce
-- coordinator per key: never run both against the same RELAYER_PRIVATE_KEY).
-- It lets the batch-037 relayer write again (its insert has no tx_nonce/fence/status) and makes sure its breaker sees
-- every revert the batch-031 relayer recorded. Rows, the replay keys and today's spend are all kept.
ALTER TABLE rel_sent ALTER COLUMN tx_nonce DROP NOT NULL;
ALTER TABLE rel_sent ALTER COLUMN fence DROP NOT NULL;
ALTER TABLE rel_sent ALTER COLUMN status DROP NOT NULL;
UPDATE rel_sent SET reverted = true WHERE status = 'reverted' AND NOT reverted;
