STATUS: READY

# Build report: 003-P1-arkiv-probe (claude-frontend), round 2

## DONE in round 2 (round 1: tester, security, ux PASS; code CHANGES)
- **[code F1 / security LOW-1]** `lib/arkiv.ts`: the hand check (`isHex`, length 66) is gone. `privateKeyToAccount` now validates hex, length and the curve range inside a try/catch that rethrows `"ARKIV_PRIVATE_KEY is missing or malformed."` with **no cause**. An out-of-range key such as `0x` + `ff`×32 used to reach noble's error, which printed it in decimal.
- **[code F2]** `test/arkiv.test.mjs`:
  - five bad keys (`0x1234`, the bare 64 hex without `0x`, too long, out of range, non-hex); each must name the variable, echo neither the value nor its decimal form, and have no `cause`
  - the redaction test also feeds the raw access key
  - static import, as in `dither.test.mjs`
  - mutations run by the builder: dropping the raw-form redaction fails 1 test; removing the try/catch fails 1 test
- **[tester open 2]** A whitespace-only `ARKIV_ACCESS_KEY` is refused (`?.trim()`), with a test.
- **[tester]** `test/arkiv-probe.test.mjs` (added by the tester in round 1; read by the builder; kept): 3 offline tests of the probe's exit 0 / exit 1 paths and of redaction on stderr.
- **[code LOW / tester open 1]** The spec now lists `expiresInMin` in the probe output, instead of changing a probe that already has live evidence.
- Not changed, deliberately: the indexed `note` (LOW, harmless) and the 30 s timeout. **security LOW-2** (a redacting transport wrapper, so no error object ever carries the key) goes to the Phase 4 writer route, where errors can reach server logs.
- Verified: `npm run typecheck` 0 · `npm run lint` 0 · `npm test` 23/23. The probe's create/query path is unchanged, so the round-1 live evidence stands (two runs: blocks 258050 and 258117).

# Round 1 report (kept)

## DONE
- `@arkiv-network/sdk` pinned at **1.0.1** (`npm install --save-exact`; adds 1 package). It's a new dependency, so it needs the human's yes at the gate (PIPELINE §11).
- `lib/arkiv.ts`:
  - `arkivClients(env)` returns the Rabdi (7794095) reader + writer + the public writer address.
  - A missing or malformed `ARKIV_PRIVATE_KEY`, or a missing or empty `ARKIV_ACCESS_KEY`, throws an error naming the variable, never its value. An empty access key would otherwise fall back silently to the rate-limited public endpoint.
  - `redactArkivError(err, accessKey)` strips the access key, raw and URL-encoded: the SDK puts it in the RPC URL path, and viem copies that URL into error messages.
- `scripts/arkiv-probe.ts`: creates one `mcplus.probe.v1` entity (`note`, `at`; 30-minute expiry), queries it back with `eq("at", …).ownedBy(writer)`, and prints only public values. It exits 1 if the entity isn't found, and every error is redacted.
- `test/arkiv.test.mjs`: 4 tests (RED first in the scratchpad, then GREEN):
  - a malformed key is refused without being echoed
  - an empty access key is refused
  - the clients are on chain 7794095
  - a real viem `HttpRequestError` is redacted in both forms
- `tsconfig.json`: `allowImportingTsExtensions`, so Node's type stripping can run the probe's `../lib/arkiv.ts` import and tsc still checks it. Batch 004 needs the same flag for its server tests.

## Verified
- `npm run typecheck` 0 · `npm run lint` 0 · `npm test` 20/20 · `npm run build` 0 (routes `/`, `/_not-found`).
- Client bundle: `grep -rlE "ARKIV_|rpc\.rabdi|arkiv-network" .next/static` finds nothing.
- **Live probe (23:34 IST)**, `node --env-file=../../.env scripts/arkiv-probe.ts`, exit 0:
  - writer `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` (funded with 10 tGLM by the human)
  - entityKey `0xe14667bcbc6eebeb4035014b82fd691d861130abbdc8a9ac01ea64ba2e439b3d`
  - txHash `0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e`
  - createMs 3189, queryMs 285, found true
- Receipt read over the RPC: status success, block 258050, from the writer, to `0x4400000000000000000000000000000000000044`, gasUsed 124618, mined 23:34:18 IST.
- The explorer API at `https://rabdi.explorer.arkiv.network/api/v2/transactions/<hash>` returns 404 (it isn't the Blockscout v2 path). The tester should check the explorer UI.

## Not done / notes
- The entity expires 30 minutes after creation (about 00:04 IST). Re-running the probe makes a fresh one; each run costs a little tGLM.
- Friction was sent to claude-research at 22:54 for `arkiv/friction.md`. To add: the explorer API path doesn't match Blockscout v2.

## After the round-2 verdicts (before ci)
- [review-code R2 L1] `test/arkiv-probe.test.mjs:48` now pins the exact output keys (the 6 originals plus `expiresInMin`), so a probe that printed an env value as an extra field fails. Test-only; the reviewer said no new round is needed. `npm test` 23/23.
- Deferred to the Phase 4 writer route, with LOW-2: security I-2 (redact the URL-encoded form before the raw one, so a key containing `%` leaves no fragment) and code L2 / security I-1 (`privateKeyToAccount` doesn't check the `0x` prefix; nothing leaks).
