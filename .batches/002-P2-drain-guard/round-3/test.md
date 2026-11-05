VERDICT: PASS

# Test: 002-P2-drain-guard, round 3 (tester, last round)

Code under test: HEAD `568978b` on branch `relayer`. The tree is clean apart from the untracked batch folder and notes, and I did not add or edit any repo file other than this one. The builder's dev server (pid 5224, `node --env-file=.env dev.ts`) started at 01:18:11. The last write to `src/relayer.ts` was at 01:17:30 and the commit at 01:19:11, with no change since, so the server runs the committed round-3 code. I did not start, stop or restart it, I read no `.env`, I signed only for fresh random 0-USDT payers and for throwaway in-process keys against local fake nodes, and I sent no transaction. Relayer `0xdd02…a651` nonce: 3 (latest and pending) at 01:21:07, and 3 (latest and pending) at 01:34:56, after 152 rejected `/relay` requests. Its WBT balance was 0.498377508835749934 at both times. There is no UI in this batch, so there are no screenshots and no Lighthouse run.

Fast mode (PIPELINE §3a) applies: only HIGH or CRITICAL findings block. Round 3 has none. F1, F2, F5, F6 and F7 are fixed. Nothing the round-3 changes touch broke: the timer, the send race, test isolation and the failing-refresh path are each covered by a probe below. The items left for later are test-coverage gaps (FOLLOW-UP) and the live checks that wait for the human gate.

## Per-criterion evidence

| # | Criterion (spec.md) | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit && npm test` pass; RED first | PASS | `tsc exit 0`; `ℹ tests 36 · pass 36 · fail 0 · todo 0`, `duration_ms 896`, the process exits in 1.07 s (`real 1.07`). RED commit `e9a9dff` was checked in round 1 and has not changed. |
| 2a | each local pre-check → 422 + code, zero RPC | PASS | `✔ local pre-checks reject with 422 + code before any RPC call` (`relayer.test.ts:184`), `✔ a contract as from fails locally as bad_signature…` (:206), `✔ accepts boundary values…` (:214) |
| 2b | each RPC pre-check (incl. `would_revert`, `payer_has_code` with `0xef0100…`) → 422/503 after one round, no nonce read, no send | PASS | `✔ RPC pre-checks reject in one round…` (:231, includes the EIP-7702 designator `0xef0100…`), `✔ RPC pre-checks are judged in spec order…` (:553) |
| 2c | simulations carry gas 0x61a80 + maxFee 10 gwei | PASS | `✔ every simulation carries the same gas limit and fees the relayer signs with` (:249) |
| 2d | valid → 200, signed fields, `eth_sendRawTransactionSync` only | PASS | `✔ a valid pull is signed with capped gas and fees, sent once…` (:261), `✔ ignores a client-supplied target or calldata…` (:291) |
| 2e | same authorization twice at once → one send | PASS | `✔ the same authorization sent twice at once is broadcast once…` (:305), `✔ a copy queued behind a send that times out is a replay inside the lock…` (:499) |
| 2f | re-POST after a sync timeout → `replay`, no second send | PASS | :314, and `✔ the sent set keys on (from, nonce)…` (:481) |
| 2g | two different valid → nonces n, n+1, second simulation after the first send | PASS | :327 |
| 2h | a throwing send releases the lock | PASS | :338 |
| 2i | `receipt_mismatch` / `reverted` / sync timeout → 502 + our txHash | PASS | :349 |
| 2j | -32603 with non-hex data → 502, no "revert" | PASS | :366, :406 |
| 2k | USDT domain → on-chain `DOMAIN_SEPARATOR` | PASS | :133 |
| 2l | `api/relay.ts` text/plain → 415 before key/RPC | PASS | `dev.test.ts:9` |
| 2m | `dev.ts`: JSON not 415, 5 KB → 413 and keeps answering, foreign Host → 403, `/health?x=1` routed | PASS | `dev.test.ts:41,48,55,60,65` |
| 2n | unparsable 64-hex key → fixed message | PASS | `relayer.test.ts:643` |
| 3 | Live valid 1 USDT pull → 200, gas 400k / 10 gwei, payer 0 WBT | PENDING (human gate) | No tx allowed. Payer `0xE53f…309b`: `cast balance` → `0` WBT; `balanceOf` → `0` USDT (still drained, see NEEDS THE USER) |
| 4 | Live, no tx (AT-10 PullStub half) | PASS for every no-tx case; live replay PENDING | `b2r3/probes.out` (01:22:29): `below_minimum (1 unit): 422 …"below_minimum"`; `contract as from (USDT): 422 …"bad_signature"`; `insufficient_funds: 422`; `not_yet_valid`, `expired (10 s left)`, `window_too_long (16 min)` → 422 with those codes; `bad_request` → 400; `415 text/plain` → 415 `unsupported_media_type`; `413 5 KB` → `413 body too large`; foreign Host → `HTTP/1.1 403 Forbidden`; `health?x=1` → 200 `{"relayer":"0xdd02…a651","wbt":"0.498377508835749934",…,"paused":false}`. `payer_has_code` is unit-only, as the spec says (row 2b). A live replay needs a used authorization that is still inside its window, so it waits for the gate. |
| 5 | nonce unchanged; `cast tx` fields; payer before/after | PARTIAL: nonce PASS, rest PENDING | `cast nonce` (latest/pending) 3/3 at 01:21:07 and 3/3 at 01:34:56, after 152 rejected `/relay` requests (9 probes + 3 × 46 timed + 5 idle). `cast tx` and payer before/after wait for the gate. |
| 6 | NFR-14 timed runs | `/health` PASS (back-to-back and paced); local reject PASS; RPC reject reported only; replay, `would_revert` and payment PENDING | Tables below |
| 7 | NFR-3 env | PASS (one check by metadata) | `grep … \| sort -u` → `process.env.PORT`, `process.env.RELAYER_PRIVATE_KEY`, `process.env.RPC_URL`; `git check-ignore -v apps/relayer/.env` → `.gitignore:29:.env apps/relayer/.env`; `git ls-files apps/relayer \| grep -i env` → nothing tracked. `apps/relayer/.env` is `-rw------- 87 bytes mtime 22:53`, unchanged since round 1: the size of one `RELAYER_PRIVATE_KEY=0x…64 hex` line. Not read. |

