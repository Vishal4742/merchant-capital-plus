VERDICT: PASS

# Test report: 003-P1-arkiv-probe, round 1 (tester)

Run 2026-11-05, 23:35 to 23:45 IST, against the uncommitted diff under `apps/web` (package.json, package-lock.json, tsconfig.json, lib/arkiv.ts, scripts/arkiv-probe.ts, test/arkiv.test.mjs). Per the orchestrator I did not run `npm run build`; :3100 serves the builder's `.next` (BUILD_ID 23:33:58, built after the source files' 23:33:27 mtimes).

## Acceptance criteria

| # | Criterion (spec.md) | Result | Evidence |
|---|---|---|---|
| 1 | `@arkiv-network/sdk` pinned exactly at 1.0.1 | PASS | package.json `"@arkiv-network/sdk": "1.0.1"` (no caret); lock root dep `1.0.1`, `node_modules/@arkiv-network/sdk` version `1.0.1`, integrity `sha512-DCOFdGunn4I5…3CUQ==`; installed package.json `"version": "1.0.1"`. The human still has to approve the new dependency (below). |
| 2 | `arkivClients(env)`: Rabdi 7794095 reader, writer and address; a bad `ARKIV_PRIVATE_KEY` or a missing or empty `ARKIV_ACCESS_KEY` throws, naming the variable and never echoing the value | PASS | `test/arkiv.test.mjs` tests 1–3 pass: a malformed key is refused and its value isn't in the message; the access key is refused when missing and when `""`; `reader.chain.id` and `writer.chain.id` are 7794095. |
| 3 | `redactArkivError` strips the access key raw and URL-encoded; the test uses a real viem `HttpRequestError` | PASS | Test 4 passes. Mutation 1 (return the raw `err.message`): test 4 fails at `test/arkiv.test.mjs:38` (`assert.ok(!text.includes(ACCESS) && !text.includes(encodeURIComponent(ACCESS)))`, 3 pass / 1 fail). Mutation 2 (redact the raw form only, not the URL-encoded one): the same test fails (3/1). Restored: `shasum -a 256 -c` gives `lib/arkiv.ts: OK` (a8501b08…2aa1) and `cmp` against the pre-mutation copy is clean. The file is untracked, so `git diff` can't show it; the hash is the proof. |
| 4 | Probe creates one `mcplus.probe.v1` entity (30-minute expiry), queries it back with `eq("at", …).ownedBy(writer)`, prints only public values, exits 1 if not found or on error | PASS (one LOW note) | Live run below: exit 0, `found: true`. The explorer shows schema `mcplus.probe.v1`, created at block 258117, expiring at block 259017: 900 blocks × 2 s = 30 min. Exit-1 paths were untested, so I added `apps/web/test/arkiv-probe.test.mjs` (3 tests, offline, mocked `lib/arkiv.ts`): found → exit 0 with the six spec fields; not found → exit 1; RPC `HttpRequestError` → exit 1, stderr `Arkiv probe failed: HTTP request failed…`, key absent raw and encoded. Mutating the probe (dropping `if (!found) process.exitCode = 1` and printing the raw `err.message`) fails 2 of the 3 tests. Restored: `scripts/arkiv-probe.ts: OK` (4a8f8541…a1c), `cmp` clean. LOW: the output adds an `expiresInMin` field (OPEN 1). |
| 5 | Live evidence: probe output + entity on the explorer | PASS | See "Live probe" and "Explorer" below. |
| 6 | `npm test`, typecheck, lint, build; `.next/static` grep clean | PASS | Builder's suite: `npm test` tests 20, pass 20, fail 0. With my 3 added tests: 23 / 23 / 0, exit 0. `npm run typecheck` exit 0, `npm run lint` exit 0. Build not re-run (orchestrator's instruction; the builder reported 0). `grep -rlE "ARKIV_\|rpc\.rabdi\|arkiv-network" apps/web/.next/static` finds nothing (grep exit 1), and the same grep over `.next/server` finds nothing too. Nothing in `app/`, `components/` or `lib/` (other than `lib/arkiv.ts` itself) imports arkiv, and nothing uses `NEXT_PUBLIC_ARKIV*` (`.env` has 0 such names). |
| 7 | Friction posted to claude-research | PASS | agentbus 2026-11-05T22:54:10 claude-frontend → claude-research "ARKIV FRICTION for arkiv/friction.md": (1) key in the URL path copied into viem errors, (2) an empty key silently falls back to the public endpoint, (3) the writer has 0 tGLM and needs the faucet, (4) read-only check after the outage. The outage was posted at 20:57:29 and logged by research at 20:59:42; it ended at 22:46:50 (research). Not posted yet: explorer routes (OPEN 3). |

