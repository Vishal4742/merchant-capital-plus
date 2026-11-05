VERDICT: CHANGES

# Test: 001-P1-relay-stub, round 2 (tester)

This batch has no UI (HTTP API only), so I didn't do a browser walk and `shots/` is empty. Round-1 findings 2 (the 4 KB cap counted chars, not bytes) and 3 (`/health?x=1` returned 404) are fixed. Finding 1 (an RPC failure during simulation answered 422) is only partly fixed: transport failures now get 502, but a JSON-RPC `-32603 Internal error` still gets 422. The `dev.ts` change for finding 3 added a crash: one malformed request target kills the dev server. Both problems now have failing tests, and I checked that a one-line fix for each turns the suite green (18/18, on a scratch copy; product code untouched).

Safety: I sent no transaction and made no POST /relay with a valid authorization. The live check was simulate-only, with no key loaded and a transport guard that blocks `eth_send*`, `eth_fill*` and `eth_sign*`. Relayer nonce: `3` at the start, `3` at the end. Blockscout shows 4 txs for the relayer, the newest still `0x9f5efc75…e000` (nonce 2). The dev server isn't running (`no listener on 8787`).

## Acceptance criteria (spec.md)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit` (strict) | PASS | `tsc exit 0`, with the round-2 tests included |
| 2 | `npm test` passes | **FAIL** | Before my tests: `tests 13, pass 13, fail 0` (the builder's 4 plus round 1's 9). With 5 round-2 tests: `tests 18, pass 16, fail 2`. The failures are OPEN 1 and 2 below. With the proposed fixes on a scratch copy: `tests 18, pass 18, fail 0` |
| 2a | invalid bodies → 400, no RPC | PASS | `✔ rejects malformed bodies…`, `✔ rejects more malformed shapes…` (35 shapes, `node.calls == []`). Byte cap, round-1 #2: `✔ a body over 4 KB in bytes…` (6368 bytes / 2.3k chars → 400). New boundary test `✔ the 4 KB cap counts bytes: a 4096-byte multibyte body is accepted, 4097 bytes is 400 with no RPC` (the 4097-byte body is under 4096 chars). On the dev server, `6369 / 2369` bytes/chars → `{"error":"body too large"} [HTTP 400]`, and 4000 bytes of `0xff` (invalid UTF-8, decoded to U+FFFD) → `body too large [HTTP 400]` |
| 2b | simulation revert → 422, no `eth_sendRawTransaction` | PASS | Unit: `✔ returns 422 and sends nothing when the simulation reverts`. New, over a real HTTP transport (production path): `✔ over HTTP, a real revert (code 3 + Error(string) data, as Ankr answers) is still 422 with the reason` (also a bare code-3 revert → 422). **Live, simulate-only** (`scratchpad/live-simulate.ts`, relayer address as a json-rpc account, no key, guarded transport), the used and now-expired authorization from `0x9f5efc75…` → `status 422 {"error":"The contract function \"pull\" reverted with the following reason:\nTetherToken: auth expired"}`, `methods eth_call` (no fill or send). Raw `eth_call` to Ankr confirms its revert format: `{"code":3,"message":"execution reverted: TetherToken: auth expired","data":"0x08c379a0…"}` |
| 2c | valid → 200 `{txHash}`; raw tx to the stub; calldata = request args + split sig | PASS | `✔ submits pull to the stub with the exact args and returns the tx hash`, `✔ accepts boundary values…`, `✔ ignores a client-supplied target or calldata…` |
| 2d | `/health` shape, `wbt` from `eth_getBalance` | PASS | `✔ health reports the relayer WBT balance…`, `✔ health returns 502 when the balance lookup fails` |
| 3 | Live: payer (0 WBT) signs, POST /relay → txHash, explorer from relayer to PullStub, payer 0 WBT before and after | PASS (read-only recheck) | Blockscout `/api/v2/transactions/0x9f5efc7504e52eb0b4b4bdecfdbf66b896ef3572864f44cb1041f965be5ee000` → `ok success 12296944 91164 pull 2 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651 0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`; decoded `from 0xE53fBc545e9b72f315699e3295a8A300c192309b, value 1000000`. `cast balance 0xE53f…309b` → `0` |
| 4 | Live: `/health` shows real WBT (≤ 0.5) | PASS | `curl 127.0.0.1:8787/health` → `{"relayer":"0xdd02FE971Ad9e21365673E701693e7ab7bF9a651","wbt":"0.498377508835749934","gasSpentToday":null,"budgetLeft":null,"usdtFeesUnswapped":null,"paused":false} [HTTP 200]`; `cast balance … --ether` → `0.498377508835749934`, an exact match. Round-1 #3: `GET /health?x=1` → the same body `[HTTP 200]` (fixed). `/health/`, `GET /relay`, `POST /health`, `/nope` → 404 |
| 5 | Live AT-10 preview: replay → 422, relayer nonce unchanged | PASS (read-only) | `cast nonce` relayer → `3` before and after this round; no tx after nonce 2 on Blockscout; the live simulate-only replay → 422 (row 2b) |
| 6 | NFR-3: `process.env` only `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`; no key or `.env` value in any output, log or batch file | PASS | `dev.ts:7 PORT`, `src/relayer.ts:33 RELAYER_PRIVATE_KEY`, `src/relayer.ts:35 RPC_URL`. Value-free scan (`scratchpad/secret-scan.mjs`, prints counts only): `16 .env values (>= 8 chars) checked against 23 files: 0 contain one []` (batch folder, `apps/relayer` minus node_modules, `notes/phase-1-relayer.md`, the dev log, my scratch scripts, task outputs) |

