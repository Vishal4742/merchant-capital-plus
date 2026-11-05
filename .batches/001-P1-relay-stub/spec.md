# Spec: 001-P1-relay-stub

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-1 (stub)**: the relayer submits a payer's signed `receiveWithAuthorization` pull (through claude-contracts' G1 `PullStub`) with the relayer key and returns the transaction hash.
- **FR-REL-6 (skeleton only)**: `GET /health` returns the shape from ARCHITECTURE.md §3 with the relayer's real WBT balance; fields that need Phase 2 storage are `null`.
- **CON-4**: the payer only signs a message; the relayer pays the gas. **CON-7 / NFR-3**: the relayer reads only `RELAYER_PRIVATE_KEY` (and `RPC_URL`), never prints it, never ships it anywhere else.
- **FR-REL-3 (early, one line)**: `simulateContract` runs before every send, so the stub never sends a tx that would revert. This is the standard viem pattern and costs nothing; the full drain guard is Phase 2.
- Gate **G1** (relayer half, optional to the gate): a second relayed pull submitted through `POST /relay`, payer holding 0 WBT. claude-contracts' forge script remains the primary G1 proof (agreed on agentbus).

## Interface (Phase 1 only; Phase 2 replaces `pull` with the ARCHITECTURE §3 actions)
- `POST /relay` body: `{"action":"pull","args":{"from":"0x…","value":"1000000","validAfter":"0","validBefore":"<unix s>","nonce":"0x<32 bytes>"},"sig":"0x<65 bytes>"}`. Integers are decimal strings (uint256 doesn't fit a JSON number).
  - 200 `{"txHash":"0x…","blockNumber":"…"}` once the receipt says success.
  - 400 `{"error":"…"}` bad JSON, body over 4 KB, unknown action, bad address/integer/nonce/signature; the chain isn't touched.
  - 422 `{"error":"…"}` simulation reverted (bad signature, replay, insufficient USDT); nothing is sent.
  - 502 `{"error":"…","txHash"?}` RPC failure, or the tx was mined and reverted.
- `GET /health` → `{"relayer":"0xdd02…","wbt":"0.4993","gasSpentToday":null,"budgetLeft":null,"usdtFeesUnswapped":null,"paused":false}`.
- Target is fixed: the stub address constant + the single `pull` function. The client can't choose the target or the calldata.
- ABI assumed (**confirm with claude-contracts before the live run**): `pull(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`.

## Acceptance criteria (each must be checkable)
- [ ] `cd apps/relayer && npx tsc --noEmit` passes (strict).
- [ ] `cd apps/relayer && npm test` (`node --test`) passes, tests written first (RED commit not required for a stub; tests land in the same commit):
  - [ ] invalid bodies (bad JSON, oversize, wrong action, bad `from`, negative or non-integer `value`, `value` 0, short `nonce`, short `sig`) → 400, and no RPC call at all;
  - [ ] simulation revert → 422, and `eth_sendRawTransaction` is never called;
  - [ ] valid body → 200 `{txHash}`; the raw signed tx goes to the stub address, and its decoded calldata is `pull` with exactly the request's args and the split signature;
  - [ ] `/health` returns the shape above, with `wbt` formatted from `eth_getBalance`.
- [ ] Live (needs `PullStub` deployed and the human's OK): the payer `0xE53f…309b` (0 WBT) signs `ReceiveWithAuthorization(to = PullStub, value = 1 USDT)` off-chain with `cast wallet sign --data` in the scratchpad (outside `apps/relayer`); `curl -X POST 127.0.0.1:8787/relay` returns a `txHash`; the explorer shows `from = 0xdd02…a651`, `to = PullStub`; `cast balance` shows the payer at 0 WBT before and after.
- [ ] Live: `curl 127.0.0.1:8787/health` shows the relayer's real WBT balance (≤ 0.5).
- [ ] Live (AT-10 preview, not the gate): posting the same signed authorization again returns 422, and the relayer's nonce (`cast nonce`) doesn't change.
- [ ] `grep -rn 'process.env' apps/relayer --include=*.ts` (excluding node_modules) shows only `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT` (NFR-3). No key or `.env` value appears in any command output, log or batch file.

## Files to touch (owner lane: claude-relayer only)
- `apps/relayer/package.json`, `apps/relayer/package-lock.json`, `apps/relayer/tsconfig.json`
- `apps/relayer/src/relayer.ts` (parse, simulate, send, health; ~100 lines)
- `apps/relayer/api/relay.ts`, `apps/relayer/api/health.ts` (Vercel Web-standard handlers, ~3 lines each)
- `apps/relayer/dev.ts` (local `node:http` server on 127.0.0.1 that maps `POST /relay` and `GET /health` to the handlers)
- `apps/relayer/test/relayer.test.ts`
- `.batches/001-P1-relay-stub/*`, `notes/phase-1-relayer.md`

## Ponytail ladder (why this is the smallest change that works)
- **Needed at all?** Yes: FR-REL-1 is Phase 1 (stub) and the frontend needs a `/relay` and `/health` to build against.
- **Already in repo?** No relayer code. Reuse viem's `simulateContract` → `writeContract` → `waitForTransactionReceipt`, `parseSignature`, `getAddress`, `formatEther`.
- **stdlib / platform:** Node 26 runs `.ts` natively (type stripping), `node --test`, `node:http`, `node --env-file`. Vercel runs `api/*.ts` with `export function POST(request: Request)` and no framework (docs: vercel.com/docs/functions/functions-api-reference, runtimes/node-js; default runtime Node 26.x). No express, hono, tsx, vitest, dotenv or zod.
- **Dependencies (new; flagged to the human):** `viem` 2.57.13 (exact pin, required by the brief), dev-only `typescript` 7.0.2 and `@types/node` 26.x for `tsc --noEmit`.
- **Minimum code:** one module plus two 3-line handlers. Tests fake the JSON-RPC endpoint with viem's `custom` transport, so the real viem code paths run with no network.
- `ponytail:` markers: stub ABI inlined (upgrade: `packages/shared` in Phase 2); no send lock, so two concurrent requests could pick the same nonce (upgrade: Postgres advisory lock, Phase 2, ARCHITECTURE §3).

## Out of scope
- Phase 2 drain guard (FR-REL-2 full allowlist, FR-REL-4 fee/minimum, FR-REL-5 gas/window caps, rate limits, daily budget), pause (FR-REL-9), Neon `rel_*` tables, AT-10 as a gate, alerting.
- Public deploy: the stub runs on 127.0.0.1 only until the Phase 2 guards land. `vercel.json` rewrites (`/relay` → `/api/relay`) come with the deploy batch.
- `packages/shared` ABI and addresses (claude-contracts), `/schedule` and keepers (Phase 5), the payer-side signer (the frontend's guest wallet in Phase 2).

## NEEDS THE USER (PIPELINE.md §11)
- Relayer key use: the live run sends one `pull` tx from `0xdd02…a651` (~0.0005 WBT gas) and, as the AT-10 preview, attempts nothing on-chain for the replay.
- The live run signs one 1 USDT authorization with `PAYER_PRIVATE_KEY` (claude-contracts' G1 payer) via `cast` in the scratchpad; the USDT goes payer → stub → team wallet.
- New dependencies: viem 2.57.13, typescript 7.0.2 (dev), @types/node (dev).