SRS mapping: **DEP-5 PASS** (our own writer did one write and one query on Rabdi; the Arkiv track stays). **NFR-3 PASS** (the writer key is server-only: no client import, no `NEXT_PUBLIC_`, clean bundle grep). **NFR-8 PASS** (the explorer shows the entity's only attributes: `arkiv.schema`, `at` = unix seconds, `note` = "dep-5 probe"; the owner is our own writer). **SR-ARK-1 evidence** below. No AT-* ID applies to this batch (AT-9 is Phase 4).

## Live probe (run once)

`cd apps/web && node --env-file=../../.env --no-warnings scripts/arkiv-probe.ts`, started 23:36:27 IST, exit 0, wall time 11.11 s (including Node startup). stderr was empty.

```json
{
  "writer": "0xF216677A6c7635c34e7dD58927B98D141d538Cbe",
  "entityKey": "0x59f0a4a5e0ff921cfafc0cd90ed0a4949e54ceb62f4eb815ac8497fb3de06048",
  "txHash": "0xf604d899622385782ab905b4f20f31230241f6face49dfb87524ad81a9fcb89d",
  "createMs": 7215,
  "queryMs": 309,
  "found": true,
  "expiresInMin": 30
}
```

Before printing anything, I checked the stdout and stderr files with a script that reads the two ARKIV secrets from `.env` without echoing them. It searched for 5 forms (raw, URL-encoded, and the private key without `0x`) and found 0. createMs was 7215 here and 3189 in the builder's run. No SRS budget covers Arkiv writes (NFR-4 is the payment path); I'm recording it as information only.

## Explorer (independent of the SDK)

I used headless Chromium (Playwright) at 1440 wide on https://rabdi.explorer.arkiv.network with no key. Script: `round-1/probes/explorer.mjs`. Screenshots are in `round-1/shots/`.

- **Tester tx** `/tx/0xf604d899622385782ab905b4f20f31230241f6face49dfb87524ad81a9fcb89d` (`explorer-tx-tester.png`): SUCCESS, block 258117 pos 1, 2026-11-05 18:06:32 UTC, from `0xf216677a…1d538cbe` to EntityRegistry, nonce 1, gas used 113826 / 143576, fee 0.0001138 tGLM. ARKIV OPERATIONS (1): CREATE, schema `mcplus.probe.v1`, entity key `0x59f0a4a5…e06048`, expires at block 259017, attributes `at u64 indexed 1793901987` and `note str indexed "dep-5 probe"`. 1793901987 is 23:36:27 IST, the second the probe ran.
- **Tester entity** `/entity/0x59f0a4a5e0ff921cfafc0cd90ed0a4949e54ceb62f4eb815ac8497fb3de06048` (`explorer-entity-tester.png`): LIVE, owner `0xF216677A…1d538Cbe`, version 0, 1 operation, created at block 258117 by tx `0xf604d899…a9fcb89d`, expires at block 259017 ("in ~28m 0s", 93% left). History shows the three attributes SET: `arkiv.schema`, `at`, `note`.
- **Writer** `/address/0xf216677a6c7635c34e7dd58927b98d141d538cbe` (`explorer-writer.png`): balance 10 tGLM (the explorer rounds), "2 outgoing transactions": nonce 1 at block 258117 (`0xf604d899…`, CREATE) and nonce 0 at block 258050 (`0x2d651b87…`, CREATE, 124618 / 157118 gas, 0.0001246 tGLM).
- **Builder tx** `/tx/0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e` (`explorer-tx-builder.png`): SUCCESS, 18:04:18 UTC, from the writer, entity `0xe14667bc…439b3d`, expires at block 258950, `at` 1793901855, note "dep-5 probe". This matches build-claude-frontend.md.
- **Schema query** `/entity-explorer?q=arkiv.schema+%3D+str%28%27mcplus.probe.v1%27%29` (`explorer-query-schema.png`): "2 entities at block 258268 · 304 ms", both owned by `0xF216…8Cbe`. This is the runnable query for SR-ARK-1.

SR-ARK-1 evidence for the README (claude-research): writer `0xF216677A6c7635c34e7dD58927B98D141d538Cbe`. Runnable query with no key: the explorer link above, or `arkiv.schema = str('mcplus.probe.v1')` in the explorer's entity explorer. The probe entities expire about 30 minutes after creation (around 00:04 and 00:06 IST), so the README should point at the writer address or the schema query, not at an entity key.

## Speed (NFR-4, NFR-12–14)
Not applicable. The diff changes no web page and no relayer code, so there was no page walk at 375 or 1440 and no Lighthouse run. The bundle grep shows the SDK never reaches the client, so page JS size is unchanged. `ux-375.png` and `ux-1440.png` in `shots/` (23:35) were written by another agent, not by me.

## Secret hygiene
- I never printed a `.env` value. I read `.env` only for variable names (`ARKIV_PRIVATE_KEY`, `ARKIV_ACCESS_KEY`) and through the no-echo leak check.
- `.env` is git-ignored (`.gitignore:29`). `.env.example` (tracked) has empty `ARKIV_PRIVATE_KEY` and `ARKIV_ACCESS_KEY` placeholders; the leak check found 0 hits.
- Every Rabdi RPC URL I show stops at the host. The redaction mutation runs passed their output through a sed that masks the path.
- I ran the leak check over every file I wrote (this file, `probes/explorer.mjs`, the screenshots, `apps/web/test/arkiv-probe.test.mjs`): 0 hits. The command and result are at the end.

## DONE
- `apps/web/package.json:15`: SDK pinned at 1.0.1; lockfile and installed package match (criterion 1).
- `apps/web/lib/arkiv.ts:11-24`: env checks and Rabdi clients, covered by `test/arkiv.test.mjs` tests 1–3 (criterion 2).
- `apps/web/lib/arkiv.ts:27-31`: redaction; two mutations both killed, file restored by hash (criterion 3).
- `apps/web/scripts/arkiv-probe.ts:10-26`: one live run (found, exit 0), confirmed on the explorer. The exit-1 paths are now covered by the tester-added `apps/web/test/arkiv-probe.test.mjs`, which mutation shows can fail (criterion 4).
- Bundle and server grep clean; typecheck 0, lint 0, tests 23/23 (criterion 6).

## OPEN (none block this round)
1. LOW · `apps/web/scripts/arkiv-probe.ts:21` · claude-frontend. The output has a seventh field, `expiresInMin: 30`, while the spec says it "prints only {writer, entityKey, txHash, createMs, queryMs, found}". It's a public constant and harmless. Drop it, or add it to the spec wording.
2. LOW · `apps/web/lib/arkiv.ts:15` · claude-frontend. An `ARKIV_ACCESS_KEY` made only of spaces passes the `!env.ARKIV_ACCESS_KEY` check and would go into the URL path. `.trim()` before the check would close it.
3. INFO · friction · claude-frontend → claude-research. Not posted yet: the explorer UI routes are `/tx/<hash>`, `/entity/<key>`, `/address/<addr>` and `/entity-explorer?q=<query>`; `/entity?key=` shows an empty lookup and `/api/v2/transactions/<hash>` returns 404 (builder). Worth adding to `arkiv/friction.md` and the README query.
4. INFO · `.env.example:11` · claude-frontend. `ARKIV_RPC_URL` is listed, but `lib/arkiv.ts` uses the SDK's `rabdi()` URL and never reads it. Remove it or note that it's unused.
5. INFO · Phase 4 (FR-ARK-1) · claude-frontend. The bundle grep is clean today because no route imports `lib/arkiv.ts`. When the writer route lands, re-run the grep over `.next/static`, and consider `import "server-only"` in the route module (not in `lib/arkiv.ts` itself, because it would break the plain-Node probe).
6. The tester-added file `apps/web/test/arkiv-probe.test.mjs` belongs in this batch's commit (claude-frontend). It edits no product code.

## NEEDS THE USER
- New dependency `@arkiv-network/sdk` 1.0.1 (PIPELINE §11): approve or reject at the gate.
- Near secrets (PIPELINE §11): `lib/arkiv.ts` loads the Arkiv writer private key and the access key from the web app's server env. The redaction and refusal behaviour is tested above.
- `apps/web/tsconfig.json:16` adds `allowImportingTsExtensions: true`, a compiler-config change that batch 004 will also rely on.

## Commands used (for re-runs)
- `cd apps/web && npm test` · `npm run typecheck` · `npm run lint` (all exit 0)
- `grep -rlE "ARKIV_|rpc\.rabdi|arkiv-network" apps/web/.next/static` (no hits)
- `cd apps/web && node --env-file=../../.env --no-warnings scripts/arkiv-probe.ts` (once, exit 0)
- `node .batches/003-P1-arkiv-probe/round-1/probes/explorer.mjs <path> <shot> [waitMs]`
- Leak check (reads `.env`, prints only counts): `node <scratchpad>/leakcheck.mjs <files…>` gives `checked needles=5 hits=0` on the probe output and on every file listed under Secret hygiene.
