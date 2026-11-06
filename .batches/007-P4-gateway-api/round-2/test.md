VERDICT: PASS

Tester, round 2, fast mode, API only. From apps/web:
- `node --experimental-test-module-mocks --test test/gw-*.test.mjs`: 98 of 98 pass before my file; my new file adds 3, all pass.
- `npm test`: 233 tests, 231 pass, 0 fail, 2 skipped (live). `npm run lint` clean.

## Round 2 delta
- H1 (holds count at apply time): PASS. gw-vouchers:256 (1-use code on 4 open checkouts, only the first; holder re-applies its own), :266 (hold expires at exactly 30 min; last-use guard still counts one).
- M3 (`confirmRedemption(session, paid)`): PASS. gw-vouchers:282, full-price payment not counted.
- M2 (webhook data = SDK Session) and the SQL split via `db/statements.mjs`: covered by the passing gw-events and by every test applying the SQL statement by statement.
- Rate limits and the 5-year cap on `futureTime`: the existing tests pass. I did not add new ones for them.

## Added: `apps/web/test/gw-tester-vouchers.test.mjs` (3 tests, pass)
1. 5 simultaneous applies of a 1-use code leave exactly one hold row.
2. Confirmed uses and live holds both count: with max 2, one paid plus one held means the third checkout is refused.
3. A holder who switches to another code frees its hold on the first code, and another checkout can then take it.

## OPEN (non-blocking)
- PGlite runs on a single connection, so "simultaneous" applies are serialized. The `pg_advisory_xact_lock` race protection is untestable offline; it needs a check on real Neon (contracts lane, after migration).
- Carried over from round 1: DNS-rebinding window, spoofable `x-forwarded-for` if the host doesn't overwrite it, and the follow-ups the build notes list.

## NEEDS THE USER
Apply migrations on Neon; set VOUCHER_HASH_SECRET and CRON_SECRET in the git-ignored .env.
