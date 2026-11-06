# Spec: 013-P4-gateway-pay-hardening

Gateway API (claude-contracts). Phase mode, Money: yes. Batch 012's security review N1–N5, while no route calls these functions yet.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-12 / FR-GW-7** (N1): `onSessionPaid(session, paidAmount)` takes the claimed price as a **required** argument, so tsc flags any caller that would confirm or report the undiscounted price.
- **FR-GW-12** (N2): `applyVoucher`'s insert and upsert themselves refuse a paid checkout (not only the read before them).
- **FR-GW-12** (N3): `releaseHold`'s docstring lists exactly when it may be called (batch-009 F1: the claiming attempt only, a pre-relay refusal, a 4xx/BUSY, a 422 only after `findPayment` returned null, settle's "open" branch; never unknown / 409 / STILL_PENDING / paid).
- **FR-GW-7** (N4): `onRefund(session, amount, totalRefunded, paidAmount)` reports the price actually paid as `data.amount`.
- **NFR-11** (N5): the F1 test asserts after HOLD_MS, where only the frozen-paid rule can keep the code held.

## Acceptance criteria
- [ ] `onSessionPaid(session, paidAmount, now?)`, `onRefund(session, amount, totalRefunded, paidAmount, now?)`: required; tests updated; `data.amount` = paidAmount in both.
- [ ] `applyVoucher` SQL: `AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)` in the INSERT … SELECT WHERE and the DO UPDATE WHERE; test: a paid checkout's apply is refused even if the pre-read is bypassed (call order shown in the test).
- [ ] `releaseHold` docstring per N3.
- [ ] F1 test: the "stays held" check runs after HOLD_MS.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`; one reviewer-security pass.

## Files (owner: claude-contracts)
- `apps/web/lib/server/{vouchers,events}.ts`, `apps/web/test/gw-{vouchers,events}.test.mjs`, `.batches/013-P4-gateway-pay-hardening/*`

## Ponytail ladder
- Two signatures made strict, one NOT EXISTS in two places, one comment, one test time. No schema change.

## Out of scope
- claude-frontend's routes (the release call sites themselves, settle.ts's paid-amount comparison, pending.amount).
