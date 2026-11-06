# Spec: 019-P4-web-g4-ux-blockers

Request: claude-research 09:34 "the G4 UX part-2 fixes first (H2 checkout sheet clipped at 375 with the code field open; M1 order-ahead page enabled at 0.00), because they block G4" (.batches/G4-phase-review/round-2/review-ux-ui.md). Phase mode, Money: no (layout, plus a client-side total; the server still validates every amount).

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-12 / NFR-6 (H2): at 375 the customer checkout sheet stays inside the screen with "Have a discount code?" open, an error shown, or "Discount applied". The Apply button and its focus ring aren't clipped.
- FR-GW-2 / NFR-6 (M1): on a payment page with items, the total updates as quantities change, and "Continue to pay" is disabled at 0.00 with the hint "Choose at least one item". It works without JS: the server-rendered button is disabled at 0.00, and "Update total" still reloads.
- NFR-12: /checkout and /p stay ≤ 204,800 B of JS.

## Acceptance criteria
- [ ] H2: the sheet and the code form are `min-w-0` / `w-full`; no fixed-width line forces the width. Measured at 375: sheet right edge ≤ 359.
- [ ] M1: `components/gateway/LiveTotal.tsx` (client) wraps the items list, recomputes the total with parseUsdt/formatUsdt on input, and disables "Continue to pay" at 0. The server checkout route still refuses an empty order.
- [ ] Tests: the total maths (pure helper); a quantity of 0 everywhere gives disabled.
- [ ] typecheck, lint, `npm test`, build; Playwright at 375: the checkout with the code field open shows no clipping; /p shows live totals and the disabled state.

## Files
- `apps/web/components/Checkout.tsx`
- `apps/web/components/gateway/{Hosted,LiveTotal}.tsx`
- `apps/web/lib/gateway-forms.ts` (a pure total helper, if needed)
- tests
