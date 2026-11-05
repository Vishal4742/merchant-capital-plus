STATUS: READY

# Build: 002-P2-drain-guard (claude-relayer)

## DONE
- `apps/relayer/src/relayer.ts` — request flow: `parsePull` (400) → `localChecks` (422 `not_yet_valid` / `expired` / `window_too_long` / `below_minimum` / `bad_signature`, plus the in-process sent set → `replay`; no RPC) → `rpcChecks`, one parallel round (`authorizationState`, `getCode`, `balanceOf`, `eth_gasPrice`, gas-capped `simulateContract`) → `serialized(send)`: re-check the 30 s margin and the sent set, `simulate ‖ getTransactionCount('pending')`, sign locally with `FEES` (gas 400k, maxFee 10 gwei, tip 0.001 gwei) and chain 1874, `txHash = keccak256(signed)`, add to the sent set, `sendRawTransactionSync` (4 s), require `receipt.transactionHash == txHash` and success. Error bodies `{error, code, txHash?}`. `isRevert` needs hex revert data for -32603. `relayerClient` rethrows a fixed message on an unparsable key; http timeout 8 s.
- `api/relay.ts` — 415 `unsupported_media_type` unless the media type is `application/json` (parameters allowed), checked before the key is touched.
- `dev.ts` — 403 for a foreign `Host`; 413 while streaming past 4,096 bytes; forwards `content-type`; routes on the path.
- `package.json` — `dev` = `node --env-file=.env dev.ts`; `apps/relayer/.env` (git-ignored, mode 600) holds only `RELAYER_PRIVATE_KEY` (human decision 2, 22:53).
- Tests: `test/relayer.test.ts` rewritten around a stateful fake node (authorizations become used once sent, nonce advances, optional send delay, every `eth_call` labelled by function, simulation request objects recorded); `test/dev.test.ts` new (415 handler test; spawned dev server with only `PORT`: JSON POST not 415, 413, 403, `?query` routing, malformed target). All batch-001 test intents kept; reviewer-code LOW-1/2 (unused fake answers, stale comments) done by the rewrite.
- Commits: `e9a9dff` test (RED: `relayer.test.ts` fails to import; 5 of 7 dev tests fail) → `6eac3b3` feat (GREEN).

## Verified (command output)
- `npx tsc --noEmit` → exit 0. `npm test` → `tests 26, pass 26, fail 0`, 0.64 s (was 13.6 s: no receipt-retry path any more).
- Mutation check (scratch copies, each mutant must fail its guard's test):
  - no lock → 2 fail (duplicate broadcast once; nonces n, n+1 in order)
  - simulation without `FEES` → 1 fail (simulations carry gas/fees)
  - no sent set → 1 fail (re-POST after timeout)
  - no receipt-hash check → 1 fail (send outcomes)
  - no code check → 1 fail (RPC pre-checks)
- `grep -rhoE 'process\.env\.[A-Z_]+' apps/relayer --include='*.ts' --exclude-dir=node_modules | sort -u` → `PORT`, `RELAYER_PRIVATE_KEY`, `RPC_URL`. `cut -d= -f1 apps/relayer/.env` → `RELAYER_PRIVATE_KEY`. `git check-ignore apps/relayer/.env` → ignored.
- Design probes (read-only, venue → Ankr, warm): single read p50 176 / p95 181 ms; `getTransactionCount('pending')` 365 ms; 4-read JSON-RPC batch ≈ 370 ms, no gain (and batching would put a sync send in the same HTTP request as a `/health` read) → plain parallel requests.
- viem source: `prepareTransactionRequest` skips `eth_fillTransaction` when chainId, nonce, both fee fields and gas are set; `sendRawTransactionSync` sends `[raw, timeout]` with retryCount 0; `simulateContract` passes gas and fees into `eth_call`.
- Live setup (human approved 22:53): team → G1 payer 2 USDT, tx `0x945980052736f4c25613bb0118ea164d6f502326dc6a345534736e9c757089bb` (60,911 gas); payer 2 USDT / 0 WBT.

## OPEN (for the tester / human gate)
- Live valid pull + NFR-14 timings need the dev server with the scoped key: rejections (`below_minimum`, `replay`, `would_revert`) send nothing and can be timed by the tester; the one valid pull (relayer tx) runs at the human gate.
- `eth_sendRawTransactionSync` timeout units: EIP-7966 says milliseconds; confirm on the live run that a 4,000 timeout is accepted by Ankr's reth.
- Human-enforced control (not code): PullStub is never relayed publicly; no `RELAYER_PRIVATE_KEY` in Vercel (001 gate decision). Batch 004 moves the target to MerchantPay.
- In-process lock and sent set: one process only (`ponytail:` → batch 003 advisory lock + `rel_sent`).

## Round 2 (addresses round-1/test.md CHANGES)
- **F2** (`src/relayer.ts` `send`): `tooLate(p)` is re-checked right before signing (and still at lock entry); live transport `retryCount: 0`, so the lock is held for at most two 8 s RPC timeouts. The tester's `todo` test is now a normal test and passes.
- **F1** (`wbtBalance`): `/health` serves the WBT balance for up to 5 s per relayer address (human 23:27); every send clears it. New test: two reads → one `eth_getBalance`; after a send → fresh; after 5 s → fresh.
- **NFR-14 RPC-backed rejects** (human 23:27): budget stays 500 ms, measured at G2 from the deployed relayer (venue → Ankr p95 alone was 582–717 ms in some windows).
- Frontend notes F3/F4 forwarded on agentbus (502 without a landing tx → poll with a timeout, then re-sign; sign `validAfter = 0`).
- `npx tsc --noEmit` → 0 · `npm test` → `tests 32, pass 32, fail 0, todo 0`. Commit `27c0250`.

## Round 3 (addresses round-2/test.md CHANGES; last round allowed)
- **F5** (human 01:14): `startBalanceRefresh(client, 3000)` re-reads the WBT balance every 3 s from `relayerClient()` (timer `unref`'d; tests drive it with `makeClient`). Live, paced 1 req/s ×12: `/health` p50 2.4 / p95 3.5 ms; 5.5 s gaps ×4: max 189 ms (warm socket even on a miss).
- **F6**: `sendCount` — a balance read that overlaps a send is returned but not cached. The tester's `todo` test is now normal; a mutant without the guard fails it.
- **F7**: spec Behaviour 4 now says a 502 without `txHash` means nothing was sent and a re-POST is safe.
- `npx tsc --noEmit` → 0 · `npm test` → `tests 36, pass 36, fail 0, todo 0`.
- Gate note: the G1 payer `0xE53f…309b` now holds 0 USDT (another lane's txs moved it). Proposal for the live pull: a fresh in-memory payer funded with exactly 1 USDT from the team wallet, pulled back in full through the stub, key discarded (no `.env` change, no clash with other lanes' use of the G1 payer).
