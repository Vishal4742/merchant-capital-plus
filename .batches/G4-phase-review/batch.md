# G4 phase review, part 1 (stable Phase 4 work)
Owner lane: claude-research
Mode: phase
Base: 7b32902 (merge of PR #11, gateway backend batch 007, which had the full 5-check round)
Head: origin/main at review time
Scope: everything merged into main since the base under apps/web/ (backend batches 008-P4-gateway-followups and 009-P4-gateway-s1-fx-priced via PR #14; frontend batches 006-P4-web-gateway-shell follow-ups, 010-P4-web-links-pages-qr and 011-P4-web-network-fee). Batch 012+ of either lane is out of scope (part 2 at the gate).

## Part 2 (09:28)
Base: c719cef (part 1 head). Head: origin/main at review time, plus `apps/shop/` from origin/relayer (PR #19) if it isn't merged yet.
Scope: frontend 012-P4-web-developers, 013-P4-web-money-screens, 014-P4-web-ux-fixes, 015-P4-web-voucher-pay, 016-P4-web-direct-server-reads, 017-P4-web-docs (and 018 meter if merged); backend 012-P4-gateway-pay-integration, 013-P4-gateway-pay-hardening, 015-P4-g4-review-fixes (and 018 Arkiv mirror if merged); relayer 010-P5-fund-relay (apps/relayer); apps/shop (AT-14). Also re-check that part 1's H1, M2, M3, M4 are really closed.
Already verified on-chain: AT-11, AT-12 (payment + Arkiv entity), AT-13, AT-14, AT-15. Output: round-2/review-code.md and round-2/review-ux-ui.md.
