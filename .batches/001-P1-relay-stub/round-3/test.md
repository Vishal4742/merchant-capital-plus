VERDICT: PASS

# Test: 001-P1-relay-stub, round 3 (tester)

This batch has no UI (HTTP API only), so there was no browser walk and `shots/` is empty. Every acceptance criterion passes. All four blocking findings from rounds 1 and 2 are fixed, and each one is guarded by a test: I reverted each fix on a scratch copy and its test went red (table below). The round-3 changes broke nothing I could find. What's left is LOW or Phase 2 work, listed in its own section at the end.

Safety: I sent no transaction and made no POST /relay with a valid authorization. The one live relay-path check was simulate-only: no key loaded, the relayer address as a json-rpc account, and a transport guard that refuses `eth_send*`, `eth_fill*` and `eth_sign*`. The dev server ran only for `/health` and for bodies that fail validation before any RPC call, and I stopped it at the end (`no listener on 8787`, `no dev.ts process`). Relayer nonce (`cast nonce 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651`): `3` at the start, `3` at the end. I added no test, since I found no real defect, and changed no product code.

## Acceptance criteria (spec.md)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `cd apps/relayer && npx tsc --noEmit` (strict) | PASS | `tsc exit 0` |
| 2 | `npm test` (`node --test`) passes | PASS | `ℹ tests 18 ℹ pass 18 ℹ fail 0 ℹ cancelled 0 ℹ skipped 0`, `duration_ms 13557` |
| 2a | invalid bodies → 400, no RPC call | PASS | `✔ rejects malformed bodies with 400 and makes no RPC call`, `✔ rejects more malformed shapes…` (35 shapes, `node.calls == []`), `✔ a body over 4 KB in bytes…`, `✔ the 4 KB cap counts bytes: a 4096-byte multibyte body is accepted, 4097 bytes is 400 with no RPC`. Dev server: `not json`, empty, 5000 × `x`, `paySale`, `from 0x123`, `value "0"`, short nonce, short sig, all-zero sig, and a 6030-byte / 2030-char multibyte body each → `[HTTP 400]` with a specific error (`body is not JSON`, `body too large`, `unknown action…`, `args.from must be an address`, `args.value must be above 0`, `args.nonce must be 32 bytes of hex`, `sig must be 65 bytes of hex`, `sig is not a valid signature`) |
| 2b | simulation revert → 422, `eth_sendRawTransaction` never called | PASS | `✔ returns 422 and sends nothing when the simulation reverts`; `✔ over HTTP, a real revert (code 3 + Error(string) data, as Ankr answers) is still 422 with the reason`. **Live, simulate-only** (`scratchpad/live-simulate.ts`, guarded, no key): `status 422 {"error":"The contract function \"pull\" reverted with the following reason:\nTetherToken: auth expired"}`, `methods eth_call`. Raw Ankr `eth_call` of the same calldata from the relayer → `{"code":3,"message":"execution reverted: TetherToken: auth expired","data":"0x08c379a0…"}` |
| 2c | valid → 200 `{txHash}`; raw tx to the stub; calldata = request args + split signature | PASS | `✔ submits pull to the stub with the exact args and returns the tx hash` (RPC sequence `eth_call > eth_fillTransaction > eth_sendRawTransaction > eth_getTransactionReceipt`, chain 1874, decoded `pull(from, 1e6, 0, 1.9e9, nonce, yParity+27, r, s)`), `✔ accepts boundary values…`, `✔ ignores a client-supplied target or calldata…` |
| 2d | `/health` shape, `wbt` from `eth_getBalance` | PASS | `✔ health reports the relayer WBT balance and Phase 2 fields as null`, `✔ health returns 502 when the balance lookup fails` |
| 3 | Live: payer (0 WBT) signs; POST /relay → txHash; explorer from relayer to PullStub; payer 0 WBT before and after | PASS (read-only recheck of the run the human approved at 21:11) | Blockscout `/api/v2/transactions/0x9f5efc7504e52eb0b4b4bdecfdbf66b896ef3572864f44cb1041f965be5ee000` → `ok success 12296944 91164 pull 2 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651 0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`. `cast balance 0xE53fBc545e9b72f315699e3295a8A300c192309b` → `0` (rounds 1–2 checked blocks 12296943 and 12296944, also `0`) |
| 4 | Live: `curl 127.0.0.1:8787/health` shows the real WBT balance (≤ 0.5) | PASS | `200 {"relayer":"0xdd02FE971Ad9e21365673E701693e7ab7bF9a651","wbt":"0.498377508835749934","gasSpentToday":null,"budgetLeft":null,"usdtFeesUnswapped":null,"paused":false}`; `cast balance … --ether` → `0.498377508835749934`, an exact match. `lsof` shows the server bound to `127.0.0.1:8787` only |
| 5 | Live AT-10 preview: replay → 422, relayer nonce unchanged | PASS (read-only) | `cast nonce` → `3` (start) and `3` (end). Blockscout lists 4 txs for the relayer, the newest `0x9f5efc7504…` at nonce 2 (`[(2,'0x9f5efc7504'),(1,'0xc4629df10e'),(0,'0x86efc97bf8'),…]`). The live simulate-only replay → 422 (row 2b) |
| 6 | NFR-3: `process.env` is only `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`; no key or `.env` value in any output, log or batch file | PASS | `grep -rn 'process.env' apps/relayer --include='*.ts' \| grep -v node_modules` → `dev.ts:7 PORT`, `src/relayer.ts:34 RELAYER_PRIVATE_KEY`, `src/relayer.ts:36 RPC_URL`. Count-only scan (`scratchpad/secret-scan.mjs`, prints no values): `16 .env values (>= 8 chars) checked against 26 files: 0 contain one []` (batch folder, `apps/relayer` minus node_modules, `notes/phase-1-relayer.md`, the round-3 dev log and probes, background task output) |

