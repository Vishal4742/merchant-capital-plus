STATUS: READY

# build-relayer: Part B, relayer state across instances (FR-REL-10, FR-REL-5, FR-REL-6)

Builder: whiteflow-b7 · 2026-11-06 · Files only under `apps/relayer/**`, plus this file. No commits (workspace is not a git repo). Gate self-check (`tools/pipeline-gate.sh`, Edit and Write) printed nothing for every path below.

## Design
All shared state is in two Postgres tables, `rel_lease` and `rel_sent` (`apps/relayer/db/001_rel_state.sql`). Every DB call is **one SQL statement** (`src/state.ts`), using the web app's driver (Neon HTTP, `@neondatabase/serverless` 1.2.0) in production and PGlite in tests.

- **Send lock = a lease row with a fence**, one row per relayer address. `takeLease` is a single `INSERT … ON CONFLICT DO UPDATE … WHERE until < now() RETURNING fence`, so when instances race, exactly one gets a row back. Each take increments `fence`. A release only sets the row's expiry to the past and never deletes it, so a fence number is never reused. The lease lasts `LEASE_S = 90` s, longer than `vercel.json` maxDuration (60 s); `deploy-config.test.ts` now enforces that. A waiting instance polls the lease every 50 ms until the existing `maxRequestAgeMs` limit (20 s), then returns 503 `busy` with nothing signed. Inside one instance, the existing in-memory FIFO stays, so only the head of each instance's queue polls the DB.
- **Why a lease and not an advisory lock:** Neon's HTTP driver can't hold a session between statements, so a session advisory lock is impossible over it. The alternative (an interactive transaction over a pooled/WebSocket client) would keep a connection and transaction open for the ~1–25 s an RPC send takes. It also can't be tested properly on single-connection PGlite. It would still need fencing too, because a dropped connection frees the lock while the instance keeps running. The lease runs on the driver the web already uses, holds no connection, behaves the same on PGlite, and mirrors the web's already-reviewed `app_web_locks` pattern (security 026).
- **Fencing:** the write-ahead insert succeeds only if the writer's fence still matches **and** its lease is still live, checked in the same statement (`WITH lease … INSERT … SELECT … WHERE EXISTS (lease)`). A holder that outlived its lease (e.g. a frozen Fluid instance) can sign locally but can never record the tx, so it never broadcasts; it gets 503 `busy`.
- **Write-ahead (B2):** after signing, `rel_sent` gets `{auth_key, tx_hash, tx_nonce, fence, fee_wei = cap, status 'signed', sent_at}` before `eth_sendRawTransaction`. `auth_key` = `<payer>:<authorization nonce>` is the primary key, so the replay set is durable and shared (insert conflict → 422 `replay`). After the receipt, `settle` writes the real fee and status `mined`, `reverted` or `unknown`.
- **Ledger (B3):** the budget, rate limits, ban and breaker are all derived from `rel_sent` in one read (`readLedger`):
  - spend = sum of `fee_wei` since the UTC day started;
  - payer and merchant sends in the last hour;
  - mined reverts in the last hour;
  - whether this payer has ever had a mined revert.

  It is read before any RPC (pre-check, unchanged order: replay → breaker → ban → budget → rate) and again inside the lease, in parallel with the simulate ‖ nonce round. Accounting is unchanged: the 0.0024 WBT cap counts until a receipt gives the real cost.
- **Fail closed (B4):** there is no in-memory fallback in any mode. A missing `DATABASE_URL`, an unreachable DB or a failing query → `DbUnavailable` (fixed message; only the Postgres SQLSTATE or error name goes to stderr, never the URL, host or driver text) → **503 `db_unavailable`, before anything is signed**. The web already maps 503 to "Nothing was charged; try again". DB queries time out at 5 s, so a hung DB can't hold the lease. A DB failure **after** the broadcast is only logged: the response (200 or 502 with txHash) never changes, and the written-ahead row keeps counting the cap.
- **/health (B5):** `gasSpentToday`/`budgetLeft` now come from the shared ledger. `paused` = breaker open (≥ 3 mined reverts in the last hour) **or** today's budget can't cover one more send, i.e. exactly the states where every `/relay` gets 503. The response shape is unchanged. The ledger read is cached for 5 s per instance with a single shared request (like the balance) and dropped after a local send. `/health` is public, so a request burst costs one DB read. Another instance's sends show up within 5 s. DB down → 503 `db_unavailable`.

