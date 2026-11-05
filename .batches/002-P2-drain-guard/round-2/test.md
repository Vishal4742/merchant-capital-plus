VERDICT: CHANGES

# Test: 002-P2-drain-guard, round 2 (tester)

Code under test: HEAD `27c0250` (round-2 fix), clean tree apart from my test additions. The builder's dev server (pid 42836, `node --env-file=.env dev.ts`) started at 00:35:39, after the fix commit (00:35:21) and the last `src/relayer.ts` write (00:35:03), so it runs the committed code. I did not start, stop or restart it, read no `.env`, signed only for fresh random 0-USDT payers, and sent no transaction. Relayer `0xdd02…a651` nonce: 3 (latest and pending) at 00:38:20, 3 after every run, 3 (latest and pending) at 01:00:02. The relayer's WBT balance was 0.498377508835749934 before and after. No UI in this batch, so there are no screenshots.

F2 is fixed: I proved it on the live transport with a real clock. F1 passes the spec's measurement (20 back-to-back warm requests, p95 under 1 ms). It does **not** hold for a client that polls: every cache miss now goes out on a cold TLS connection at about 520 ms, so a 1 s poller sees p95 545 ms and a 5.5 s poller sees p95 558 ms (F5). That is over the 300 ms budget, and that is the reason for CHANGES. Smaller items: F6 (cache race, LOW, `todo` test added) and F7 (no-retry 502 contract and the Ankr 429 limit, LOW, docs).

## Per-criterion evidence

| # | Criterion (spec.md) | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit && npm test` pass; RED first | PASS | `tsc exit 0`; `ℹ tests 35 · pass 34 · fail 0 · todo 1` (the builder's 32 plus my 3; the todo is F6). Builder alone at `27c0250`: `tests 32, pass 32, fail 0, todo 0`. RED commit `e9a9dff` was checked in round 1 and is unchanged. |
| 2a–2n | unit rows of Behaviour 1–6 | PASS | All round-1 tests still pass on `27c0250`, including the 5 round-1 tester tests the builder committed (sent-set keys, in-lock replay, queue time, judging order) and the former `todo` F2 test, which now passes as a normal test (`✔ an authorization that drops under 30 s during the in-lock simulate/nonce step is not signed or sent`). |
| F2 | expiry can't lapse inside the lock; lock held ≤ 2 RPC timeouts | **PASS (fixed)** | Unit: the test above. Live transport: `relayerClient()` (8 s, `retryCount: 0`) against a local fake JSON-RPC server over real HTTP, using a throwaway unfunded key in-process (`scratchpad/r2/lockbound.ts`, output `lockbound.out`): `A hang eth_getTransactionCount: 502 rpc_error in 8.02 s`, `getTransactionCount=1` HTTP request, so no retries (round 1: 4 requests). `B1 slow nonce (7.5 s) + hanging send: 502 rpc_error txHash=0xda3e… in 15.52 s`; `B2 queued behind B1: 200 in 15.47 s`; send #2 went out 8.004 s after send #1, so the lock was held 15.5 s, under 2 × 8 s. `D 36 s left, 7 s nonce read: 422 expired in 7.01 s`, `send=0`, which is the pre-sign re-check on a real clock. `E 40 s left, fast lock step: 200`, so the re-check does not reject healthy requests. The sync send carries `params[1]=4000`. |
| F1 | `GET /health` p95 ≤ 300 ms | PASS by the spec's method / **FAIL when paced (F5)** | Timing tables below |
| 3 | Live valid 1 USDT pull → 200, gas 400k / 10 gwei, payer 0 WBT | PENDING (human gate) | No tx allowed. Payer `0xE53f…309b`: `cast balance` → `0` WBT. **Its USDT is now 0, not 2** (see NEEDS THE USER) |
| 4 | Live, no tx (AT-10 PullStub half) | PASS for every no-tx case / replay PENDING | `scratchpad/r2/probes.out`: `below_minimum (1 unit): 422 …"below_minimum"`; `contract as from (USDT): 422 …"bad_signature"`; `insufficient_funds: 422`; `not_yet_valid`, `expired`, `window_too_long` → 422 with their codes; `bad_request` → 400; `415 text/plain` → 415 `unsupported_media_type`; 5 KB → `413 body too large`; foreign Host → `HTTP/1.1 403 Forbidden`; `/health?x=1` → 200. Nonce 3 → 3. Live `replay` needs a used authorization from a key we hold that is still inside its window, so it waits for the gate. |
| 5 | nonce unchanged across rejects; `cast tx` fields; payer before/after | PARTIAL | 155 rejected `/relay` requests this round (9 probes + 3 × 46 timed + 8 cold), nonce 3 → 3. `cast tx` and payer before/after are PENDING (gate). |
| 6 | NFR-14 timed runs | see tables | `/health` back-to-back PASS 3/3, paced FAIL (F5); local reject PASS 3/3; RPC reject reported only (human 23:27: judged at G2 from the deployed relayer), and it was under 500 ms in 3/3 warm runs this time; payment ≤ 5 s PENDING (gate) |
| 7 | NFR-3 env | PASS (one check by metadata) | `grep … \| sort -u` → `process.env.PORT`, `process.env.RELAYER_PRIVATE_KEY`, `process.env.RPC_URL`; `git check-ignore -v apps/relayer/.env` → `.gitignore:29:.env apps/relayer/.env`; only `.env.example` is tracked. `apps/relayer/.env` is mode 600, 87 bytes, mtime 22:53 (unchanged since round 1, still the size of exactly one `RELAYER_PRIVATE_KEY=0x…64 hex` line). Not read. |
| new | cache never serves one relayer's balance to another | PASS | new test `relayer.test.ts:578`. Mutant with one global cache slot → 4 tests fail, including this one. |
| new | cache cleared by a *failed* send, not by a pre-lock reject | PASS | new test `relayer.test.ts:587` (sync timeout and `receipt_mismatch`). Mutant that clears only on success (no `finally`) → the builder's 32 tests all pass and this test fails, so it is the only guard of the `finally` at `relayer.ts:220-222`. |

