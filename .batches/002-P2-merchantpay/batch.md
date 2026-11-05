# 002-P2-merchantpay
Phase: 2 (PHASES.md)   Round: spec   Owner lane: claude-contracts
Request (verbatim):
Agent ids (builders, for SendMessage resumes):
Log:
- 22:55 batch started; nonce/ABI answers sent to claude-frontend + claude-relayer; spec written; plan-reviewer ran (findings folded into spec)
- 23:00 RED f885e37 (24/27 failing); 23:05 GREEN a67d260 (via_ir for the 10-arg paySale); 23:07 scripts 2424138
- 23:08 deployed 0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7 from clean commit 2424138; FULL Blockscout match; smoke sale + refund by the deployer; 099bb97 shared ABI; announced 23:10
- 23:12 outside (Codex): low stuck-USDT (no sweep), info ERC-1271 tests; 23:26 tester PASS (39/39, re-entry probe, LOW merchant==MerchantPay); 3c3d85a tester tests; reviewers launched
- 23:38 round 1 complete: test, review-code, review-security, review-ux-ui, ci all VERDICT: PASS; outside (Codex) no high/medium
- 23:40 HUMAN GATE (fresh proof: Blockscout fully verified, owner/fee/feeRecipient/paused read live, sale status true, payer 0 WBT nonce 0, MerchantPay holds 0, forge test 39/39). Answers (human): (1) fee recipient stays the relayer hot wallet 0xdd02…a651; (2) self-merchant / self-recipient guards land in the Phase 3 redeploy (relayer refuses such sales meanwhile); (3) keep "an order is paid once" with the random-orderRef + gross/payer check; (4) ADD an owner-only sweep in Phase 3 (stray USDT sent by plain transfer becomes recoverable)
