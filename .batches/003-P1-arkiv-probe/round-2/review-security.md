VERDICT: PASS

# Security review: 003-P1-arkiv-probe, round 2 (reviewer-security)

Scope: the round-2 changes in `apps/web/lib/arkiv.ts` and `apps/web/test/arkiv.test.mjs`, the tester-added `apps/web/test/arkiv-probe.test.mjs`, and a recheck of round 1's LOW-1 and LOW-2. I didn't run the live probe or the build, and I didn't read `.env`. Every check below ran offline with dummy keys.

There are no CRITICAL, HIGH or MEDIUM findings. LOW-1 is closed. LOW-2 is still deferred to Phase 4, as agreed in round 1. I have three new INFO notes, and none of them blocks the gate.

Reviewed file: `lib/arkiv.ts` sha256 `994b3885c230b9c970ae2bd41cb0eb48b6b8ca7619be3ba19caee2fe7cc83a80`. At 23:48:55 the on-disk file matched this hash and contained no `MUTATION` marker. See I-3 for why I checked.

## DONE (what was checked, how verified)

### LOW-1 (out-of-range key echoed by noble): closed
- The fix is at `lib/arkiv.ts:14-20`. `privateKeyToAccount` runs inside a `try`. The `catch` has no binding, so the noble error can't be passed on, and it throws a new `Error("ARKIV_PRIVATE_KEY is missing or malformed.")` with no `cause`.
- **Dummy-key check.** I copied the reviewed file byte for byte into the scratchpad and symlinked `node_modules` next to it. I then tried 17 inputs: `0x00…00`, `0xff…ff`, the curve order n, n+1, a non-hex character at the end and in the middle, the bare 64 hex, 62, 65 and 68 hex digits, empty, whitespace only, `undefined`, a quoted key, a space-padded key, a `zz` prefix and a `0X` prefix.
  - For each input I searched the message, `stack`, `util.inspect(err, {showHidden: true})` and all stdout/stderr writes. I looked for the input, its hex body, every 12-character fragment of the body and its decimal value.
  - Result: 15 of the 17 are refused with the fixed message and `cause: undefined`. No surface echoes any form of the key, and nothing is written to the console.
  - The two "hits" on `empty` and `spaces` are false positives from my harness: `""` matches every string, and three spaces match stack indentation.
  - Round 1 failed this check: `0xff…ff` and `0x00…00` were printed in decimal.
- **The tests guard it.** `test/arkiv.test.mjs:14-21` checks five bad keys, including `0x` + `ff`×32. For each one it asserts that the message names the variable, doesn't contain the input, doesn't contain the decimal form of `top`, and has `e.cause === undefined`. The tester's mutations M1, M1b, M2 and M4 (`round-2/test.md:37-47`) each fail at least one of these assertions.
- `node --experimental-test-module-mocks --test test/arkiv.test.mjs test/arkiv-probe.test.mjs`, run with the `ARKIV_*` variables unset, passes 7 of 7.

