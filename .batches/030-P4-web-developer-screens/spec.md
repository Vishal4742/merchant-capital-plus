# Spec: 030-P4-web-developer-screens

## Requirements (cite docs/SRS.md IDs)
- FR-GW-6 (API keys): the Developers screen creates secret and publishable test keys, shows a new key once
  (copy, no .env line for a publishable key), lists keys with created / last used, revokes.
- FR-GW-7 (webhooks): add an https endpoint, show its signing secret once, send a test event, see the last 5
  deliveries with a plain reason per failure (redirect, 401, 404, 5xx, no answer in 5 s), resend, delete.
- A 4-step setup strip (secret key, endpoint, test event answered, real payment event) from deliveredEvents.

## Acceptance criteria (each must be checkable)
- [ ] /merchant/developers renders keys, webhooks and the setup strip at 375 and 1440, light and dark, no horizontal
      scroll, 0 CSP violations under its strict CSP.
- [ ] Failure reasons follow lib/server/webhooks.ts (TIMEOUT_MS pinned in test/dev-screens.test.mjs).
- [ ] Copy names both events the gateway sends now: payment.succeeded and payment.refunded (batch 027).
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/app/merchant/developers/page.tsx, lib/gateway-dev.ts, test/dev-screens.test.mjs
- apps/web/components/gateway/{ApiKeys,Webhooks,Setup,RevealOnce,Share,Links,Pages}.tsx, components/CopyButton.tsx

## Ponytail ladder
- Uses claude-contracts' existing keys/webhooks routes and deliveredEvents; no new dependency or table.

## Out of scope
- lib/server/webhooks.ts (claude-contracts); a separate Webhooks nav page (the menu keeps "Soon").
