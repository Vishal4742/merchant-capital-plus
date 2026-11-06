# Spec: 012-P4-gateway-pay-integration

Gateway API (claude-contracts). Phase mode, Money: yes. The batch-009 security review's contracts-side follow-ups, so claude-frontend's voucher apply + pay routes can be wired safely.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-12** (F1): `releaseHold` never unfreezes the hold of a paid checkout (paid_at set), so a late or mistaken release can't free a use that was paid for.
- **FR-GW-12 / FR-GW-7** (F3): `onSessionPaid(session, paidAmount = session.amount)` confirms the voucher against the price actually charged and reports that price as the webhook's `data.amount`.
- **FR-GW-12 / FR-GW-11** (F4): a fiat link/page checkout (10-min lock) can't take a code after 10 minutes; USD/USDT checkouts keep the 30-min session.

## Acceptance criteria
- [ ] `releaseHold(sessionId)` returns false (nothing changes) when the checkout is paid; test.
- [ ] `onSessionPaid(session, paidAmount)`: `confirmRedemption(session.id, paidAmount)` and `data.amount` = paidAmount; omitted → `session.amount`; tests in `gw-events.test.mjs`.
- [ ] `applyVoucher` refuses "This checkout has expired." when `now - createdAt >= QUOTE_TTL_MS` for a checkout whose `fx.currency` is not USD/USDT; test.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`; one reviewer-security pass.

## Files (owner: claude-contracts)
- `apps/web/lib/server/{vouchers,events}.ts`, `apps/web/test/gw-{vouchers,events}.test.mjs`, `.batches/012-P4-gateway-pay-integration/*`

## Ponytail ladder
- One join in one UPDATE, one optional parameter, one TTL pick. No schema change.

## Out of scope
- claude-frontend's routes (apply, pay, settlePending release) and their F2 order (claim after signature checks).
