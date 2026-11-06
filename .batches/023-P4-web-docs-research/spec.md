# Spec: 023-P4-web-docs-research

Request (verbatim, human 09:22): "reaserch the company docs and see how they write the docs and others things"; at 09:5x the human chose "Docs: quick wins" and "Docs: full endpoint pages" from the research (scratchpad/docs-research.md: Stripe, Razorpay, Adyen, Checkout.com, Cashfree, PayPal, Coinbase, Circle; patterns only, nothing copied). Phase mode, Money: no (docs only; the drift tests run real route handlers on PGlite).

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-8: /docs gains:
  - curl next to the SDK (the SDK is in the repo's packages/sdk and not published; the page says so)
  - "How a payment works", with Quickstart prerequisites and a step 04 "Check it's paid"
  - one webhook events table (only payment.succeeded is sent; payment.refunded isn't yet)
  - full parameter pages for POST /sessions, GET /sessions/{id} and GET /payments
  - a test-scenarios table, Note/Warning callouts, a "What to do" errors column, the API reference regrouped, the checkout status lifecycle
- FR-GW-4/5/7/11, NFR-6: every documented field, event, status and message is pinned to the code (static drift tests, plus test/docs-endpoints.test.mjs, which runs the documented requests against the real handlers).
- NFR-12: no new client JS (/docs JS byte-identical).

## Acceptance criteria
- [ ] The 10 items above. Typecheck, lint, `npm test`, build.
- [ ] 375 and 1440, light and dark: no overflow, 0 CSP violations (builder, scratch b021).

## Files
- `apps/web/app/docs/page.tsx`
- `apps/web/components/docs/{Reference.tsx,snippets.ts,ui.tsx,Start.tsx}`
- `apps/web/lib/docs-reference.ts`
- `apps/web/test/{docs-reference,docs-endpoints}.test.mjs`

Note: batch 022's notes call the sessions-in-Neon batch "023"; batch numbers are assigned in order, so it is 024.
