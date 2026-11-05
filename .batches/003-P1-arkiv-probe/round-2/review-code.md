VERDICT: PASS

# Code review: 003-P1-arkiv-probe, round 2 (reviewer-code)

Scope: the untracked `apps/web/lib/arkiv.ts`, `apps/web/test/arkiv.test.mjs` and `apps/web/test/arkiv-probe.test.mjs` (the tester's file, which I review here for the first time), plus `git diff` on `package.json`, `package-lock.json` and `tsconfig.json`, which are unchanged since round 1. `scripts/arkiv-probe.ts` is byte-identical to round 1: its sha256 `4a8f8541…a1c` matches the tester's round-1 hash. I did not run the live probe or `npm run build`, and I did not read `.env`.

Both round-1 findings are fixed. Every mutation that got past the round-1 tests is now caught. Nothing regressed. The four notes below are LOW or INFO and none blocks the batch. L1 is a one-line test change worth folding in before the commit.

## Round-1 findings

### F1 (out-of-range key): FIXED
- `lib/arkiv.ts:14-20`: the `isHex`/length-66 check is gone. `privateKeyToAccount` sits in a `try`, and the bare `catch {}` rethrows `"ARKIV_PRIVATE_KEY is missing or malformed."` with no cause. This is the fix I proposed in round 1.
- Checked directly in a scratch mirror against the clean file. `0x00…00`, `0xff…ff`, `""`, `"0x"`, a missing key, a key with a trailing space and a key with a leading space are all refused with that message and `cause: undefined`. noble's decimal text no longer gets out.

### F2 (test gaps): FIXED
- `test/arkiv.test.mjs:15`: five bad keys (non-hex, `0x1234`, 64 hex with no `0x`, one byte too long, out of range). Each one must name the variable, must not echo the input or its decimal form, and must have no `cause`.
- `test/arkiv.test.mjs:44-45`: the raw form is now fed in and checked exactly.
- `test/arkiv.test.mjs:7`: static import, as in `dither.test.mjs`.

Mutation matrix. I mutated a copy of the clean `lib/arkiv.ts` (sha256 `994b3885…`) in the scratchpad and ran both arkiv test files against it, 7 tests:

| Mutation | Result |
|---|---|
| none (baseline) | 7/7 pass |
| raw-form redaction dropped (the round-1 survivor) | **caught**, 1 fail |
| encoded-form redaction dropped | caught, 2 fail (both test files) |
| try/catch removed | caught |
| cause passed on (`{ cause }`) | caught |
| viem's message appended to the error | caught |
| variable name dropped from the message | caught |
| `.trim()` dropped | caught (whitespace test) |
| access-key guard deleted | caught |
| `=== undefined` guard (empty key accepted) | caught |
| redaction skipped for non-`Error` values | survives (see L3) |

The round-1 survivors "length check deleted" and "`isHex` check deleted" no longer apply, because those checks are gone. The equivalent question now is whether each bad shape is refused, and the five-key loop answers it. The round-1 shape regex with no try/catch also fails on the out-of-range key.

Probe mutations (on a copy of `scripts/arkiv-probe.ts`, run against `test/arkiv-probe.test.mjs`): dropping the not-found `exitCode`, dropping the catch `exitCode`, printing the raw `err.message`, and `found = entities.length > 0` are each caught. Adding a field to the output or dropping `expiresInMin` survives (L1).

## Findings (none blocking)

### L1 (LOW) `apps/web/test/arkiv-probe.test.mjs:48`: "prints only" is not asserted
- **What:** the test checks that the six round-1 fields are present (`k in printed`). It doesn't check that nothing else is printed, and it doesn't include `expiresInMin`, which the spec now lists. I mutated the probe to print `key: process.env.ARKIV_PRIVATE_KEY` as an extra field, and all 3 tests still pass.
- **Why:** the spec AC says the probe "prints only `{writer, entityKey, txHash, createMs, queryMs, found, expiresInMin}`", and the point of "only" is that no secret ends up on stdout. The live run in round-1 `test.md` (7 fields, leak check 0 hits) proves the AC today. This test is the guard against a later edit.
- **Fix:** replace line 48 with one line:
  `assert.deepEqual(Object.keys(printed), ["writer", "entityKey", "txHash", "createMs", "queryMs", "found", "expiresInMin"]);`
  This kills both surviving mutations.
- **Owner:** claude-frontend (the file is in that lane's commit). Fold it in before the commit. It doesn't need another round.

### L2 (LOW) `apps/web/lib/arkiv.ts:16`: viem never checks the `0x` prefix
- **What:** `privateKeyToAccount` runs `privateKey.slice(2)` and validates only the 64 characters after the first two (`viem/_esm/accounts/privateKeyToAccount.js:17`, viem 2.57.13). In the mirror, `0X…`, `zz…` and two spaces followed by 64 hex are all accepted and give the same address as the `0x` form. The round-1 `isHex` check refused them. I didn't catch this when I proposed the fix in round 1.
- **Why it doesn't block:** nothing leaks, and the account signs with exactly the 64 hex the user typed, so there's no wrong-key or money risk. The usual slip (64 hex with no prefix) is still refused, because slicing leaves 62 characters, and the test covers that case. Only a literal reading of "malformed throws" breaks.
- **Fix, if wanted:** add `!env.ARKIV_PRIVATE_KEY?.startsWith("0x") ||` to a guard before the `try`, or narrow the comment on line 16 to "checks length, hex and curve range after the 0x".
- **Owner:** claude-frontend. Optional.

### L3 (INFO) `apps/web/test/arkiv.test.mjs:46`: the non-`Error` path is only tested with a string that has no key in it
- A mutation that redacts only `Error` messages survives. viem always throws `Error` subclasses, so this is close to theoretical. If you want it covered: `assert.equal(redactArkivError(\`x ${ACCESS}\`, ACCESS), "x <access-key>")`. Owner: claude-frontend. Optional.

### I1 (INFO, process) in-place mutation raced with this review
- At 23:46 the repo's `lib/arkiv.ts` held another agent's mutants ("MUTATION M1b", then "MUTATION M2"). My first copy picked one up and failed 1 test. I switched to a copy rebuilt from my first read, whose sha256 matches the `994b3885…` I took before the mutations. By the end of this review the repo file was back to `994b3885…`, and `npm test` gave 23/23 on it.
- Parallel reviewers who run `npm test` in the repo while a mutant is in place get false results. Next time, testers should mutate in a scratch mirror (symlink `node_modules`, copy `lib/`, `scripts/`, `test/`). Owner: tester/orchestrator.

### Spec note (INFO) `spec.md` "Files"
- `test/arkiv-probe.test.mjs` isn't in the Files list, but it is in this batch (tester OPEN 6, builder kept it). The orchestrator should add it so the commit and the spec agree. No scope creep: it only tests the probe's own AC.

## Round-1 LOWs
- `expiresInMin`: resolved through the spec wording.
- `.indexed()` on `note`: kept on purpose. Harmless.
- `ARKIV_TIMEOUT_MS = 30_000` (`lib/arkiv.ts:8`): kept, still with no stated reason. A short comment (Rabdi receipts were slow during the outage) would explain it. Not blocking.
- Static import: done.

## Checked and fine
- **Scope:** every change traces to DEP-5, NFR-3, NFR-8 or SR-ARK-1. Nothing from FR-ARK-1–5 or FR-PRIV-2 was built. There's no contract ABI in this batch, so ARCHITECTURE §2 doesn't apply. The whitespace-key refusal is inside the existing AC ("missing or empty").
- **`lib/arkiv.ts`:** the access key is checked before the private key, so a missing key gives the right message. A missing private key hits `undefined.slice`, which the `catch` turns into the generic message. `let account;` is narrowed by control flow, because the `catch` always throws. `tsc` is happy and no annotation is needed.
- **`test/arkiv-probe.test.mjs`:**
  - Runs offline: no RPC, no tGLM.
  - `mock.module` needs `--experimental-test-module-mocks`, which was already in the `test` script before this batch. If the `exports` option weren't supported, the probe's named imports would fail loudly rather than pass.
  - Each case imports the probe under a fresh `?case=` URL, so its top-level code runs once per test, and `exitCode` and console are reset in `finally`.
  - The not-found case uses an entity with a different `$key`, so `found = any entity` is caught.
  - Test 3 sets and then deletes `process.env.ARKIV_ACCESS_KEY` for the probe's redaction call.
  - Each test file runs in its own process, so the module mock doesn't leak into other files.
- **No secrets** in the test files: fixed fake keys built at runtime, and the failure label prints only `bad.slice(0, 12)` of those fakes.
- **Verified by me:**
  - `npm test`: 23 tests, 23 pass, 0 fail (on `lib/arkiv.ts` sha256 `994b3885…`, checked before and after the run)
  - `npx tsc --noEmit`: exit 0
  - `npx eslint` on the four arkiv files: exit 0
  - the mutation matrices above
  - The scratch mirror and scripts are in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/r2mut/` (`mut.mjs`, `mutp.mjs`, `prefix.mjs`). I didn't touch the repo.

## Report
DONE: F1 and F2 are fixed and verified by mutation (above). The probe is unchanged since round 1, so the round-1 live evidence still stands.
OPEN: L1 (one line in `test/arkiv-probe.test.mjs`, before the commit) and the optional L2 and L3, all claude-frontend. I1 goes to the tester/orchestrator. The spec Files line goes to the orchestrator.
NEEDS THE USER: the new dependency `@arkiv-network/sdk@1.0.1` (PIPELINE §11). Unchanged from round 1.
