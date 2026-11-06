# Spec: 009-P4-web-landing

Request (verbatim): "hey i want more in landing page … looks bland and basic … see the design taste and find somethings intresting … and i want it to be fast" (human); the gateway v2 demo approved ("ya ggod"); "bhai tere se ui abhi tak nhi bana" (05:57). Phase mode (PIPELINE §3b): build + ci. Money: no (the hold-to-pay on the page is a visual demo and charges nothing).

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-14: the root layout's test-mode strip stays above the page, and the page doesn't repeat it.
- FR-GW-1/2/3/10/11/12, FR-GW-4/5/7: the page explains links, pages, QR, T+0 settlement, FX quotes, vouchers, the button, the SDK and webhooks, with the real SDK names from /docs.
- FR-PAY-4: "Try a checkout" stays a plain form POST to /api/demo-checkout (303, full load).
- NFR-13: the canvas scenes start after first paint, run only on screen and while the tab is visible, and draw one still frame under prefers-reduced-motion. No three.js on /.
- NFR-12 spirit: / ships 141,058 B of JS as Chrome downloads it (it was 428,834 B). CLS 0; LCP 696 ms at 375 with 4× CPU and slow 4G.
- NFR-6: plain words. Text contrast ≥ 4.5:1 (5.31:1 light, 6.12:1 dark).

## Acceptance criteria
- [ ] The / sections from design-refs/gateway-v2-demo.html:
  - hero: dithered night, gather and cursor parting
  - the checkout card with a real HoldButton demo
  - the FX ticker
  - 01 Accept
  - 02 Settle, with the orb
  - 03 voucher + quote with the 10:00 timer
  - 04 the "$" poster
  - 05 developers
  - 06 Capital
  - footer
- [ ] Every amount on the card matches the real rule (20 EUR at 0.88875 → 22.51 USDT, rounded up).
- [ ] typecheck, lint, `npm test`, build; screenshots at 375 and 1440, light and dark (builder: scratchpad/b012-tools/final/).

## Files (claude-frontend)
- `apps/web/app/page.tsx`
- `apps/web/components/landing/*` (new)
- `apps/web/lib/dither.ts` (exports BAYER; `sceneIntensity` takes an optional moonX, default 0.58)
- `apps/web/test/dither.test.mjs`
