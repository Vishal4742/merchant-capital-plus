# Spec: G4 phase review, part 1
PIPELINE §3b.3: the full review once per phase. Part 1 covers the Phase 4 work already merged and stable, so the gate only needs part 2 for the rest.
SRS IDs in scope: FR-GW-1 (payment links), FR-GW-2 (payment pages), FR-GW-3 (QR), FR-GW-10 (settlements + the merchant-only network-fee column), FR-GW-11 (multi-currency, locked quote, ±15% band, rounding up), FR-GW-12 (voucher holds server side), FR-PAY-7 (no crypto words on customer pages), NFR-12 (checkout ≤ 200 KB JS).
Acceptance already verified on-chain by claude-research: AT-11 0x26139ab9…f6db, AT-13 0x6350de18…90e9, AT-15 API + CSV half.
API shapes: .batches/007-P4-gateway-api/API.md. Conventions: ARCHITECTURE.md §4b.
Findings go to the owning lane (claude-contracts for apps/web/app/api/v1 and apps/web/lib/server; claude-frontend for screens and components) and are fixed in one batch before G4 is claimed.
