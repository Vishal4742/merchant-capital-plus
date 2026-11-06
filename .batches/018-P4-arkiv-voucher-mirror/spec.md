# Spec: 018-P4-arkiv-voucher-mirror

Gateway API (claude-contracts). Phase mode, Money: yes (the Arkiv writer key signs). On G4's critical path: AT-12's Arkiv half.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-12 / FR-ARK-1 / SR-ARK-1**: a voucher's Arkiv mirror never fails silently: the outcome is stored on the voucher (`arkiv_error` with a fixed, secret-free reason, or the entity key + create tx hash) and shown in the API (`arkiv_status`, `arkiv_error`, `arkiv_tx_hash`).
- **FR-GW-12**: a merchant can retry the mirror: `POST /api/v1/vouchers/{id}/publish` (dashboard cookie; owner only; idempotent: an already-mirrored voucher isn't written again; an expired one is refused).
- **AT-12**: backfill voucher G4AT12 through the same code path; post its entity key, create tx hash and expiry.
- **NFR-3 / CON-7**: no key or env value is logged, stored or returned (reasons are fixed strings or `redactArkivError` output, capped at 200 chars).

## Acceptance criteria
- [ ] `db/049_arkiv_status.sql` (ADD-only, idempotent): `arkiv_error TEXT`, `arkiv_tx_hash TEXT`, `arkiv_attempted_at BIGINT` on `app_gw_vouchers`.
- [ ] `mirrorToArkiv` returns the outcome; `createVoucher` and `publishVoucher` record it; `voucherJson` adds `arkiv_status: "on_arkiv" | "not_on_arkiv"`, `arkiv_error`, `arkiv_tx_hash`.
- [ ] Route `app/api/v1/vouchers/[id]/publish/route.ts`; tests: a failed mirror stores its reason (missing secret, missing Arkiv config, write error with the key redacted); publish retries and records the entity key + tx; a mirrored voucher isn't re-written; another merchant's id → 404; an expired voucher → 409.
- [ ] Backfill G4AT12 on Neon (standing approval for ADD-only migrations covers 049; the Arkiv write is the batch-007 human-approved writer path).
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`; one reviewer-security pass.

## Files (owner: claude-contracts)
- `apps/web/db/049_arkiv_status.sql`, `apps/web/lib/server/vouchers.ts`, `apps/web/app/api/v1/vouchers/[id]/publish/route.ts`, `apps/web/test/gw-vouchers.test.mjs`, `.batches/018-P4-arkiv-voucher-mirror/*`

## Ponytail ladder
- Three columns, one outcome type, one route reusing createVoucher's mirror. No job queue (a button retries).

## Out of scope
- The merchant screen's "Publish to Arkiv" button and status text (claude-frontend); the :3100 server's env (claude-frontend).
