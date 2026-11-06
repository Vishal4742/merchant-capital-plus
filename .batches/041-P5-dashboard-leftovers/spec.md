# Spec: 041-P5-dashboard-leftovers

## Requirements (cite docs/SRS.md IDs)
- FR-ADV-1, FR-INV-1: the merchant reaches the Capital tab from the home ("Get paid early" → /merchant/capital, no
  "Soon") and from an open invoice nothing is paid on ("Sell this invoice" → /merchant/capital?invoice=<id>, which
  PR #32's InvoicePanel preselects). Only such invoices: CapitalMarket lists unpaid open invoices only.
- FR-GW-12: the home's "Vouchers used" tile shows real numbers from the vouchers module: redemptions across all codes,
  and how many codes still work (voucherStatus "active"); "—" if unreadable, "0 · No codes yet" if none.

## Acceptance criteria (each must be checkable)
- [ ] test/home-tiles.test.mjs: vouchersUsed for null, none, and mixed codes (active, off, expired, used up).
- [ ] The home shows "Get paid early · Capital" as a link to /merchant/capital and no "Soon" in the tiles or actions.
- [ ] An open unpaid invoice row has "Sell this invoice" → /merchant/capital?invoice=<id>; part-paid, paid and
      cancelled rows don't.
- [ ] /merchant at 375 and 1440, light and dark: no horizontal scroll, 0 CSP violations.
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/app/merchant/page.tsx, apps/web/components/merchant/Invoices.tsx, apps/web/lib/gateway-money.ts
  (vouchersUsed next to voucherStatus), apps/web/test/home-tiles.test.mjs (new)

## Ponytail ladder (why this is the smallest change that works)
- Reuses merchantVouchers (gateway-server) and voucherStatus; anchors reuse the existing `action` and `link` classes.

## Out of scope
- app/merchant/capital/** and components/capital/** (PR #32).