AT-10 (PullStub half): PASS for every case checkable without a tx. Live replay is pending (gate). The "unprofitable" half belongs to batch 004.

## NFR-14 timing (client 127.0.0.1 → dev server → Ankr; nearest-rank p95 = the 19th of 20 sorted)

Spec method: 20 back-to-back warm requests after 3 untimed warm-ups (`scratchpad/r2/live2.mjs timing`, raw samples in `r2/timing1-3.out`).

| Run (IST) | `GET /health` p50 / p95 / max | local reject `below_minimum` p50 / p95 | RPC reject `insufficient_funds` (fresh random 0-USDT payer) p50 / p95 / max |
|---|---|---|---|
| 1 (00:40:17) | 0.5 / **0.9** / 0.9 ms | 0.4 / 0.6 ms | 175.7 / 181.2 / 489.6 ms |
| 2 (00:40:43) | 0.2 / **0.5** / 0.5 ms | 0.4 / 0.5 ms | 175.2 / 179.4 / 183.5 ms |
| 3 (00:41:08) | 0.4 / **0.8** / 0.9 ms | 0.4 / 0.7 ms | 187.0 / 190.6 / 192.9 ms |
| Budget | ≤ 300 ms → PASS 3/3 | ≤ 500 ms → PASS 3/3 | ≤ 500 ms → under budget 3/3 here; judged at G2 (human 23:27) |

Every response was the expected one (`200 ok`, `422 below_minimum`, `422 insufficient_funds`). Ankr was calm in this window. Round 1 saw 582–717 ms single-read p95 at other times.

Paced `/health`, a dashboard that polls (`live2.mjs paced`, `r2/paced.out`, 00:41:41–00:44:04):

| Pacing | p50 / p95 / max | raw ms |
|---|---|---|
| 1 request/s | 2.2 / **544.6** / 549.8 ms | 545,2,2,3,2,516,3,3,1,3,497,1,2,1,1,550,1,1,2,3 |
| every 5.5 s (every read a miss) | 525.7 / **557.5** / 806.5 ms | 511,546,556,526,495,519,524,501,557,505,547,524,539,542,527,807,526,542,516,549 |
| Budget ≤ 300 ms p95 | FAIL / FAIL | |

