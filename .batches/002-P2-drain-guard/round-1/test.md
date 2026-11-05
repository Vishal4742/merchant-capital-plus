VERDICT: CHANGES

# Test: 002-P2-drain-guard, round 1 (tester)

Code under test is HEAD `6eac3b3`, a clean tree. The dev server (pid 58748, `node --env-file=.env dev.ts`) started at 23:04:58, after the GREEN commit (23:03:39). The source mtimes are 23:02:58–59 and have not changed since, so the server runs the committed code. I did not read either `.env`, did not start or stop the server, and sent no transaction. Relayer nonce: 3 at the start, 3 after the probes, 3 after each timed run, and 3 at the end (23:16:15).

There are two reasons for CHANGES. (1) NFR-14 is over budget: `GET /health` p95 is above 300 ms in 3 of 3 runs, and the RPC-round reject p95 is above 500 ms in 2 of 3 runs. The relayer itself adds under 1 ms; the time is Ankr's tail latency, measured directly below. (2) A real gap in the lock: the 30 s margin can run out inside the lock, after the re-check (F2).

No UI in this batch, so there are no screenshots (`round-1/shots/` is not used).

## Per-criterion evidence

| # | Criterion (spec.md) | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit && npm test` pass; RED committed first | PASS | `tsc exit 0`; `ℹ tests 31 · pass 30 · fail 0 · todo 1` (26 builder tests + 5 tester tests; the todo is F2). RED checked: `git archive e9a9dff apps/relayer` run alone → `ℹ tests 7 · pass 2 · fail 5` (`test/relayer.test.ts` fails to import, plus 4 dev tests), so the test commit came before the code. |
| 2a | each local pre-check → 422 + code, zero RPC | PASS | test `local pre-checks reject with 422 + code before any RPC call` (9 cases, `node.calls` = `[]`) |
| 2b | each RPC pre-check incl. `would_revert` → 422/503 after one round, no nonce, no send | PASS | test `RPC pre-checks reject in one round…`: sorted calls = exactly the 5 pre-check calls. Added: `RPC pre-checks are judged in spec order…` (relayer.test.ts:533; kills a mutant that swaps the replay and code checks) |
| 2c | every simulation `eth_call` carries gas 0x61a80, maxFee 10 gwei | PASS | test `every simulation carries the same gas limit and fees…` (2 simulations, both checked) |
| 2d | valid → 200, raw tx fields, sync send only | PASS | test `a valid pull is signed with capped gas and fees…`: gas 400000, maxFee 1e10, tip 1e6, nonce 7 (from the node), chain 1874, `to` = stub, exact args; no fill / estimate / plain send / receipt poll |
| 2e | two concurrent same-auth → one send, other 422 | PASS | builder test (other copy fails re-simulation). Added `a copy queued behind a send that times out is a replay inside the lock…` (:477): the first send stays pending, so simulation passes, and only the in-lock sent-set check (relayer.ts:181) stops the copy. Mutant without line 181: the 26 builder tests all pass and this test fails. |
| 2f | after a sync timeout, re-POST → 422 `replay`, no second send | PASS | builder test. Added `the sent set keys on (from, nonce)…` (:459): an upper-case nonce, a lower-case `from` and a malleated high-s signature all get `replay` with 1 send. Mutant with a case-sensitive nonce key: the builder tests pass and this test fails. |
| 2g | two different concurrent valid → nonces n, n+1, 2nd simulation after 1st send | PASS | builder test `two different payments at once…` |
| 2h | a throwing send releases the lock | PASS | builder test `failures inside the lock release it…` (the lock is module-global; a fresh node for the next request) |
| 2i | receipt_mismatch / reverted / rpc_error → 502 + our txHash | PASS | builder test `send outcomes…` (4 cases) |
| 2j | -32603 non-hex data → 502 `rpc_error`, no "revert" | PASS | builder test + the over-HTTP variant |
| 2k | exported domain = on-chain DOMAIN_SEPARATOR | PASS | unit test, and on-chain: `cast call 0xcedf…55a7 'DOMAIN_SEPARATOR()(bytes32)'` → `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25` |
| 2l | `api/relay.ts` text/plain → 415 before key/RPC | PASS | dev.test.ts (3 media types). Live: `415 {"error":"content-type must be application/json","code":"unsupported_media_type"}` |
| 2m | dev.ts: JSON not 415, 5 KB → 413 and still answering, foreign Host → 403, `/health?x=1` routed | PASS | dev.test.ts 5/5. Live: `413 body too large`; `403 foreign Host: HTTP/1.1 403 Forbidden`; `health?x=1: 200 {"relayer":"0xdd02…a651",…}` |
| 2n | unparsable key → fixed message without the key | PASS | builder test |
| — | queue time counts: re-check `validBefore ≥ now+30 s` inside the lock | PASS as written in spec / gap F2 | Added `queue time counts…` (:486): a request that drops under 30 s while queued gets `422 expired`, no nonce read, 1 send. Mutant without relayer.ts:180: the builder tests pass and this test fails. Gap: the check comes before the slow in-lock step (F2). |
| 3 | Live: valid 1 USDT pull → 200, explorer gas 400k / 10 gwei, payer 0 WBT | PENDING (human gate) | no tx allowed this round. Payer `0xE53f…309b` WBT now: `cast balance` → `0` |
| 4 | Live, no tx (AT-10 PullStub half) | PARTIAL PASS / replay PENDING | `below_minimum (1 unit): 422 {"error":"value must be at least 1 USDT","code":"below_minimum"}`; `contract as from (USDT): 422 {…"code":"bad_signature"}`; also `not_yet_valid`, `expired`, `window_too_long` → 422 with their codes, `bad_request` → 400, and a fresh 0-USDT payer → `422 insufficient_funds`. Nonce 3 → 3. Live `replay` needs a used authorization still inside its window, which only exists after the gate's live pull. `payer_has_code` is unit-test only (spec). |
| 5 | Live `cast tx` fields; payer balance before/after; nonce unchanged across rejects | PARTIAL | nonce unchanged across 147 rejected `/relay` requests (9 probes + 3 runs × 46) (3 → 3); `cast tx` + payer before/after → PENDING (gate) |
| 6 | NFR-14 timed runs | **FAIL** | see the table: `/health` p95 372 / 403 / 426 ms (budget 300); RPC reject p95 721 / 1649 / 349 ms (budget 500); local reject p95 0.6–0.7 ms PASS; `replay` reject and the ≤ 5 s payment PENDING (gate) |
| 7 | NFR-3 env | PASS (one check by metadata) | `grep … | sort -u` → `process.env.PORT`, `process.env.RELAYER_PRIVATE_KEY`, `process.env.RPC_URL`; `git check-ignore -v apps/relayer/.env` → `.gitignore:29:.env apps/relayer/.env`; no env file tracked; `npm run dev` = `node --env-file=.env dev.ts` and the live process shows that command line and the relayer address in `/health`. I did not run `cut -d= -f1 .env` (no reading `.env` this round): the file is mode 600 and 87 bytes, which is exactly `RELAYER_PRIVATE_KEY=` + `0x` + 64 hex + newline, i.e. one variable. |

