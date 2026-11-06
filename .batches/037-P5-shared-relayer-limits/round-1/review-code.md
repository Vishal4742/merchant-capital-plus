VERDICT: PASS

# reviewer-code: 037-P5-shared-relayer-limits, round 1

Scope: `git diff cdfba6b~1 c67f7e3 -- apps/relayer` (RED cdfba6b + GREEN c67f7e3; HEAD 2e5d013 changes nothing under apps/relayer). FR-REL-10 and the spec only. Phase/fast mode: nothing here is HIGH or CRITICAL, so it's PASS, and the findings below go to FOLLOW-UP.

## Verified (command output)
- `cd apps/relayer && npm test`: **tests 69, pass 69, fail 0** (relayer.test.ts has 59; the 7 FR-REL-10 tests are new). `npx tsc --noEmit`: exit 0.
- The FR-REL-10 subset was run 6 times: 6/6 green. The "same authorization" test takes about 230 ms and "two payments" about 365 ms every time.
- Mutation runs on a scratch copy (the scratch copy is deleted; no product code was edited):
  - acquire always succeeds: killed (the replay test and the distinct-nonces test fail).
  - fencing removed from `reserve`: killed (the fencing test fails).
  - in-lock `ledgerChecks` removed: killed (the "budget … queued requests are re-checked in the lock" test fails).
  - `store.reserve(...).catch(() => 'ok')`: **survives, 59/59** (finding F1).
  - the `.catch` on `serialized(...)` at relayer.ts:510-513 removed: **survives, 59/59** (finding F1).
- SQL on both drivers. In Neon 1.2.0, params go through pg's `prepareValue`: numbers and booleans become text, and null stays null. Every param is either compared to a typed column (`relayer = $1`, `sent_at >= $3`, `until_ms <= $4`, VALUES into typed columns) or cast explicitly (`$7::bigint`, `$8::bigint`, `$9::bigint`, `least($3::bigint, $4::bigint)`). So Postgres infers the same types from text as PGlite does from JS values. Outputs are normalised: sums `::text` then `BigInt`, counts `::int` then `Number`, booleans through `coalesce(bool_or…, false)`. Neon (int4 → number, bool → boolean) and PGlite return the same JS values. An aggregate with no GROUP BY always returns one row, so an empty table gives `sent=false, spent='0'`. `least()` covers 00:00-01:00 UTC, when the hour window starts before the day.
- Atomicity. `acquire` (`INSERT … ON CONFLICT DO UPDATE … WHERE until_ms <= now`) locks the conflicting row and rechecks it against the latest committed version, so two racers can't both get a row back. The `reserve` lease `UPDATE … holder = $2` rechecks after a concurrent writer, and its INSERT reads only `lease`'s RETURNING, so a lost lease writes nothing. The fencing depends on the holder check, not on the client's `$9` clock, so it holds even if the statement runs late.
- Reject codes and order on the pre-lock path are unchanged against cdfba6b~1. The order is bad_signature, then replay, then breaker_open, payer_banned, budget_exhausted, rate_limited (now one SELECT), then the RPC round. AT-10 holds: `reserve` is the last await before `sendRawTransaction`, and every reject in the lock comes before it. The 62 existing tests are unchanged; the only edit above line 1037 is the PGlite setup at lines 14-21.
- Vercel bundling. `api/relay.ts` imports `src/relayer.ts`, which imports `src/store.ts`, which imports `@neondatabase/serverless` and nothing else. `db/pglite.ts` is reachable only from `test/` and `dev.ts`, which loads it through a dynamic import, and both are in `.vercelignore`. Nothing in `src/` or `api/` imports `db/`. In the lock, `@neondatabase/serverless` 1.2.0 and `@electric-sql/pglite` 0.5.11 (dev) bring zero transitive deps, and both match apps/web's pins.
- The cross-instance test trick works. `relayer.ts?b` is a separate ESM module record, with its own `sendQueue`, caches and `TIMING`. Its `./store.ts` resolves to the same URL, so both instances share one `current` Db and one `StoreError` class, which keeps `instanceof` working across them. The distinct-nonces test can't pass without the lease, because the fake node bumps the nonce only when a tx is mined.

