# Spec: 015-P4-g4-review-fixes

Gateway API (claude-contracts). Phase mode, Money: yes. The G4 phase review's findings for this lane, before the Capital tab continues.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-11 / AT-13** (H1): a fiat link or page checkout converts its **total** once (rounded up to the cent), so the charge equals a quote for the same total; USDT and USD (rate exactly 1) convert **exactly**, no rounding (a 10.123456 USDT link charges 10.123456).
- **FR-GW-1** (M3): a single-use link is paid at most once: `claimAmountDue` refuses (410) a checkout of a single-use link when another checkout of it is paid or mid-payment (claimed within the signature window), under a per-link lock.
- **FR-GW-1 / FR-GW-2** (LOW): a fiat link or page can't be created with a price that can never be paid (a fixed link outside 1–1,000 USDT at today's rate, an item above 1,000 USDT, an open minimum above 1,000 USDT).
- **FR-GW-12** (F2): a frozen voucher hold stops counting after `FREEZE_MS` (the relayer's 15-min signature window + 5 min), so an abandoned claim can't lock a use forever.
- **FR-GW-11** (F6): after a failed FX fetch, wait 60 s before fetching again (serve the checked cache or 503 at once).
- **FR-GW-1** (claude-frontend 08:19): `GET /api/v1/public/links/{slug}` adds `paid_at` (ISO) when status is paid, else null.
- **FR-GW-12** (batch-013 P1): `releaseHold`'s docstring states the rules in `relaySale`'s result shape (`refused`, `unknown`, other).

## Acceptance criteria
- [ ] H1: tests: 2 × 10 EUR page at 0.88875 → 22.51 (= `createQuote("20.00","EUR")`); gw-pages' cart test 20.96 → 20.94; a 10.123456 USDT link charges 10.123456; USD 1:1 exact.
- [ ] M3: `db/048_claimed.sql` (`ALTER TABLE app_gw_checkouts ADD COLUMN IF NOT EXISTS claimed_at BIGINT`); `claimAmountDue` sets `claimed_at` and throws `HttpError(410, "This payment link has already been paid.")` when another checkout of the same single-use link is paid or claimed within `FREEZE_MS`; `releaseHold` clears `claimed_at`; tests incl. two checkouts claiming in turn and after a release.
- [ ] LOW: creation tests for each refused case; USDT/USD unchanged.
- [ ] F2: a frozen hold older than `FREEZE_MS` no longer counts or blocks; the probe's "a week later" case applies.
- [ ] F6: a failed fetch then a call 10 s later makes no second request; 61 s later it does.
- [ ] `paid_at` test on the public link.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md` (verdict from the tools' own markers); one reviewer-security pass; Neon migration 048 under the human's standing approval.

## Files (owner: claude-contracts)
- Builder X: `apps/web/lib/server/{links,pages}.ts`, `apps/web/test/gw-{links,pages}.test.mjs`
- Builder Y: `apps/web/db/048_claimed.sql`, `apps/web/lib/server/{vouchers,checkouts}.ts`, `apps/web/test/gw-vouchers.test.mjs`, `apps/web/test/gw-single-use.test.mjs`
- Lane: `apps/web/lib/server/quotes.ts`, `apps/web/test/gw-quotes.test.mjs`, `.batches/015-P4-g4-review-fixes/*`

## Ponytail ladder
- Conversion moves from per-line to per-total in one function; one column + one guarded UPDATE under the existing advisory-lock transaction; one time constant; one failure timestamp. No new tables or dependencies.

## Out of scope
- claude-frontend's routes (they handle claimAmountDue's 410); the Capital tab (next batch).