### No new path echoes a key
- The whitespace check at `lib/arkiv.ts:13` uses a fixed message. A whitespace-only key is now refused before `rabdi()` sees it, so the SDK never builds a URL ending in `/%20%20`.
- A padded key such as `"abc "` passes `.trim()`. `rabdi()` then receives it untrimmed, and the probe redacts with the same untrimmed `process.env` value, so both the raw and the encoded form match. (Node's `--env-file` trims unquoted values anyway.)
- In the accepted cases, `util.inspect(writer.account)` doesn't show the private key: viem keeps it in a closure.
- `redactArkivError` (`:31-35`) and `scripts/arkiv-probe.ts` haven't changed since round 1. The probe still prints only the redacted string (`:24`), and every `await` is inside the `try`.
- **Round-1 leak harness, rerun against the reviewed copy.** It stubs `fetch`, uses a fake key and covers 8 error cases. `redactArkivError` comes out clean in 8 of 8. The raw message leaks in 7 of 8, `inspect` in 8 of 8 and the cause chain in 8 of 8. These numbers are unchanged from round 1 and are what LOW-2 covers.

### New test files hold no real secret
- `test/arkiv.test.mjs` builds its values at runtime: `KEY = 0x${"11".repeat(32)}` and `top = 0x${"ff".repeat(32)}`. The access key is the non-hex fake `ak_test/with+chars=0123456789`.
- `test/arkiv-probe.test.mjs:9-11,22` also builds its values at runtime: the fake access key `ak_probe/with+chars=42`, `WRITER` (`"ab"`×20), `KEY` (`"cd"`×32, used as an entity key, not a private key) and a txHash (`"ef"`×32).
- The probe test mocks `arkivClients` (`:14-27`), so the probe script under test can't reach the network.
  - If the mock ever failed to apply, the real `arkivClients()` would read `process.env`. `npm test` doesn't pass `--env-file`, and the shell has no `ARKIV_*`, `*PRIVATE*` or `*SECRET*` variable names (checked by name only). So it would throw before making any network call.
  - `:61,71` sets and deletes `process.env.ARKIV_ACCESS_KEY` in the test process only.
- `grep -rnE '[0-9a-fA-F]{40,}'` over the four source and test files finds nothing (exit 1).

### NFR-3 still holds
- `lib/arkiv.ts` and the SDK are imported only by `scripts/arkiv-probe.ts` and the two test files. None of the three `"use client"` files (`app/page.tsx`, `components/HoldButton.tsx`, `components/DitherScene.tsx`) imports them.
- `NEXT_PUBLIC` appears nowhere in `apps/web` outside `node_modules` and `.next`.
- I grepped the existing `.next/static` (build 23:33, not rebuilt by me) for `ARKIV_|rpc\.rabdi|arkiv-network|db-chain\.testnet|PRIVATE_KEY|ACCESS_KEY`: no hits. Round 2 didn't change any app import, so this check still applies.
- `.env.example` is unchanged from HEAD. Its `ARKIV_PRIVATE_KEY` and `ARKIV_ACCESS_KEY` lines have an empty value plus an inline comment (I checked the shape only).

### Required grep: `grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --include=*` on the diff's files
- `apps/web/lib/arkiv.ts:16,19`: only the variable name `ARKIV_PRIVATE_KEY`.
- `apps/web/test/arkiv.test.mjs:13,17,18,25,26,27,31`: only the variable name.
- `apps/web/test/arkiv-probe.test.mjs`, `apps/web/scripts/arkiv-probe.ts`, `package.json`, `tsconfig.json` and the `+` lines of the `package-lock.json` diff: no hits.
- `spec.md:11`, `build-claude-frontend.md:6,24` and `round-2/test.md:24,42,56`: the variable name in prose.
- `build-claude-frontend.md:39,40` (entityKey `0xe14667bc…439b3d` and txHash `0x2d651b87…771e`) and `round-2/test.md:27` (the round-1 tx hashes) are public on-chain identifiers, which I verified in round 1. None of them is a key.

## OPEN

### LOW-2 (carried, Phase 4 writer route): redaction is opt-in and covers only `.message`
- Status is unchanged; see the harness numbers above. The fix is the same as in round 1. In the FR-ARK-1 batch, sanitize at the source, either with a wrapping `fetchFn` or by wrapping the client actions, and rethrow a fresh `Error(redacted)` with no `cause`. Log only that string at the route boundary, and add `import "server-only"`.
- Owner: claude-frontend, Phase 4. It doesn't block 003.

### INFO
- **I-1 (`lib/arkiv.ts:16`).** Dropping the round-1 `isHex` + length-66 check loosened the prefix check. viem 2.57.13 runs `privateKeyToAccount(k)` → `getPublicKey(k.slice(2))`, so any two leading characters are accepted (`zz<64 hex>` and `0X<64 hex>` both load). This has no security impact: nothing is echoed, and the 64 hex the operator wrote is what gets used. The comment "checks hex, length and curve range" is still true, but it doesn't cover the prefix. Optional fix: `if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw …` before the call. Owner: claude-frontend, any later batch.
- **I-2 (`lib/arkiv.ts:33`).** The redaction order is raw form first, then encoded. If an access key contains `%`, the raw form can be a substring of its own encoding. With the key `%25`, for example, the encoded `%2525` turns into `<access-key>25`, which leaves a fragment of the key in the output (verified offline). Redacting the encoded form first closes this; it's a one-line swap of the array order. Real keys are unlikely to contain `%`, so this is optional. Owner: claude-frontend, fold it into the LOW-2 work.
- **I-3 (process).** The tester ran its mutations in place on `apps/web/lib/arkiv.ts` while the reviewers were running. My first dummy-key run (about 23:46:41) loaded a mutated file: one mutant without the try/catch, then `MUTATION M2: cause passed on`. I switched to a byte-exact copy of the reviewed file and then confirmed the on-disk hash. The tester's restore proof (`round-2/test.md:47`, sha256 `994b3885…3a80`) matches my hash. Nothing is wrong now, but a mutant left behind by a crashed run would pass the noble error, which carries the key in decimal, as `cause`. Next time, mutate a scratch copy or finish the mutations before the reviewers start. ci should confirm `grep -rn MUTATION apps/web` is empty and the `lib/arkiv.ts` hash before the commit. Owner: tester / lane orchestrator.

## NEEDS THE USER (PIPELINE §11)
- The new dependency `@arkiv-network/sdk` 1.0.1 still needs your yes at the gate. Round 1's integrity, provenance and install-script checks stand, and the lockfile hasn't changed since.
- This batch handles secrets: the Arkiv writer private key and the access key are server-only env vars, and the access key travels in the RPC URL path. Carry LOW-2 into Phase 4.
