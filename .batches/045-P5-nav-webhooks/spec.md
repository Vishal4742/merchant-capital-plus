# Spec: 045-P5-nav-webhooks

## Requirements (cite docs/SRS.md IDs)
- FR-GW-7 (webhooks): the dashboard menu's Webhooks item links to the webhooks section of the Developers screen
  (/merchant/developers#webhooks, the `<h2 id="webhooks">` in components/gateway/Webhooks.tsx) instead of "Soon".

## Acceptance criteria (each must be checkable)
- [ ] test/nav-links.test.mjs: every menu item has an href, Webhooks → /merchant/developers#webhooks, no "Soon".
- [ ] /merchant at 375 (folded menu) and 1440 (sidebar): Webhooks is a link and lands on the webhooks section.
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/components/dashboard/Nav.tsx, apps/web/test/nav-links.test.mjs (new)

## Ponytail ladder (why this is the smallest change that works)
- One href; the "Soon" branch has no item left, so it is deleted rather than kept for later.

## Out of scope
- The investor offer book's Arkiv label (043, components/capital/investor/**).
