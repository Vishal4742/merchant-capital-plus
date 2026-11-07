VERDICT: PASS
# Batch 049-PW4-port-stage2 · round 1 · reviewer-security (phase mode, Money: yes; only HIGH/CRITICAL block)

Scope: only the merge resolution that is new in this batch (`git diff a39b0c7 7a4129d`, `git diff origin/main 7a4129d -- apps/relayer`) plus the batch-049 test fix c82a9e8. Batch 031 itself was not re-reviewed. The worktree HEAD has since moved to `wf/stage3-identity` (b57093d, batch 050). Every file reviewed here is byte-identical between 7a4129d and HEAD, except `apps/relayer/test/relayer.test.ts` (c82a9e8: a test-timing fix with the same assertions). I edited no code.

No CRITICAL or HIGH. One MEDIUM: the cutover and rollback runbook is wrong or missing. It fails closed, so no money is at risk, but fix it before anyone merges. The other findings are LOW or info.

## Commands run
- `git diff a39b0c7 7a4129d -- apps/relayer/src apps/web/lib/server/webhooks.ts apps/web/lib/server/events.ts apps/web/lib/relay.ts`: **empty**. The relayer source and the web webhook, event and relay code are exactly the snapshot's reviewed version.
- A 3-way provenance check over every file under apps/, packages/, contracts/ and tools/ (base 3cd0dc9, main e7e41bf, snapshot a39b0c7, merge 7a4129d). Merge results that differ from both parents: the relayer db/test files, the two funds routes, `capital-fund.ts`, `http.ts` and UI files. `capital-fund.ts` = main's minLeft check + snapshot's `payer_cooldown` 429; `http.ts` = main's `unstable_rethrow` + snapshot's `sharedRateLimit`. Both are a plain union. `relayer.ts` = snapshot (main's 037 store wiring superseded, as P2 intends). `capital.ts`: snapshot == main. Relayer `package.json` deps and the lockfile are identical to main (`@neondatabase/serverless` 1.2.0, `@electric-sql/pglite` 0.5.11).
- PGlite (PG 18.6) scripts in a temp dir outside the repo, reading the repo's SQL. They:
  - applied 001 + 002, inserted a 037 row, then 003/004 twice + 005;
  - ran main's batch-037 `reserve()` INSERT as `mcplus_relayer`;
  - dumped `information_schema` privileges for `mcplus_relayer`;
  - tracked `pg_class.relfilenode` across re-runs;
  - upgraded a DB built from the snapshot's own `001_rel_state.sql` + `002_rel_round3.sql`.
- The secret grep `(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` over the 186 files in the two diffs (`.env*` excluded). Results under "Secrets" below.

## What holds
- **Replay set.** `auth_key` PK and every row are kept. The key format is the same on both sides (`lower(payer):lower(nonce)`: main `store.authKey`, new `relayer.ts:148-149`), so batch-037 rows keep blocking `writeAhead`'s `ON CONFLICT (auth_key)`. Legacy rows get `fence = 0`, and fences start at 1, so a legacy row can never be "recognised as our own" write-ahead (the B8 path). It is always a replay.
- **Daily budget.** The `BIGINT → NUMERIC(78,0)` cast keeps every value (the test and Neon harness compare the fee sum before and after). `relayer`, `sent_at` (unix ms) and lowercasing are unchanged, so today's spend carries across the upgrade.
- **Breaker.** `reverted_at = sent_at` for legacy reverted rows (an honest approximation: a mined revert lands seconds after the send), so the last hour's 037 reverts still count.
- **Fail closed in every partial state.** New relayer before 003/004 → 42P01. Before 005 → 42501. Both are non-transient (`db.ts:63-74`), so `DbUnavailable` → 503 before any RPC or broadcast. Old relayer after 003 → 23502 → `StoreError` → 503 before broadcast (verified). No mix of old and new code can broadcast without a write-ahead row.
- **Least privilege (002 + 005), verified as `mcplus_relayer`:**
  - **Grants match the statements.** Table grants are SELECT+INSERT on rel_sent, rel_lease and rel_lock, and SELECT on rel_payer_unblocks. Column UPDATE: rel_lease(fence, holder, until), rel_sent(fee_wei, payer_fault_at, reverted, reverted_at, status), rel_lock(holder, until_ms). This covers each state.ts statement:
    - `readLedger`: SELECT on rel_sent and rel_payer_unblocks.
    - `takeLease`: INSERT … ON CONFLICT DO UPDATE fence/until/holder + RETURNING, so INSERT, column UPDATE and SELECT.
    - `releaseLease`: UPDATE(until).
    - `writeAhead`: INSERT + the no-op `DO UPDATE SET status`, so UPDATE(status).
    - `settle`: UPDATE of four columns. PG checks every SET column whatever the value, so the role test's mined sale proves all four.
  - **Write limits.** No DELETE. No UPDATE on auth_key, sent_at, payer, relayer or tx_hash, so the role can neither erase the replay set nor backdate rows. No INSERT on `rel_payer_unblocks` (the unblock stays owner-only, and the test asserts the refusal). No access to the web's `app_*` tables. No CREATE on the schema. Column ACLs survive the 003 type change.
- **Funds routes (item 4).** `"memory"` is right for both:
  - The answer is one boolean derived from public chain state (`balanceOf`, the on-chain invoice), so there is no info leak.
  - With the DB up, the shared window is strictly tighter than main's per-instance `rateLimit()`. With it down, behaviour equals main's.
  - Key `funds:<ip>` is shared by both routes as intended. `clientIp` is the Vercel-set `x-forwarded-for`. Over-long keys are hashed (`http.ts:163`).
  - On `sessions/[id]/funds` the fallback is moot: `getSession` needs the DB, so a DB outage is a 503 there anyway. That is harmless.
  - main added no other API routes, and no `rateLimit(` caller is left outside `sharedRateLimit`'s fallback.
- **Secrets (item 5).** No `.env` file, key, mnemonic or connection string in the diff. Every grep hit is one of:
  - an env var name (`RELAYER_PRIVATE_KEY` at relayer.ts:93-99, `RELAY_API_SECRET` at capital-fund.ts:81, `VOUCHER_HASH_SECRET` and `ARKIV_PRIVATE_KEY` in vouchers.ts, `DEPLOYER_PRIVATE_KEY` at MoveAdminToSafe.s.sol:96, `MCP_SECRET_KEY`);
  - a labelled test fake (`'SECRETPW'` with `postgresql://u:…@x/db` in migrate/unblock-cli tests, `sk_test_AbCd…` in packages/mcp/test/helpers.ts:10, `hunter2` in rate-limit-db.test.mjs:40, `voucher-hash-secret-for-tests`);
  - a scanner regex (ci.yml:145, pre-push:40);
  - a public 64-hex value: testnet tx hashes in README.md:38-48 explorer links, the USDT DOMAIN_SEPARATOR (relayer.test.ts:249), secp256k1 N (:673), a fundingNonce vector (ui-capital-investor.test.mjs:42), an orderRef in the mcp fixture;
  - review prose in `.batches/*`.

  `.env.example` adds two empty public-ID keys. `tools/stage2/relayer-neon.ts` reads only `DATABASE_URL` via `parseEnv` and prints only PASS/FAIL notes.

## FOLLOW-UP

### M1 (MEDIUM): the cutover and rollback runbook is wrong or missing. Fails closed, no money at risk; fix it before merge (docs only)
- **Where:**
  - `apps/relayer/db/003_rel_state.sql:7` claims "Rollback: the batch-037 relayer ignores the new columns and table". `:32-34` make `tx_nonce`, `fence` and `status` NOT NULL with no DEFAULT.
  - main's 037 `reserve()` inserts only `(auth_key, relayer, payer, merchant, tx_hash, fee_wei, sent_at)` (origin/main `apps/relayer/src/store.ts:122-123`).
  - The new `settle` (`src/state.ts:134`) never writes 001's `reverted` column, which 037's breaker and ban read (`store.ts:76-77`).
  - There is no relayer cutover runbook anywhere; the order exists only in SQL comments. A merge to main deploys the relayer.
- **Verified:** after 003, 037's reserve fails with `23502 null value in column "tx_nonce"`. A new-relayer revert row ends up `reverted = false, status = 'reverted'`.
- **Failure scenarios:**
  1. The owner runs `db:migrate` ahead of the merge. The live 037 relayer then answers every `/relay` with 503 `storage_error` until the PR deploys.
  2. The PR merges before 003/004/005 run. The new relayer answers every `/relay` with 503 (42P01/42501).
  3. In an incident the operator "rolls back" by reverting the PR as the header promises. Every relay is then a 503. If someone then "fixes" that by dropping NOT NULL, the 037 breaker and ban are blind to the last hour's reverts recorded by the new relayer.

  All three are total outages of the gasless pay path. None broadcasts without a record, so no money is at risk. The NOT NULL is actually what keeps old and new from both sending on one key, so keep it.
- **Fix (owner: whiteflow-f3, relayer files and PR body):**
  - Correct the 003 header: after 003 a batch-037 relayer refuses every relay. Rollback = revert the PR **and** run an owner-only rollback SQL:
    - `ALTER TABLE rel_sent ALTER COLUMN tx_nonce DROP NOT NULL, ALTER COLUMN fence DROP NOT NULL, ALTER COLUMN status DROP NOT NULL;`
    - `UPDATE rel_sent SET reverted = true WHERE status = 'reverted';`

    Keep that SQL in a non-schema file, e.g. `db/rollback_037.sql`, so `isSchemaFile` never runs it. Never run it while a new relayer is live.
  - Put the cutover order in the PR body:
    1. Frozen window, no other merges.
    2. Owner runs `npm run db:migrate` (001/003/004) with the owner URL, then `005_relayer_role_state.sql`.
    3. Merge at once. Expect relayer 503s in between; the web already says nothing was charged.
    4. Check `/health` (spend carried over, `paused` false) and one test payment.
  - Optional: have `settle` also set `reverted = ($3 = 'reverted')` so 001's column stays truthful. 002 already grants UPDATE(reverted).

### L1 (LOW): 003 rewrites `rel_sent` under ACCESS EXCLUSIVE on every `db:migrate` run
- **Where:** `003_rel_state.sql:24` `ALTER COLUMN fee_wei TYPE NUMERIC(78, 0) USING fee_wei::numeric`. `db/migrate.ts:21` re-applies every schema file on each run (there is no applied-migrations table).
- **Verified:** with `USING`, `relfilenode` changes on a re-run (a full table rewrite plus an index rebuild). The same statement without `USING` on a NUMERIC(78,0) column keeps `relfilenode` (no rewrite). `SET NOT NULL` and the CHECK drop/re-add only scan.
- **Scenario:** `rel_sent` is never pruned (one row per relayed payment). Each later `db:migrate`, e.g. for a future 006, locks it for the length of a rewrite. Relayer statements block, hit the 5 s timeout, and return 503 before broadcast. Once a payment has been sent, `settle` can time out too, which leaves the conservative cap fee in place. Small today; grows with volume.
- **Fix (whiteflow-f3):** drop the `USING fee_wei::numeric` clause. bigint→numeric has an assignment cast, so the first run still converts. 003 has not been applied anywhere real, so editing it is still allowed. Optional: also make lines 35-36 a no-op on re-run.

### L2 (LOW): role-file exclusion is a substring match, and the skip list is hard-coded
- **Where:**
  - `db/statements.ts:52` `!/_role/.test(name)`.
  - `db/migrate.ts:29` prints a fixed "002…, then 005…" string.
  - `test/db-helpers.ts:30` uses a different regex (`/^\d{3}_.+_role.*\.sql$/`).
- **Scenario:** a future schema migration whose name contains `_role` (e.g. `006_rel_roles_cleanup.sql`, or `006_role_x.sql`, which neither regex treats as a role file) is skipped by `db:migrate`, the PGlite tests and the Neon harness alike, so no test notices. The console still says only 002/005 were skipped. The relayer would then fail closed on the missing schema, or quietly run without an intended constraint or index.
- **Fix (whiteflow-f3):**
  - Use one shared, anchored predicate (e.g. `isRoleFile = /^\d{3}_relayer_role[\w-]*\.sql$/`) in all three places.
  - Have migrate print the role files it actually skipped, computed from `readdir`.
  - Add a test that every `db/*.sql` is exactly one of schema or role, and that no schema file contains `GRANT`/`CREATE ROLE`.

### L3 (LOW / info): what the upgrade deliberately does not carry over
- **Bans:** payers banned by the batch-037 relayer (a permanent ban on any mined revert) are no longer refused. Legacy reverted rows get no `payer_fault_at`, so they never feed the B9 cooldown. This matches the owner's 031 B9 decision ("replaces the automatic ban") and is honest, since there was no on-chain attribution check. Record it in the PR notes.
- **Sentinel rows:** legacy rows carry `tx_nonce = -1`, `fence = 0`, `status = 'unknown'`. Nothing reads them today. The carried 031 follow-up "FR-OPS-4 Unknown→reconcile with a nonce floor from `rel_sent.tx_nonce`" must exclude `fence = 0` rows. Otherwise it would treat hundreds of long-mined 037 sends as unresolved.
- **Snapshot-schema DBs:** a database built from the snapshot's own `001_rel_state.sql` (no `reverted` column) cannot be upgraded. 003 statement 7 fails with `42703 column "reverted" does not exist`; verified. That is a loud failure, not a silent one. Drop and recreate any dev or preview DB that ran the snapshot's relayer migrations (the wf_s2 harness already does).

### L4 (info): leftover runtime privileges
`mcplus_relayer` keeps SELECT/INSERT/UPDATE(holder, until_ms) on `rel_lock` and UPDATE(reverted) on `rel_sent` (from 002). `state.ts` uses neither. Keep them while a rollback to 037 is possible (M1). Revoke them in a later forward role file once 037 is retired.