Classification over a real HTTP transport (`scratchpad/classify-probe.ts`, a local JSON-RPC server), round-1 #1 recheck:

```
code 3 + Error(string) data (reth revert)  -> 422 "…reverted with the following reason:\nTetherToken: auth invalid"
code 3, no data (bare revert)              -> 422
code -32000 header not found               -> 502
code -32603 internal error                 -> 422 "…reverted with the following reason:\nInternal error"   <- OPEN 1
code -32005 limit exceeded                 -> 502
HTTP 503 html / HTTP 429 / HTTP 200 garbage -> 502
```

## DONE
- `apps/relayer/test/relayer.test.ts:1-11`: imports for the round-2 tests (`node:child_process`, `node:events`, `node:http`, `node:net`, viem `encodeErrorResult`, `parseAbi`).
- `apps/relayer/test/relayer.test.ts:284-307`: `httpNode` / `relayVia` helpers, a canned JSON-RPC node over real HTTP, so classification goes through viem's `http` transport as in production rather than `custom`.
- `apps/relayer/test/relayer.test.ts:309`: a real revert in Ankr's format is still 422 with the reason (passes). This guards the round-2 fix against over-correcting.
- `apps/relayer/test/relayer.test.ts:318`: HTTP 503, 429, non-JSON, -32000 and -32005 during simulation → 502 (passes).
- `apps/relayer/test/relayer.test.ts:334`: -32603 → 502 (**fails**, OPEN 1).
- `apps/relayer/test/relayer.test.ts:339`: exact byte boundary, 4096 multibyte bytes → 200 and 4097 → 400 with no RPC (passes).
- `apps/relayer/test/relayer.test.ts:361`: spawns `dev.ts` with only `PORT` in its environment (no key, handlers never reached, spawn `timeout` 10 s), sends one malformed request target, then expects `/nope` → 404 (**fails**, OPEN 2).
- Round-1 tests (now lines 149-282, shifted +6 by the imports) unchanged and passing.

## OPEN (owner: claude-relayer)
1. **A JSON-RPC `-32603 Internal error` during simulation still answers 422.** `apps/relayer/src/relayer.ts:54-56` (`isRevert`). viem's `getContractError` (`node_modules/viem/_esm/utils/errors/getContractError.js:15`) wraps both code 3 and `InternalRpcError.code` (-32603) in `ContractFunctionRevertedError`, so a node-side failure looks like a revert. The spec Interface says 502 for an RPC failure, and round-1 #1's concern (the frontend throws away a still-valid signature) applies. Ankr reports real reverts as code 3 with data (raw curl above), so excluding a -32603 that has no revert data loses nothing. Test `relayer.test.ts:334`: `-32603 answered 422 {"error":"…reverted with the following reason:\nInternal error"}` / `422 !== 502`. Fix that turns it green (checked on a scratch copy, 18/18):
   ```ts
   // import InternalRpcError from 'viem'
   if (!(e instanceof BaseError)) return false;
   const revert = e.walk((cause) => cause instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
   return revert !== null && (revert.raw !== undefined || e.walk((cause) => cause instanceof InternalRpcError) === null);
   ```
2. **Regression from the round-2 `dev.ts` fix: one malformed request target crashes the dev server.** `apps/relayer/dev.ts:14` runs `new URL(req.url ?? '/', 'http://127.0.0.1')` outside the `try`. An absolute-form target with a bad host (`GET http://[/health HTTP/1.1`) throws `TypeError: Invalid URL` (`code: 'ERR_INVALID_URL', input: 'http://[/health'`) as an unhandled rejection, and the process exits with code 1. Seen live: `nc` sent it to `npm run dev`, then `curl /health` → `[curl failed: server gone]`, and the dev log shows the stack at `dev.ts:14:43`. In round 1 this request reached the `try` (500), so the fix introduced the crash. Browsers don't send absolute-form targets, but any local process can, and the frontend lane will run against this server. Test `relayer.test.ts:361`: `after one malformed request the dev server answered: connection refused (exit code 1)`. Fix that turns it green (scratch copy, 18/18; malformed target → 404 and the server keeps serving): `routes[\`${req.method} ${(req.url ?? '/').split('?')[0]}\`]` (or move the lookup inside the `try`).
3. LOW, carried from round 1 (#4), not blocking: a failing receipt RPC after broadcast is retried about 12.6 s (viem defaults) before the 502 with `txHash` (`relayer.test.ts:245`, still the slowest test). This is NFR-4 work for Phase 2.
4. LOW, Phase 2, not blocking: the 4 KB cap is checked after the whole body is buffered (`dev.ts:17-18` reads every chunk; `api/relay.ts:8` awaits `request.text()`). Fine on localhost; on Vercel the platform caps bodies at 4.5 MB. Worth a streaming cap when the deploy batch lands (for reviewer-security to weigh).
5. Observation, no action: viem maps -32000 to `InvalidInputRpcError`, so "header not found" reaches the client as `"Missing or invalid parameters…"`. The status (502) is right; only the text is misleading.

## NEEDS THE USER (PIPELINE.md §11, flagged even when checks pass)
- Relayer key use: nothing new this round. Nonce stays 3, and the one live tx (`0x9f5efc75…e000`, 0.000455911 WBT) was approved at 21:11.
- New dependencies (unchanged): viem 2.57.13, typescript 7.0.2 (dev), @types/node 26.6.6 (dev).
- Round budget: this is round 2. A CHANGES here uses the last resume (round 3). Both fixes are one line each and already checked green on a scratch copy.
