# Spec: 018-P4-web-private-reads

Request: claude-research 06:46 list ("private-read meter (FR-PRIV-3)"); human 08:52 in claude-frontend's window: "Allow Nym, narrow list (Recommended)". Phase mode, **Money: yes** (the CSP on the dashboard that sends invoices, approvals and refunds; the refund/invoice read path), so one reviewer-security pass.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-PRIV-1: the merchant dashboard's browser chain reads go through Anon-RPC (Nym) once it has booted. Before that, or if it fails, they go through the wallet's RPC at once and count as plain. Writes always go through the wallet.
- FR-PRIV-3: a visible meter in the dashboard's top bar ("Private reads 7 of 9"), with a one-line explanation and a link to /proofs.
- FR-PRIV-4: the hosts the dashboard may reach for Nym are exactly:
  - publicnode (the bootstrap)
  - cdn.jsdelivr.net / unpkg.com / raw.githubusercontent.com (the bundle mirrors)
  - validator.nymtech.net
  - wss: (the gateway)
  
  plus a blob:/wasm worker, on /merchant only. Customer routes stay strict.
- NFR-13: the Nym boot starts after first paint (requestIdleCallback) and never blocks a refund. Known upstream gap: the harness hashes the bundle on the main thread (a ~1.1 s task, after paint).

## Acceptance criteria
- [ ] `lib/read-meter.ts`, `components/dashboard/PrivateReads.tsx`. `lib/merchant-wallet.ts` reads through `readVia(provider)`, with a 10 s private-read deadline that falls back to the wallet. `lib/anon.ts` counts its setup lookups.
- [ ] Shell: the chip shows at 375 in the menu row and at 1440 under the wordmark, in one row, with no overflow.
- [ ] `next.config.ts`: the /merchant CSP adds exactly the approved hosts. /merchant/pages keeps `img-src https:`. /checkout, /pay, /r, /l, /p, /counter and /docs are unchanged.
- [ ] Tests: the meter counts; no boot on import; a failed boot gives plain reads; booting doesn't make a refund wait; once ready, reads are private and sends go through the wallet; a Nym failure falls back.
- [ ] typecheck, lint, `npm test`, build; a curl of the CSP header on /merchant and on /checkout (unchanged).

## Files
- `apps/web/lib/{read-meter,merchant-wallet,anon}.ts`
- `apps/web/components/dashboard/{PrivateReads,Shell}.tsx`
- `apps/web/next.config.ts`
- `apps/web/test/{read-meter,merchant-wallet}.test.mjs`
