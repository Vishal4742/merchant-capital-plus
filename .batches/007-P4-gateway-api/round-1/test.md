VERDICT: PASS

Tester, round 1, fast mode, API only (no pages changed: no screenshots, no Lighthouse). Run from apps/web.

## Evidence
- `node --experimental-test-module-mocks --test test/gw-*.test.mjs`: 92 tests (before my file), 92 pass. My new file adds 3, all pass.
- `npm test`: 227 tests, 225 pass, 0 fail, 2 skipped (claude-frontend live tests).
- `npm run typecheck` clean, `npm run lint` clean (re-run before my file was added; it is plain .mjs).
- Not run: `npm run dev` curl probe (PGlite tests are the evidence, per the brief); `npm run build` (builder reports it green; CI owns it).

## Added
`apps/web/test/gw-tester-webhooks.test.mjs` (3 tests): route-level cross-merchant 404 on webhook delete / test / replay and 401 anonymous; exact retry schedule (due at +1 m, then +5 m, then +30 m after each attempt, `failed` after the 4th, nothing due 1 ms early); dispatch auth (empty, prefix-only and wrong secrets 401, unset CRON_SECRET 503).

## Criteria
- DB files idempotent, tables `app_gw_*` only; PGlite applies every `db/NNN_*.sql`: PASS (gw-helpers setupDb). Neon migration not applied (needs the human, as stated).
- `query()` Neon/PGlite switch: PASS (every test runs real SQL).
- Dashboard routes 401 without cookie, other merchant's id 404: PASS for keys, links, pages, vouchers (deactivate), webhooks, reports, settlements (gw-keys:20,64; gw-links:44,99; gw-pages:45; gw-vouchers:60,162; gw-reports:86; gw-settlements:66,83; tester file).
- Keys (shown once, hash only, revoked/unknown null, cap): PASS (gw-keys 6 tests).
- Quotes: PASS. `getQuote` null at exactly 10 min, round-up, bounds, USD 1:1, 15 min cache, per-IP 429 (gw-quotes:36 ff.).
- Links: PASS. Status order (paid outranks expired), single-use flip once, reference_id unique, stored price wins over request (gw-links:127,166,193).
- Pages: PASS. Prices from the stored page only; unknown item, duplicate, qty <1 or >100 give 400 (gw-pages:134).
- Vouchers: PASS. Link/page sessions only, apply rules, last-use race with one winner (gw-vouchers:197,210,256), Arkiv hash only and failure path redacted.
- Webhooks: PASS. SSRF (DNS answers), 5 s timeout, no redirects, signature verifies with the SDK's `constructEvent` (gw-sdk-compat), replay/test owner only.
- Reports / settlements, UTC bucketing incl. midnight, CSV, refunds on their own day, log paging: PASS (gw-reports, gw-settlements).
- `onSessionPaid` / `onRefund` idempotent: PASS (gw-events 5).
- AT-11..AT-15 backend halves: covered by the tests above; the chain-side proof is claude-frontend's live run, not this batch.

## OPEN (non-blocking)
1. `lib/server/vouchers.ts` confirmRedemption: a payer who loses the last-use race still paid the discounted price and nothing is counted, so a code can be over-used by concurrent payers; it is a documented `ponytail:` ceiling. Owner: contracts lane, later batch (reserve against the limit at apply time).
2. A voucher deactivated or expired after a reservation is still confirmed on payment (no re-check at confirm). Same lane, same fix.
3. `lib/server/http.ts:137` `clientIp` trusts the first `x-forwarded-for` entry; rate limits are only as good as the host overwriting that header (true on Vercel). Owner: contracts lane, note for deploy.
4. `lib/server/webhooks.ts` DNS-rebinding window between check and fetch (documented ponytail).

## NEEDS THE USER
Apply migrations on Neon; set VOUCHER_HASH_SECRET and CRON_SECRET in the git-ignored .env (spec NEEDS THE USER list).
