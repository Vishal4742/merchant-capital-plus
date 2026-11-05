VERDICT: CHANGES

# Test: 001-P1-relay-stub, round 1 (tester)

There's no UI in this batch (HTTP API only), so there was no browser walk and `shots/` is empty. I checked the API with curl against `npm run dev` on 127.0.0.1:8787 and checked the live run read-only (Blockscout API and `cast` calls on Ankr). I sent no transaction and posted no valid body. The diff is the whole of `apps/relayer/` (untracked, new) plus this batch folder.

## Acceptance criteria (spec.md)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit` (strict) | PASS | `tsc exit 0` (also after the tester tests were added) |
| 2 | `npm test` passes | **FAIL** | Builder's 4 tests: `tests 4, pass 4, fail 0`. With the 9 tester tests: `tests 13, pass 11, fail 2`. The 2 failures are interface deviations; see OPEN 1 and 2 |
| 2a | invalid bodies → 400, no RPC | PASS, with one gap | Builder's 14 cases plus 21 tester cases (`null`, `[]`, `""`, args as an array or null, no sig, no nonce, `from` as a number, all-caps bad checksum, `value` of `""`, `" 1"`, `"+1"`, `"0x10"` or `"1e6"`, `validAfter` `"-0"`, `0X` nonce, 33-byte nonce, v = 29, 66-byte sig, a 4097-char body) all return 400 with `node.calls == []`. Gap: a body over 4 KB **in bytes** passes (OPEN 2) |
| 2b | simulation revert → 422, no `eth_sendRawTransaction` | PASS | `✔ returns 422 and sends nothing when the simulation reverts` |
| 2c | valid → 200 `{txHash}`, raw tx to the stub, calldata = request args + split sig | PASS | `✔ submits pull to the stub …` (RPC sequence `eth_call > eth_fillTransaction > eth_sendRawTransaction > eth_getTransactionReceipt`, chain 1874). Tester: `✔ accepts boundary values` (a 4096-char body, `validBefore` = uint256 max, lowercase `from` checksummed in the calldata, compact v 00/01 sent as 27/28) and `✔ ignores a client-supplied target or calldata` (extra `to`/`target`/`address`/`data`/`functionName` fields are ignored; the tx still goes to the stub as `pull` with value 0) |
| 2d | `/health` shape, `wbt` from `eth_getBalance` | PASS | `✔ health reports the relayer WBT balance …` (0.5); tester `✔ health returns 502 when the balance lookup fails` |
| 3 | Live: payer (0 WBT) signs, `POST /relay` → txHash, explorer from relayer to PullStub, payer 0 WBT before and after | PASS (read-only check of the human-approved run) | Blockscout `/api/v2/transactions/0x9f5efc75…e000`: `status ok, result success, block 12296944, gas_used 91164, method pull, nonce 2`, `from 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651 to 0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`, decoded `from 0xE53fBc54…309b, value 1000000, v 28`, transfers `payer → stub 1000000 USDT`, `stub → 0xb4E7…714D 1000000 USDT`. `cast balance` payer: `@12296943: 0`, `@12296944: 0`, now `0` |
| 4 | Live: `/health` shows real WBT (≤ 0.5) | PASS | `curl 127.0.0.1:8787/health` → `200 {"relayer":"0xdd02FE971Ad9e21365673E701693e7ab7bF9a651","wbt":"0.498377508835749934","gasSpentToday":null,"budgetLeft":null,"usdtFeesUnswapped":null,"paused":false}` (0.70 s). `cast balance … --ether` → `0.498377508835749934`, an exact match |
| 5 | Live AT-10 preview: replay → 422, relayer nonce unchanged | PASS (read-only) | `cast nonce` relayer `@12296943: 2`, `@12296944: 3`, now `3`. The relayer's Blockscout tx list ends at nonce 2 (`0x9f5efc75…`), so no replay tx exists. `cast call` of the same `pull` args `--from` the relayer → `execution reverted: TetherToken: auth invalid` (the cause of the 422). `authorizationState(payer, nonce)` → `true` |
| 6 | NFR-3: `process.env` only `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`; no key or `.env` value in any output, log or batch file | PASS | `grep -rn 'process.env' apps/relayer --include='*.ts' \| grep -v node_modules` → `dev.ts:7 PORT`, `src/relayer.ts:33 RELAYER_PRIVATE_KEY`, `src/relayer.ts:35 RPC_URL`. A script compared the 16 `.env` values against the batch folder, `apps/relayer` (minus node_modules) and the dev-server log without printing any value: `0 files contain one`. The tester test also proves that an RPC failure body is `{"error":"HTTP request failed."}`, with no RPC URL or host echoed |

