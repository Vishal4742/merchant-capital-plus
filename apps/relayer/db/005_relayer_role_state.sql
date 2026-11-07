-- Batch 049 (port of batch 031 onto the batch-037 least-privilege role): what the relayer's own role (mcplus_relayer,
-- created by 002_relayer_role.sql) needs for the batch-031 state, and nothing more. Run by the OWNER after 003 and 004,
-- like 002 (the relayer's runtime DATABASE_URL is that role; db:migrate skips *_role*.sql files).
-- Re-run safe: GRANT is idempotent. The audited unblock (rel_payer_unblocks INSERT) stays owner-only: operators run
-- db/unblock-payer.ts with the owner URL, and the relayer only reads unblocks.
GRANT SELECT, INSERT ON rel_lease TO mcplus_relayer;
GRANT UPDATE (fence, until, holder) ON rel_lease TO mcplus_relayer;
GRANT UPDATE (fee_wei, status, reverted_at, payer_fault_at) ON rel_sent TO mcplus_relayer;
GRANT SELECT ON rel_payer_unblocks TO mcplus_relayer;
