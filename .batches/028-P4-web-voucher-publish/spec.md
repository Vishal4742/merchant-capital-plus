# Spec: 028-P4-web-voucher-publish

## Requirements (cite docs/SRS.md IDs)
- FR-GW-12: each code is an Arkiv entity that expires with the code. When the mirror failed at create time, the
  merchant can retry it from the Vouchers screen (claude-contracts' route `POST /api/v1/vouchers/{id}/publish`, batch 018).

## Acceptance criteria (each must be checkable)
- [ ] `moneyClient().publishVoucher(id)` POSTs to `/api/v1/vouchers/{id}/publish` (id URL-encoded) and returns the parsed
      voucher plus `arkiv_error` (string or null); a malformed reply is refused like the other voucher calls.
- [ ] The call waits up to 200 s (the Arkiv SDK's receipt wait is 180 s), not the 10 s of the other calls.
- [ ] A voucher card with no Arkiv entity that is active and not expired shows "Publish to Arkiv"; while it runs the
      button says "Publishing…"; on success the screen refreshes and shows the entity; otherwise the server's
      `arkiv_error` (or the call's error) is shown under the button.
- [ ] Expired or deactivated codes keep the plain "Not on Arkiv" (the route refuses them with 409).
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/lib/gateway-money.ts
- apps/web/components/gateway/Vouchers.tsx
- apps/web/test/gateway-money.test.mjs

## Ponytail ladder
- Needed: a code whose mirror failed has no way back onto Arkiv today. The route exists; only the button is missing.
- Reuses moneyClient's call() (one optional timeout argument) and the Deactivate control's pattern.

## Out of scope
- Showing the stored arkiv_error on first render (the list reply would need it parsed everywhere).