Dev-server checks (no chain access; relayer nonce still `3` afterwards): `not json`, empty, a 5000-char body, `paySale`, no args, bad `from`, `value` `0`, `value` `-1`, short nonce, short sig and an all-zero sig each → `HTTP 400` with a specific `error`. `GET /relay`, `POST /health` and `/nope` → 404. The server binds `127.0.0.1:8787` only (`lsof`), and no listener remains after the stop.

## DONE
- `apps/relayer/test/relayer.test.ts:12-18`: `fakeNode` takes an `on` per-method override (backward compatible; it records `sentRaw` before the override runs).
- `apps/relayer/test/relayer.test.ts:143-276`: 9 new tests: more 400 shapes, accepted boundary values, a fixed target, the 502 paths (mined-and-reverted with `txHash`, broadcast failure without `txHash`, receipt-lookup failure with `txHash`), health 502, an unreachable RPC (no URL leak, status), and the byte-size cap. 7 pass and 2 fail (below).
- Live run verified read-only on Blockscout and `cast` (rows 3–5).

## OPEN (owner: claude-relayer)
1. **An RPC failure during simulation returns 422, but the spec says 502.** `apps/relayer/src/relayer.ts:92-95` maps every `simulateContract` error to 422. The spec's Interface says 422 means the simulation reverted and 502 means an RPC failure. The frontend will read 422 as "this authorization is bad" and may throw away a still-valid signature during an Ankr outage. Test `relayer.test.ts:256`: `RPC down during simulation answered 422 {"error":"HTTP request failed."}` / `422 !== 502`. Proposed fix: return 422 only when `e instanceof BaseError && e.walk(x => x instanceof ContractFunctionRevertedError)`, and 502 otherwise. The existing code-3 revert test must stay 422.
2. **The 4 KB cap counts UTF-16 chars, not bytes.** `apps/relayer/src/relayer.ts:9,55` (`MAX_BODY_CHARS`, `body.length`). The spec says 400 for a "body over 4 KB … the chain isn't touched", but a 6368-byte body (multibyte padding in an ignored field, 2.3k chars) with valid args reaches the chain. Test `relayer.test.ts:268`: `a 6368-byte body answered 200` / `200 !== 400`. Proposed fix: `Buffer.byteLength(body) > 4096` (or `new TextEncoder().encode(body).length`). If the lane decides chars are what was meant, amend the spec instead and delete that test.
3. LOW, not blocking: `apps/relayer/dev.ts:14` routes on the raw `req.url`, so `GET /health?x=1` → 404 in dev. A cache-busting query from the frontend would break local polling. Fix: route on `new URL(req.url, 'http://x').pathname`.
4. LOW, not blocking: after a broadcast, a failing receipt RPC is retried by viem's default (6 retries, about 12.6 s) before the 502. Test `relayer.test.ts:239` takes 12.6 s and is the slowest in the suite. The response still carries `txHash`, which is correct. It belongs with NFR-4 in Phase 2 (`retryCount` on `waitForTransactionReceipt`, or `sendTransactionSync`).
5. Known, Phase 2 (from build-relayer.md, not re-tested): NFR-4 latency was 7.86 s against a 5 s target, and there's no send lock (ponytail marker at `src/relayer.ts:85`).

## NEEDS THE USER (PIPELINE.md §11, flagged even when the checks pass)
- Relayer key use: the live run sent 1 tx from `0xdd02…a651` (fee 0.000455911164006554 WBT per Blockscout). Verified, nothing more to approve.
- New dependencies: viem 2.57.13, typescript 7.0.2 (dev), @types/node 26.6.6 (dev).