## FOLLOW-UP (MEDIUM)

**F1. Database failure inside the lock is untested, on the money path.** Lines: test/relayer.test.ts:1127-1146, src/relayer.ts:457-461 and :510-513. Owner: claude-relayer.
- What: the storage_error test fails the DB from the first query, so it only covers the pre-check catch (relayer.ts:507). No test fails `acquire`, the in-lock `counters` or `reserve` while a request is running. Two mutants show the gap. One broadcasts after a failed `reserve` (`.catch(() => 'ok')`); the other drops the in-lock StoreError catch. All 59 tests pass on both.
- Why: "never a send without the database" is the main safety claim of FR-REL-10. The code is correct as written: `reserve` is awaited bare and the StoreError reaches `storageDown`. But nothing in the suite would catch a regression.
- Fix: add one test with a `Db` wrapper that throws only on `INSERT INTO rel_sent` (and one case for `INSERT INTO rel_lock`). Assert `503 storage_error`, `node.sent.length === 0`, and for the reserve case that `rel_lock.until_ms` is `0` afterwards (the lease was released).

**F2. Neon queries have no timeout.** Line: src/store.ts:35. Owner: claude-relayer.
- What: `@neondatabase/serverless` 1.2.0 sets no fetch timeout; there is no `AbortSignal` anywhere in the driver.
- Why: a slow or hung Neon call (a compute waking up, a network stall) has these effects:
  - The 20 s age gate isn't checked while a query hangs (relayer.ts:416-419, and the pre-check at :320).
  - A slow `reserve` can broadcast after the web has aborted at 35 s. The web then shows "couldn't confirm" instead of "nothing was charged".
  - A slow `settle`/`release` stretches the lock hold past the ~44 s that `LEASE_MS` (store.ts:45) is derived from.

  There's no money loss: the PK and the fencing hold at any latency. But this is the timing budget that batch 022 and security 018 F4 set up.
- Fix: one line in `run()`: `sql.query(t, p, { fetchOptions: { signal: AbortSignal.timeout(DB_TIMEOUT_MS) } })`, with 3-5 s. An abort becomes a StoreError and the answer is 503 storage_error. A `reserve` that committed just before the abort leaves the authorization as replay, which is the safe side the spec already accepts.

## FOLLOW-UP (LOW)

**F3. The order of rejects inside the lock changed slightly.** Line: src/relayer.ts:436 (before: cdfba6b~1 relayer.ts:425 and :439). Owner: claude-relayer.
- What: the old order inside the lock was replay, then simulate/nonce, then expired, then busy, then breaker/ban/budget/rate. The new order is replay/breaker/ban/budget/rate, then simulate, then expired, then busy.
- Why: the answer differs only when a queued request trips both a ledger reject and a simulation or age reject. In every case nothing is sent, the RPC call is saved, and no existing test changed. The spec still says "same order".
- Fix: keep the code. Add one line to spec.md or batch.md saying the in-lock ledger read now comes before the simulate round.