AT-10 (PullStub half): PASS for every case that can be checked without a tx. Live replay is pending (gate). The "unprofitable" half belongs to batch 004.

## Round-2 findings

| ID | Result | Evidence |
|---|---|---|
| F1 `/health` p95 ≤ 300 ms (back-to-back) | PASS | p95 0.4 / 0.4 / 0.4 ms (table below) |
| F2 expiry can't lapse inside the lock; lock held ≤ 2 RPC timeouts | PASS (still fixed) | Unit `relayer.test.ts:539`. I re-ran the round-2 live-transport probe on the round-3 code (`r2/lockbound.ts` → `b2r3/lockbound-r3.out`): `A hang eth_getTransactionCount: 502 rpc_error in 8.02 s`, `getTransactionCount=1` (no retry); `B1 … 502 rpc_error txHash=0xdb74… in 15.51 s`, `B2 queued behind B1: 200 … in 15.46 s`, `send #2 at 8.002 s after send #1`, `params[1]=4000`; `C1 one HTTP 503: 502 rpc_error`, `C2 re-POST of the same body: 200`; `D 36 s left, 7 s nonce read: 422 expired in 7.00 s`, `send=0`; `E 40 s left: 200`. |
| F5 paced `/health` p95 > 300 ms | PASS (fixed) | Paced 1 req/s: p95 2.9 / 1.7 / 1.2 ms (round 2: 544.6). One request per 5.5 s: max 28.8 ms and 13.8 ms (round 2: p95 557.5). `relayer.ts:100-105` `startBalanceRefresh`, started at `relayer.ts:76`. |
| F6 a read across a send re-caches the old balance | PASS (fixed) | `relayer.ts:89,94,96,234` (`sendCount`). Test `relayer.test.ts:608` is a normal test now and passes. Mutant M1 (drop the `sendCount === sendsBefore` guard) → `✖ a health read in flight across a send does not re-cache the pre-send balance`, and only that test fails. Live transport, with a refresh read held across a real `relay()` (probe R2 below) → `/health after send: 200 wbt=0.9995 (want 0.9995)`. |
| F7 a 502 without txHash is undocumented | PASS (fixed) | `spec.md:34` (Behaviour 4): "**A 502 without `txHash` means nothing was sent** … so re-POSTing the same body is safe". Proven on the live transport (F2 row, C1/C2). |