The RPC reject after 6 s idle (`live2.mjs cold`, `r2/cold.out`, 00:58): `569,554,1546,599,541,547,1253,540` ms, all `422 insufficient_funds`. This is the cold-connection cost on `/relay`. It is not a regression (round 1 hid it behind warm-ups), but it is what a first payer sees, and on Vercel it is what G2 will measure.

Root cause, measured directly against Ankr, 4 `eth_getBalance` per gap (`r2/coldconn.mjs`, `r2/coldconn.out`):

| Client | gap 1 s | gap 3 s | gap 5.5 s | gap 10 s |
|---|---|---|---|---|
| Node `fetch` (what viem `http` uses) | 182, 182, 182, 182 | 185, 181, 178, 178 | **531, 608, 526, 511** | **500, 534, 532, 517** |
| `https.Agent({ keepAlive: true })` | 174 reused ×4 | 173 reused ×4 | 169–174 reused ×4 | 172–177 reused ×4 |

Node's fetch drops an idle upstream socket after about 4 s (the undici keep-alive default), while Ankr keeps it open for at least 10 s. A 5 s TTL means the upstream read happens at most once every 5 s, so every cache miss pays a new TCP+TLS handshake (about 520 ms against about 175 ms warm). Any caller slower than back-to-back gets at least 1 miss in 20, so its p95 is a cold miss.

## DONE
- `apps/relayer/test/relayer.test.ts:570-620`: 3 tests added (tester lane, no product code touched). Each one was checked against a mutant in a scratch copy (`scratchpad/r2/mut`):
  - :578 the cache is keyed per relayer. Mutant with one global slot → `✖ the health cache is per relayer…` (+3 builder tests).
  - :587 a failed send clears the cache and a local reject does not. Mutant that clears only after a successful send → `✖ a failed send … also clears the health cache` and nothing else.
  - :606 F6, marked `todo` so the suite stays green. Without the flag it fails on HEAD (`actual: '0.5', expected: '0.4995'`, "served the pre-send balance after the send"). With a 3-line send counter (below) it passes: `ℹ pass 35 · fail 0`.
- F2 confirmed fixed on the real `http` transport (lockbound probe above). Live probes and 3 timed runs plus paced and cold runs against the builder's server. No transaction; nonce 3 → 3.

## OPEN
- **F5 (HIGH, NFR-14, owner claude-relayer) the 5 s `/health` cache only meets ≤ 300 ms p95 for back-to-back bursts.** `relayer.ts:84-92` (`wbtBalance`) reads Ankr on the request path at every miss, and with `BALANCE_TTL_MS = 5_000` (`relayer.ts:14`) above Node fetch's ~4 s idle-socket timeout, each miss is a cold TLS handshake: p95 545 ms at 1 req/s and 558 ms at one request per 5.5 s. For a 1 s poller this is worse than round 1, where 1 s gaps kept the socket warm. Fix options, smallest first. (a) Refresh ahead, inside the approved 5 s bound: while the process is up, refresh the balance every ~3 s in the background (`setInterval(...).unref()`, started on the first `/health`). `/health` then always answers from memory with a balance ≤ ~3 s old, and the socket never idles past 4 s. This only helps a long-lived process. (b) A keep-alive agent with an idle timeout longer than the TTL for the RPC transport. This needs `undici` (a new dependency, §11) or a `fetchFn` over `node:https`. (c) A human decision: accept the spec's back-to-back method as the NFR-14 measure, or allow stale-while-revalidate (a served balance may be older than 5 s). On Vercel every cold instance starts with a cold socket whatever the code does, so like the RPC rejects, the deployed `/health` number belongs to G2.
- **F6 (LOW, owner claude-relayer) a `/health` read in flight across a send re-caches the pre-send balance for 5 s.** `relayer.ts:89-90` stores the result after the `await`, after the send's `finally` (`relayer.ts:221`) has already cleared the entry, so "refreshed after each send" fails for that interleaving. Test `relayer.test.ts:606` (`todo`). Fix verified in a scratch copy: `let sends = 0;` → `const gen = sends;` before the read, `if (gen === sends) balances.set(…)`, and `sends += 1` next to the `balances.delete` in `send`.
- **F7 (LOW, owner claude-relayer for spec text, claude-frontend for the code → UI map) `retryCount: 0` turns every transient RPC error into a user-visible `502 rpc_error`, and the spec doesn't say what the client does then.** With retries off, Ankr's per-IP limit shows up directly: in `r2/blip3.out` (my own load of ~28 calls/s, 00:45–00:46) 98 of 150 five-call pre-check rounds failed with `code=-32090 status=429 "Too many requests, reason: call rate limit exhausted, retry in 10s"`. At normal load: `r2/blip2.out` 0 of 100, and all 69 RPC-round requests through the dev server answered correctly. No retries inside the lock is right (F2), and viem's 150/300/600 ms backoff would not outlast a 10 s window anyway. What's missing is the contract: a 502 **without** `txHash` is safe to re-POST with the same body. I verified that on the live transport: `C1 one HTTP 503 on eth_gasPrice: 502 rpc_error` (1 request, no retry), then `C2 re-POST of the same body: 200`. That rule is only in a code comment (`relayer.ts:10-11`) and the commit message. Spec Behaviour 3/4 covers only the 502 *with* `txHash` (poll, never re-POST). Add one line to Behaviour 5 and the frontend mapping. Optionally map an upstream 429 to `503 rate_limited`, like `gas_price_cap`'s "retry later". Note: the builder's server shares this machine's IP, so my 00:45:10–00:46:13 run could have rate-limited it for a few seconds. No one was using it then (nonce unchanged).
- Info: the TTL uses `Date.now()` (`relayer.ts:88`), so a backward clock step keeps an entry "fresh" for longer (until the next send). `performance.now()` is monotonic, if anyone cares.
- Info: the RPC reject after idle is 540–600 ms (1.25–1.55 s outliers) because of the same cold-socket effect. It existed in round 1 too. For the G2 measurement from the deployed relayer.