AT-10 (PullStub half): PASS for every case checkable without a tx (above). Live replay is pending. The "unprofitable" half belongs to batch 004.

## NFR-14 timing (20 warm requests each after 3 untimed warm-ups; client 127.0.0.1 → dev server → Ankr; nearest-rank p95 = the 19th of 20 sorted)

| Run (IST) | `GET /health` p50 / p95 / max | local reject `below_minimum` p50 / p95 | RPC reject `insufficient_funds` p50 / p95 / max |
|---|---|---|---|
| 1 (23:08:50) | 175.9 / **372.3** / 697.2 ms | 0.5 / 0.6 ms | 342.9 / **720.7** / 729.5 ms |
| 2 (23:10:28) | 182.3 / **402.7** / 514.2 ms | 0.4 / 0.7 ms | 354.6 / **1648.5** / 2257.4 ms |
| 3 (23:12:58) | 177.1 / **425.7** / 738.0 ms | 0.4 / 0.7 ms | 342.1 / 349.4 / 351.1 ms |
| Budget | ≤ 300 ms p95 → FAIL 3/3 | ≤ 500 ms → PASS 3/3 | ≤ 500 ms → FAIL 2/3 |

Every response was the expected one (`200 ok`, `422 below_minimum`, `422 insufficient_funds`). The RPC reject used a fresh random payer per request (0 USDT), validly signed for 1 000 000. It returns only after the whole parallel round, including the gas-capped simulation (`Promise.all`, relayer.ts:164), so it also stands in for `would_revert`. Raw samples are in `/private/tmp/claude-501/-Users-vg890-ethglobal-relayer/8148ef7e-ac03-4282-84ed-0cbdc7d30d0f/scratchpad/timing.out`, `…/timing2.out` and `…/timing3.out`.

