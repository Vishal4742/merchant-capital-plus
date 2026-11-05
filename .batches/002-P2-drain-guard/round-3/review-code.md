VERDICT: PASS

# Code review: 002-P2-drain-guard, round 3 (reviewer-code)

Diff: `git diff e9a9dff~1 HEAD -- apps/relayer` (e9a9dff test RED, 6eac3b3 feat, 27c0250 fix, 568978b fix) at HEAD `568978b`. I read every changed file in full, plus `PullStub.sol`, `packages/shared/merchantPay.ts`, ARCHITECTURE §2/§3/§7, SRS FR-REL-1..6, NFR-3/4/14, AT-10, the batch-001 relay-stub reviews and the drain review (`~/ethglobal/research/relayer-drain-review-2026-11-06.md`). Fast mode (PIPELINE §3a) applies, so only HIGH or CRITICAL findings block. I found none. This is the batch's first code review: rounds 1 and 2 stopped at tester CHANGES, so there is no earlier `review-code.md` to check against. I sent no transaction, read no `.env` and left the :8787 server alone.

## Blocking (HIGH / CRITICAL)
None.

## DONE (file:line, what, how verified)
- **Build and tests:** `npx tsc --noEmit` → exit 0. `npm test` → `tests 36 · pass 36 · fail 0 · todo 0`, 926 ms (my run). GitHub CI is green on `568978b` (run 42097524581, Linux, which includes the 413 test).
- **Behaviour 1 (body):** `api/relay.ts:9-12` answers 415 before `relayerClient()` is touched. It allows parameters and is case-insensitive. `dev.ts:16` returns 403 for a foreign Host, `:21-25` returns a streaming 413 past 4,096 bytes, `:29` forwards `content-type`, and `:17` routes on the path only. Tests: `dev.test.ts:9,41,48,55,60,65`.
- **Behaviour 2 (local):** `relayer.ts:171-184` runs the checks in spec order: `not_yet_valid` → `expired` → `window_too_long` → `below_minimum` → `bad_signature`, with `to` = the target and the USDT domain. The sent-set `replay` check also runs here (`:183`), after the signature check. That's the same code as spec step 3, just cheaper (no RPC). Tests: `relayer.test.ts:184,206,214`.
- **Behaviour 3 (RPC):** `:191-204` makes one `Promise.all` of 5 calls and judges them in spec order: `replay`, `payer_has_code` (handles `undefined` or `0x`, so the `0xef0100…` designator counts as code), `insufficient_funds`, `gas_price_cap` 503, then `would_revert` or 502. The http transport has no `batch` option (`:74`; viem `http.js:24-26`, so no JSON-RPC batching). Tests: `:231,:553`.
- **Behaviour 4 (lock and send):** `:111-115` is a FIFO chain whose queue promise never rejects. `:207-237` covers every spec bullet: it re-checks the 30 s margin and the sent set at lock entry, runs simulate ‖ the pending nonce, re-checks the margin before signing, signs locally with chainId 1874, the nonce and `FEES`, computes `txHash = keccak256(signed)` before the send, adds the authorization to the sent set before the send, makes one sync send, and checks the receipt hash and status. The viem source confirms `sendRawTransactionSync` sends `[raw, 4000]` with `retryCount: 0`, and `simulateContract` defaults `account` to `client.account`, so the simulation runs as the relayer. Tests: `:261,:305,:314,:327,:338,:349,:499,:508,:539`.
- **Behaviour 5 and 6:** `:128-138` treats a -32603 with non-hex data as a node failure. `:68-73` throws a fixed key message. Tests: `:366,:406,:643`.
- **ABI conformance:** `PULL_STUB_ABI` (`:47-49`) matches `PullStub.pull(...)` argument for argument. `authorizationState` matches `IUSDT3009`. `AUTH_TYPES` matches `packages/shared` `receiveWithAuthorizationTypes`. `:133` pins the domain to the on-chain `DOMAIN_SEPARATOR`. MerchantPay (ARCHITECTURE §2) is not called yet; that is batch 004 by spec.
- **Batch-001 carry-overs closed:**
  - S2: gas-capped simulation and signing.
  - S3: the receipt-hash check at `:228`.
  - S5: the lock and the sent set.
  - S6: the streaming body cap.
  - S7: the Host check and the 415.
  - S8: the scoped `.env` (`package.json:9`).
  - S9: the fixed key message (`:72`).
  - Reviewer-code LOW-1: the fake node throws on any method it doesn't expect (`relayer.test.ts:70`).
  - Reviewer-code LOW-2: the stale comments are gone.
- **No regressions vs batch 001:** the `relay()` and `health()` signatures, the 200 body `{txHash, blockNumber}` and the `/health` shape are unchanged. Error bodies gain `code`, which only adds a field. `makeClient` now takes a `LocalAccount`, and every importer is inside `apps/relayer`.
- **Scope:** the four lane commits touch only `apps/relayer`. Every change traces to FR-REL-2/3/4/5/6, AT-10, NFR-3/4/14, §3 points 1–6 and 11, or a human decision (22:53, 23:27, 01:14). Nothing from batch 003 or 004 was built.
- **NFR-3:** the grep finds only `process.env.PORT`, `process.env.RELAYER_PRIVATE_KEY` and `process.env.RPC_URL`. `apps/relayer/.env` is git-ignored and untracked; I didn't read it.
- **Ponytail:** no product code to delete beyond FOLLOW-UP F2. `/health` has four mechanisms for one number (TTL, clear on send, `sendCount`, the 3 s refresh). Each one maps to a human decision or tester finding (23:27, F6, 01:14), and batch 003 rewrites `/health` anyway.

