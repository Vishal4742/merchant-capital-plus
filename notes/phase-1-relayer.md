# Phase 1 — relayer lane (claude-relayer)

## Batch 001-P1-relay-stub (FR-REL-1 stub, FR-REL-6 skeleton)
**Built:** `apps/relayer/` — `POST /relay` submits claude-contracts' `PullStub.pull` (EIP-3009 `receiveWithAuthorization`) with the relayer key; `GET /health` returns the relayer's real WBT balance with the Phase 2 fields `null`. Vercel Web-standard handlers in `api/`, logic in `src/relayer.ts`, a localhost `node:http` adapter in `dev.ts`.

**Run it:** `cd apps/relayer && npm install && npm run dev` → `http://127.0.0.1:8787` (loads `../../.env`; reads only `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`). Checks: `npx tsc --noEmit && npm test`.

**Verified:** tsc 0 · `node --test` 18/18 (4 builder + 14 tester, rounds 1–2) · live relayed pull `0x9f5efc7504e52eb0b4b4bdecfdbf66b896ef3572864f44cb1041f965be5ee000` (block 12,296,944, 91,164 gas, 0.000456 WBT), payer 0 WBT before and after · replay → 422 `TetherToken: auth invalid`, relayer nonce unchanged.

**Decisions**
- Stub runs on 127.0.0.1 only; no public deploy until the Phase 2 drain guard exists.
- Target and function are server constants (stub address + `pull`), so a request can't pick the call. Simulate-before-send from day one.
- No framework: Node 26 type stripping, `node:test`, `node:http`; deps = viem 2.57.13 (+ dev typescript 7.0.2, @types/node 26.6.6).
- Payer signing stays outside `apps/relayer` (scratchpad script for the live run; the frontend's guest wallet in Phase 2), so the relayer ships one key only (NFR-3).

**For Phase 2 (measured here)**
- viem 2.57 sends via `eth_fillTransaction`, and Ankr's reth answers it, so the node picks nonce, gas and fees. Enforce FR-REL-5 caps (≤ 10 gwei, ≤ 400k gas) on the request we sign.
- NFR-4: POST → receipt took 7.86 s from the venue (Ankr RTT 0.65–1.15 s × ~8 sequential RPCs). Ankr supports `eth_sendRawTransactionSync` (EIP-7966), and viem has `sendTransactionSync`: send + receipt in one call.
- Gas: a bare relayed pull is 91–94k; budget ~0.00046 WBT per relay at 5 gwei.
- Vercel: whether the builder resolves `.ts` import specifiers is unverified until the deploy batch.

**Open:** NFR-4 latency; Vercel project for `apps/relayer` (human + frontend, PHASES Phase 1).

## Human decisions at the 001 gate (2026-11-05 22:01)
1. Scoped `apps/relayer/.env` (only `RELAYER_PRIVATE_KEY`) first thing in Phase 2; `dev` script → `node --env-file=.env dev.ts`.
2. No `RELAYER_PRIVATE_KEY` in any Vercel project until the Phase 2 drain guard passes.
3. Only `/relay` sends from the relayer key (scripts/keepers: deployer key or `POST /relay`).
4. Reject payers with code (incl. EIP-7702 delegation); smart wallets self-submit (FR-REL-7).

## Phase 2 drain-guard backlog (from round-3 reviews)
- Gas cap on the signed request: `gas ≤ 400k`, `maxFeePerGas ≤ 10 gwei` (node fills fees via `eth_fillTransaction`).
- `eth_getCode(from)` must be `0x` (ERC-1271 signers can burn ~0.175 WBT/request: USDT forwards all gas to `isValidSignature`).
- `receipt.transactionHash === txHash` before 200 (viem returns a replacement's receipt).
- Send lock over simulate → send → receipt; clients poll a 502's `txHash` instead of re-POSTing.
- FR-REL-4/5: fee + 1 USDT minimum, `validBefore ≤ now + 15 min`, `authorizationState` pre-check, rate limits, daily budget; never relay bare `pull` publicly.
- `isRevert`: require `isHex(revert.raw)`; generic 502 message for node failures; a stable `code` on 422 (expired / replay / insufficient) for the pay page.
- dev.ts: 413 while streaming past 4 KB; Host + JSON content-type checks (CSRF / DNS rebinding); rethrow a fixed message if the key fails to parse.
- NFR-4: `sendTransactionSync` (Ankr supports `eth_sendRawTransactionSync`); receipt-failure path waits ~12.6 s today.
- Deploy batch: verify Vercel resolves `.ts` import specifiers; `engines.node` → `"26.x"`; test for `GET /health?x=1`; Vercel max duration vs 30 s receipt wait.
- Tests: drop the fake node's 7 unused RPC answers and reword 3 stale comments (reviewer-code LOW-1/2).
