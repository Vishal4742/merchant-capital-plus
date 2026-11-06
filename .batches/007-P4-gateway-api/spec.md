# Spec: 007-P4-gateway-api

The gateway backend API (claude-contracts after the G4 contract freeze; ARCHITECTURE §4b and §8). Route shapes were agreed on agentbus with claude-frontend (02:46–03:17), claude-sdk (02:45, 03:17, 03:18) and claude-research (02:48). Fast mode (PIPELINE §3a). The human approved the two new dependencies at the batch-006 gate (03:0x).

## Requirements (docs/SRS.md v2.0)
- **FR-GW-6** API keys: `pk_test_…` / `sk_test_…`, SHA-256 hash stored, shown once, revocable; `authenticateKey(req)` for claude-frontend's `POST /api/v1/sessions` (**FR-PAY-4** key half).
- **FR-GW-1** Payment Links · **FR-GW-2** Payment Pages (fixed items or open amount) · public checkout → claude-frontend's `createSession` → 303 to `/checkout/{id}`.
- **FR-GW-11** FX quotes: USD = USDT 1:1 (rate "1"); EUR, GBP, INR, AED, SGD from Frankfurter (ECB), cached ≤ 15 min, quote locked 10 min.
- **FR-GW-12** Vouchers: percent or fixed off, expiry, usage limit, min amount; atomic redemption counted on our server; each code mirrored to Arkiv (`mcplus.voucher.v1`, `code_hash = HMAC-SHA256(VOUCHER_HASH_SECRET, merchant ‖ code)`, expires with the code; **FR-ARK-4**: no plain code or personal data on Arkiv). Vouchers apply **only to sessions created from a link or page** (claude-sdk 03:18: a shop's `sk_` session must never be silently discounted).
- **FR-GW-7** / **FR-PAY-10** Webhooks: `payment.succeeded`, `payment.refunded`; `MC-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")` (claude-sdk's format); retries at 1 m / 5 m / 30 m; delivery log, test send, replay; `data.amount` = what was actually paid.
- **FR-GW-9** Reports and **FR-GW-10** Settlements from on-chain `Paid` / `Refunded` logs (Blockscout index, ARCHITECTURE §1; no tables); CSV.
- **CON-7, NFR-3, NFR-8**: secrets only from env; never logged or returned (except a new key or webhook secret, once, to its owner).
- Backend halves of **AT-11** (link paid → shows Paid; report + settlement include it), **AT-12** (page + discount code, use count +1), **AT-13** (EUR quote locked), **AT-14** (signed webhook verifies), **AT-15** (reports match the chain).

## Acceptance criteria
- [ ] `apps/web/db/NNN_*.sql` (idempotent `CREATE … IF NOT EXISTS`) + `db/migrate.mjs` applied to Neon; tables `app_gw_*` only.
- [ ] `lib/server/db.ts` `query(text, params)`: Neon HTTP driver in prod, PGlite in tests (`setTestDb(client)`), so tests run real SQL offline.
- [ ] Dashboard routes need the SIWE cookie (`currentMerchant()`), else 401; rows are always scoped to that merchant (another merchant's id → 404).
- [ ] Keys: `POST /api/v1/keys {label, kind}` → `{id, key, prefix, kind, createdAt}` (key once) · `GET` → no key/hash · `DELETE /api/v1/keys/{id}`; revoked/unknown → `authenticateKey` null; hash compare constant-time; `last_used_at` updates.
- [ ] Quotes: `POST /api/v1/quotes {amount, currency}` (public, rate-limited per IP) → `{quote_id, usdt_amount, rate, source, fetched_at, expires_at}`; `getQuote(id)` null after expiry; 1 USDT ≤ usdt_amount ≤ 1,000 USDT (`MAX_PAYMENT`).
- [ ] Links: `POST/GET /api/v1/links`, `POST /api/v1/links/{id}/cancel`; public `GET /api/v1/public/links/{slug}` (render info only) and `POST /api/v1/public/links/{slug}/checkout {amount?}` → 303; statuses active/paid/expired/cancelled; `reference_id` unique per merchant; single-use flips to paid once (idempotent) on `onSessionPaid`.
- [ ] Pages: `POST/GET /api/v1/pages`; public `GET /api/v1/public/pages/{slug}` and `POST …/checkout {items:[{name, qty}]} | {amount}` → 303; prices from the stored page only; unknown item, qty < 1 or > 100 → 400.
- [ ] Vouchers: `POST/GET /api/v1/vouchers`, `POST /api/v1/vouchers/{id}/deactivate`; `applyVoucher(merchant, code, sessionId, usdtAmount)` refuses sessions not created from a link or page; `onSessionPaid` confirms the redemption with `UPDATE … WHERE times_redeemed < max_redemptions RETURNING` (two concurrent confirms on the last use → one wins); Arkiv entity written on create (failure → voucher still usable, `arkiv_entity_key` null, error redacted).
- [ ] Webhooks: `POST /api/v1/webhooks {url}` → `{id, secret}` (once) · `GET` with deliveries `{event, status, attempts, nextAttemptAt, responseStatus, at}` · `DELETE` · `POST /api/v1/webhooks/{id}/test` · `POST /api/v1/webhooks/deliveries/{id}/replay`; URL `https:` only, no localhost / private / link-local addresses (checked after DNS resolution, SSRF); 5 s timeout; redirects not followed; signature verifies with claude-sdk's `constructEvent`.
- [ ] Reports: `GET /api/v1/reports?from=YYYY-MM-DD&to=` → `{days:[{date, gross, fees, net, refunds, count}], totals, kpis:{newPayers, returningPayers}}` and `GET /api/v1/reports.csv` (same rows); Settlements: `GET /api/v1/settlements?from=&to=` → `{balance, settlements: [{payment_id, gross, fee, to_investors, net, tx_hash, settled_at, explorer_url}]}` (balance = merchant wallet USDT; settlement `net` = to_merchant, report `net` = gross − fee); snake_case JSON across the gateway API (agentbus 03:31); amounts as plain decimal strings (≤ 6 dp, unpadded), dates UTC.
- [ ] `lib/server/events.ts`: `onSessionPaid(session)` and `onRefund(session, amount, totalRefunded)`, idempotent per session.
- [ ] Every input validated (amounts as decimal strings ≤ 6 dp, currency list, lengths capped, `https:` URLs); errors `{error}` 400/401/404/409/410/429, never a stack.
- [ ] `npm test` (incl. `test/gw-*.test.mjs`), `npx tsc --noEmit`, `npm run lint`, `npm run build` pass.

## Files (owner: claude-contracts; CLAIMed on agentbus)
- Foundation (lane): `apps/web/package.json` + `package-lock.json` (deps only), `apps/web/db/{migrate.mjs,001_keys.sql,005_checkouts.sql,040_quotes.sql,045_events.sql}`, `apps/web/lib/server/{db,http,checkouts,keys,quotes,events}.ts`, `apps/web/app/api/v1/{keys,quotes}/**`, `apps/web/test/{gw-helpers.mjs,gw-keys.test.mjs,gw-quotes.test.mjs,gw-events.test.mjs,gw-sdk-compat.test.mjs}`
- Builder A: `db/010_links.sql`, `db/011_pages.sql`, `lib/server/{links,pages}.ts`, `app/api/v1/{links,pages}/**`, `app/api/v1/public/{links,pages}/**`, `test/gw-{links,pages}.test.mjs`
- Builder B: `db/020_vouchers.sql`, `db/030_webhooks.sql`, `lib/server/{vouchers,webhooks}.ts`, `app/api/v1/{vouchers,webhooks}/**`, `test/gw-{vouchers,webhooks}.test.mjs`
- Builder C: `lib/server/{reports,settlements}.ts`, `app/api/v1/{reports,reports.csv,settlements}/**`, `test/gw-{reports,settlements}.test.mjs`

## Ponytail ladder
- Reuses `currentMerchant()`, `createSession()`, `parseUsdt`/`formatUsdt`, `paidLogs()` (Blockscout), `arkivClients()` + `redactArkivError()`, `node:crypto`. Plain SQL, no ORM. One Postgres driver for all lanes. No tables for reports or settlements. No job queue: the first webhook attempt is inline and retries run from `POST /api/v1/webhooks/dispatch` (cron secret).

## Out of scope
- All screens, QR rendering, the hosted `/l/{slug}` and `/p/{slug}` pages and the vanity `/@{merchant}` page (claude-frontend); sessions, payments list and Idempotency-Key (claude-frontend); SDK + button (claude-sdk); first-time-only vouchers and success-rate KPIs (need the session store); gift vouchers (FR-GW-13, C).

## NEEDS THE USER
- PIPELINE §11: new dependencies (`@neondatabase/serverless`, `@electric-sql/pglite` dev; approved 03:0x), auth code (API keys), outbound HTTP to merchant URLs (webhooks), new env secrets `VOUCHER_HASH_SECRET` and `CRON_SECRET` generated into the git-ignored `.env`, migrations on the shared Neon database.
