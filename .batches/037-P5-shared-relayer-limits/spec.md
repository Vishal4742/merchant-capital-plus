# Spec: 037-P5-shared-relayer-limits (phase mode, Money: yes)

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-10:** the send lock, the daily gas budget (0.1 WBT/UTC day) and the per-payer (10/h) and per-merchant (200/h) limits hold across every relayer instance, through shared Postgres state, not per process. This replaces the `ponytail:` notes at relayer.ts:141 and :189.
- The behaviour of FR-REL-1..9 and AT-10 doesn't change: the same reject codes, in the same order, and nothing is sent on a reject.
- Two new tables live in the gateway's Neon database (the same Neon project, aws-us-east-1):
  - `rel_sent`: one row per send attempt. The row is written **before** the broadcast, with the worst-case fee (400k gas × 6 gwei). After the receipt it's updated to the real fee and the reverted flag. The primary key `auth_key` is `payer:nonce`, so a second copy of the same authorization can never be broadcast twice by any instance.
  - `rel_lock`: one lease row per relayer address (holder id, expiry in ms).
- **Lock.** A request takes the lease with one atomic upsert. The upsert succeeds only when the lease is free or expired; the lease lasts 60 s, above the worst-case hold of about 44 s. While another instance holds it, the request polls every 100 ms. Once the request is older than the 20 s age gate it gets `503 busy`, and nothing is sent.
  - **Fencing.** The lease is renewed and the `rel_sent` row is written in a single statement, right before the broadcast. If the lease was lost (expired and taken), the result is 503 busy, with no broadcast. If the row already exists, the result is 422 replay.
  - The lease is released in a `finally`. A crashed instance frees it once the 60 s run out.
  - The in-process FIFO (`serialized`) stays in front, so one instance never polls with more than one request.
- **Counters.** One SELECT, run both before the RPC round and again inside the lock, returns:
  - today's spend;
  - reverts in the last hour (breaker: 3 → 503 `breaker_open`);
  - whether this payer ever caused a revert (422 `payer_banned`);
  - sends by this payer and by this merchant in the last hour (429 `rate_limited`);
  - whether this authorization was already sent (422 `replay`).
- **Database down or not configured:** `503 storage_error` ("the relayer database is unavailable; nothing was sent, so retry"), never a send. The web already shows a 503 as "Nothing was charged; try again". `/health` reports today's spend from the same table and returns 502 `storage_error` if the database can't be read.
- **Driver.** `@neondatabase/serverless` 1.2.0 HTTP, the same exact version and pattern as `apps/web/lib/server/db.ts`. Tests and the local dev server use PGlite 0.5.11 (a devDependency, the same version as the web), so the SQL under test is the SQL that ships.
- **Least privilege.** In production the relayer connects as its own Postgres role, `mcplus_relayer`, which has SELECT/INSERT/UPDATE on `rel_sent` and `rel_lock` only: it can't read any `app_gw_*` table and can't run DDL.
  - The owner applies `apps/relayer/db/001_rel.sql` once. The role's password is generated and piped into the relayer project's Production env (Sensitive) without ever being printed.

## Why a lease row and not `pg_advisory_lock`
A session advisory lock needs one connection held across simulate → sign → send → receipt, which the Neon HTTP driver doesn't have. Holding a TCP `pg` transaction open for up to 44 s on Vercel needs a new driver plus pool tuning (the 03:09 plan review: lock_timeout, idle_in_transaction_session_timeout, connectionTimeoutMillis), and it can't be tested on PGlite. The lease row is still a shared Postgres lock: it's one atomic upsert, it gets a fencing check before every broadcast, it expires after a crash, and it can be tested in CI with two relayer instances (two module instances) sharing one PGlite.

## Acceptance criteria (each must be checkable)
- [ ] Tests first (RED commit), in test/shared-limits.test.ts, on PGlite with two relayer module instances (`relayer.ts?b`) sharing one database:
  - the same signed payment POSTed to both instances at once → exactly one broadcast, and the other gets 422 replay;
  - two different payments on two instances → both sent with distinct relayer nonces (the lease serialises them);
  - rows written by "another instance" count here: budget → 503 budget_exhausted, 10 payer sends → 429, a reverted row → 422 payer_banned, 3 reverts → 503 breaker_open, and none of these makes an RPC call;
  - a live lease held by another holder → 503 busy after the age gate, with nothing sent; an expired lease is taken over and the payment is sent;
  - a lease stolen during the presend round → no broadcast, 503 busy;
  - database down → 503 storage_error, nothing sent; /health → 502 storage_error;
  - /health gasSpentToday/budgetLeft include rows from other instances;
  - after a send, the row holds the receipt's real fee and the lease is free.
- [ ] All 62 existing relayer tests pass unchanged, now on the PGlite store.
- [ ] `npm test` and `npm run typecheck` in apps/relayer pass; ci.md written.
- [ ] Deploy (after the human gate):
  - role and tables created, and DATABASE_URL set on merchant-capital-relayer (Production, Sensitive), with nothing printed;
  - redeploy; /health 200 with budgetLeft from the database;
  - one live 1.00 USDT sale relayed (NFR-4 time posted) and its `rel_sent` row checked.

## Files to touch (owner lane: only these)
- apps/relayer/src/relayer.ts, apps/relayer/src/store.ts (new), apps/relayer/db/001_rel.sql (new), apps/relayer/dev.ts
- apps/relayer/test/shared-limits.test.ts (new), apps/relayer/test/relayer.test.ts (PGlite setup only), apps/relayer/test/dev.test.ts (if dev start needs it)
- apps/relayer/package.json, apps/relayer/package-lock.json

## Ponytail ladder
- Needed at all? Yes: on Vercel's fluid compute several instances can each send with their own budget and their own nonce view (drain review R3, security 002 P2).
- Already in the repo? The web's `db.ts` Neon/PGlite pattern and its versions are reused. Only `query()` is needed (the data-modifying CTEs make every write a single statement), so there's no `transaction()`.
- Stdlib/platform: Postgres `ON CONFLICT … WHERE` for the lease, and a CTE for the fencing write.
- Minimum code: the in-process ledger maps and the sent set are **deleted**, and the store is the only implementation.

## Out of scope
- Re-checking holder caps inside the lock (M2 from batch 026): a later batch.
- Reconciling rows left "pending" by a crashed instance: the worst-case fee stays counted, which is the safe side.
- The operator pause switch: the contract's pause is already surfaced.
