# Spec: 022-P4-arkiv-mirror-hardening

Gateway API (claude-contracts). Phase mode, Money: yes (the Arkiv writer key signs). Batch 021 security review follow-ups.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-12 / FR-ARK-1** (M1): a voucher never gets two Arkiv entities: before writing, the mirror asks Arkiv for an entity of ours with this voucher's `code_hash` (the HMAC binds merchant + code) and adopts it if found; an attempt's finishing UPDATE releases the lease only if it still holds it; the lease outlasts the SDK's 180 s receipt wait (5 min).
- **FR-GW-12** (L1): if the Arkiv client can't be built after the lease was taken, the lease is released with the reason (no 3-minute "already publishing").
- **FR-GW-7** (L2): an inline webhook attempt that throws logs its error's name (never its message: it can hold the merchant's URL).
- **NFR-3**: nothing secret logged or stored.

## Acceptance criteria
- [ ] Tests (mocked Arkiv reader + writer): an existing entity is adopted with no createEntity call; the query failing stores a reason and writes nothing; an attempt that lost its lease to another doesn't clear the other's lease; a client that fails to build after the lease releases it; the attempt error's name is logged.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`; one reviewer-security pass.

## Files (owner: claude-contracts)
- `apps/web/lib/server/{vouchers,webhooks}.ts`, `apps/web/test/gw-{vouchers,webhooks}.test.mjs`, `.batches/022-P4-arkiv-mirror-hardening/*`

## Ponytail ladder
- One indexed Arkiv read before each write; a CASE on the lease column; one log line. No schema change.

## Out of scope
- L3 (event key + delivery rows in one transaction: cross-module, pre-existing, LOW); L4 (the MerchantPay address on a stored payment: with claude-frontend when sessions move to Neon).
