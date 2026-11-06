# 021-P4-refund-sync-webhook-ids
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): claude-research 09:41 ("payment.refunded is promised in the UI and docs, but onRefund has no production caller … add POST /api/v1/payments/{id}/refunds/sync {txHash} that reads that receipt, checks MerchantPay's Refunded log … records it once … fires onRefund") + G4 code review part 2 (M2 ponytail comment on the sibling check) + claude-frontend 09:53 (F2 a retried enqueue gets a new evt_ id; F4 key check first) + claude-frontend 10:01 (export TIMEOUT_MS, deliveredEvents) + batch 018 review M1 (concurrent publish) / L1 (deactivated voucher)
Agent ids (builders, for SendMessage resumes): Builder R refund sync (BUILDERS-021.md)
Log:
- 10:0x spec.
- 10:1x built (Builder R refund sync b664fe6; lane: stable event ids + deliveredEvents 2dd0084, publish lease + deactivated 2738e9e); ci PASS (178 gw / 483 total, 0 fail). Security PASS; follow-ups: M1 (an Arkiv write that times out after the receipt wait can still lead to a duplicate entity), L1 (lease kept when the client fails to build), L2 (log the swallowed attempt error's name), L3 (key + delivery rows in one transaction), L4 (record the MerchantPay address with a stored payment; with claude-frontend).
