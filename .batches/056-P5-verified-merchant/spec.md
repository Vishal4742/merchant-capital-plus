# Spec: 056-P5-verified-merchant

## Requirements (cite docs/SRS.md IDs)
- FR-GW-1 / FR-GW-2 (hosted link and page), FR-PAY-5 (hosted checkout), FR-PAY-3 (invoice pay page), FR-PAY-7 (the pay page shows the merchant): the shop's name sits at the top of every customer pay sheet, in ink (not the small grey eyebrow), with a verified tick after it when the shop is verified.
- SRS v3.0 FR-BIZ-5 (PR #43, claude-research): "Verification statuses are shown separately and only when actually checked." So the tick is NOT shown for every merchant: a shop name is the merchant's own text, and a tick on any name would hand a phisher a blue tick. Today exactly one shop is checked: the operator-configured shop (MERCHANT_ADDRESS, set by us). FR-WLD-1 (World IDKit, later) or business verification flips it per merchant; that's one function to change (merchantVerified).
- FR-PAY-7: plain words; the tick's accessible name is "Verified merchant".
- NFR-16: nothing goes on chain (the flag is computed on our server).

## Acceptance criteria
- [ ] merchantVerified(address): true for the configured shop (any letter case), false for any other address, false with no shop configured.
- [ ] GET /api/v1/public/links/{slug} and /api/v1/public/pages/{slug} carry merchant_verified (true for the shop, false for another merchant); nothing else in the public JSON changes.
- [ ] /l/{slug}, /p/{slug}, /checkout/{id}, /pay/{id} show the name + tick at the top for the shop; another merchant's link shows its name with no tick.
- [ ] The dashboard's page preview matches what customers will see (tick when the merchant is verified).
- [ ] 375 light + 1440 dark screenshots of /l and /checkout; long names wrap, no h-scroll; FR-PAY-7 word scan clean.
- [ ] npx tsc --noEmit, npm run lint, npm test, npm run build.

## Files to touch (owner lane: only these)
- apps/web/components/MerchantName.tsx (new), components/gateway/Hosted.tsx, components/gateway/Pages.tsx, components/Checkout.tsx, components/InvoicePay.tsx
- apps/web/lib/server/http.ts, lib/server/links.ts, lib/server/pages.ts, lib/gateway-client.ts
- apps/web/app/checkout/[sessionId]/page.tsx, app/pay/[invoiceId]/page.tsx, app/merchant/pages/page.tsx
- apps/web/test/verified-merchant.test.mjs (new), test/gw-links.test.mjs, test/gw-pages.test.mjs (the pinned public JSON)

## Ponytail ladder
- Needed: the human asked. Already in repo: merchantName() already special-cases the configured shop, so merchantVerified() is its one-line sibling. Platform: inline SVG, no icon dependency. Minimum: one component, one boolean through the existing JSON.

## Out of scope
- World ID verification itself (FR-WLD-1, C, W8) and a per-merchant verified column (comes with workspaces, PR #44).
- The receipt page and the paid state's "to {shop}" line (no tick there; add if asked).
