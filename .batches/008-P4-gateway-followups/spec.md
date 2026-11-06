# Spec: 008-P4-gateway-followups

Gateway API only (claude-contracts, ARCHITECTURE §8). Two parts: (A) batch 007's review follow-ups, so claude-frontend can wire the voucher apply route safely; (B) the FX module becomes the single FX source (human 05:4x) with the SDK's conventions and a sanity band.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-12** vouchers: the price charged always equals the voucher hold (security R2-M1); a hold lives only as long as its checkout session plus a short grace (R2-M2, R2-L2); exact counting pinned to READ COMMITTED (R2-L1 / code N1); bad requests can't lock a merchant out of creating vouchers (code N2).
- **FR-GW-11** FX: one source for the whole app, matching packages/sdk's `priced {currency, amount, rate, rateAt, source}`: `rate` = units of the currency per 1 USD, `rateAt` = the source's publish date; Frankfurter v2 `/v2/rates?base=usd&quotes=…` (AED included at its 3.6725 peg); USDT rounded **up to the cent**; a sanity band (per-currency range, AED within 1% of 3.6725, rate date ≤ 7 days old) or 503.
- **FR-GW-9** reports: `?tz=<IANA zone>` (e.g. `Asia/Kolkata`) buckets by that zone's days (default UTC), so the dashboard's "today" matches.
- **NFR-11** test hygiene: no hard-coded future dates (code N3).
- **FR-GW-7 / AT-14**: a shop registers its webhook from a setup script with its secret key: `POST` and `GET /api/v1/webhooks` accept `Authorization: Bearer <sk_test_ key>` as well as the dashboard cookie; publishable keys are refused (claude-sdk 05:54).

## Acceptance criteria
- [ ] `amountDue(sessionId)` (`lib/server/vouchers.ts`): the live hold's `usdt_amount`, else the checkout's `usdt_amount`, else null (a shop's own session). Tests: no code, one code, a switched code, an expired hold.
- [ ] `applyVoucher` refuses a checkout older than `SESSION_TTL_MS` ("This checkout has expired."); a hold's `created_at` is the checkout's `created_at` (re-applying never extends it); holds count for `SESSION_TTL_MS + HOLD_GRACE_MS` (5 min). Tests: re-apply late doesn't extend; apply at 30 min refused; a hold still counts inside the grace.
- [ ] `db.ts` passes `{ isolationLevel: "ReadCommitted" }` to Neon's `sql.transaction`.
- [ ] `POST /api/v1/vouchers` rate-limits only after `voucherInput` validation passes.
- [ ] `quotes.ts`: v2 endpoint; `rate` per USD; `rate_at` in `quoteJson`; `usdtAmount` rounded up to the cent; band check → 503 with a plain message; `pricedJson(quote)` → the SDK's `priced` shape. Links/pages keep converting through the same functions (AT-13 FX line now shows the per-USD rate and its date). Tests: EUR 20.00 at 0.88875 per USD → 22.51 USDT (22.5035… up to the cent); USD 1:1; AED 36.725 → 10.00; a stale date, an out-of-band rate and AED off-peg are refused; the 15-min cache.
- [ ] Reports: `tz` validated with `Intl.DateTimeFormat` (bad zone → 400); IST bucketing test at 00:00-05:30 IST.
- [ ] `gw-links.test.mjs` uses now + 1 year for its expiry.
- [ ] Webhooks POST/GET: an `sk_test_` Bearer key works like the cookie for its merchant; a `pk_test_` key or a revoked key → 401. `db/046_rate_at.sql` (idempotent `ALTER … ADD COLUMN IF NOT EXISTS`) adds `rate_at` / `fx_rate_at`.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Files (owner: claude-contracts)
- `apps/web/db/046_rate_at.sql`, `apps/web/lib/server/{vouchers,db,quotes,links,checkouts,keys,reports}.ts`, `apps/web/app/api/v1/vouchers/route.ts`, `apps/web/app/api/v1/webhooks/route.ts`, `apps/web/test/gw-webhooks.test.mjs`, `apps/web/test/gw-events.test.mjs`, `apps/web/app/api/v1/reports/route.ts`, `apps/web/app/api/v1/reports.csv/route.ts`, `apps/web/app/api/v1/settlements/route.ts`, `apps/web/test/gw-{vouchers,links,pages,quotes,reports,settlements}.test.mjs`, `.batches/008-P4-gateway-followups/*`

## Ponytail ladder
- One helper, one guard, one option, one moved line, one test date; FX is a change of endpoint and rate direction in the module that already exists; `Intl.DateTimeFormat` (platform) for time zones; no new tables, no new dependencies.

## Out of scope
- Creating link/page sessions with `priced` + a 10-min expiry: needs claude-frontend's Session v2 `createSession` on main first (follow-up as soon as it merges). claude-frontend's apply and pay routes (they call `applyVoucher` and `amountDue`). The max-payment number (1,000 vs 10,000 USDT): asked claude-research; 1,000 stays until decided. Security M1 (open sign-in caps), M3 (`logo_url`), DNS rebinding.
