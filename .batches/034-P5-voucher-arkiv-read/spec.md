# Spec: 034-P5-voucher-arkiv-read

## Requirements (cite docs/SRS.md IDs)
- FR-ARK-7: at checkout the server reads the code's live Arkiv entity (by its keyed hash, from our writer) and refuses a
  code whose entity is missing or expired. If Arkiv can't be reached it refuses the code with a plain reason; the
  customer can still pay without a code.
- FR-GW-12: each code is an Arkiv entity that expires with the code; redemptions are counted on our server (unchanged:
  Postgres stays the counter, Arkiv is now also read).
- AT-12: a page with two items is bought with a discount code; Arkiv holds the code entity and the checkout read it.

## What changes
`applyVoucher` (apps/web/lib/server/vouchers.ts), after the Postgres row passes its own checks (active, not expired,
uses left, minimum) and before the discount is computed: if the voucher has an `arkivEntityKey`, one Arkiv query
`select($key, expires_at).from(mcplus.voucher.v1).where(code_hash = HMAC(merchant:CODE)).ownedBy(writer).createdBy(writer).limit(1)`,
capped at 2 s. Same reader and owner+creator filter as capital-arkiv.ts (security 023 F2: anyone can write an entity
with our type, and an owner can hand one to us; the creator never changes).
- entity present, `expires_at` in the future → the code applies as today.
- no entity → "That code isn't valid."
- entity's `expires_at` passed → "That code has expired." (the same text the Postgres expiry check already uses).
- Arkiv unreachable, timed out, not configured, or the query throws → "We couldn't check this code right now. You can pay
  without it." Nothing is held (the reservation insert runs after this check), so the checkout stays payable at full price.
- the log line names only the voucher id and the redacted SDK error (redactArkivError); never the code, the secret or a key.

## Why a voucher without an arkivEntityKey keeps today's behaviour
A code whose mirror failed at create time (Arkiv down, a setting missing) has no entity and shows "Not on Arkiv" on the
Vouchers screen with a Publish button (batch 028). Refusing it at checkout would silently break codes the merchant made
while Arkiv was down, with nothing on the customer's side to explain it. The merchant sees the state and can publish;
once published, every checkout reads the entity. The key is written only by our server (recordMirror), so a customer
can't clear it to skip the read.

## Acceptance criteria (each checkable; Arkiv reader mocked in test/voucher-arkiv-read.test.mjs)
- [ ] entity present and live → discount applied, one Arkiv query with code_hash = HMAC, ownedBy = createdBy = writer.
- [ ] entity missing → refused "That code isn't valid.", no hold row.
- [ ] entity expired → refused "That code has expired.", no hold row.
- [ ] reader throws → refused with the plain reason, no hold row; the log has no code, secret or access key.
- [ ] reader hangs → refused with the plain reason within ~2 s, no hold row.
- [ ] Arkiv settings missing on a published voucher → refused with the plain reason (fails closed).
- [ ] no arkivEntityKey → applied as today with no Arkiv query.
- [ ] landing card: "640.00 of 1,000.00 funded · 2 investors" (invoices cap at 2 holders, batch 026).
- [ ] the vouchers.ts header no longer calls the Arkiv entity a write-only mirror.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass in apps/web.

## Files to touch
- apps/web/lib/server/vouchers.ts
- apps/web/test/voucher-arkiv-read.test.mjs (new)
- apps/web/test/gw-vouchers.test.mjs (its Arkiv mock answers the new owner+creator read with a live entity)
- apps/web/components/landing/Sections.tsx (one copy fix)

## Ponytail ladder
- Needed: the Arkiv prize disqualifies "Arkiv as a log nothing reads"; FR-ARK-7 is M.
- Reuses arkivClients, redactArkivError, codeHash, VoucherEntity and capital-arkiv's query shape; Promise.race for the
  timeout (no new dependency, no new module).

## Out of scope
- Caching the read (each apply is one query; the apply route is already rate limited).
- Checking the entity's kind/value against Postgres (Postgres stays the source of the discount amount).
