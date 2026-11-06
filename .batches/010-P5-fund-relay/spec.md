# Spec: 010-P5-fund-relay (phase mode, Money: yes; human 08:20)
## Requirements
- **FR-ADV-3**: an eligible investor funds an advance (or invoice claim) by signing one message; the relayer submits it. **FR-REL-1/2**: allowlist adds exactly `CapitalMarket.fundWithAuthorization` (0xecd6…0abe). Drain guard as for sales; funding carries no relay fee, so the quote must be ≥ 1 USDT.
## Behaviour
- `POST /relay {action:'fund', args:{claimId, investor, units, validAfter, validBefore, salt}, sig}` → one batched read of `quote(claimId, units)` + `fundingNonce(claimId, investor, units, salt)` → the usual checks with value = quote, nonce = fundingNonce, `to` = CapitalMarket → send `fundWithAuthorization` → 200 `{txHash, blockNumber, gasUsed, gasCostWei}`.
## Acceptance criteria
- [ ] tsc + 53/53 tests (3 new: happy path to CapitalMarket with exact args; quote < 1 USDT → 422 below_minimum, no simulate/send; signature for MerchantPay → bad_signature).
- [ ] reviewer-security PASS; deployed to Vercel production.
