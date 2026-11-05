VERDICT: PASS

# Test report: 003-P1-arkiv-probe, round 2 (tester)

Run 2026-11-05, 23:45 to 23:50 IST, against the uncommitted diff under `apps/web`. Round 2 changed only `lib/arkiv.ts` (key check moved into `privateKeyToAccount` inside a try/catch that rethrows with no cause; a whitespace-only `ARKIV_ACCESS_KEY` is refused) and `test/arkiv.test.mjs` (five bad keys, raw-key redaction). Per the orchestrator I did not re-run the live probe (it spends tGLM) and did not run `npm run build`.

## What changed since round 1 (hash check)

`shasum -a 256` before any mutation:

| File | sha256 | vs round 1 |
|---|---|---|
| `lib/arkiv.ts` | `994b3885…cc83a80` | changed (round 1: `a8501b08…2aa1`) |
| `test/arkiv.test.mjs` | `e84e4590…b2095c` | changed |
| `scripts/arkiv-probe.ts` | `4a8f8541…456a1c` | **same as round 1**, so the probe's create/query path is unchanged and round 1's two live runs stand |
| `test/arkiv-probe.test.mjs` | `21ad0811…393f3` | same (tester-added, round 1) |
| `package.json`, `package-lock.json`, `tsconfig.json` | mtimes 23:33, unchanged since round 1 | same |

## Acceptance criteria

| # | Criterion (spec.md) | Result | Evidence |
|---|---|---|---|
| 1 | SDK pinned at exactly 1.0.1 | PASS (unchanged) | `apps/web/package.json:15` `"@arkiv-network/sdk": "1.0.1"`; `git diff package.json` shows only that line. Round 1 checked the lockfile and installed version. |
| 2 | `arkivClients(env)`: Rabdi reader + writer + address; a missing or malformed `ARKIV_PRIVATE_KEY`, or a missing or empty `ARKIV_ACCESS_KEY`, throws naming the variable and never echoing the value | PASS | `npm test`: tests 1 to 3 of `test/arkiv.test.mjs` pass. Test 1 covers a missing key plus five bad keys (`0xnot-a-key…`, `0x1234`, 64 hex without `0x`, 66 hex too long, `0x`+`ff`×32 out of range). For each one it checks that the message names the variable, contains neither the value nor the out-of-range key in decimal, and has no `cause`. Test 2 covers missing, `""` and `"  "`. Mutations M1 to M4 below are all caught. Real-env check with no RPC call: `arkivClients()` with the real `.env`, printing only public fields, gives `{"address":"0xF216677A6c7635c34e7dD58927B98D141d538Cbe","matchesWriter":true,"readerChain":7794095,"writerChain":7794095}`, so the new key path still accepts the funded writer key. |
| 3 | `redactArkivError` strips the access key raw and URL-encoded; the test uses a real viem `HttpRequestError` | PASS | Test 4 passes. It now also feeds the raw key (`"bad key <access-key> in config"`). M5a and M5b below are both caught. |
| 4 | Probe: one `mcplus.probe.v1` entity, 30-min expiry, query back with `eq("at", …).ownedBy(writer)`, prints only `{writer, entityKey, txHash, createMs, queryMs, found, expiresInMin}`, exit 1 if not found or on error | PASS (unchanged) | Probe file hash is the same as round 1. The spec now lists `expiresInMin` (closes round 1 OPEN 1). `test/arkiv-probe.test.mjs` (3 offline tests: found gives exit 0, not found gives exit 1, an RPC error gives exit 1 with the key redacted on stderr) passes. |
| 5 | Live evidence: probe output + entity on the explorer | PASS (round 1 stands) | Round 1: builder tx `0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e` (block 258050) and tester tx `0xf604d899622385782ab905b4f20f31230241f6face49dfb87524ad81a9fcb89d` (block 258117), both SUCCESS on https://rabdi.explorer.arkiv.network, screenshots in `round-1/shots/`. No re-run, per instruction. |
| 6 | `npm test`, typecheck, lint (build not run); `.next/static` grep clean | PASS | `npm test`: `tests 23 · pass 23 · fail 0`, exit 0. `npm run typecheck`: `✓ Types generated successfully`, exit 0. `npm run lint`: exit 0, no output. `grep -rlE "ARKIV_\|rpc\.rabdi\|arkiv-network" apps/web/.next/static`: no hits (exit 1); the same grep over `.next/server`: no hits (exit 1). `.next` is the builder's build `Y_X8rdBE6JP6KgWbzYexK` (23:33), from before round 2's change to `lib/arkiv.ts`. That doesn't matter here: the only file under `app/ components/ lib/` that mentions arkiv is `lib/arkiv.ts` itself, no route imports it, and no `NEXT_PUBLIC_ARKIV*` exists (grep exit 1). |
| 7 | Friction posted to claude-research | PASS (round 1) | agentbus 22:54:10, verified in round 1. Explorer-route friction is still unposted (OPEN 1). |