Root cause, measured straight from this machine with viem `http` and no relayer (read-only, `…/scratchpad/ankr.mjs`). A slow request in each row hit all five parallel calls at once, so these are stalls across the provider, not independent per-request tails:

| Baseline (IST) | single `getBalance` p50 / p95 | the 5-call pre-check round p50 / p95 |
|---|---|---|
| Ankr 23:09 | 177 / 717 ms | 184 / 1346 ms |
| Ankr 23:10:45 | 185 / 582 ms | 360 / 705 ms (the `simulate` eth_call alone was ~358 ms p50) |
| Ankr 23:13:12 | 176 / 183 ms (max 1691) | 182 / 507 ms |
| official `rpc.testnet.whitechain.io` 23:11:04 | 190 / 675 ms | 349 / 870 ms |
| race Ankr vs official 23:12:39 | Ankr 175 / 178, official 313 / 928, first-reply 175 / 178 | — |

The relayer's p50 matches the direct p50, and the local reject costs 0.5 ms, so the relayer adds almost nothing. The budget misses are Ankr stalls of 2–10× RTT that happen 1–3 times per 20 requests.

## DONE
- `apps/relayer/test/relayer.test.ts:449-550`: 5 tests added (tester lane, no product code touched), each checked against a mutant in a scratch copy. In each case the mutant passes all 26 builder tests and fails the new test:
  - :459 sent-set key normalisation (re-cased nonce or `from`, malleated high-s sig) → mutant `sentKey` keeps nonce case: `✖ the sent set keys on (from, nonce)…`
  - :477 in-lock sent-set check behind a pending send → mutant without relayer.ts:181: `✖ a copy queued behind a send that times out…`
  - :486 in-lock expiry re-check (queue time) → mutant without relayer.ts:180: `✖ queue time counts…`
  - :533 pre-check judging order → mutant with code judged before replay: `✖ RPC pre-checks are judged in spec order…`
  - :517 F2 below, marked `todo` so the suite stays green. Without the flag it fails on current code (`actual [200, undefined]`, expected `[422, 'expired']`). With a one-line re-check before signing it passes (`ℹ pass 31 · fail 0`, scratch copy).
- Live HTTP probes and three timed runs against the builder's server, with a direct RPC baseline (tables above). No transaction; nonce 3 → 3.

