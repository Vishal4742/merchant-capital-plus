VERDICT: PASS

# Security review: 008-P4-gateway-followups, round 1 (phase mode, Money: yes, one pass)

Scope: `git diff 7b32902..HEAD -- apps/web` (17 files). I read the current `lib/server/{vouchers,keys,http,quotes,reports,links,checkouts,db,events,webhooks}.ts`, the webhooks and reports routes, `lib/sessions.ts`, `lib/pay.ts` and the existing `sessions/[id]/pay` route, plus batch 007's round-2 security review.

Commands run:
- `node --experimental-test-module-mocks --test test/gw-{vouchers,quotes,webhooks,reports,links,pages}.test.mjs` → 82 pass, 0 fail.
- `curl https://api.frankfurter.dev/v2/rates?base=usd&quotes=aed,eur,gbp,inr,sgd` → 200 with `[{"date":"2026-11-05","base":"USD","quote":"AED","rate":3.6725},{"date":"2026-11-06",...,"quote":"EUR","rate":0.88875},...]`. That is the shape and casing `fetchRates` parses (`base` "USD", `quote` upper case, numeric `rate`, a date on each row).
- A PoC against PGlite, `/private/tmp/claude-501/-Users-vg890-ethglobal-contracts/c6b19a0f-dc4e-4bc4-b19c-2f27badbf70b/scratchpad/poc-reapply.mjs`, for S1 below.

No HIGH or CRITICAL finding is reachable in the code as shipped: no route calls `applyVoucher` or `amountDue` yet. S1, however, has the same impact as batch 007's H1, and **it must be fixed before claude-frontend wires the apply and pay routes.**

## What is verified OK

1. **Vouchers (R2-M2, R2-L2 partial).** `applyVoucher` refuses a checkout once `now - checkout.createdAt >= SESSION_TTL_MS` (`vouchers.ts:183`). The checkout row is written just after `createSession` (`links.ts:79-82`), so this guard matches the session's own expiry to within milliseconds. The hold's `created_at` is the checkout's `created_at` on both the insert and the upsert (`:202-213`). A re-apply therefore can't extend a hold, and no checkout can lock a code for longer than `HOLD_MS` = 35 min. The hold count (`r.created_at > now - HOLD_MS`, `:206`) and `amountDue` (`created_at > now - HOLD_MS`, `:229`) use the same predicate, so a hold that `amountDue` prices is always a hold that `applyVoucher` counts. Advisory lock + guarded `INSERT … SELECT` is unchanged and still exact under READ COMMITTED.
2. **`amountDue` closes R2-M1 as written.** Two concurrent applies on one session leave one row (PK `session_id`, last writer wins). A pay route that charges the row's amount always charges a held price. The remaining gap is a third interleaving (S1).
3. **`db.ts:40-41` pin.** `@neondatabase/serverless` 1.2.0 `transaction(g, w)` forwards `w.isolationLevel` as the `Neon-Batch-Isolation-Level` header (`node_modules/@neondatabase/serverless/index.mjs:1298-1309`). The type allows `'ReadCommitted'` (`index.d.ts:489`). R2-L1 is closed.
4. **FX (`quotes.ts`).** The URL is a constant, so no request input reaches the fetch (no SSRF). Untrusted JSON is handled defensively:
   - a non-array body becomes an empty list;
   - `row?.` guards against null and primitive rows;
   - `base` must be "USD" and `quote` must be on the allowlist;
   - `rate` must be a JS number whose `String()` matches `^\d+(\.\d{1,12})?$`, so exponent forms are refused;
   - the date must be a real calendar day, at most 7 days old and no later than tomorrow;
   - every band minimum is > 0, so `num` can't be 0 and nothing divides by zero.

   Rounding is correct: `ceil(units·den / (num·10⁴))·10⁴` is the per-USD rate rounded up to the cent (EUR 20 at 0.88875 → 22.51). Each line is rounded up before `× qty` (`links.ts:51,75`), so the merchant is never short. The payer can't choose or influence the rate: USD/USDT are 1:1, everything else comes from one server-side cached fetch, and no stored rate is ever turned back into an amount (quotes store `usdt_amount`). The fetch-error path logs nothing.