**F4. A successful relay now waits on 6 database round trips in sequence (NFR-4).** Lines: src/relayer.ts:320, :416, :436, :457, :477, :423. Owner: claude-relayer.
- What: the round trips are the pre-check `counters`, `acquire` (plus one more per 100 ms poll when another instance holds the lock), the in-lock `counters`, `reserve`, `settle` and `release`. Before this batch there were none. `/health` adds one, in parallel with the cached balance, so `/health` latency is now about one Neon round trip against NFR-14's 300 ms p95. `settle` and `release` run after the last stopwatch lap, so they only show in `total`.
- Fix: measure on the live 1.00 USDT sale (the spec's deploy step). If NFR-4 is tight, fold `settle` into the success-path `release` as one CTE statement, which saves one round trip. Don't merge `acquire` with the in-lock `counters`: the SELECT would use the statement's start snapshot and could miss the previous holder's `settle` (its revert flag).

**F5. A write can commit even though its response is lost.** Lines: src/relayer.ts:416 and :457. Owner: claude-relayer.
- What: on Neon HTTP, a statement can commit and then the response can still be lost.
- Why, case by case:
  - `acquire` commits, then the response is lost: the StoreError is thrown before the `try/finally`, so the lease stays held for 60 s and every instance answers 503 busy during that time.
  - `reserve` commits, then the response is lost: the answer is 503 "nothing was sent, so retry", but the retry gets 422 replay. That's the safe side, and the case is rare.
- Fix (cheap): in `leased`, do a best-effort `release(holder)` when `acquire` throws. Leave the reserve case as it is.

**F6. The live-lease test passes even with the poll loop removed.** Line: test/relayer.test.ts:1101-1111. Owner: claude-relayer.
- What: with `acquire` forced to return true, this test still passes, because `reserve`'s fencing also answers 503 busy and sends nothing.
- Why: the poll-until-age-gate path is proven only indirectly, by the distinct-nonces test.
- Fix: also assert `res.out.error` is the QUEUED_TOO_LONG text, or that `eth_getTransactionCount` was never called.

**F7. Instance B keeps the production TIMING.** Line: test/relayer.test.ts:1041. Owner: claude-relayer.
- What: B keeps the 8 s receipt timeout and the 250 ms poll. If B wins the lease in the "same authorization" test, that test takes ~8 s instead of ~0.2 s. In 6/6 runs A won.
- Fix: `Object.assign(instanceB.TIMING, { receiptPollMs: 5, receiptTimeoutMs: 120 })` right after the import.

**F8. A failed `settle` after a mined revert also loses the ban and the breaker count.** Lines: src/relayer.ts:160-163. Owner: claude-relayer.
- What: the ALERT says only "its worst-case fee stays counted".
- Fix: when `minedRevert` is true, have the alert also say the payer was not banned, so the operator knows to act.

**F9. The least-privilege GRANT isn't in the repo.** Line: db/001_rel.sql:1-2. Owner: claude-relayer (reviewer-security's area).
- What: the file names the `mcplus_relayer` role, but the SELECT/INSERT/UPDATE grant is left to the deploy step, out of band.
- Fix: put the GRANT (never the password) in a deploy-only file that PGlite doesn't run, for example `db/002_role.sql`, so the privilege set can be reviewed.

**F10. The test file layout differs from the spec.** Lines: test/relayer.test.ts:1037-1162 and db/pglite.ts. Owner: claude-relayer.
- What: the spec's acceptance criteria name `test/shared-limits.test.ts`, and allow "PGlite setup only" in relayer.test.ts. `db/pglite.ts` is not in the spec's files list either.
- Why: it's reasonable, since the new tests reuse `fakeNode` and `signedSale`.
- Fix: record the change in batch.md.

## Ponytail nits (optional)
- store.ts:48-51: `utcDayStart` can be one line: `new Date(now).setUTCHours(0, 0, 0, 0)`.
- db/pglite.ts:7: nothing uses the `pg` handle in the return type. `Promise<Db>` is enough.
- relayer.ts:13-14: two imports from `./store.ts`. `store.StoreError` would do.
- relayer.ts:533: `/health` reuses the relay copy "nothing was sent, so retry" for a read. Use a /health-specific message.

## Process (not code)
- There is no `build-claude-relayer.md`, and `round-1/ci.md` isn't written yet; ci.md is acceptance criterion 3. Write it before `batch-close.sh`.
- ARCHITECTURE.md §3 still says "serialized sends (Postgres advisory lock)". Ask claude-research to change it to "lease row + fencing", per the spec's "Why a lease row" section. Lanes don't edit that doc.
- PGlite is single-connection, so CI can't run truly concurrent upserts. The race safety of `acquire` and `reserve` rests on Postgres's documented ON CONFLICT and UPDATE recheck semantics, which I checked above. No action needed. If you want live evidence, fire two concurrent POSTs at the deploy step.

## Scope and ABI
- Every change traces to FR-REL-10 or to the spec's storage_error, /health and driver lines, and nothing beyond the spec was built. The `ponytail:` notes at the old relayer.ts:141 and :189 are deleted, as the spec asks.
- ARCHITECTURE §2 (the contract ABI) is not touched. The relayer HTTP contract only gains `503 storage_error` on /relay, which the web already maps to BUSY ("Nothing was charged"; apps/web/lib/relay.ts:87), and `502 storage_error` on /health.
