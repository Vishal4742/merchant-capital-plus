# Spec: 021-P4-refund-sync-webhook-ids

Gateway API (claude-contracts). Phase mode, Money: yes. Makes `payment.refunded` real and webhook delivery exactly-once per event id.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-7 / FR-PAY-10 / AT-15** (refund half): `POST /api/v1/payments/{id}/refunds/sync {tx_hash}` (dashboard cookie): reads that tx's receipt from the chain, takes MerchantPay's `Refunded(paymentId, amount, totalRefunded)` log for THIS payment from MerchantPay's address only, and fires `onRefund(session, amount, totalRefunded, payment.amount)` → `payment.refunded` (once per refunded total; `onRefund` already dedupes). The client's claim is never trusted: no Refunded log → 400; a reverted tx → 400; another merchant's payment → 404.
- **FR-GW-7** (claude-frontend F2): a webhook event's id is derived from its sendOnce key (`evt_` + base64url(sha256(key))[0..24]), so a re-enqueue after a partial failure reuses the same id and a merchant deduping on `event.id` never ships twice. F4: the key check runs before building the data.
- **FR-GW-7** (claude-frontend 10:01): `export const TIMEOUT_MS`; `deliveredEvents(merchant) → {test, payment}`.
- **FR-GW-12** (batch 018 review M1, L1): `publishVoucher` takes a 3-min lease on `arkiv_attempted_at` (a concurrent publish → 409 "Publishing to Arkiv already, try again in a minute."), create takes it too; a deactivated voucher isn't published (409).
- **FR-GW-1** (G4 part 2 M2): a `ponytail:` note on claimAmountDue's sibling check (it relies on onSessionPaid having marked the other checkout paid).

## Acceptance criteria
- [ ] Refund sync: tests with a mocked receipt: a good Refunded log fires one payment.refunded with amount / refunded / refund_amount; the same tx again changes nothing; a log from another contract or another payment id is ignored (400); a reverted receipt → 400; unknown / another merchant's payment → 404; no cookie → 401.
- [ ] Event ids: the same sendOnce key gives the same `evt_` id across a failed and a retried enqueue (test).
- [ ] `deliveredEvents`: test event vs real payment event, per merchant.
- [ ] Publish lease + deactivated refusal: tests.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`; one reviewer-security pass.

## Files (owner: claude-contracts)
- Builder R: `apps/web/lib/server/refunds.ts`, `apps/web/app/api/v1/payments/[id]/refunds/sync/route.ts`, `apps/web/test/gw-refunds.test.mjs`
- Lane: `apps/web/lib/server/{events,webhooks,vouchers}.ts`, `apps/web/test/gw-{events,webhooks,vouchers}.test.mjs`, `.batches/021-P4-refund-sync-webhook-ids/*`

## Ponytail ladder
- No new table: onRefund's existing sendOnce key is the idempotency record; the event id is a hash of that key; the lease reuses arkiv_attempted_at.

## Out of scope
- claude-frontend calling the sync route after the merchant's refund receipt; GET /api/v1/sessions/:id's amount (their file).
