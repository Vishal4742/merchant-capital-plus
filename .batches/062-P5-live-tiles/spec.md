# Spec: 062-P5-live-tiles

## Requirements (cite docs/SRS.md IDs)
- FR-GW-1 (payment links), FR-GW-2 (payment pages), FR-GW-3 (QR), FR-GW-4 (the one-line button): the landing's four Accept tiles show working examples of each, not drawings.
- FR-UX-4: the copy controls are labelled buttons; links are real links.

## Acceptance criteria
- [ ] landingDemo() reads DEMO_LINK_SLUG / DEMO_PAGE_SLUG (each must match SLUG, else null) and the site origin (PUBLIC_ORIGIN, else https://whiteflow.org).
- [ ] With DEMO_LINK_SLUG set: tile 01 shows <host>/l/<slug> as a link with a working Copy (the full URL); tile 03 is the real QR (/qr/l/<slug>) linking to the same page; tile 04 is the real snippet `<script src="<origin>/v1/button.js" data-link="<slug>"></script>` with a Copy.
- [ ] With DEMO_PAGE_SLUG set: tile 02 opens /p/<slug>.
- [ ] Unset: the tiles stay as plain illustrations with no fake controls (no "Copy" that does nothing, no QR pretending to scan).
- [ ] 375 light + 1440 dark: no h-scroll, CSP 0 (home has none), console 0; the QR decodes to the link.
- [ ] tsc, lint, npm test, build.

## Files to touch
- apps/web/lib/config.ts (landingDemo), components/landing/Sections.tsx (Accept), components/landing/landing.css, components/CopyButton.tsx (optional className), test/landing-tiles.test.mjs (new)
- .batches/061-P5-hero-trim/round-1/ci.md (061's ci record, not yet in git)

## Ponytail ladder
- Reuse: CopyButton, the /qr route, button.js, PUBLIC_ORIGIN. New: one config function, one className prop.

## Out of scope
- Creating the demo link and page (the human, in the dashboard) and renaming the G5 QA links (audit M2).