## NEEDS THE USER
- **F5 decision:** the human's 5 s cache (23:27) passes NFR-14 only for back-to-back requests. Either the builder adds a refresh-ahead (option a, no new dependency), or you decide that the back-to-back method (or stale-while-revalidate) is the NFR-14 measure for `/health`. A keep-alive agent (option b) is a new dependency.
- **The live-check payer has 0 USDT.** `0xE53f…309b` was funded 2 USDT at block 12303144 (`0x9459…89bb`). Since then: out 2 USDT to contract `0x83b5…73b7` (`0xae155c49…cfb1a`, block 12303977, sent by the team wallet `0xb4E7…714D`, selector `0x96d2584e`), in 1 USDT from the team wallet (`0xbd91e67e…f939`, block 12303983), and out 1 USDT to the team wallet via `transferWithAuthorization` (`0x7fa9fded…ecf0`, block 12307460, sent by the team wallet). All of these came from the team wallet, probably another lane's tests, and none from the relayer (nonce 3). The gate's live pull needs ≥ 1 USDT on this payer again (one team-wallet tx), or another payer.
- **Pending at the human gate (unchanged from round 1):** the live valid 1 USDT pull (200, `cast tx` → `0x61a80` / `0x2540be400` / `0xf4240`, payer 0 WBT before and after), the ≤ 5 s payment timing, a live `replay` (re-POST the gate's body) and its timing, and whether Ankr's reth accepts the `eth_sendRawTransactionSync` timeout `4000`.
- Always-flag (§11): this batch sets relayer limits (gas 400k, 10 gwei, 15 min window, 30 s margin, 1 USDT minimum, now also the 5 s `/health` staleness and no RPC retries) and uses the key file `apps/relayer/.env`. These were human-approved (22:53, 23:27). I am re-listing them as the rules require.

Raw outputs and scripts: `/private/tmp/claude-501/-Users-vg890-ethglobal-relayer/8148ef7e-ac03-4282-84ed-0cbdc7d30d0f/scratchpad/r2/` (`live2.mjs`, `probes.out`, `timing1.out`–`timing3.out`, `paced.out`, `cold.out`, `coldconn.mjs`/`.out`, `lockbound.ts`/`.out`, `blip.mjs`, `blip.out`–`blip3.out`, `mut/`).
