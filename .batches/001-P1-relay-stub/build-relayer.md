STATUS: READY

# Build: 001-P1-relay-stub (claude-relayer)

## DONE
- `apps/relayer/src/relayer.ts` — `parsePull` (trust-boundary validation, no chain access), `relay` (simulate as the relayer → `writeContract` → `waitForTransactionReceipt` 30 s), `health` (real WBT balance, Phase 2 fields `null`), `relayerClient` (key from env, Ankr default), `makeClient` (test seam: any viem transport).
- `apps/relayer/api/relay.ts`, `api/health.ts` — Vercel Web-standard handlers (`export function POST(request: Request)`); target fixed to PullStub `0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`.
- `apps/relayer/dev.ts` — `node:http` adapter on 127.0.0.1:8787 (`npm run dev`, loads `../../.env` with `node --env-file`).
- `apps/relayer/test/relayer.test.ts` — 4 tests, fake JSON-RPC node via viem `custom` transport (retryCount 0, like a real HTTP code-3 revert).
- Deps pinned exact: viem 2.57.13; dev typescript 7.0.2, @types/node 26.6.6. `npm install` reported 0 vulnerabilities.

## Verified (command output)
- `npx tsc --noEmit` → exit 0.
- `npm test` → `tests 4, pass 4, fail 0`: 14 malformed bodies → 400 with zero RPC calls; revert → 422, no `eth_sendRawTransaction`; valid → 200, RPC sequence exactly `eth_call > eth_fillTransaction > eth_sendRawTransaction > eth_getTransactionReceipt`, raw tx to the stub on chain 1874 with calldata `pull(from, 1e6, 0, 1.9e9, nonce, yParity+27, r, s)`; `/health` shape.
- Live, read-only: `GET /health` handler → `200 {"relayer":"0xdd02FE971Ad9e21365673E701693e7ab7bF9a651","wbt":"0.498833419999756488",…}`; `cast balance` agrees to the wei.
- PullStub on 1874 checked with cast: 805 bytes code, `usdt()` = prize USDT, `payee()` = team wallet `0xb4E7…714D`; selector `0x71e9b8d6` matches. claude-contracts' G1 pull `0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e` (ok, 94,034 gas).
- `grep -rn process.env --include='*.ts'` (no node_modules) → only `PORT`, `RELAYER_PRIVATE_KEY`, `RPC_URL` (NFR-3).
- Payer-side signer (scratchpad, outside apps/relayer): the USDT EIP-712 domain `{Tether USD, 1, 1874, 0xcedf…}` hashes to the on-chain `DOMAIN_SEPARATOR()` `0xcdcfacb6…2a25`.

## Live run (human approved 21:11; `npm run dev`, server on 127.0.0.1:8787 only)
- `curl 127.0.0.1:8787/health` → `{"relayer":"0xdd02FE971Ad9e21365673E701693e7ab7bF9a651","wbt":"0.498833419999756488","gasSpentToday":null,"budgetLeft":null,"usdtFeesUnswapped":null,"paused":false}`; unknown route → 404.
- `POST /relay` (payer-signed 1 USDT `ReceiveWithAuthorization`, to = PullStub) → `200 {"txHash":"0x9f5efc7504e52eb0b4b4bdecfdbf66b896ef3572864f44cb1041f965be5ee000","blockNumber":"12296944"}`.
  Explorer: https://explorer.testnet.whitechain.io/tx/0x9f5efc7504e52eb0b4b4bdecfdbf66b896ef3572864f44cb1041f965be5ee000 — status ok, from relayer `0xdd02…a651`, to PullStub `0x51e2…325d`, method `pull`, **gasUsed 91,164**, fee 0.000455911 WBT; USDT transfers payer → stub 1.0, stub → team wallet 1.0.
- Snapshots (cast): before `payer WBT=0 payerUSDT=1000000 teamUSDT=110721542 relayerNonce=2` · after pull `payer WBT=0 payerUSDT=0 teamUSDT=111721542 relayerNonce=3` · after replay unchanged.
- Replay of the same body → `422 {"error":"The contract function \"pull\" reverted with the following reason:\nTetherToken: auth invalid"}`; relayer nonce stayed 3 (no tx, no gas) — AT-10 preview.
- Timing: POST → 200 took **7.86 s** (NFR-4 target ≤ 5 s, a Phase 2 gate item). Cause: venue → Ankr round trip 0.65–1.15 s × ~8 sequential RPCs (call, fill, send, receipt polls).

## Findings worth keeping (for Phase 2)
- NFR-4: Ankr supports **`eth_sendRawTransactionSync`** (EIP-7966; probe with an undecodable tx → `-32602 failed to decode`, vs `-32601` for an unknown method) and viem 2.57 has `sendTransactionSync`, so send + receipt can become one RPC. Measure in Phase 2.
- viem 2.57 sends via `eth_fillTransaction` first; Ankr's reth supports it, so **the node fills nonce, gas and fees** (probe: maxFeePerGas 5.001 gwei, priority 0.001 gwei). FR-REL-5 caps (≤10 gwei, ≤400k gas) must be enforced on the request we sign, not assumed.
- viem retries only unknown/5xx/rate-limit errors; a real code-3 revert over HTTP 200 is not retried, so a rejected request returns fast.
- Vercel `.ts` import extensions: Node 26 runs `../src/relayer.ts` imports natively; whether Vercel's builder resolves `.ts` specifiers is UNVERIFIED until the Phase 2 deploy batch (fallback: `rewriteRelativeImportExtensions` or a bundle step).

## OPEN
- NFR-4 latency (7.86 s here) — Phase 2, see findings.
- Spec said `cast wallet sign`; the signer is a viem script in the scratchpad instead, so the payer key comes from the environment and never appears on a command line (`ps`). Same signature, same scope.

## Round 2 (addresses round-1/test.md CHANGES)
- **422 vs 502** (`src/relayer.ts` `isRevert`): simulation errors return 422 only when the viem error chain contains `ContractFunctionRevertedError`; RPC failures return 502, so a still-valid signature isn't treated as bad. Live check (simulate only, no send): the used authorization → classified revert, `TetherToken: auth expired`; relayer nonce still 3.
- **Body cap in bytes** (`MAX_BODY_BYTES`, `Buffer.byteLength(body)`): the 6,368-byte / ~2.3k-char body now gets 400 before any RPC.
- **dev.ts** routes on the URL pathname, so `GET /health?x=1` works.
- Not changed: the 12.6 s receipt-retry path (viem default retries) → Phase 2 NFR-4 work with `eth_sendRawTransactionSync`.
- `npx tsc --noEmit` → exit 0 · `npm test` → `tests 13, pass 13, fail 0` (the tester's 9 new tests included).

## Round 3 (addresses round-2/test.md CHANGES; last round allowed)
- **-32603 is not a revert** (`src/relayer.ts` `isRevert`): viem's `getContractError` labels both code 3 and -32603 as `ContractFunctionRevertedError` (source: `utils/errors/getContractError.js`). Now 422 only if the revert carries revert data (`raw`) or no `InternalRpcError` is in the chain; a bare -32603 → 502.
- **dev.ts crash** (round-2 regression of mine): routing uses `(req.url ?? '/').split('?')[0]`, no `new URL` outside the try; a malformed request target gets 404 and the server keeps running.
- `npx tsc --noEmit` → exit 0 · `npm test` → `tests 18, pass 18, fail 0`. The dev-server test spawns `dev.ts` with only `PORT` in its env (no key).
