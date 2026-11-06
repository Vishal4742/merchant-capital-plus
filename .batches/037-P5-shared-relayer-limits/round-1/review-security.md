VERDICT: PASS

# Security review, batch 037-P5-shared-relayer-limits, round 1

Reviewer: reviewer-security (claude-relayer lane review, Money: yes).
Diff: `git diff cdfba6b~1 c67f7e3 -- apps/relayer` (RED cdfba6b, GREEN c67f7e3). Files: src/store.ts (new), src/relayer.ts, db/001_rel.sql, db/pglite.ts, dev.ts, package.json/lock, test/relayer.test.ts (section "batch 037", lines 1038-1162). Spec: FR-REL-10, AT-10, FR-REL-2.

No CRITICAL or HIGH findings. Two MEDIUM and six LOW go under FOLLOW-UP (PIPELINE §3a.1).

## Commands run

- `cd apps/relayer && npm test`: `tests 69, pass 69, fail 0` (the 8 FR-REL-10 tests included).
- `npx tsc --noEmit`: exit 0.
- `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` on every diff file: hits only at relayer.ts:93/94/99 (the env var *name* `RELAYER_PRIVATE_KEY` in the loader and its error text) and test/relayer.test.ts:241 (the public USDT domain separator), :664 (the secp256k1 order N), :839-848 (env var name in a test). None of them is in this batch's added lines (`git diff ... | grep '^+'` gives no hit). No key, token or connection string is committed. The package-lock integrity values are base64 sha512, not hex.

## What holds (checked by reading the code and the driver)