## Files changed (all under apps/relayer)
| File | What |
|---|---|
| `db/001_rel_state.sql` (new) | `rel_lease`, `rel_sent` + 5 indexes; idempotent, additive, no DO blocks/functions |
| `db/statements.ts` (new) | SQL splitter, same rule as `apps/web/db/statements.mjs` (the relayer deploys alone, so it can't import that) |
| `db/migrate.ts` (new) | apply command (prints table names only) |
| `src/db.ts` (new) | Neon HTTP client, `setTestDb`, `DbUnavailable`, 5 s timeout, safe logging |
| `src/state.ts` (new) | `readLedger`, `takeLease`, `releaseLease`, `writeAhead`, `settle` (one statement each) |
| `src/relayer.ts` | removed the in-memory `ledgers`/`sentAuthorizations`; ledger checks read the shared ledger; `send` = lease → `sendLeased` (in-lock read, sign, fenced write-ahead, broadcast, settle) → release; DB errors → 503; `/health` reports the shared ledger and real `paused` |
| `test/db-helpers.ts` (new) | PGlite with every `db/NNN_*.sql` applied via the same splitter |
| `test/relayer.test.ts` | PGlite `before`/`after` (no existing assertion changed); 16 new B1–B7 tests with a second module instance (`../src/relayer.ts?instance=2`) on the same PGlite |
| `test/deploy-config.test.ts` | new: `LEASE_S` > maxDuration |
| `package.json`, `package-lock.json` | deps below; script `db:migrate` |

## Schema + apply command
`apps/relayer/db/001_rel_state.sql`, applied from `apps/relayer` with:
```
npm run db:migrate        # = node --env-file=../../.env db/migrate.ts  (needs DATABASE_URL; prints "applied 001_rel_state.sql (7 statements)" and the rel_ table names)
```
Re-running it is safe (B7 test applies it twice on PGlite; rows kept). Not run against Neon by me: no `.env` here and no credentials.

## New dependencies (FLAG, PIPELINE §11)
- `@neondatabase/serverless` **1.2.0** (dependency): the same pinned version the web app uses; `npm ls` shows no transitive runtime deps.
- `@electric-sql/pglite` **0.5.11** (devDependency, tests only): the same pin as the web.
- `npm install` reported `found 0 vulnerabilities`.

## Commands run (real output)
Baseline before any change (Node v24.14.0, apps/relayer): `npm test` → `ℹ tests 62 · ℹ pass 62 · ℹ fail 0`; `npm run typecheck` → clean.

RED (tests written, code not yet changed): `ℹ tests 79 · ℹ pass 63 · ℹ fail 16`. All 62 existing tests and B7 passed; every behaviour test failed. Examples:
- B1: `actual: [ 7, 7 ], expected: [ 7, 8 ]` (two instances signed the same nonce);
- B2: `actual: [ 502, 'rpc_error' ], expected: [ 422, 'replay' ]` (instance 2 broadcast the same authorization again).

GREEN, final code:
```
$ npm run typecheck
> typecheck
> tsc --noEmit
(exit 0)

$ npm test            # run 3 times, ~8.5 s wall each
✔ B7: db/*.sql is idempotent: applying it again keeps every table and row (6.2923ms)
ℹ tests 80
ℹ suites 0
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7604.955
```
The 80 entries are: 62 baseline + 17 new tests (16 B-tests + 1 deploy-config) + 1 entry for `test/db-helpers.ts`. `node --test` loads every file under `test/` and lists the helper as a 0-test file.

**Pre-existing, host-dependent flake (not caused by this batch):** `the background refresh keeps re-reading the balance…` asserts ≥ 3 ticks of a 20 ms `setInterval` in 75 ms. On this Windows host at the default ~15.6 ms timer resolution, that interval fires about every 31 ms.
- A standalone probe with **no relayer code and no PGlite** got < 3 ticks in **40/40** rounds.
- In that state the suite reads `ℹ pass 79 · ℹ fail 1` (only that test).
- With the system timer resolution held at 1 ms (`timeBeginPeriod(1)` from a temporary helper process, which Windows reverts on exit), the full suite was 80/80 in 3 of 3 runs.
- I left the test unchanged. Linux CI should be unaffected. Suggested fix for a later batch: wait for 3 reads with a deadline instead of a fixed 75 ms sleep.

Also fixed: an open PGlite keeps the test process alive about 10 s after it last did any work once DDL has run, which stretched `relayer.test.ts` from ~8 s to 41 s. It is now closed in `after()`.

## Acceptance criteria
- [x] B1: two instances, one PGlite: nonces 7 and 8, and the second nonce is read after the first tx is mined. A live lease from a "crashed" instance → 503 `busy`, nothing signed; once it lapses it is re-taken with fence 42 (from 41) and released as expired, not deleted. Fencing: a lease taken over mid-send → 503 `busy`, nothing written or broadcast.
- [x] B2: an authorization sent on instance 1 (tx still pending) is a 422 `replay` on instance 2. The row `{tx_hash, tx_nonce 7, fee = cap, status signed}` exists when `eth_sendRawTransaction` arrives, and is then settled to `mined` with the real fee.
- [x] B3: ban and breaker (instance 2 sees instance 1's reverts); budget (three sales racing on two instances → 1 sent, 2× 503 `budget_exhausted`, then a refusal with no RPC); payer limit (10 on instance 1 → 11th on instance 2 is 429); merchant limit (199 seeded → the 200th passes, the 201st is 429).
- [x] B4: no DB configured → `/relay` 503 `db_unavailable` with **zero RPC calls**, and `/health` 503. A DB failure at each of the 4 statements before the broadcast → 503, nothing sent, no host in the response or the logs. A DB failure after the broadcast → the 200 and txHash stand.
- [x] B5: instance 2's `/health` shows instance 1's spend and `paused: true` after 3 reverts (≤ 5 s staleness, shown by advancing the clock); `paused: true` once the budget can't cover a send; 10 concurrent `/health` calls → 1 DB read. The existing exact-shape health test is unchanged (`paused: false` when fresh).
- [x] B6: all 62 baseline tests pass with no assertion changed (only the PGlite setup was added at the top of the file), including AT-10 behaviour (invalid/unprofitable calls rejected before any send, no gas).
- [x] B7: schema idempotent (test); apply command above; `RELAYER_PRIVATE_KEY` handling untouched; no secret or DB URL in any file or log line.

## Behaviour changes to know about (all deliberate, all fail-safe)
1. **Fail closed in every mode**, not only production: `npm run dev` now needs `DATABASE_URL` in `apps/relayer/.env`, or every `/relay` and `/health` answers 503 `db_unavailable`.
2. A payer ban is now **permanent** (it lives in the DB). Before, it lasted only as long as the process.
3. A send counts toward the rate limits and the cap budget from the write-ahead (just before broadcast) rather than just after: slightly more conservative.
4. A duplicate that reaches the lease now makes the simulate ‖ nonce reads before being refused as a replay (the ledger read runs alongside them). Reads only: no gas, nothing sent.
5. There are two new 503 reasons: `db_unavailable` (DB down) and `busy` "lost its send lock". Both are sent before anything is broadcast; the web maps any 503 to "Nothing was charged; try again".

## OPEN
- **Latency (NFR-4, NFR-14): re-measure on the deployed relayer.**
  - A successful `/relay` now adds 5 sequential Neon HTTP round trips: pre-check read, lease, write-ahead, settle, release. The in-lock read runs in parallel with RPC.
  - `/health` adds at most one read per 5 s per instance, in parallel with the balance read.
  - NFR-4 was measured at 4.32–4.40 s against a 5 s budget, so the headroom is about 600 ms.
  - Proposed if needed: run `settle` and `release` in parallel, or release before `settle`.
- **Write-ahead committed but its reply lost (5 s timeout):** the relayer answers 503 "nothing sent". That is true, but the authorization is now marked used, so a re-POST of the same signature is a 422 `replay` and the customer has to sign again. No double charge.
- **A frozen instance in the microseconds between the fenced write-ahead and the broadcast,** for longer than the 90 s lease: a second holder could broadcast the same nonce. The node accepts only one of the two txs; the other fails with 502. There is no double payment (EIP-3009 nonces are single-use). The nonce still comes from the chain's `pending` count, as before.
- The lease is polled every 50 ms by each waiting instance (`ponytail:` in `relayer.ts`). `rel_sent` is never pruned (`ponytail:` in the SQL).
- Out of scope, as the spec says: Unknown → reconcile of uncertain broadcasts (FR-OPS-4, needs SRS v3.0). Rows with status `unknown` are recorded for it.

## NEEDS THE USER
1. **Deploy order (otherwise every payment returns 503):** set `DATABASE_URL` on the **relayer** Vercel project (the same Neon DB as the web works: the tables are `rel_`-prefixed) → run `npm run db:migrate` from `apps/relayer` → then deploy this relayer.
2. Approve the **new relayer dependency** `@neondatabase/serverless` 1.2.0 (and PGlite 0.5.11 for dev) (§11).
3. **Relayer limits and budget** (§11): the values are unchanged (0.1 WBT/day, 10 per payer and 200 per merchant per hour, breaker at 3/h). New: `paused` in `/health` (and the dashboard badge) is now true when the breaker is open or the budget is spent.

## Doc drift (for whiteflow-ef / claude-research; I did not edit these)
- `PHASES.md:62` says "Postgres lock + rel_sent + breaker + rate limits + daily budget … verified 06:22, batch 006". Before this batch, all of that was in process memory. After it, there is a Postgres **lease** (not an advisory lock) and `rel_sent`.
- `ARCHITECTURE.md` §3 "serialized sends (Postgres advisory lock)" should read "per-relayer lease row with a fence (`rel_lease`), write-ahead `rel_sent`". Point (7) "rate limits … in SQL" is now true for payer and merchant; the IP limit is the web's. Point (10) "pause switch" doesn't exist: `paused` is derived from the breaker and budget, and there is no manual switch.
- FR-REL-6 "pause state" now has a concrete meaning (breaker open or budget spent) that the SRS doesn't spell out.

## Round 2
whiteflow-ef's round-1 security review of Part B found no CRITICAL, HIGH or MEDIUM issue and asked for three LOW hardening items. All three are done, test-first, in `apps/relayer` only. Nothing else in the product code changed. Gate self-check: silent for every path touched.

### R2-1: migrate.ts never prints the connection string (AGENTS.md "never print a .env value")
- **Reproduced first,** with a fake password. On `DATABASE_URL="psql 'postgresql://u:<FAKE_PASSWORD>@x/db'"`, the first `sql.query()` rejects with a `NeonDbError` whose message **and** stack contain the password. The old `migrate.ts` didn't catch it, so Node printed it.
- **Fix:**
  - `src/db.ts` exports `errorLabel(e)`: the SQLSTATE (`/^[0-9A-Z]{5}$/`) or the class name (`/^[A-Za-z][A-Za-z0-9_]{0,63}$/`), else `error`. Never the message or stack.
  - `query()` now logs through it (same rule as before, shared).
  - `db/migrate.ts` wraps the connect, every statement and the table listing in try/catch, prints `migration failed: <file> statement <n>: <label>` (or `connecting` / `listing tables`), and exits 1.
- **Test:** `test/migrate.test.ts` (new) runs `node db/migrate.ts` with that fake URL and asserts:
  - exit code 1;
  - neither `SECRETPW` nor `postgresql://` appears in stdout or stderr;
  - stderr matches `migration failed: 001_rel_state.sql statement 1: NeonDbError`.
- **RED** before the fix: `✖ … AssertionError [ERR_ASSERTION]: the password was printed`.
- **GREEN** after the fix:
  ```
  $ DATABASE_URL="psql 'postgresql://u:<FAKE_PASSWORD>@x/db'" node db/migrate.ts
  migration failed: 001_rel_state.sql statement 1: NeonDbError
  (exit 1; grep -c SECRETPW on the output = 0)
  ```

### R2-2: the write-ahead's `AND until > now()` is now pinned by a test
New test: `B1 fencing: a sender whose lease merely expired (same fence, nobody took it yet) cannot write ahead either`. In the `eth_getTransactionCount` hook it runs `UPDATE rel_lease SET until = now() - interval '1 second' WHERE relayer = $1`, with the fence unchanged. It then asserts 503 `busy`, no txHash, `node.sent.length === 0` and no `rel_sent` row.

Mutation check: I removed `AND until > now()` from `state.ts:75` on a scratch basis, then restored it (verified: `75: … AND fence = $2::bigint AND until > now()`).
```
=== MUTANT (no 'AND until > now()') ===   node --test --test-name-pattern="^B1 fencing" test/relayer.test.ts
✖ B1 fencing: a sender whose lease merely expired (same fence, nobody took it yet) cannot write ahead either
    actual: [ 200, undefined, '0x50a2bf28…c1193b' ],      ← the stale holder broadcast
    expected: [ 503, 'busy', undefined ],
=== RESTORED ===
✔ B1 fencing: a sender whose lease was taken over while it was in the lock cannot write ahead, so it never broadcasts
✔ B1 fencing: a sender whose lease merely expired (same fence, nobody took it yet) cannot write ahead either
ℹ tests 2 · ℹ pass 2 · ℹ fail 0
```

### R2-3: a failed settle is retried, with limits
- **Fix:** `recordSend` (`src/relayer.ts`) retries `settle()` up to **3 tries**, with 100 ms then 300 ms backoff. It makes no new try once **2 s** have passed (a hung DB has already cost its 5 s query timeout). It never retries after a success.
- `reverted_at` uses one timestamp taken before the first try.
- It still never throws and never changes the HTTP response. On final failure it logs `ALERT settle failed <txHash>: <outcome> not recorded after <n> tries (the capped fee stands)`; the txHash is public, and there is no DB text.
- **Added latency:** only when the DB fails. At most ~0.4 s for fast failures; worst case ~7 s (a fast failure at ~1.9 s, then one hung try).
- **Tests** (RED before the fix: both `✖`):
  - `B3/B4: a failed settle is retried, so a mined revert still bans the payer; the answer is unchanged`: the first 2 settles fail and the 3rd records `reverted`. The answer is still 502 `reverted` with the txHash. Instance 2 then refuses the payer with 422 `payer_banned`.
  - `B4: settle runs once when it succeeds and at most 3 times when it keeps failing, then alerts; the 200 stands`: exactly 1 settle on success. When it always fails: exactly 3, the 200 and txHash stand, the ALERT is logged, and `db-host` never appears in the logs.

### Test-harness fixes in my own round-1 tests (found by the filtered mutation runs; no product code)
- The second-instance import (`await import('../src/relayer.ts?instance=2')`) moved from mid-file to the top. A top-level await between `test()` calls let node:test end the root early under `--test-name-pattern`, running `after()` before `before()`. Full runs were never affected.
- `after(() => pg?.close())`: when a filter matches no test, node:test skips `before()` but still runs `after()`.
- B7 now inserts its own row instead of relying on rows from earlier tests (it failed when run alone).
- Filtered runs after the fix: `^B7` 1/1 · `^nothing-matches-this` 1/1 · `^B1 fencing` 2/2 · `^B3/B4|^B4` 5/5.

### Commands run (round 2, real output)
```
$ npm run typecheck
> typecheck
> tsc --noEmit
(exit 0)

$ npm test        # 3 runs, ~9.8 s wall each
ℹ tests 84 · ℹ pass 83 · ℹ fail 1   ✖ the background refresh keeps re-reading the balance, so health is served from the cache
(identical in all 3 runs; grep -c SECRETPW over all outputs = 0)
```
84 entries = 62 baseline + 17 from round 1 + 4 from round 2 (migrate, B1 expired lease, 2 settle tests) + 1 entry for the `test/db-helpers.ts` file. **Every batch-031 test passes.** The single failure is the pre-existing timer test, which whiteflow-ef also reproduced independently and accepted as a host issue. A bare 20 ms-interval probe with **no relayer code and no PGlite** failed **40/40** rounds at the same moment (CPU load 4%).

**Correction to round 1:** I wrote that holding `timeBeginPeriod(1)` from a helper process made the suite 80/80. On Windows 11, timer resolution requested by another process doesn't apply to this one. The probe got < 3 ticks in 40/40 rounds with the helper running this time. The earlier green runs therefore most likely coincided with a better host timer state (the probe showed 1/40 then), not with the helper. The conclusion stands: the failure follows the host's timer state, not the code.

## Round 3
Owner decisions at the human gate (spec.md "Round 3": B8, B9). This is the second and last allowed resume. Work stayed in `apps/relayer/**`; gate self-check silent for every path touched. Tests first: 14 behaviour tests went RED (with a throwing stub of `unblockPayer`, so the file loaded), then GREEN. Every key guard was mutation-checked (table below).

### B8: transient DB failures are retried briefly; unknown DB state never leads to a signature or broadcast
- **Where:** `src/db.ts` `query()` retries before throwing `DbUnavailable` (which stays 503 `db_unavailable` before any signature, as before).
  - Tries: up to 4, with 100 / 300 / 600 ms backoff.
  - No new try starts once **1.5 s** has passed. In practice it gives up after ≈ 1.0 s on fast failures.
  - A single hung statement still uses its 5 s timeout and is not retried.
- **Transient only** (`isTransient`):
  - timeouts and aborts;
  - dropped or refused connections (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `EAI_AGAIN`, `UND_ERR_*`);
  - Neon's "Error connecting to database" (it carries `sourceError`);
  - Neon "Server error (HTTP status 5xx or 429)";
  - SQLSTATE `08…`, `53…`, `57P01-03`, `40001`, `40P01`.

  Never retried: constraint/SQL/logic errors, 4xx, unknown errors, and an unconfigured DB. These shapes come from reading `@neondatabase/serverless` 1.2.0's code. A malformed URL is tried once (it isn't transient).
- **Every statement is safe to repeat:**
  - reads, and the guarded `UPDATE`s (release-lease, settle), are naturally safe;
  - **take-lease:** `rel_lease.holder` = a per-request UUID. If a take committed but its reply was lost, the retry returns the live lease this request already holds (`UNION ALL … WHERE holder = $2 AND until > now()`), not "held by someone else → busy". If a retry overlaps the still-committing first try, the next lease poll (50 ms, same holder) finds it;
  - **write-ahead:** `ON CONFLICT (auth_key) DO UPDATE SET status = rel_sent.status WHERE tx_hash = ours AND fence = ours AND status = 'signed'`. A retry recognises its own committed row as `written`, never as `replay`. `DO UPDATE` sees the latest committed row, so this holds even if the first try commits mid-retry. The **fence** is required because a stale holder re-signing the same nonce produces an identical tx hash;
  - **unblock:** a fixed UUID with `ON CONFLICT (id) DO NOTHING`.
- **Remaining edge** (unchanged from round 1, now rarer): the write-ahead committed **and** every retry failed (> 1.5 s of DB outage). The answer is 503 and nothing is broadcast, but the authorization is marked used, so a re-POST of the same signature gets 422 `replay` and the customer must sign again. No double charge.
- R2-3's own settle loop in `recordSend` was removed: `db.ts` now retries settle like every statement (no nested retries). Final failure → `ALERT settle failed <txHash>`; the response is unchanged.

### B9: no automatic ban; a temporary, audited cooldown for repeated payer-attributable failures
- **No ban.** One mined revert no longer blocks the payer (`payer_banned` is gone).
- **Replays and duplicates never penalize the payer.** A re-POST of a failed authorization is still a 422 `replay`, without a rebroadcast (the shared replay set), and adds nothing to any count.
- **Kept as separate safeguards, unchanged:** the global revert breaker (3 mined reverts/hour per relayer → 503 for everyone, any cause), the daily WBT budget, and the payer/merchant rate limits.
- **Qualifying failure** (`payerFault`, `src/relayer.ts`), with the justification:
  1. **The signature was already verified as the payer's** before relaying (ECDSA recovery to `from`). A forged or invalid signature is refused with 422 `bad_signature` and never written, so it can never count against the claimed payer (tested with 5 forged requests).
  2. **The tx was mined and reverted.** At the revert's block, one batched read checks:
     - `authorizationState(payer, nonce) == false`, i.e. the authorization was **not** consumed elsewhere. If it was, e.g. a front-run that paid the order, the funds left with it and that isn't the payer's doing, so it doesn't count;
     - `balanceOf(payer) < signed value` (sale amount, invoice amount + relayFee, or funding quote), i.e. the payer moved their USDT after signing. That is the gas-griefing pattern.
  3. **Anything else doesn't count:** a contract or token pause, a blocklist, gas, an unknown cause, or a failure of this check itself (RPC trouble).

  I **did not** count "authorization used/cancelled elsewhere", as the suggestion included it. With a single boolean, a payer's cancellation is indistinguishable from a third party's front-run that paid the order. Telling them apart needs the token's `AuthorizationCanceled` logs, and that event isn't in our verified ABI. So cancel-griefing stays bounded by the breaker, budget and rate limits (OPEN below).
- **Policy** (provisional testnet values, not production-validated). Env var names, read on every check; an invalid value falls back to the default with one stderr warning:

  | Env var | Default | Meaning |
  |---|---|---|
  | `RELAYER_COOLDOWN_FAILURES` | 3 | distinct qualifying failures… |
  | `RELAYER_COOLDOWN_WINDOW_S` | 600 | …within this many seconds (exclusive) |
  | `RELAYER_COOLDOWN_S` | 900 | cooldown length, from the failure that completed the streak |

- **Persisted and shared:** `rel_sent.payer_fault_at` holds one per authorization, so failures are distinct by construction. The cooldown is derived in the same single ledger read on every instance, per payer across relayers, and survives restarts. While active: **HTTP 429**, `{"code":"payer_cooldown","retry_after_s":<int>}` plus a `Retry-After` header, before any RPC.
- **Audited unblock** (operator CLI, no endpoint):
  ```
  npm run payer:unblock -- --payer 0x… --actor <who> --reason "<why>"     # from apps/relayer, reads DATABASE_URL from ../../.env
  → unblocked 0x… by <who> (audit <uuid>): lifted a cooldown that ran until <ISO time> | no cooldown was active
  ```
  - It writes `rel_payer_unblocks(id, payer, actor, reason, cooldown_until, at)`. Failures at or before `at` stop counting, so the cooldown ends at once and old failures can't re-trigger it.
  - Arguments are validated before any DB access: usage and exit 2. A DB failure prints `unblock failed: the relayer's database is unavailable` and exits 1; no secrets or driver text.

### Schema and apply command
`db/002_rel_round3.sql` (new; additive and re-run safe, verified by B7 applying all files twice):
- `rel_lease.holder`;
- `rel_sent.payer_fault_at` + a partial index;
- the `rel_payer_unblocks` table + index.

Apply with `npm run db:migrate` from `apps/relayer` (applies 001, then 002).

### Existing tests changed by the owner's policy (assertions, not just setup)
- The batch 006 `breaker:` test and the B3 shared-breaker test: "a mined revert bans the payer" (422 `payer_banned`) became "the same payer's next authorization is relayed". The 3-reverts-per-hour breaker assertions are unchanged.
- B4 "failure at any step": it now injects a **fatal** (non-retried) error, so query *n* is still exactly that step.
- R2-3 settle tests:
  - the revert test now asserts a recorded payer fault instead of a ban;
  - "at most 3 tries" became 4, since db.ts retries now.

### New tests (14)
- **B8** (6):
  - two transient failures, then success → 200;
  - take-lease reply lost → recognised (200, fence 1, no second lease);
  - write-ahead reply lost → recognised (200, one broadcast, one row);
  - direct `writeAhead`/`takeLease`: our retry = written and holder recognised, while the same tx hash under another fence = replay and the old holder isn't recognised;
  - another holder's row is still a replay;
  - a fatal error is tried once, persistent transient errors give up in < 1.8 s with 4 tries, and nothing is signed, sent or RPC'd.
- **B9** (6):
  - 3 attributable reverts on 3 relayers, across 2 instances → 429 `payer_cooldown`, `retry_after_s` in (890, 900], `Retry-After` header, no RPC, on both instances; other payers unaffected;
  - 2 attributable reverts don't block, and 3 reverts each of: funds still present / consumed elsewhere (front-run) / check failed → 0 faults, still relayed;
  - re-POSTs of a failed authorization → replay, no rebroadcast, no extra fault; 5 forged signatures → 0 faults;
  - window and cooldown arithmetic: 11/5/1 min ago → none; 18/17/16 min ago → expired; 9/5/1 min ago → `retry_after_s` in (830, 840];
  - env thresholds;
  - audited unblock: audit row has actor, reason and the lifted cooldown; payer relayed again; a new failure plus the pre-unblock ones don't re-trigger; bad actor/payer are refused.
- **CLI** (`test/unblock-cli.test.ts`, 2): bad or missing arguments → exit 2 with usage and no DB access; malformed `DATABASE_URL` → exit 1, no password, fixed message.

### Mutation checks (each applied alone, the named test fails, then restored; restoration verified by grep)
| # | Mutation | Caught by | Observed |
|---|---|---|---|
| M1 | take-lease holder recognition disabled (`AND false`) | B8 take-lease lost reply; B8 direct | `actual: 503, expected: 200`; holder recognition `undefined` vs `'2'` |
| M2 | write-ahead `DO UPDATE … WHERE ours` → `DO NOTHING` | B8 write-ahead lost reply; B8 direct | `actual: 422 ('replay'), expected: 200 ('written')` |
| M3 | recognition without `fence = EXCLUDED.fence` | B8 direct fence test | `actual: 'written', expected: 'replay'` |
| M4 | every error treated as transient | B8 non-transient; B4 any-step | `actual: [503,'db_unavailable',4], expected: [...,1]`; B4 step 4 then broadcast (200) |
| M5 | payer fault without `!used` (front-run counted) | B9 unattributable | `authorization consumed elsewhere (front-run)…: counted` |
| M6 | cooldown ignores audited unblocks | B9 audited unblock | `actual: 429, expected: 200` |
| M7 | no 10-min window (any 3 failures) | B9 window | `actual: true, expected: false` (11/5/1 min blocked) |

### Commands run (round 3, real output)
```
$ npm run typecheck
> typecheck
> tsc --noEmit
(exit 0)

$ npm test        # 3 runs, ~15.5 s wall each (B8/B9 tests wait out real retry budgets)
run 1: ℹ tests 98 · ℹ pass 97 · ℹ fail 1   ✖ the background refresh keeps re-reading the balance, so health is served from the cache
run 2: ℹ tests 98 · ℹ pass 98 · ℹ fail 0
run 3: ℹ tests 98 · ℹ pass 98 · ℹ fail 0
(grep -c SECRETPW over all outputs = 0)

$ node db/unblock-payer.ts                         → usage: npm run payer:unblock -- --payer 0x… --actor <who> --reason "<why>"   (exit 2)
$ DATABASE_URL="psql 'postgresql://u:<FAKE_PASSWORD>@x/db'" node db/unblock-payer.ts --payer 0x1111…1111 --actor ops-asha --reason test
db error NeonDbError
unblock failed: the relayer's database is unavailable                                                                          (exit 1; password count 0)
```
98 = 84 (round 2) + 14 new. The single run-1 failure is the pre-existing host-timer test (rounds 1 and 2).

### OPEN (round 3)
- **Breaker vs. cooldown, with one hot key:**
  - the breaker (3 mined reverts per hour per relayer, any cause) trips **no later than** a payer's cooldown (3 qualifying failures in 10 min);
  - so a single griefer on one relayer still stops everyone at their 3rd revert, and the cooldown adds protection only when reverts are spread over relayers, or after the breaker's hour;
  - values are unchanged, as instructed. The owner may want the breaker threshold above the cooldown's (a §11 limits decision).
- **Cancel-griefing:** a payer who cancels their own authorization looks like "consumed elsewhere", so it doesn't count (see the justification above). Bounded by the breaker, budget and rate limits. Upgrade: read the token's `AuthorizationCanceled` log at the revert block once its event signature is verified on the deployed USDT.
- **The attribution check reads state at the revert block** (recent, so fine on Ankr). The revert path adds one parallel RPC round (3 reads) before answering 502 `reverted`.
- **Write-ahead committed + the DB down for > 1.5 s:** 503 and nothing sent; the authorization is now marked used, so the customer re-signs. No double charge.

### NEEDS THE USER (round 3)
1. **Run `npm run db:migrate`** (it now applies 001 + 002) before deploying, with `DATABASE_URL` set on the relayer project, as before. Without 002 every `/relay` answers 503 (`holder`/`payer_fault_at` are missing).
2. **Cooldown thresholds** are provisional testnet values: `RELAYER_COOLDOWN_FAILURES`=3, `RELAYER_COOLDOWN_WINDOW_S`=600, `RELAYER_COOLDOWN_S`=900. Unset = these defaults.
3. **Unblock procedure:** `npm run payer:unblock -- --payer 0x… --actor <who> --reason "<why>"`, run by an operator with `DATABASE_URL`. Every use leaves a `rel_payer_unblocks` audit row.
4. **Decide whether the per-relayer breaker threshold should sit above the cooldown's** (OPEN, first item).