5. **Webhooks with the secret key (`keys.ts:72-81`).** The cookie is tried first, then `authenticateKey`:
   - pk keys → 401 (`kind === "sk"` is required);
   - revoked keys → 401 (`revoked_at IS NULL` in the lookup);
   - unknown or malformed keys → 401 (pattern check, then the hash lookup).

   The merchant comes from the key's own row, so one merchant's key can only manage that merchant's webhooks. Only a 401 from the cookie falls through to the key; any other error is re-thrown. `/api/v1` sends no CORS headers (only `lib/anon.ts` sends `*`), so a browser page can't send an `Authorization` header cross-origin, and the key path adds no CSRF surface. URL checks (`httpsUrl` + the private-range block) and the 5-endpoint cap apply as before. `[id]`, test and replay stay cookie-only.
6. **Reports `?tz=` (`reports.ts:86-95`).** The value is capped at 64 characters and checked with `new Intl.DateTimeFormat(…, { timeZone })` inside try/catch, so any bad zone gets a 400. The zone only ever reaches Intl and is echoed in a JSON body. It never reaches SQL or headers: the CSV filename uses `from`/`to`, which are regex-checked dates or Intl `en-CA` output. Work is bounded by `MAX_DAYS` = 92, and all three routes stay cookie-only.
7. **Rate limit after validation** (`vouchers/route.ts:9-11`): an invalid body can't spend the merchant's 30/h. The route is cookie-only, so this adds no unauthenticated path.
8. **Migration `046_rate_at.sql`:** idempotent `ADD COLUMN IF NOT EXISTS` with a text date. No PII. Nothing new goes on chain or to Arkiv.

## FOLLOW-UP (none blocks this batch)