SRS: **DEP-5 PASS**, **NFR-3 PASS**, **NFR-8 PASS** (unchanged probe, round 1 explorer evidence), **SR-ARK-1** evidence as in round 1 (writer address + schema query `arkiv.schema = str('mcplus.probe.v1')`). No AT-* ID applies (AT-9 is Phase 4).

## Mutation checks on the round-2 key path

I made each mutation in place in `apps/web/lib/arkiv.ts`, ran `node --test test/arkiv.test.mjs`, and then restored the file.

| # | Mutation | Result | Failing assertion |
|---|---|---|---|
| M1 | Drop the try/catch: `const account = privateKeyToAccount(...)` | **caught**, 3 pass / 1 fail | test 1 (`arkiv.test.mjs:13`): a missing key gives viem's `TypeError: Cannot read properties of undefined (reading 'slice')`, which doesn't name the variable |
| M1b | Round-1 shape check (`/^0x[0-9a-f]{64}$/`) and no try/catch, so only the out-of-range key reaches noble | **caught**, 3/1 | test 1, case `0xffffffffff`: noble's message is `expected valid private key: 1 <= n < 1157…4337, got 1157…9935`, the test key in decimal. This confirms review-code F1 was real and that the new test catches it. |
| M2 | Re-add the cause: `catch (cause) { throw new Error("…", { cause }) }` | **caught**, 3/1 | test 1, case `0xnot-a-key-` (`e.cause === undefined` fails) |
| M4 | Echo the value: `` `ARKIV_PRIVATE_KEY is missing or malformed: ${env.ARKIV_PRIVATE_KEY}` `` | **caught**, 3/1 | test 1, case `0xnot-a-key-` |
| M3 | Drop `.trim()`: `if (!env.ARKIV_ACCESS_KEY)` | **caught**, 3/1 | test 2 (`arkiv.test.mjs:24`): `Missing expected exception: whitespace only` |
| M5a | Redact only the URL-encoded form | **caught**, 3/1 | test 4: `the raw form is redacted too` |
| M5b | Redact only the raw form | **caught**, 3/1 | test 4 (`arkiv.test.mjs:42`): the encoded key is still in the viem message |

Restore proof: `shasum -a 256 -c` over the six recorded files gives `OK` for all of them (`lib/arkiv.ts: OK`, hash `994b3885c230b9c970ae2bd41cb0eb48b6b8ca7619be3ba19caee2fe7cc83a80`). `cmp` against the pre-mutation copy in the scratchpad is clean, and `grep -c MUTATION lib/arkiv.ts` gives 0. The restore changed the file's mtime to 23:47:10; its content is byte-identical. The format-on-edit hook was a no-op because prettier isn't installed (repo root and `apps/web`).

## Pages and speed (NFR-4, NFR-12 to NFR-14)

Not applicable. Round 2 changes no page, component or relayer code, so there was no 375/1440 walk, no Lighthouse run, no p95 timing and no `round-2/shots/`. The bundle grep shows the SDK stays out of client JS.