## FOLLOW-UP (MEDIUM / LOW, non-blocking; owner claude-relayer unless noted)
- **F1 MEDIUM, tracking:** the drain-review fixes are in no relayer plan.
  - **What:** `notes/phase-2-relayer.md:28-32` ("Carried into batch 003") doesn't list the drain review's R1/R2 revert breaker (ban the payer after one reverted send; 503 after 3 reverts an hour), the R4 per-payer queue slot and queue cap, the R5 cap (see NEEDS THE USER) or the R6 single-flight `/health` miss.
  - **Why:** R1 is HIGH once the URL is public. A 7702 delegation or a `cancelAuthorization` placed after the in-lock simulation (`relayer.ts:213`) burns up to 400k gas, and nothing in this batch can see that gap. It is LOW today, because `dev.ts:38` binds 127.0.0.1 and there is no key in Vercel.
  - **Fix:** add all four to the batch 003/004 spec, with the breaker in `send()`'s `reverted` branch (`:229`), before any public URL.
- **F2 LOW, Ponytail rung 2:** `relayer.ts:26,34-41` duplicates `packages/shared/merchantPay.ts:8,14,18-35` (`addresses.usdt`, `MIN_PAYMENT`, `usdtDomain`, `receiveWithAuthorizationTypes`), which landed at 23:10.
  - **Fix:** in batch 004, import those and delete the local copies. Keep the `DOMAIN_SEPARATOR` test (`relayer.test.ts:133`) pointed at the import. While there, drop the unused exports: `USDT` has no importer (the test redefines it at `relayer.test.ts:16`), and `parsePull` has none either. The spec deferred shared imports to batch 004, so this is not scope drift now.
- **F3 LOW, repeated calls:** `relayer.ts:214` reads the pending nonce from a load-balanced RPC right after the previous receipt.
  - **What:** a backend one block behind returns `n`, and the node rejects the transaction with "nonce too low".
  - **Why:** the next payer gets a 502 with a `txHash` and must sign again. No gas is lost, and the receipt check stops a false success.
  - **Fix:** run two back-to-back valid pulls at the gate. If it happens, point `RPC_URL` at one backend (the drain review suggests `rpc.testnet.whitechain.io`) rather than adding a local nonce counter, which would gap on a dropped transaction.
- **F4 LOW, concurs with the tester:** the refresh `.catch(() => undefined)` at `relayer.ts:102` swallows errors with no log, and `unref()` (`:103`) and the wiring in `relayerClient()` (`:76`) have no unit test.
  - **Fix:** write one stderr line per failing refresh (the message only), and add the tester's suggested `unhandledRejection` test.
- **F5 LOW, docs:** `spec.md:33` doesn't mention the 3 s refresh (human 01:14), and `spec.md:62` doesn't list `test/dev.test.ts` (acceptance criterion `:53` requires it, so it traces).
  - **Fix:** correct both in the next spec. Owner: claude-relayer, with the doc text sent to claude-research.

## OPEN
- Live checks wait for the human gate: the valid pull, `cast tx` fields, payer WBT before and after, live `replay` and `would_revert` timings, and whether Ankr accepts the `4000` sync timeout. These are the same items the tester listed.

## NEEDS THE USER
1. **The gas cap: the docs disagree (PIPELINE §2, pick one before the live gate tx).**
   - **The conflict:** the code signs with `maxFeePerGas` 10 gwei (`relayer.ts:22`), as the spec says (`spec.md:6,32,57`; the acceptance criterion checks `0x2540be400`). But ARCHITECTURE.md:101 point (5) now says **`maxFeePerGas ≤ 6 gwei` (human 00:45)**. That arrived in commit `2cb9919` and was merged into this branch at 01:16. ARCHITECTURE ranks above the spec.
   - **Why it doesn't block:** on the PullStub path there is no fee to break even against, and the price actually paid is the base fee (5 gwei floor) plus 0.001 gwei. 6 vs 10 gwei only matters while the base fee is between 6 and 10 gwei.
   - **Option (a), 6 gwei now:** change `relayer.ts:22` to `6_000_000_000n`. The `gas_price_cap` check follows automatically. In the tests, change `relayer.test.ts:255` to `'0x165a0bc00'`, `:276` to `6_000_000_000n`, and `:237`/`:555` to `6_000_000_001n`. In the spec, update `spec.md:6,32,43,44,57`.
   - **Option (b), keep 10 gwei for the stub:** keep 10 gwei on the stub path, and have claude-research mark ARCHITECTURE §3(5) "from batch 004 (MerchantPay fee path)", which is where the drain review placed R5.
   - Raise this on agentbus; I don't post.
2. **Process:** round 3 goes past fast mode's two-round cap (§3a.2). The human's 01:14 decision let it run. Please confirm at the gate.
3. **Always-flag (§11):** relayer limits (400k gas, 10 gwei, 15 min window, 30 s margin, 1 USDT minimum, no RPC retries, `/health` balance ≤ 5 s old with a 3 s refresh) and the key file `apps/relayer/.env`. All were human-approved at 22:53, 23:27 and 01:14; they are listed because the rules require it.
