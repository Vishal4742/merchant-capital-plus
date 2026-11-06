# Spec: 021-P4-web-voucher-speed

Request: claude-research 08:38 (AT-12 runner measured 5.82 s click-to-confirm on a voucher checkout, over NFR-4's 5 s); human 09:3x "Payment speed fix first". Phase mode, **Money: yes** (the pay route and what the customer signs), so one reviewer-security pass.

## Requirements (cite docs/SRS.md v2.0 IDs)
- NFR-4: a link/page checkout with a code no longer reads the code route before paying. The amount the customer signs travels in the pay body (`amount`, USDT units). This removes one browser→server trip and its 3 database round trips.
- FR-GW-12 / F1–F3 (claude-contracts 009 review): the order is unchanged (lock → settle "open" → claim → verify at the claimed price → balance → relay).
  - If the body's `amount` ≠ the claimed price, the attempt releases its hold (a pre-relay refusal F1 allows) and answers 409 with the due fields (`{error, amountDue, discount, amountUnits}`). The sheet shows the new total.
  - A malformed `amount` gives 400 before the lock. A missing `amount` (an older client) takes today's path.
  - The verify at the claimed price stays the backstop.
- NFR-12: /checkout stays ≤ 204,800 B (186,351 B measured, +16 B).

## Acceptance criteria
- [ ] `app/api/v1/sessions/[id]/pay/route.ts`: `gatewayCheckout(id)` overlaps the body read; the amount check after the claim, as above.
- [ ] `components/Checkout.tsx`: no pre-sign GET; signs and sends `due.amountUnits`; a 409 with the due fields updates the sheet.
- [ ] Tests (`test/voucher-pay.test.mjs`, 7 new, RED first): mismatch gives 409 and release; a matching amount proceeds; a missing amount works; malformed gives 400; the lock's 409 and STILL_PENDING release nothing; the overlap happens; the client source pin. All F1–F3 tests still pass.
- [ ] typecheck, lint, `npm test`, build.

## Files
- `apps/web/app/api/v1/sessions/[id]/pay/route.ts`
- `apps/web/components/Checkout.tsx`
- `apps/web/app/api/v1/sessions/[id]/voucher/route.ts` (comment)
- `apps/web/lib/docs-reference.ts` (the pay endpoint's text)
- `apps/web/test/voucher-pay.test.mjs`
