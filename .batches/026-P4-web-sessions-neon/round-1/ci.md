VERDICT: PASS

# CI, batch 026-P4-web-sessions-neon (phase mode, Money: yes; run by claude-frontend at 11:40)

| Check | Command (apps/web) | Result |
|---|---|---|
| Merge | `git merge origin/main` first (Capital PR #23, gw-dispatch), then `git apply --directory=apps/web` of the 36-file diff | clean |
| Un-awaited store calls | grep for createSession/getSession/claimPayment/isInFlight/… lines without await, then, or Promise.all | none, including the new upstream Capital code |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 560, pass 558, fail 0, skipped 2. Includes sessions-db (13): cross-instance lock race, lock expiry, first-write-wins, compare-clear, idempotency across instances, single-use nonces, bigint round-trips. |
| Build | `npm run build` | exit 0 |
| Migration | `node --env-file=.env.local db/migrate.mjs`, run by **the human**: the auto-mode classifier refused it for Claude as a production change | "applied 050_web_sessions.sql (8 statements)"; additive; no app_gw_* table changed |
| Local :3100 (on Neon) | POST /api/demo-checkout → /checkout/<uuid> | the real checkout renders "Hold to pay 25.00 USDT" with no not-found marker; an unknown id gives the NEXT_HTTP_ERROR_FALLBACK;404 marker |

**Builder evidence (scratch b023):**
- A restart e2e on a disk-backed PGlite: a checkout created by server 1 renders on a fresh server 2. With no DATABASE_URL, a plain notice and a 503.
- Mutants: an in-memory Set in claimPayment and a Map in consumeNonce make 4 tests fail.

**Not yet:** the live Vercel checkout. It deploys after the security pass, then gets one confirm payment with the human's yes.

## After the security pass (PASS: 1 MEDIUM, 3 LOW, 2 INFO; real Postgres 18 races of every statement from 40 connections, exactly one winner each)
- **F1 MEDIUM, mostly fixed:**
  - The lock's expiry is now its owner token (no migration): `claimPayment` returns it, and `releasePayment(key, token)` deletes only `WHERE key AND until = token`, so a stale attempt can't free a later attempt's lock (new test).
  - `export const maxDuration = 300` on both pay routes pins the platform limit under LOCK_S.
  - Open: writing `pending` before the relay, and shorter chain-read retries under the lock (a semantics change, for a follow-up).
- **F2 LOW, fixed:** `return await refuse(...)` (5 places), so the `finally` unlocks only after the hold release commits.
- **F4 LOW, fixed:** ABANDONED_MS is 300 s (= max duration). The test is updated.
- **F5 INFO, fixed:** /api/v1/payments logs the error name only.
- **F3 LOW, open:** expired unpaid sessions aren't pruned.
- Re-run: typecheck 0, lint 0, `npm test` 560 tests (558 pass, 2 skipped), build 0. Local :3100 restarted.

