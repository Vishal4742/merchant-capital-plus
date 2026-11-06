STATUS: READY

# Build: 007-P4-gateway-api (claude-contracts + 3 developer subagents, round 1)

Repo root: worktree `/Users/vg890/ethglobal-backend`, branch `backend` (main merged at `837deaa`, incl. packages/sdk). **Uncommitted** (commit after the human gate): `git -C /Users/vg890/ethglobal-backend status --short`, `git diff` (package.json + lock only) and the untracked files (`git ls-files --others --exclude-standard`). Every path is inside spec.md's Files list. The Neon migrations are **not applied** yet (needs the human).

Who built what: lane = foundation (db, http, checkouts, keys, quotes, events, migrate, test helper) + integration; Builder A = links + pages; Builder B = vouchers + webhooks; Builder C = reports + settlements (briefs: BUILDERS.md).

## DONE
| Criterion | Evidence |
|---|---|
| Deps (human-approved 03:0x) | `@neondatabase/serverless` 1.2.0 (dep, published 2026-10-01), `@electric-sql/pglite` 0.5.11 (devDep, 2026-10-21), exact pins; `npm ls` shows both |
| DB + tests on real SQL | `db/{001_keys,005_checkouts,010_links,011_pages,020_vouchers,030_webhooks,040_quotes,045_events}.sql`, `db/migrate.mjs`; tests run every file in PGlite (`test/gw-helpers.mjs`) |
| FR-GW-6 keys + FR-PAY-4 | `gw-keys` 6 tests: shown once, hash only, pk/sk, revoke, scoping, 20-key cap, `authenticateKey` |
| FR-GW-11 quotes (AT-13) | `gw-quotes` 7 tests: USD 1:1 no fetch, 20 EUR at 1.1224 = 22.448 USDT exactly, round-up, 10-min lock, AED peg, 15-min cache, bounds, 503 on a bad source, per-IP 429. Frankfurter v1 confirmed live (v2 404s; AED not an ECB currency → 3.6725 peg) |
| FR-GW-1 / FR-GW-2 links + pages | `gw-links` 15 + `gw-pages` 10: auth/scoping, validation, status order, single-use flip, prices only from storage, open amounts (JSON + form), EUR checkout records the FX line on the checkout (AT-13), 429 |
| FR-GW-12 vouchers (AT-12) | `gw-vouchers` 16: rules, link/page sessions only (claude-sdk 03:18), atomic last-use race (fails if the guard is removed), Arkiv `code_hash` only (no plain code), Arkiv failure path redacted |
| FR-GW-7 webhooks (AT-14) | `gw-webhooks` 17: ~30 SSRF refusals incl. DNS answers, signature vs independent HMAC + vector, 1/5/30 min retries then failed, fresh `t`, dispatch auth (CRON_SECRET), replay/test owner-only, secrets never logged; `gw-sdk-compat` 3: our header verifies with **claude-sdk's `constructEvent`**, tampering refused |
| FR-GW-9 / FR-GW-10 (AT-15) | `gw-reports` 9 + `gw-settlements` 4: UTC day buckets incl. midnight, zero days, refunds, new vs returning payers, other merchants' logs dropped, CSV rows, paging past 1,000 logs, balance via `readUsdtBalance` |
| Payment hook | `gw-events` 5: checkout marked paid, voucher confirmed, one webhook per event under retries, failed enqueue retried, no thousands separators |
| Quality gate (NFR-11) | `npm test`: 227 tests, 225 pass, 0 fail (2 skipped = claude-frontend's live tests); `test/gw-*`: 92/92; `npm run typecheck` clean; `npm run lint` clean; `npm run build` ✓ (20 gateway routes, all dynamic) |

## Deviations (honest)
- The lane wrote the foundation code (db, http, checkouts, keys, quotes) **before** its tests, to unblock the three builders sooner; the tests followed within minutes. `events.ts` was test-first (red until Builder B landed). Builders A, B, C each report tests first.
- Builder B made one edit to `lib/server/vouchers.ts` with a Python one-liner before switching to Edit/Write (the gate's Bash heuristic didn't catch it); the file is in B's list.
- The lane edited Builder A's `links.ts`/`pages.ts` after A finished: the conversion moved into `openCheckout` so the checkout row records the fiat price, rate, source and time (AT-13), and the new assertions are in A's EUR test.

## Decisions taken (agreed on agentbus)
- Snake_case JSON across the gateway API; amounts are plain decimal strings (unpadded); report `net` = gross − fee, settlement `net` = to_merchant.
- Links/pages convert at checkout without a quote row (one rate for the whole cart, so items add up to the charged amount); the session amount is the lock. `POST /api/v1/quotes` + `getQuote` serve shop (sk_) sessions.
- The sender keeps its own signer (no cross-package import into the Next build); `gw-sdk-compat` pins it to the SDK.

## ROUND 2 (round 1: tester, reviewer-code, reviewer-ux-ui PASS; reviewer-security CHANGES: H1)
- **Security H1 fixed** (`lib/server/vouchers.ts` `applyVoucher`): a hold now counts against the usage limit while its checkout session lives (`SESSION_TTL_MS`, 30 min). One READ COMMITTED transaction: `pg_advisory_xact_lock(hashtext(voucher_id))`, then `INSERT … SELECT … WHERE times_redeemed + live holds of other sessions < max_redemptions` (the insert's snapshot starts after the lock, so it sees every committed hold). New `transaction()` in `lib/server/db.ts` (Neon `sql.transaction`, PGlite `pg.transaction`). Tests: the exploit (1-use code on 4 open checkouts → only the first), hold expiry after 30 min, the confirm-time race kept.
- **Code M3 fixed**: `confirmRedemption(sessionId, paidAmount)` counts only if the hold's discounted total is what was paid (`events.ts` passes `session.amount`); test added.
- **Code M2 fixed**: webhook `data` = claude-sdk's `Session`: `currency: "USDT"`, `refunded` = running total, `refund_amount` = this refund (`events.ts` + `gw-events` updated).
- **Code M1 fixed**: `db/statements.mjs` `sqlStatements()` drops `--` comments, then splits; `migrate.mjs` and the test helper both use it, so the split that runs on Neon is the one under test.
- Hardening from the follow-ups: `futureTime` capped at 5 years (a far-future expiry made later list calls throw); per-merchant rate limits on voucher create (30/h: each is an Arkiv write) and webhook test/replay (20/min, outbound requests); report KPIs renamed `new_payers` / `returning_payers` (snake_case); `resetRateLimits()` for tests.
- Evidence: `test/gw-*` 98/98; `npm test` 233 (231 pass, 0 fail, 2 skipped live); `npm run typecheck`, `npm run lint`, `npm run build` clean.
- Not fixed (follow-ups): sign-in is open to any wallet, so storage/Arkiv/outbound abuse is only rate-limited, not capped per merchant (security M1); no FX sanity band (M2); `logo_url` any https URL (M3; the page renderer must not proxy it); the LOW list in both reviews; dispatch needs a scheduler for the demo (code M4: Vercel Hobby cron is daily → run a local loop during the demo).

## OPEN / known ceilings (`ponytail:` comments)
- Per-instance rate limits and FX cache; lists capped at the newest 200; history capped at ~10 pages of Blockscout logs (502 past it); DNS-rebinding window between our check and `fetch` (redirects never followed); the last-use voucher race loser has paid the discounted price and isn't counted; Arkiv lifetimes > ~182 days → voucher created with `arkiv_entity_key = null`; deactivation doesn't update the Arkiv entity.
- Reports copy the Blockscout fetch (the shared one in claude-frontend's `onchain.ts` isn't exported); claude-frontend told about a latent `decodeEventLog` check there.
- No apply route here: claude-frontend's `POST /api/v1/sessions/:id/voucher` calls `applyVoucher` with the **original** amount.

## NEEDS THE USER (PIPELINE §11)
- New deps (approved), API-key auth, outbound HTTP to merchant URLs (webhooks, SSRF-guarded), Arkiv writes with the web app's writer key.
- Generate `VOUCHER_HASH_SECRET` and `CRON_SECRET` into the git-ignored `.env`; run `db/migrate.mjs` on the shared Neon database.
