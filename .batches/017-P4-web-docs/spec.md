# Spec: 017-P4-web-docs

Request (verbatim): "imporove the docs section" (human, 08:40). Phase mode, Money: no.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-8: /docs is a full developer guide:
  - quickstart, pay button (with a live preview), server SDK, webhooks
  - an API reference for every route, currencies and FX, limits and rate limits, errors
  - test mode with the test-keys box and "Simulate a payment", and a go-live checklist
- FR-GW-4/5/7/11: every endpoint, field, limit and error comes from the code. A drift test fails if the page documents a route that doesn't exist, or a limit or message the code doesn't have.
- NFR-6 / NFR-12: plain words; a server component plus one small client island (the button preview). /docs keeps its strict CSP.

## Acceptance criteria
- [ ] 10 sections in the gateway v2 design: a sticky numbered nav from md up, a section-chip row on phones, tables as cards at 375, copyable snippets.
- [ ] The webhook snippet keeps the reviewed logic: ignore test events and repeats, find the order by the checkout id, check the amount.
- [ ] `lib/docs-reference.ts` is the typed data. `test/docs-reference.test.mjs` (12) and `test/docs-limits.test.mjs` (13) check it against the code.
- [ ] typecheck, lint, `npm test`, build; 375 and 1440, light and dark, no overflow; 0 CSP violations; JS for /docs ≈ the old page (+976 B).

## Files
- `apps/web/app/docs/page.tsx`
- `apps/web/components/docs/{ui.tsx,Reference.tsx,ButtonPreview.tsx,snippets.ts}`
- `apps/web/lib/docs-reference.ts`
- `apps/web/test/docs-{reference,limits}.test.mjs`
