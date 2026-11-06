# Spec: 009-P4-gateway-s1-fx-priced

Gateway API (claude-contracts). Phase mode, Money: yes (one reviewer-security pass). Unblocks claude-frontend's voucher apply + pay routes and AT-13's FX line on link/page checkouts.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-12** (security S1, batch 008 review): the price a payment is relayed at is frozen with its voucher hold, so a hold can't be switched mid-payment; S2: holds count for the session TTL + 15 min (the relayer accepts signatures up to 900 s).
- **FR-GW-11** FX: sanity band = ±15% of today's rate for EUR/GBP/INR/SGD, AED = peg ± 1% (human 06:18; ARCHITECTURE §4b); S3: a cached rate served while the source is down still obeys the 7-day rule.
- **FR-GW-1 / FR-GW-2 / FR-GW-11 / AT-13**: a link or page checkout priced in a fiat currency creates its session with `priced` (the SDK shape) and the 10-min quote lock as its lifetime; USD and USDT links keep the 30-min session (USD with `priced` rate "1").

## Acceptance criteria
- [ ] `db/047_frozen.sql`: `ALTER TABLE app_gw_redemptions ADD COLUMN IF NOT EXISTS frozen_at BIGINT` (idempotent, ADD-only).
- [ ] `claimAmountDue(sessionId, now)` (`lib/server/vouchers.ts`): in one statement freezes the live hold (`frozen_at`) and returns its `usdt_amount`; no hold → the checkout's amount; not a link/page session → null. Idempotent (a second claim returns the same amount). `applyVoucher` refuses a session whose hold is frozen ("This checkout is being paid."). `amountDue` stays read-only. Test: the batch-008 reviewer's PoC (apply HALF, claim, apply ONE → refused; confirm(s, claimed) counts HALF; HALF then refuses another checkout).
- [ ] `HOLD_MS = SESSION_TTL_MS + 15 min`; tests updated.
- [ ] `quotes.ts` `BANDS` = EUR 0.7555–1.0221, GBP 0.6309–0.8536, SGD 1.0858–1.4690, INR 80.33–108.68, AED 3.635775–3.709225 (claude-frontend's numbers, 06:19); the stale-cache fallback re-checks each rate's date against now. Tests: a flipped EUR rate (1.1251) refused; a cached 8-day-old rate refused during an outage.
- [ ] `openCheckout` (`lib/server/links.ts`): non-USDT → `createSession({..., priced: {currency, amount, rate, rateAt, source}}, now, QUOTE_TTL_MS)` for fiat, the default TTL for USD; `pricedJson` reused where it fits. Tests on links and pages: EUR session has `priced` and `expiresAt = now + 10 min`; USDT has no `priced`.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`; one reviewer-security pass → `round-1/review-security.md`; Neon migration 047 under the human's standing approval.

## Files (owner: claude-contracts)
- Builder A: `apps/web/db/047_frozen.sql`, `apps/web/lib/server/vouchers.ts`, `apps/web/test/gw-vouchers.test.mjs`
- Builder B: `apps/web/lib/server/links.ts`, `apps/web/lib/server/pages.ts`, `apps/web/test/gw-links.test.mjs`, `apps/web/test/gw-pages.test.mjs`
- Lane: `apps/web/lib/server/quotes.ts`, `apps/web/test/gw-quotes.test.mjs`, `.batches/009-P4-gateway-s1-fx-priced/*`

## Ponytail ladder
- One column, one claiming UPDATE, one guard, two constants, one fallback check, one createSession argument. No new tables or dependencies.

## Out of scope
- claude-frontend's apply/pay routes (they call `applyVoucher`, `claimAmountDue`, `onSessionPaid`), the apply route's per-IP limit and in-flight refusal (theirs, R2-M2 second half).
