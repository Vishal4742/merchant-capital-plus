# Spec: 027-P4-web-refund-sync

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-8: the dashboard refund stays one click from the merchant's own wallet.
- FR-GW-7 / FR-PAY-10: after a refund's receipt, the dashboard names the tx to
  `POST /api/v1/payments/{id}/refunds/sync {tx_hash}` so the gateway sends the signed `payment.refunded` webhook.
- AT-15: Reports and the webhook log see the refund.

## Acceptance criteria (each must be checkable)
- [ ] `refund()` in lib/merchant-wallet.ts returns the refund tx hash (the receipt it already waits for).
- [ ] Refund.tsx POSTs `{tx_hash}` to the sync route after the refund; a 502 (receipt not readable yet) is retried
      twice with a 1.5 s pause; nothing else is retried.
- [ ] If the sync still fails, the refund is not reported as failed (the money already moved): the form closes and the
      row says "Refunded. The webhook didn't go out yet." and the table refreshes.
- [ ] A unit test pins the retry rule (502 retried, 400/401/404 not).
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/lib/merchant-wallet.ts (refund return value)
- apps/web/lib/refund-sync.ts (new: the sync call with its retry rule)
- apps/web/components/merchant/Refund.tsx
- apps/web/test/refund-sync.test.mjs (new)

## Ponytail ladder (why this is the smallest change that works)
- Needed: without it the shop never hears about dashboard refunds (the route exists, nothing calls it).
- Already in repo: the route, syncRefund and send() (which returns the receipt). Only the call is new.
- No new dependency; plain fetch, a 3-try loop.

## Out of scope
- The Capital nav link: no /merchant/capital page on main yet; it stays "Soon" until claude-contracts' screen lands.
- Re-sync of past refunds from the dashboard.