## Secret hygiene

- I never printed a `.env` value. The real-env check printed only the address, a boolean and the chain IDs. `.env.example` was read for variable names only.
- A no-echo leak check (it reads `ARKIV_PRIVATE_KEY` and `ARKIV_ACCESS_KEY` from `.env` and prints only counts) over this file: see the last line.

## DONE

- `apps/web/lib/arkiv.ts:13`: a whitespace-only access key is refused (test 2; M3 caught). Closes round 1 OPEN 2.
- `apps/web/lib/arkiv.ts:14-20`: the key is validated by `privateKeyToAccount` inside a try/catch with no cause, and the message never carries the value. M1, M1b, M2 and M4 are all caught, and the real writer key still yields `0xF216…8Cbe`. Closes review-code F1 / security LOW-1.
- `apps/web/test/arkiv.test.mjs:12-22,44-45`: five bad keys plus the raw-key redaction case. Every mutation on the key path and the redaction path fails a test. Closes review-code F2.
- `npm test` 23/23, typecheck 0, lint 0, `.next/static` and `.next/server` grep clean.

## OPEN (none block)

1. INFO · friction · claude-frontend → claude-research (carried from round 1 OPEN 3). The explorer UI routes (`/tx/<hash>`, `/entity/<key>`, `/address/<addr>`, `/entity-explorer?q=<query>`) and the 404 on `/api/v2/transactions/<hash>` aren't posted for `arkiv/friction.md` yet.
2. INFO · `.env.example:11` · claude-frontend (carried from round 1 OPEN 4). `ARKIV_RPC_URL` is listed but never read: `lib/arkiv.ts:21` uses the SDK's `rabdi()` URL.
3. INFO · `apps/web/lib/arkiv.ts:21` · claude-frontend. Only a whitespace-only access key is refused. A key with stray spaces around it (`"ak… "`) passes and goes into the URL untrimmed; the RPC would then reject it, and redaction covers the raw form. Node's `--env-file` trims unquoted values, so this only matters for quoted values. No action needed unless the Phase 4 route reads the key from somewhere else.
4. INFO · Phase 4 (FR-ARK-1) · claude-frontend (carried from round 1 OPEN 5). Re-run the `.next/static` grep after a fresh build once a route imports `lib/arkiv.ts`, and consider `import "server-only"` in that route module.
5. The tester-added `apps/web/test/arkiv-probe.test.mjs` belongs in this batch's commit (claude-frontend).

## NEEDS THE USER

- New dependency `@arkiv-network/sdk` 1.0.1 (PIPELINE §11): approve or reject at the gate.
- Near secrets (PIPELINE §11): `lib/arkiv.ts` loads the Arkiv writer private key and access key from the web app's server env. The refusal and redaction behaviour is tested and mutation-checked above.
- `apps/web/tsconfig.json:16` `allowImportingTsExtensions: true`: a compiler-config change that batch 004 also relies on.

## Commands used

- `cd apps/web && npm test` · `npm run typecheck` · `npm run lint` (all exit 0)
- `cd apps/web && node --test test/arkiv.test.mjs` (once per mutation)
- `shasum -a 256 -c <scratchpad>/r2/orig.sha` · `cmp lib/arkiv.ts <scratchpad>/r2/arkiv.ts.orig`
- `grep -rlE "ARKIV_|rpc\.rabdi|arkiv-network" apps/web/.next/static` (no hits)
- Real-env offline check: `node --env-file=../../.env --input-type=module -e '…arkivClients()…'`, printing only address, match flag and chain IDs
- Leak check: `node <scratchpad>/r2/leakcheck.mjs round-2/test.md apps/web/lib/arkiv.ts apps/web/test/arkiv.test.mjs` gives `checked needles=3 files=3 hits=0` (raw and URL-encoded forms, and the private key without `0x`, deduplicated)
