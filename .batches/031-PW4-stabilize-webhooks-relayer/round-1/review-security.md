VERDICT: PASS
# Batch 031 · round 1 · reviewer-security (phase mode §3b, Money: yes)

Method (no claude-research/agentbus/outside-model tooling here; see notes/whiteflow-status.md): independent reviewer subagents, three lenses per part, every finding sent to a separate skeptic told to refute it. Plus a read-only peer cross-review of Part A by whiteflow-b7. Reviewers were read-only on the repo; probes ran in temp dirs outside it.

## Part A — web webhook outbox (whiteflow-ef)
Lenses: concurrency/correctness, security, test adequacy. Reviewers ran gw-outbox, gw-events, gw-webhooks, gw-dispatch, gw-tester-webhooks, gw-sdk-compat, refund-sync, docs-endpoints, docs-limits, announce-paid (all 0 failures).
Confirmed correct: the CTE (`queued` reads `fresh` RETURNING; racing instances → loser's ON CONFLICT DO NOTHING waits then skips; statement atomic under Neon autocommit; concurrent webhook delete → FK failure rolls back the key too), md5-derived ids, claimLease under READ COMMITTED, fence uniqueness, `FOR UPDATE SKIP LOCKED` recheck, no-downgrade rule, pre-051 rows, retry schedule unchanged, tenant isolation on replay (404 before 409), parameterized SQL, logs carry error names only.

| # | Sev | Finding | Status |
|---|---|---|---|
| A-R1 | MEDIUM (test) | Crash test matched the new read-only pre-check first, so atomicity/A6 were never exercised | Fixed round 1; proven a real guard (fails with pre-031 `sendOnce`, passes with fix) |
| A-R2 | LOW | Deploy order: migration 051 must precede the web deploy | Fixed (rollout note in build-web.md) |
| A-P-M1 | MEDIUM (peer) | DNS lookup without deadline → attempt can outlive the 60 s lease → concurrent duplicate POST | Fixed round 2 (3 s DNS deadline, dispatch ≤ 10 concurrent / ≤ 30 claims) |
| A-P-L1 | LOW (peer) | `Promise.all` in dispatch aborts the batch on one DB error | Fixed round 2 |
| A-P-L2 | LOW (peer) | Stalled inline first attempt could re-send a delivered event | Fixed round 2 (claim requires pending + attempts 0) |
| A-P-T1 | test | A2 didn't deterministically hit the ON CONFLICT path | Added round 2 |
| A-P-I1 | info | Events lost to the pre-031 bug are not auto-repaired | Rollout note + optional one-off script |
Rejected after verification: weak lease-release test (hardened anyway), missing A8 test (added anyway).

## Part B — relayer state across instances (whiteflow-b7)
Lenses: fencing/concurrency, drain/fail-closed security, test genuineness. **No critical/high/medium.**
Evidence beyond the unit suite: the fencing reviewer raced `takeLease` with 40 concurrent psql sessions on a temporary real Postgres 18 cluster (expired-row and first-insert cases, 5 rounds each): exactly one winner per round, fences 1,2,3,4,5 (none skipped or repeated); `writeAhead` with 20 concurrent writes of one key → 1 written, 19 replay; stale fence → lost_lease. Confirmed: every signing path fails closed before broadcast (pre-check read, lease, in-lease read, fenced write-ahead); no 503/429 after a broadcast (post-broadcast replies are 200 or 502 with txHash, which the web maps to "don't pay again"); budget/limits/ban/breaker re-read inside the lease; replay key `<payer>:<EIP-3009 nonce>` is global and persisted before `eth_sendRawTransaction`; SQL parameterized; logs carry SQLSTATE or error name only; AT-10 / FR-REL-2/3/5 order unchanged; `RELAYER_PRIVATE_KEY` handling untouched.

| # | Sev | Finding | Status |
|---|---|---|---|
| B-R1 | LOW | `db/migrate.ts` can print the full `DATABASE_URL` (password) on a malformed URL (NeonDbError message) | Round 2 (whiteflow-b7) |
| B-R2 | LOW (test) | Mutation removing `AND until > now()` from the fenced write-ahead survives the suite | Round 2 |
| B-R3 | LOW | A failed `settle()` after a mined revert leaves it out of ban/breaker | Round 2 (bounded retry) |
Residual risks recorded, not defects: a write-ahead that straddles a takeover needs a holder > 90 s into its lease (bounded paths make this ≈ unreachable; worst case two txs with one nonce, one rejected); after an `unknown` outcome or a lagging RPC node the next pending-nonce read can collide → 502 "don't pay again", no gas (pre-existing; FR-OPS-4); a committed-but-unanswered `takeLease` or a holder killed at maxDuration blocks sends ≤ 90 s (503 busy, availability only).

## FOLLOW-UP (next batches / human)
- Dedicated Neon role for the relayer limited to `rel_lease`/`rel_sent` (reviewer hardening note) instead of reusing the web's `DATABASE_URL`.
- FR-OPS-4 Unknown → reconcile, nonce floor from `rel_sent.tx_nonce`; FR-OPS-6 full transactional outbox; re-measure NFR-4/NFR-14 on the deployed relayer (5 extra Neon round trips per `/relay`).
- Secret grep over the batch's files: no private keys, tokens or connection strings (see round-2/ci.md).