## Rounds 1 and 2 findings: fixed, and the tests catch a revert of each fix

Mutation check on a scratch copy of `apps/relayer` (node_modules symlinked; the copy matched the product files byte for byte before and after, and has been deleted):

| Finding | Status | Guarding test (`test/relayer.test.ts`) | Revert the fix → |
|---|---|---|---|
| R1 #1: RPC failure during simulation answered 422 | FIXED (`src/relayer.ts:55-61`, `:104`) | `:262` unreachable RPC, `:318` HTTP 503/429/garbage/-32000/-32005 | `status: 422` for every simulation error → `fail 3` (`:262`, `:318`, `:334`) |
| R1 #2: 4 KB cap counted UTF-16 chars | FIXED (`src/relayer.ts:65`, `Buffer.byteLength`) | `:274`, `:339` (4096 bytes → 200, 4097 → 400, no RPC) | `body.length` → `fail 2` (`:274`, `:339`) |
| R1 #3: `GET /health?x=1` → 404 in dev | FIXED (`dev.ts:14`) | none (manual) | dev server `GET /health?x=1` → `200` with the same body as `/health` |
| R2 #1: JSON-RPC -32603 during simulation answered 422 | FIXED (`src/relayer.ts:60`) | `:334` | the round-2 `isRevert` (no -32603 clause) → `fail 1` (`:334`) |
| R2 #2: a malformed request target crashed the dev server (`new URL` outside the `try`) | FIXED (`dev.ts:14`, split on `?`, no `new URL`) | `:361` (spawns `dev.ts` with only `PORT`, no key) | the round-2 `new URL(...).pathname` routing → `fail 1` (`:361`) |

R2 #1 under the production transport config (viem `http` default retries, `scratchpad/r3/classify-probe.ts default`): `code -32603 Internal error, no data -> 502 [4 req, 1062 ms]`, so viem retries -32603 three times, then the relayer answers 502. The full classification over a real HTTP transport:

```
code 3 + Error(string) data (reth revert)  -> 422   code -32603 Internal error, no data   -> 502
code 3 + custom error selector data        -> 422   code -32603 + revert data (hex)       -> 422
code 3, no data (bare revert)              -> 422   code -32603 + {data: revert} (hardhat)-> 422
code 3, data 0x                            -> 422   code -32603 + data "0x"               -> 422
code -32000 execution reverted + data      -> 422   code -32603 + data {}                 -> 502
code -32000 execution reverted, no data    -> 502   code -32603 + non-hex string data     -> 422  (Phase 2 note 1)
code -32000 header not found               -> 502   code -32005 / -32601 / HTTP 503 / 429 / garbage -> 502
```

R2 #2 live: on the running dev server, raw targets `GET http://[/health`, `GET http://[/relay`, `POST http://[/relay`, `GET *`, `GET /%ZZ`, a 9 KB path and `GET /health;x` each → `HTTP/1.1 404 Not Found`. Node's own parser answered `GET \health` and `POST /relay?%` with `400 Bad Request`. Afterwards `GET /health` → `200`, and the dev log shows no `handler failed` line and no stack trace. (`/health?%ZZ` and `/health?a=[` → `200` over curl. My raw-socket probe got no reply for those two only because it half-closed the socket before the async `/health` handler answered. That's an artifact of the probe, not of the server.)