## What round 3 could have broken (checked)

All probes use the real `relayerClient()` (http, 8 s timeout, `retryCount: 0`, 3 s refresh) against a local fake JSON-RPC node over real HTTP, with a throwaway random key set in-process (never printed, unfunded). Scripts and outputs are in `scratchpad/b2r3/`.

| Concern | Result | Evidence |
|---|---|---|
| The refresh timer keeps a process alive | PASS | `exit-parent.ts` spawns a child that calls `relayerClient()` plus one `/health` and then has nothing left to do: `child (relayer) exited code=0 after 0.23 s`. Mutant M2 (no `timer.unref()`): `STILL ALIVE after 10 s (M2-nounref): killing`, so the probe tells the two apart. `npm test` exits in 1.07 s. |
| Refresh cadence; `/health` never waits on the node | PASS | `refresh.out` R1: the first `/health` is a live miss (321 ms against a node that answers in 300 ms), then `eth_getBalance hits after 9.5 s: 4` (the miss plus refreshes at about 3, 6 and 9 s), and the next two `/health` answer in `0.5 ms, 0.3 ms` with no new hit. Mutant M5 (refresh not started): hits 1, then `/health 304.8 ms, 303.3 ms`. |
| The refresh races a send | PASS | R2: a refresh read is held at the node holding the pre-send balance (1 WBT), a real `relay()` → `200`, the node's balance drops to 0.9995, the stale read is then released, and `/health` → `200 wbt=0.9995`. Code reasoning: `sendCount` only moves in the send's `finally`, so a read that started before or during the sync send and answers after it is never cached, and one that answers before the `finally` is deleted by it. |
| The refresh runs for test clients | PASS | `startBalanceRefresh` is called only from `relayerClient()` (`relayer.ts:76`, grep across `apps/relayer`). Tests build clients with `makeClient`. The one test that calls `relayerClient()` (`:643`) throws before a client exists. The refresh test (`:626`) starts its own timer and stops it. Each fake node uses its own random relayer key, so cache entries never collide (`:580`). The timing-based test `:626` (20 ms interval, needs ≥ 3 reads in 75 ms) passed 30/30 runs, 6 at a time, under 4 busy-loop CPU hogs. |
| A failing refresh (429) | PASS | R3: the node answers HTTP 429 to every `eth_getBalance`. `/health right away 200 0.9995` (cache), then after 6.5 s of failing refreshes `502 rpc_error` (the 5 s TTL still applies, so a stale balance is never served past 5 s), `unhandled=0`, and after recovery `/health 200 in 0.4 ms`. Mutant M3 (no `.catch`): `unhandled=6` in the same run. In the dev server, which has no handler, each of those would crash the process (Node's default `--unhandled-rejections=throw`). |
| A hanging node | PASS (bounded) | R4: 20 s of a node that never answers `eth_getBalance` → `max concurrent getBalance = 3` (3 s tick, 8 s timeout), `unhandled=0`. |
| The send lock and F2 | PASS | The lock code is unchanged in this diff; see the lockbound re-run above. |

Mutation summary (`b2r3/mutants.out`, unit suite only):

| Mutant | Suite result |
|---|---|
| M1 no `sendCount` guard | 1 fail (`:608`) |
| M2 no `unref()` | 36 pass, caught only by the exit probe |
| M3 no `.catch` on the refresh | 36 pass, caught only by probe R3 |
| M4 refresh reads through the cache (`fresh` dropped) | 1 fail (`:626`) |
| M5 `relayerClient()` doesn't start the refresh | 36 pass, caught only by probe R1 |
| M6 `sendCount` bumped at signing instead of in `finally` | 36 pass (see FOLLOW-UP) |

## NFR-14 timing (client 127.0.0.1 → dev server → Ankr; nearest-rank p95 = the 19th of 20 sorted)

20 warm requests per run after 3 untimed warm-ups (`b2r3/live3.mjs timing`, raw samples in `b2r3/timing1-3.out`). `/health` and the local reject ran back-to-back. The RPC reject was paced at 1 request per second, which is 5 Ankr calls/s, to stay well under the per-IP limit (round 2 hit 429 at about 28 calls/s).

| Run (IST) | `GET /health` p50 / p95 / max | local reject `below_minimum` p50 / p95 / max | RPC reject `insufficient_funds` (fresh random 0-USDT payer, 1 req/s) p50 / p95 / max |
|---|---|---|---|
| 1 (01:22:35) | 0.3 / **0.4** / 0.5 ms | 0.4 / **0.5** / 0.7 ms | 364.2 / 365.9 / 373.4 ms |
| 2 (01:23:08) | 0.3 / **0.4** / 0.4 ms | 0.3 / **0.5** / 0.8 ms | 361.7 / 365.5 / 398.9 ms |
| 3 (01:23:42) | 0.3 / **0.4** / 0.4 ms | 0.3 / **0.6** / 0.6 ms | 363.8 / 364.9 / 365.0 ms |
| Budget | ≤ 300 ms → PASS 3/3 | ≤ 500 ms → PASS 3/3 | ≤ 500 ms → under budget 3/3; judged at G2 from the deployed relayer (human 23:27) |

Every response was the expected one (`200 ok`, `422 below_minimum`, `422 insufficient_funds`). There were no 429s.

Paced `/health`, as seen by a dashboard that polls (`live3.mjs paced` / `gaps`):

| Pacing | Run 1 | Run 2 | Run 3 | Budget |
|---|---|---|---|---|
| 1 request/s ×20, p50 / p95 / max | 1.8 / **2.9** / 14.4 ms | 0.8 / **1.7** / 14.4 ms | 0.8 / **1.2** / 14.7 ms | ≤ 300 ms → PASS |
| one request per 5.5 s ×6 | 28.8, 1.5, 1.7, 2.6, 3.0, 2.7 ms | 13.8, 1.5, 1.1, 1.2, 1.5, 1.3 ms | | ≤ 300 ms → PASS (round 2: 495–807 ms) |

The 14 ms first sample of each run is the new client process opening its connection to the dev server.

RPC reject after 6 s idle (`live3.mjs cold`): `381, 366, 365, 362, 358` ms, all `422 insufficient_funds`. Round 2 measured 540–600 ms with 1.25–1.55 s outliers. The refresh keeps one Ankr socket warm, and that helps `/relay` too.

The RPC reject is about 365 ms at 1 req/s against 175–190 ms back-to-back in round 2. This comes from the network or Ankr, not from the relayer. Direct to Ankr, with no relayer in between, 5 parallel `eth_getBalance` (`b2r3/par.mjs`, `par.out`) take `176–186` ms with a 250 ms gap and `335–337` ms with a 1 s gap, consistently over 2 × 10 rounds. Report only; G2 measures it from the deployed relayer.

## DONE
- `cd apps/relayer && npx tsc --noEmit && npm test` → tsc 0, 36/36 pass, todo 0.
- Live no-tx probes, 3 timed runs, 3 paced runs, 2 gap runs and 5 idle rejects against the builder's server. No tx. Nonce 3 → 3.
- Round-3 risk probes on the real transport: process exit, cadence, the race with a send, 429 refreshes, a hanging node. Six mutants were run against the suite and the probes. Results above.
- No test was added: I found no product defect. The gaps under FOLLOW-UP guard code that is correct today.

## OPEN
None blocking.

## FOLLOW-UP (MEDIUM/LOW, owner claude-relayer, next batch; fast mode §3a.1)
- **LOW, test gap:** three round-3 guards have no unit test, and the suite stays green without them. `timer.unref()` (`relayer.ts:103`, mutant M2: the process never exits). The refresh `.catch` (`relayer.ts:102`, mutant M3: the first failing refresh after a 429 or a hang throws an unhandled rejection, which kills the dev server). `startBalanceRefresh` in `relayerClient()` (`relayer.ts:76`, mutant M5: `/health` silently goes back to live reads). The smallest guard: one test that calls `startBalanceRefresh` on a fake node whose `eth_getBalance` throws, and asserts no `unhandledRejection` over 2 ticks. The other two need a spawned process, like `exit-parent.ts`.
- **LOW, test gap:** no test covers a balance read that *starts during* the sync send. The current code is right because `sendCount` moves in `finally` (`relayer.ts:234`). Mutant M6, which bumps it at signing instead, passes the suite but would cache a pre-mined balance read during the send wait.
- **LOW, docs:** `spec.md:33` still says only "`/health` serves a WBT balance at most 5 s old, cleared by every send (human 23:27)". It doesn't record the 3 s background refresh (human 01:14), which is in `build-relayer.md` only.
- **LOW:** the refresh swallows its errors with no log (`relayer.ts:102`). `/health` still reports the failure as a 502 once the 5 s TTL lapses, so nothing is hidden for long.
- Info: on Vercel, `api/relay.ts` also calls `relayerClient()`, so `/relay` instances run a refresh whose cache nothing reads. It is harmless and keeps that instance's Ankr socket warm. A long-running dev server polls Ankr about 28,800 times a day (one call every 3 s).
- Info: with a hanging node, refresh ticks overlap up to 3 at a time (8 s timeout over a 3 s tick), so the count is bounded. `/health` misses have no single-flight, which predates this round.
- Info: Ankr sits behind a load balancer, so a read just after a send can hit a node one block behind and cache the pre-send balance until the next refresh (≤ 3 s). That stays inside the human's 5 s rule.

## NEEDS THE USER
- **Live gate (unchanged):** the live valid 1 USDT pull (200; `cast tx` → `0x61a80` / `0x2540be400` / `0xf4240`; payer 0 WBT before and after), the ≤ 5 s payment timing, a live `replay` (re-POST the gate's body) and its timing, a `would_revert` timing, and whether Ankr's reth accepts the `eth_sendRawTransactionSync` timeout `4000`.
- **Payer:** `0xE53f…309b` still holds 0 USDT and 0 WBT (`cast` at 01:34:56). The builder proposes a fresh in-memory payer funded with exactly 1 USDT from the team wallet and pulled back in full through the stub. That is a team-wallet tx and needs your OK.
- **Always-flag (§11):** relayer limits set by this batch: gas 400k, 10 gwei, 15 min window, 30 s margin, 1 USDT minimum, `/health` balance at most 5 s old with a 3 s background refresh (new this round, human 01:14), and no RPC retries. The key file is `apps/relayer/.env`. All were approved by the human (22:53, 23:27, 01:14). I list them because the rules require it.

Raw outputs and scripts: `/private/tmp/claude-501/-Users-vg890-ethglobal-relayer/8148ef7e-ac03-4282-84ed-0cbdc7d30d0f/scratchpad/b2r3/` (`live3.mjs`, `probes.out`, `timing1.out`–`timing3.out`, `paced.out`, `paced2.out`, `paced3.out`, `gaps.out`, `gaps2.out`, `cold.out`, `par.mjs`/`par.out`, `refresh.ts`/`refresh.out`/`refresh-M3.out`/`refresh-M5.out`, `exit-parent.ts`/`exit-child.ts`/`exit.out`, `lockbound-r3.out`, `mutants.out`, `mut/`, `flake-*.out`).