- **One broadcast per authorization, ever.** `store.reserve` inserts the `rel_sent` row (PK `auth_key = payer:nonce`, the same (authorizer, nonce) domain USDT's EIP-3009 state uses) before `sendRawTransaction` (relayer.ts:457-464). The PK holds whether or not the lease holds, so lease loss, clock skew or a crash can't produce a second broadcast of one authorization. The "never mined, re-POSTed to instance B" case is covered by the first FR-REL-10 test.
- **No send while the DB is down.** The broadcast needs `reserve` to return `'ok'`. Every store call goes through `run()`, which wraps every failure (including a missing `DATABASE_URL`) in `StoreError`, so each await fails closed: pre-check `counters` gives 503, `acquire` gives 503, in-lock `counters` gives 503 (release attempted), and `reserve` gives 503 with no broadcast.
- **No "nothing was sent" after a broadcast.** After `reserve`, the only store calls are `settle` (relayer.ts:162, caught) and `release` (relayer.ts:423, caught), so a `StoreError` can't reach the `.catch` at relayer.ts:510-513 once a tx exists. AT-10 holds. The new rejects (`busy` from lease loss, `replay` from the PK, `storage_error`) all happen before the broadcast. A malformed row (`[row]` undefined, null fields) throws a non-StoreError before `sendRawTransaction`, which is also fail-closed.
- **Budget and limits are serialised by the lease row lock, independent of clocks.** B's in-lock `counters` runs after B's `acquire` succeeds. That can only happen after A's `reserve` committed (A's renewal is then visible and B's upsert waits on the row) or after A's lease is dead, and in that case A's later `reserve` fails `holder = $2` and returns `'lost'`. So every in-lock read sees every committed reservation. The only overshoot is a receipt fee above `CAP_FEE_WEI` (a large `l1Fee`), and that was already there before this batch.
- **SQL under READ COMMITTED.** In `acquire` (store.ts:93-95), `INSERT ... ON CONFLICT (relayer) DO UPDATE ... WHERE rel_lock.until_ms <= $4` locks the conflicting row and evaluates the WHERE on its latest committed version, so two takers of an expired lease can't both get a row back (the loser re-checks against the winner's new `until_ms`). In `reserve` (store.ts:111-119), the `UPDATE rel_lock` waits on a concurrent `acquire` and re-checks `holder AND until_ms` on the new row version (EvalPlanQual). A stolen lease gives 0 rows, and the INSERT reads `FROM lease` (the only well-defined way to pass data between data-modifying CTEs), so it inserts nothing. `ON CONFLICT (auth_key) DO NOTHING` waits on a concurrent speculative insert of the same key. Each Neon HTTP query is one autocommit statement, so the renewal and the insert commit together. All values are bound parameters, so there is no injection path.
- **FR-REL-2 unchanged.** The targets, calldata and the three allowlisted functions are untouched. The store adds no call path to the chain.
- **No connection string in responses or logs.** Responses carry fixed text (relayer.ts:405, :533). `storageDown` logs `cause.name` only (relayer.ts:407-408). The Neon driver's fetch error text is `Error connecting to database: TypeError: fetch failed` (host only, no password). See L5 for the one message that does carry the URL.
- **Driver parity.** `@neondatabase/serverless` 1.2.0 (the web's exact version) parses OID 16 to a JS boolean and int4 to a number through its bundled pg-types (checked in node_modules/@neondatabase/serverless/index.mjs), so `row.sent === true` and `row.banned === true` behave as on PGlite today.

## FOLLOW-UP

### M1 (MEDIUM): lease times come from each instance's clock and from a `now` taken before the HTTP round-trip
- **Where:** store.ts:93-95 (`until_ms <= $4`, `$3 = now + LEASE_MS`), store.ts:113 and :120 (fence `until_ms > $9`, renewal `$8 = now + LEASE_MS`), with `now` from relayer.ts:416 and :459 (`Date.now()`).
- **Scenario:** instance B's clock runs S ahead of A's. A reserves at A-time t (lease to t+60 s), broadcasts relayer nonce N, then waits on its receipt: up to about 24 s (8 s send timeout, 8 s poll, plus one 8 s poll overrun), and longer if `settle` stalls (see L1). Once S is over about 36 s, B sees the lease as expired, takes it, reads the `pending` nonce, and can sign nonce N again if A's tx hasn't reached that Ankr backend's pool. The result is two txs with nonce N. With constant FEES the second is refused as an underpriced replacement, its authorization stays reserved (422 replay from then on), and a worst-case fee is booked. The stale `now` adds a second gap: the fence is evaluated when the statement runs but against the timestamp taken before the request left. Today this is bounded by Vercel's `maxDuration: 60` equalling `LEASE_MS`, assuming a timed-out fluid-compute request actually stops running its code (unverified). Likelihood is low with NTP-synced hosts. The fix costs nothing and removes the clock dependency entirely. Budget, limits and replay are not affected (see "What holds").
- **Fix:** take lease times from the database clock in both statements. Use `(extract(epoch from clock_timestamp()) * 1000)::bigint` for the `acquire` WHERE and the new `until_ms`, and for the `reserve` fence and renewal, and drop the `now` parameters there. `sent_at` can keep the caller's clock.
- **Owner:** claude-relayer.

### M2 (MEDIUM): least privilege is claimed but not in the diff, and the easy deploy paths break it
- **Where:** db/001_rel.sql:1-23 (no `CREATE ROLE`/`GRANT`), spec "Least privilege".
- **Scenario:** Neon's docs say roles created from the Console, CLI or API (e.g. `neonctl roles create`) get `neon_superuser` membership, and only roles made with SQL `CREATE ROLE` start with no privileges. Verify this against the docs before the gate. If the role comes from the Console/CLI path, or the Neon-Vercel integration is linked to merchant-capital-relayer and injects the owner's `DATABASE_URL`, then a leak of the relayer's env (the same blast radius as `RELAYER_PRIVATE_KEY`) also gives read access to every `app_gw_*` table and DDL on the gateway database.
- **Fix:** commit the role SQL, without a password, as db/002_role.sql. Create the role with SQL, not the Console: `CREATE ROLE mcplus_relayer LOGIN; GRANT SELECT, INSERT ON rel_sent, rel_lock TO mcplus_relayer; GRANT UPDATE (fee_wei, reverted) ON rel_sent TO mcplus_relayer; GRANT UPDATE (holder, until_ms) ON rel_lock TO mcplus_relayer;`. The column grants also stop a compromised instance from rewriting `auth_key` to free a used authorization. Set the password with a piped `ALTER ROLE`. Record evidence at the gate, run as the owner: `SELECT pg_has_role('mcplus_relayer','neon_superuser','member')` returns false, `has_table_privilege('mcplus_relayer','<an app_gw table>','SELECT')` returns false, `has_table_privilege('mcplus_relayer','rel_sent','DELETE')` returns false. Confirm the URL user in the Vercel env is `mcplus_relayer` without printing the URL.
- **Owner:** claude-relayer (deploy step, before the human gate's deploy item).

### L1 (LOW): no timeout on DB calls; an `acquire` that commits but errors leaves an orphaned lease
- **Where:** store.ts:34-35 (`neon(url)`, plain `fetch` with no signal: undici's defaults wait up to 300 s), relayer.ts:416-420 (`acquire` runs before the `try`, so its failure skips `release`).
- **Scenario:** (a) `acquire` commits at Neon but the response is lost. The request returns 503 storage_error, but the lease row now names a holder that will never release it, so every instance answers `busy` for 60 s. (b) One hung query inside `serialized` holds this instance's whole FIFO until Vercel kills the invocation at 60 s. Queued requests only check the age gate at the front of the queue, so they hang too.
- **Fix:** pass a per-query timeout, `sql.query(t, p, { fetchOptions: { signal: AbortSignal.timeout(5_000) } })` (the driver merges `fetchOptions`; see index.d.mts:573). When `acquire` throws, run a best-effort `store.release(address, holder)`.
- **Owner:** claude-relayer.

### L2 (LOW): an ambiguous `reserve` burns the authorization behind a "retry" message
- **Where:** relayer.ts:457-461 and :510-513. The same happens after a crash between `reserve` and the broadcast.
- **Scenario:** the CTE commits but the HTTP response is lost (or aborted once L1's timeout exists). The client gets 503 storage_error, "nothing was sent, so retry". That is true, but every retry with the same signature now gets 422 replay, "this authorization was already used", while USDT's `authorizationState` is still false. 0.0024 WBT is also booked against the day's budget. This errs on the safe side (no double pay) and costs liveness.
- **Fix:** confirm that the web treats a 422 replay without a txHash as "sign again with a new salt" (owner: claude-frontend). Optional fix on the relayer side: make `reserve` idempotent by `tx_hash` (on conflict, return `'ok'` when the existing row's `tx_hash` equals ours). A retry with an unchanged pending nonce signs the identical tx (same calldata, constant FEES, RFC 6979 deterministic signature), so it can only rebroadcast the reserved tx.
- **Owner:** claude-relayer / claude-frontend.

### L3 (LOW): a failed `settle` after a mined revert loses the ban and the breaker count
- **Where:** relayer.ts:160-164 and :477.
- **Scenario:** the receipt says `reverted`, and `store.settle` fails (DB blip). The row keeps `reverted = false`, so the payer isn't banned and the revert doesn't count toward the 3-per-hour breaker. The drain guard fails open for that event. Only the ALERT line in stderr records it. Before this batch it was an in-memory write that couldn't fail.
- **Fix:** retry `settle` once when `reverted` is true. If the retry also fails, keep the ALERT so the human can act.
- **Owner:** claude-relayer.

### L4 (LOW): `/health` now reads Neon on every unauthenticated GET
- **Where:** relayer.ts:526, api/relay.ts:24-26 (GET has no auth).
- **Scenario:** a /health flood keeps the Neon compute awake (cost) and competes with `counters`/`acquire`/`reserve` for Neon's HTTP proxy limits. If those calls fail, real payments get 503 storage_error. Before this batch, /health was a 5 s single-flight cached RPC read.
- **Fix:** give `spentToday` the same single-flight 5 s cache that `wbtBalance` has (relayer.ts:116-134).
- **Owner:** claude-relayer.

### L5 (LOW): two fail-open shapes, both correct today
- **Where:** store.ts:17 (`{ cause }` kept), store.ts:34 (`neon(url)`), store.ts:78 (`=== true`), relayer.ts:407.
- **Scenario:** (a) A malformed `DATABASE_URL` makes `neon()` throw `Database connection string provided to neon() is not a valid URL (connection string: <the full URL, password included>)` (index.mjs). That error is kept in `StoreError.cause`. Today only `.name` is logged, but a later `console.error(e)` or an uncaught path would print the password, because Node prints `[cause]`. (b) `row.banned === true` reads anything other than a JS boolean as "not banned". Neon 1.2.0 parses booleans today, but a driver or type-parser change would silently drop the ban. Replay has the PK as a backstop; the ban has none.
- **Fix:** keep only the cause's name in `StoreError`. Make the boolean checks fail closed (`!== false`, or `::int` in SQL and `> 0`). Add one test that sets `DATABASE_URL` to a malformed URL containing a canary password and asserts the canary appears in neither the response nor the console output.
- **Owner:** claude-relayer.

### L6 (LOW): concurrent behaviour is argued, not tested
- **Where:** test/relayer.test.ts:1038-1162 and db/pglite.ts. PGlite is one connection and runs one statement at a time.
- **Scenario:** the "two instances" tests interleave statements, but no two statements ever run at once. So row-lock waits, ON CONFLICT re-checks and EvalPlanQual are never exercised. My reading above says the SQL is correct, but a regression (say, an `acquire` rewritten as SELECT-then-UPDATE) would still pass CI.
- **Fix:** at deploy, run a one-off check against the Neon branch with real concurrent connections, for example 20 parallel `acquire` calls on one free lease: exactly one returns true. Record the output in the deploy notes. If that is too much, accept the argument.
- **Owner:** claude-relayer.

## Notes (no action in this batch)
- Pre-existing, not introduced here: the next lease holder can still read a stale `pending` nonce from a different Ankr backend after a receipt timeout, and a tx whose receipt timed out and that later mines reverted is never recorded (no ban, no breaker). This batch makes nonce use across instances strictly better: they were unserialised before.
- For reviewer-code: inside the lock, the ledger check now runs before the simulate/nonce round instead of after it. Only the reject code changes, and only when both would fail (e.g. budget_exhausted instead of order_paid); nothing is sent either way. The spec names test/shared-limits.test.ts, but the tests are in test/relayer.test.ts.
- dev.ts:9 falls back to in-memory PGlite when `DATABASE_URL` is unset. Running the dev server with the production relayer key gives it its own empty budget and replay set, so it races production for nonces. The same was true before this batch.

VERDICT: PASS (no CRITICAL or HIGH. FOLLOW-UP: M1 database clock for the lease, M2 role SQL and evidence before the deploy step, then L1-L6.)