| # | Sev | Where | Issue / exploit sketch | Fix | Owner |
|---|---|---|---|---|---|
| S1 | **MEDIUM now; HIGH once the apply + pay routes ship. Blocks the integration batch.** | `lib/server/vouchers.ts:208-210` (the upsert switches a live hold), `:220-233` (`amountDue`, and the docstring claim "the price can never drift from the hold"), `:247`; `lib/server/events.ts:45`; `app/api/v1/sessions/[id]/pay/route.ts:41-48` | **Re-applying another code while the payment is in flight frees the paid code's use.** `amountDue` is read once, before a relay that takes seconds. `paid_at` stays NULL until `onSessionPaid`, so `applyVoucher` keeps accepting switches on that session in the meantime. Sketch: code HALF (50%, 1 use) and a public code ONE (1%, 1,000 uses). (1) apply HALF on S1; (2) POST pay, which reads `amountDue` = 50 and relays; (3) during the relay, apply ONE on S1 (the row becomes ONE at 99; HALF's hold is gone); (4) the relay settles at 50; `confirmRedemption(S1, 50)` finds no row at 50 and counts nothing (with `session.amount` = 99 it would count ONE instead); (5) HALF is free again, so the next checkout gets 50% off too. Repeat for unlimited HALF uses. This is H1 again. **PoC (sequential, PGlite):** `confirmRedemption(s1, 50): null` · `apply HALF on s2 …: { ok: true, … usdtAmount: 50000000n }` · `HALF times_redeemed: 0 of 1`. The webhook's `amount` (from `session.amount`) can also differ from what was paid on chain. | Freeze the hold when the payment starts, in the same statement that reads the price. Replace `amountDue` with `claimAmountDue(sessionId)`: `UPDATE app_gw_redemptions SET frozen_at = $now WHERE session_id = $1 AND confirmed_at IS NULL AND created_at > $now - HOLD_MS RETURNING usdt_amount` (else the checkout's amount). Add `AND app_gw_redemptions.frozen_at IS NULL` to the upsert's `WHERE`; one `ADD COLUMN IF NOT EXISTS frozen_at BIGINT`. Optionally unfreeze on a definite relay refusal. The pay route calls it after `claimPayment`, relays exactly that amount, and passes **that** amount (not a later `session.amount`) to `confirmRedemption` and the webhook. The apply route also refuses while `isInFlight(id) \|\| session.pending`. That check alone isn't enough (there is an `await` between the check and the upsert), so the freeze is the real fix. Add a test: apply A → claim → apply B is refused → confirm counts A. | claude-contracts (`vouchers.ts` + migration), claude-frontend (apply and pay routes) |
| S2 | LOW | `vouchers.ts:46` (`HOLD_MS = TTL + 5 min`) vs `lib/pay.ts:15-16` (`SIGNATURE_WINDOW_S = 465`, relayer max 900 s) | R2-L2 is only partly closed. The pay route may relay up to `expiresAt` (`pay/route.ts:47`) with `validBefore` up to now + 900 s (an honest client uses now + 465 s). An "unknown" outcome can settle 7.75 to 15 min after the session ends, but the hold lapses after 5 min. Another checkout can then take the last use; `confirmRedemption`'s `times_redeemed < max` guard fails, and the discounted payment is never counted: +1 oversell per edge event. An attacker needs an unknown relay outcome, which they can't easily force. | `HOLD_MS = SESSION_TTL_MS + MAX_RELAYER_WINDOW_S * 1000` (15 min), or have the pay route refuse `validBefore > expiresAt/1000 + 300` on link/page sessions. | claude-contracts (or claude-frontend for the cap) |
| S3 | LOW | `quotes.ts:81-82` | On a fetch failure the stale cache is served no matter how old it is, and the 7-day date rule is never checked again (it ran against the fetch-time `now`). A long-lived instance whose source stays down serves rates of any age, which contradicts the spec ("rate date ≤ 7 days old or 503"). `cache.fetchedAt` isn't moved forward either, so every request during an outage waits up to the 5 s timeout. Neither side controls this, so it isn't a payer exploit. | In `usdRate`, refuse a rate whose `rateAt` is more than `MAX_RATE_AGE_DAYS` before today (`now`), the same test as `checked:63`. Optionally cap the fallback's age (e.g. 24 h since `fetchedAt`) and back off re-fetches for a minute after a failure. | claude-contracts |
| S4 | INFO | `quotes.ts:20-26` | The bands catch garbage and order-of-magnitude errors, not a wrong rate inside them. EUR is accepted from 0.5 to 2 per USD (live 0.889): a bad source row at 2.0 would charge about 44% of the price. The source is HTTPS, the payer can't influence it, and `MAX_PAYMENT` limits each payment to 1,000 USDT. Daily reference rates vs the live market (1–2% at most) is inherent to the design. | Optional: narrow the bands to about ±20% of a reference, together with claude-frontend (both lanes share these numbers). | claude-contracts + claude-frontend |
| S5 | INFO (flag to the human: access-control change, PIPELINE §11) | `keys.ts:72-81`, `webhooks/route.ts:10,18` | The `sk_test_` key's scope is wider now. Until this batch, a leaked key could create sessions; now it can also register up to 5 endpoints and read the last 20 deliveries of each (payer address, amount, reference, tx hash) for that one merchant. The dashboard lists every endpoint and the merchant can delete them; nothing alerts the merchant when one is added. This is what AT-14 asks for, and Stripe works the same way. | None needed for the hackathon. Later: show "added with key <prefix>" on each endpoint in the dashboard. | claude-contracts (later) |
| S6 | INFO | `reports.ts:61,101` | Robustness only, not security: the default `to` and the day buckets depend on ICU's `en-CA` pattern being `YYYY-MM-DD`. ICU has changed that locale's pattern before. If it changes again, `addDays(to)` throws and the route returns 500 (no internals leak). Separately, `Date.UTC` maps years 0–99 to 1900s, so `?from=0050-…` gives a nonsense, empty range (the merchant's own data only). | `formatToParts` → `${year}-${month}-${day}`; refuse years < 2000 in `dateParam`. | claude-contracts |

Still open from batch 007 (not in this batch's scope):
- **R2-M2, second half:** a per-IP rate limit and a cap on live holds per IP in claude-frontend's apply route. N public checkouts can still lock an N-use code for 35 min each; this is an availability problem, no money is lost.
- **R2-L3:** the two-key advisory-lock form.
- **M1:** open sign-in, rate-limited only.
- **M3:** `logo_url`.

## Secret grep
`git diff --name-only 7b32902..HEAD -- apps/web | xargs grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'`: every hit predates this batch and is an env var name or a test fixture:
- `lib/server/vouchers.ts:125,127` (`VOUCHER_HASH_SECRET`, name only);
- `test/gw-helpers.mjs:7,8,47` (the test `AUTH_SECRET` fixture);
- `test/gw-vouchers.test.mjs:10,56,78,140,141` (the test hash secret);
- `test/gw-webhooks.test.mjs:52,211-217,226` (the test `CRON_SECRET`).

Over the **added** lines of the diff, the same pattern plus `sk_test_…{32}` and `whsec_…` literals has no hits. No 64-hex literal, no real key, and `.env` is untouched.
