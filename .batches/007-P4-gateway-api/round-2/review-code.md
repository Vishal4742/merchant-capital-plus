VERDICT: PASS

# Code review: 007-P4-gateway-api, round 2 (delta only, fast mode, PIPELINE §3a)

The batch is still untracked, so I worked out the delta from file times. These files changed after round 1:
- `db/statements.mjs` (new), `db/migrate.mjs`
- `lib/server/{db,vouchers,events,reports,http}.ts`
- `app/api/v1/vouchers/route.ts`, `app/api/v1/webhooks/[id]/test/route.ts`, `app/api/v1/webhooks/deliveries/[id]/replay/route.ts`
- `test/{gw-helpers.mjs,gw-events,gw-vouchers,gw-reports,gw-links}.test.mjs`

All of them are inside spec.md's Files list. There are no new dependencies.

## Round 1 findings
| # | Status | Evidence |
|---|---|---|
| M1 migrate split | **Fixed** | `db/statements.mjs` drops `--` comments, then splits. Both `migrate.mjs` and `gw-helpers.mjs` use it, and the helper runs each statement through `pg.query`. I re-ran the split on every file: 17 statements, and every one is a real `CREATE`. No `--` appears outside a comment line, so the documented limit (no `--` inside a string) holds. |
| M2 webhook data | **Fixed** | `events.ts`: `currency: "USDT"`, `refunded` = the running total, `refund_amount` = this refund. `gw-events` asserts all of them: 5.00/5.00, then 7.50/2.50. The amount stays `"25.00"` (formatUsdt without commas), the same format as the sessions route that the SDK's `retrieve` reads, so I accept it. |
| M3 confirm vs. paid amount | **Fixed** | `confirmRedemption(sessionId, paidAmount)` now has `AND usdt_amount = $3` in the claiming CTE, and `onSessionPaid` passes `session.amount`. The new test pays the full price and expects 0 uses; it fails if the guard is removed. |
| M4 dispatch scheduler | Still open, as the build note records | A local loop has to run during the demo. Carried forward. |
| L1 kpis casing | **Fixed** | `kpis: {new_payers, returning_payers}` in `reports.ts:174`, the test, and `API.md`. Nothing else in apps/ or packages/ reads the old names. |
| L2–L12 | Still open, as the build note records | Carried forward. |

## Security H1 fix (`vouchers.ts:180-205`, `db.ts:39`)
- **Logic.** The usage check now counts live holds: `times_redeemed` + unconfirmed holds from other sessions created within `SESSION_TTL_MS` must stay under `max_redemptions`. Several cases follow from this:
  - **Re-apply:** a session re-applying a code excludes itself (`session_id <> $1`), so it can re-apply its own code. Moving a hold to another code only lowers the old code's count.
  - **Hold lifetime:** a hold starts when the code is applied, after the session was created, so it never expires before its session.
  - **Confirm:** confirming moves one use from "held" to `times_redeemed` in a single statement. The sum doesn't change, so `confirmRedemption` doesn't need the lock.
- **Concurrency.** The two statements run in one transaction. `pg_advisory_xact_lock(hashtext(id))` comes first, and the `INSERT … SELECT` runs after it as a separate statement. Under READ COMMITTED, that second statement takes a fresh snapshot after the lock is granted, so it sees every committed hold. Neon's `sql.transaction(txn => …)` and `txn.query(text, params)` match the 1.2.0 typings. Advisory locks scoped to the transaction are safe on pooled HTTP.
- **Tests.**
  - Exploit: a 1-use code applied to 4 open checkouts gives `[true, false, false, false]`.
  - Hold expiry: the code is refused at TTL−1 and accepted at TTL+1.
  - The confirm-time race test is kept.
  - The exploit test fails if the hold count is removed.

## Commands run (apps/web)
- `node --experimental-test-module-mocks --test test/gw-*.test.mjs`: 101 tests, 101 pass, 0 fail (this includes the tester's `gw-tester-webhooks`).
- `npx tsc --noEmit`: no errors.
- `npx eslint lib/server app/api/v1 db test/gw-*.mjs`: exit 0.

## FOLLOW-UP (LOW, new in round 2)
- **N1: `lib/server/db.ts:39` (owner: lane).**
  - *Issue:* the H1 argument assumes a fresh snapshot per statement, i.e. READ COMMITTED. But `sql.transaction` sends no isolation level, so it gets the server default. Under REPEATABLE READ, the snapshot would be taken when the lock statement starts, before it waits, and the insert would miss holds that commit while it waits.
  - *Second gap:* PGlite has one connection, so no test can fail if the lock statement is removed.
  - *Fix:* pass `{ isolationLevel: "ReadCommitted" }`, the one-argument change that makes the comment on line 14 true by construction.
- **N2: `app/api/v1/vouchers/route.ts:9` (owner: lane).**
  - *Issue:* `rateLimit` runs before `voucherInput`, so 30 rejected inputs (400) lock a merchant out of creating vouchers for an hour, even though a 400 makes no Arkiv write.
  - *Fix:* move the limit after validation.
- **N3: `test/gw-links.test.mjs:52` (owner: lane).**
  - *Issue:* the expiry is hard-coded to `"2030-01-01T00:00:00Z"`, so the test starts failing on that date.
  - *Fix:* use `new Date(Date.now() + 365 * 86_400_000).toISOString()`.
- **N4: `lib/server/vouchers.ts:203` (owner: claude-frontend, FYI).**
  - *Issue:* when re-applying a different code fails ("used up"), the session's earlier hold stays in place.
  - *Fix:* the checkout UI should keep showing the earlier code and its price, not clear it.