## OPEN
- **F1 (HIGH, NFR-14, owner claude-relayer) `GET /health` p95 is over 300 ms in every run.** `relayer.ts:228-238` / `api/health.ts:4` make one live Ankr `eth_getBalance` per call, so any Ankr stall breaks the p95. Proposed fix: serve the WBT balance from an in-process cache refreshed at most every few seconds (stale-while-revalidate; the shape stays the same). `/health` then answers from memory in ~1 ms. Re-time 20 requests in round 2.
- **F2 (MEDIUM, FR-REL-3/5 drain guard, owner claude-relayer) the 30 s margin can run out inside the lock.** `relayer.ts:69` builds the live transport with only `timeout: 8000`, so viem's default `retryCount: 3` applies, and a `TimeoutError` is retried. Measured with a never-answering server and a 300 ms timeout: `getTransactionCount: 4 HTTP requests, 2267 ms … TimeoutError`; `eth_call: 4 HTTP requests, 2268 ms` (`…/scratchpad/retry.mjs`). With 8 s that is ~33 s for `simulate ‖ getTransactionCount` (relayer.ts:184-187), and it happens after the only in-lock expiry check (relayer.ts:180). An authorization with 30–45 s left can therefore be signed and sent after its margin is gone, and on a slow node it can expire before mining: a reverted tx and burned gas. The comment at relayer.ts:10 and spec Behaviour 4 ("the 8 s timeout bounds how long the lock is held") are also wrong for the same reason. Fix (one line, test :517 turns green): repeat the `MIN_REMAINING_S` check just before `encodeFunctionData` (relayer.ts:193), then drop the `todo` flag. Also consider `retryCount: 0` on the live transport, so the 8 s lock bound becomes true.
- **F3 (LOW, owner claude-frontend, by design) a definite send failure keeps the authorization in the sent set.** relayer.ts:196 records it before the send, so `-32000 nonce too low` returns `502 rpc_error` + a `txHash` that will never land, and any re-POST is `replay`. The UI must poll that hash with a timeout and then ask for a new signature (new nonce), not retry the same body. This goes in the `code` → UI mapping sent to claude-frontend.
- **F4 (LOW, owner claude-frontend) `validAfter` boundary.** relayer.ts:145 accepts `validAfter == now`, but the EIP-3009 reference requires `block.timestamp > validAfter`. That case fails the simulation as `422 would_revert` (no gas, safe). The guest wallet should sign `validAfter = 0`, as the tests do.
- Info: viem recovers high-s signatures (test :459 gets `replay`, not `bad_signature`). This is harmless: the sent set and `authorizationState` key on `(from, nonce)`, and the simulation decides whether the token accepts the signature.
- Info: build-relayer.md says the RED commit had "5 of 7 dev tests fail". It was 4 dev tests plus the relayer test file (5 of 7 total). This is only wording.

## NEEDS THE USER
- **NFR-14 RPC-reject budget vs the public RPC.** Every `would_revert` / `insufficient_funds` / `replay` reject needs at least one Ankr round trip. Ankr's own single-request p95 measured 582–717 ms in 2 of 3 windows (and the official RPC was slower), so no code change in the relayer can promise ≤ 500 ms p95 through it. Options: (a) restate the budget for RPC-dependent rejects, e.g. ≤ 500 ms p50 / ≤ 1 s p95, or relayer-added latency only; (b) hedge each read to a second RPC (only the official one is known, and it was slower here); (c) a dedicated or paid RPC endpoint. A budget is the human's decision (PIPELINE §11).
- **F1 cache:** `/health` would show a WBT balance up to N s old (propose 5 s). It is a dashboard field, but it is a relayer limit/budget surface (§11).
- **Pending at the human gate:** the live valid 1 USDT pull (200, `cast tx` → `0x61a80` / `0x2540be400` / `0xf4240`, payer 0 WBT before/after); the payment ≤ 5 s timing; a live `replay` (re-POST the gate's body) and its timing; whether Ankr accepts the `eth_sendRawTransactionSync` timeout of 4000 (ms per EIP-7966).
- Always-flag (§11): this batch sets relayer limits (gas 400k, 10 gwei, 15 min window, the new 30 s margin, 1 USDT minimum) and uses the key file `apps/relayer/.env`. These were human-approved at 22:53 per batch.md; I am re-listing them as the rules require.
