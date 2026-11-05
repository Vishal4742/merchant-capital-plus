VERDICT: PASS

# Code review: 001-P1-relay-stub, round 3 (reviewer-code)

Scope: every file is new and untracked, so I reviewed them whole: `apps/relayer/{package.json, tsconfig.json, src/relayer.ts, api/relay.ts, api/health.ts, dev.ts, test/relayer.test.ts}` and `notes/phase-1-relayer.md`. `git status --untracked-files=all` lists only spec-listed files plus batch files, so nothing stray. Rounds 1 and 2 had no code review (tester CHANGES both times), so there are no earlier review-code findings to re-check. I re-read the tester's four fixed findings in the code: `src/relayer.ts:55-61` (isRevert), `:65` (byte cap), `dev.ts:14` (split on `?`, no `new URL` outside the try). All fixed.

Commands (run by me):
- `cd apps/relayer && npx tsc --noEmit` → `tsc exit 0`
- `npm test` → `tests 18, pass 18, fail 0` (duration 13.5 s)
- `grep -rn process.env apps/relayer --include=*.ts | grep -v node_modules` → `dev.ts:7 PORT`, `src/relayer.ts:34 RELAYER_PRIVATE_KEY`, `src/relayer.ts:36 RPC_URL` (NFR-3)
- `toFunctionSelector('function pull(address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)')` → `0x71e9b8d6`, the same as the build notes' on-chain check
- Scratch copy of `apps/relayer` (deleted afterwards): I removed 7 fake-node RPC cases and still got `18/18` (LOW-1)

## The checks

