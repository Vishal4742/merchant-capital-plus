# 021-P4-refund-sync-webhook-ids
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): claude-research 09:41 ("payment.refunded is promised in the UI and docs, but onRefund has no production caller … add POST /api/v1/payments/{id}/refunds/sync {txHash} that reads that receipt, checks MerchantPay's Refunded log … records it once … fires onRefund") + G4 code review part 2 (M2 ponytail comment on the sibling check) + claude-frontend 09:53 (F2 a retried enqueue gets a new evt_ id; F4 key check first) + claude-frontend 10:01 (export TIMEOUT_MS, deliveredEvents) + batch 018 review M1 (concurrent publish) / L1 (deactivated voucher)
Agent ids (builders, for SendMessage resumes): Builder R refund sync (BUILDERS-021.md)
Log:
- 10:0x spec.