## Did round 3 break anything?
No regressions found. One behaviour change, harmless: an absolute-form target with a valid host (`GET http://127.0.0.1:8787/health HTTP/1.1`) now gets 404. Round 2's `new URL().pathname` served it, and round 1's raw `req.url` routing also returned 404. Browsers, `curl` and `fetch` send origin-form targets, so the frontend isn't affected. Routes keyed as `"<METHOD> <path>"` always contain a space, so no `Object.prototype` key can match the `routes` lookup at `dev.ts:14`.

## DONE
- `cd apps/relayer && npx tsc --noEmit` → exit 0; `npm test` → `tests 18, pass 18, fail 0`.
- Spec rows 1–6 verified (table above); the live rows were checked read-only or simulate-only.
- Every round-1/round-2 blocking finding was confirmed fixed and confirmed guarded by a test through four mutations (`src/relayer.ts:60`, `:65`, `:104`, `dev.ts:14`).
- Round-3 probes (scratchpad only, outside `apps/relayer`): `scratchpad/r3/classify-probe.ts` (19 error shapes, with `retryCount: 0` and with the defaults), `scratchpad/r3/raw-targets.mjs` (raw request targets), and the round-2 `scratchpad/live-simulate.ts` re-run.
- No test added and no product code touched.

## OPEN (owner: claude-relayer; none blocking)
- LOW, `notes/phase-1-relayer.md:8`: says `node --test 4/4`. The suite is now 18/18. Update it in the commit step (PIPELINE §3.7).

## NEEDS THE USER (PIPELINE.md §11, flagged even though every check passed)
- Relayer key use: nothing new this round. The nonce stays `3`, and the one live tx (`0x9f5efc75…e000`, approved 21:11) is unchanged.
- New dependencies (unchanged): viem 2.57.13, typescript 7.0.2 (dev), @types/node 26.6.6 (dev).
- Near secrets: `npm run dev` runs `node --env-file=../../.env`, which loads **every** root `.env` value (the payer key and other lanes' values too) into the dev process's environment. The code reads only `RELAYER_PRIVATE_KEY`, `RPC_URL` and `PORT` (row 6), so this is fine for a localhost stub, but it's broader than NFR-3's "reads only". For reviewer-security to weigh: an `apps/relayer/.env` with just those three would scope it (the root `.gitignore` pattern `.env` already matches any subfolder).
- Round budget: this was round 3, the last allowed. The tester says PASS; reviewer-code, reviewer-security, reviewer-ux-ui and ci still have to run.

## Phase 2 notes (non-blocking; not acceptance criteria of this batch)
1. `src/relayer.ts:60`: `revert.raw !== undefined` counts any `data` value as revert data. A -32603 node failure that carries a non-hex string in `data` (e.g. `"header not found"`) still answers 422 with the text `reverted with the following signature:\nhead`. There's no evidence Ankr sends that shape: its reverts are code 3 with hex data (raw curl above). Either way nothing is sent; only the hint to the client differs. One-line tightening: `isHex(revert.raw)` (viem). Note that `"0x"` stays a revert, which is right for a bare revert.
2. `src/relayer.ts:50-52, 104`: on a -32603, the 502 body reads `The contract function "pull" reverted with the following reason:\nInternal error`. The status is right, but the text says "reverted". The frontend should branch on the status. Consider a generic message for 502s.
3. A geth-style bare revert (`-32000 "execution reverted"`, no data) → 502, because viem maps it to `ExecutionRevertedError`, not `ContractFunctionRevertedError`. Ankr's reth answers code 3, so it's 422 there. This only matters if `RPC_URL` ever points to a geth node, and it fails safe (nothing is sent).
4. Carried from rounds 1–2: a failing receipt lookup after the broadcast is retried about 12.6 s before the 502 with `txHash` (`test/relayer.test.ts:245`, `12613 ms`, 93% of the suite's runtime). NFR-4 work: `retryCount` on `waitForTransactionReceipt`, or `sendTransactionSync`.
5. Carried: the 4 KB cap is checked after the whole body is buffered (`dev.ts:17-18`, `api/relay.ts:8`). Fine on localhost; worth a streaming cap in the deploy batch.
6. Carried: NFR-4 latency (7.86 s against the 5 s target) and the missing send lock (`ponytail:` marker, `src/relayer.ts:95`).
7. The `?query` routing fix (R1 #3) has no unit test, only my curl check. One `fetch('/health?x=1')` added to the dev-server test (`test/relayer.test.ts:361`) would lock it in. Its handler would throw without a key, so that test should expect 500 rather than 404, which proves the route matched.