1. **Traceability and scope.** Every change maps to spec.md: `relay` → FR-REL-1 stub + FR-REL-3 (simulate before send, `relayer.ts:102-105`); `health` → FR-REL-6 skeleton; env reads → NFR-3/CON-7; payer signs only, relayer pays → CON-4. Nothing outside the spec was built. There is no drain guard, Neon, pause, vercel.json or deploy, and payer signing stays outside `apps/relayer`.
2. **Interface (the contract with the other lanes).** `PULL_STUB_ABI` (`relayer.ts:17-19`) matches `PullStub.pull` in `/Users/vg890/ethglobal-contracts/contracts/src/PullStub.sol` exactly, including the names, types and order. The target is a server constant (`api/relay.ts:5`, `0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`), and the client can't pick the target or the calldata (test `:201`). `PullStub` isn't in ARCHITECTURE §2 (it's a Phase 1 stub), and the spec's Interface explicitly replaces the §3 action set with `pull` for Phase 1. The status codes and bodies match the spec: 200 `{txHash, blockNumber}`, 400/422 `{error}`, and 502 `{error, txHash?}`, where `txHash` is left out when the broadcast fails (`Response.json` drops `undefined`).
3. **Logic and edge cases.** `uint256` accepts 1–78 ASCII digits and caps at `maxUint256`. Leading zeros are accepted, which is harmless. `value` 0 → 400. `validBefore` 0 passes and then reverts in simulation → 422, which is correct. Signature: `parseSignature` + `yParity + 27` gives 27/28 for both 65-byte and compact-v forms, and v = 29 → 400. `isRevert` against viem 2.57.13's `getContractError` (`node_modules/viem/_esm/utils/errors/getContractError.js`): -32603 builds a `ContractFunctionRevertedError` with `cause: err`, so `walk(InternalRpcError)` does reach it. `raw` is set from the node's `data`, so the classification works as the build notes say. `whitechainSepolia` is id 1874 in viem's chain definitions. A mined revert → 502 with `txHash`, and a receipt timeout (30 s) → 502 with `txHash`. Both are correct, because the caller can still look up the hash. `formatEther` is exact, with no rounding.
4. **Simplicity (could anything be deleted, reused, or replaced?).** The product code has nothing to delete. One module plus 3–5-line handlers, a single dependency (viem), and `node:test`/`node:http`/type stripping in place of a framework. Every helper (`isRecord`, `uint256`, `reason`, `isRevert`) has a caller and a reason to exist. The two `ponytail:` markers (inlined ABI/address, no send lock) name their ceilings and upgrade paths. The only dead code is in the tests (LOW-1).
5. **Tests assert the acceptance criteria.** Each spec bullet is covered. 400 + `calls == []`: the spec's whole list plus 21 more shapes (`:81`, `:154`, `:274`, `:339`). 422 + no `eth_sendRawTransaction` (`:109`, `:309`). 200 with the exact RPC sequence, `tx.to == stub`, chain 1874, and decoded calldata equal to the request args and the split signature (`:118`). `/health` shape with `wbt` from `eth_getBalance` (`:140`). The tester's mutation run shows each earlier fix is guarded by a test.

## DONE
- tsc 0, tests 18/18, NFR-3 grep clean, ABI and selector match PullStub.sol.
- No blocking findings. No regressions from round 3.
- The tester's round-3 OPEN item (`notes/phase-1-relayer.md` said 4/4) is already fixed: the file says `18/18`.

## OPEN: not blocking (LOW; fix in the commit step or with the next relayer batch)
- **LOW-1** `apps/relayer/test/relayer.test.ts:28, :37-43, :45`. The fake node answers 7 methods nothing calls (`eth_chainId`, `eth_estimateGas`, `eth_getTransactionCount`, `eth_maxPriorityFeePerGas`, `eth_gasPrice`, `eth_blockNumber`, `eth_getBlockByNumber`). viem's send path is `eth_fillTransaction`, and the test at `:130` asserts that exact sequence. Proof: with those cases deleted, the suite still gives 18/18. `sentRaw` is also assigned twice (`:25` and `:45`). Why it matters: dead fixture branches suggest a fallback path that is never tested. Fix: delete `:28`, `:37-43`, and the assignment at `:45` (keep the `return keccak256(params[0])`). Owner: claude-relayer.
- **LOW-2** `apps/relayer/test/relayer.test.ts:273, :332-333, :359`. These comments describe the bugs they guard in the present tense ("the check counts UTF-16 chars", "so isRevert() calls it a revert", "dev.ts parses req.url with new URL() before its try block"). All three are fixed, so the comments now misdescribe the code. Fix: change each to "regression guard for round-N: …". Owner: claude-relayer.
- **LOW-3** `/health` shape. The spec adds `relayer` to ARCHITECTURE §3's `{wbt, gasSpentToday, budgetLeft, usdtFeesUnswapped, paused}`, and the code follows the spec. The field is additive, so nothing breaks, but the two documents should show one shape. Also, `wbt` is a full 18-decimal string (`"0.498377508835749934"`), not the rounded `"0.4993"` in the spec example, so the frontend formats it for display. Fix: claude-research adds `relayer` to ARCHITECTURE §3 (or the lane drops it), and claude-frontend should know `wbt` comes at full precision. Owner: claude-research (docs), FYI claude-frontend.

## Phase 2 (not this batch; carry into the Phase 2 relayer spec)
- `src/relayer.ts:60`: tighten to `isHex(revert.raw)` so a -32603 with non-hex `data` is 502 (tester note 1). `:50-52`: use a generic 502 message so a node failure doesn't read "reverted" (tester note 2).
- `src/relayer.ts:109`: `writeContract` signs whatever gas, fees and nonce `eth_fillTransaction` returns from the node. Drain guard (5) (`maxFeePerGas ≤ 10 gwei`, gas ≤ 400k) has to be checked on `simulation.request` before signing, not assumed from the RPC.
- `src/relayer.ts:110`: if the receipt lookup fails after a broadcast, viem's default retries take about 12.6 s (test `:245` accounts for 93% of the suite's runtime). Combined with NFR-4 (7.86 s live against the 5 s target), this should move to `sendTransactionSync` / `eth_sendRawTransactionSync`, or set `retryCount` on the receipt wait.
- Send lock (the `ponytail:` at `relayer.ts:95`), a streaming body cap before buffering (`dev.ts:17-18`, `api/relay.ts:8`), `validBefore ≤ now + 15 min`, and `authorizationState` pre-checks (drain guard 3, 6).
- Deploy batch: confirm that Vercel resolves `../src/relayer.ts` import specifiers (unverified). Pin `engines.node` to a major version (`"26.x"`) rather than `">=24"`, so the runtime doesn't change on its own. Add a unit test for `GET /health?x=1` routing (tester note 7).

## NEEDS THE USER (PIPELINE.md §11; flagged though nothing blocks)
- New dependencies: `viem` 2.57.13 (exact pin), plus dev-only `typescript` 7.0.2 and `@types/node` 26.6.6.
- Relayer key use: one live `pull` tx (`0x9f5efc7504…e000`, approved 21:11). The relayer nonce has stayed 3 since then (tester).
- Near secrets: `npm run dev` loads the whole root `.env` (`package.json:9`) into the dev process. The code reads only the three allowed names. Whether to scope it to an `apps/relayer/.env` is reviewer-security's call.
- Round budget: this is round 3, the last one allowed. reviewer-code says PASS.
