VERDICT: CHANGES

# Code review: 003-P1-arkiv-probe, round 1 (reviewer-code)

Scope: `git diff -- apps/web` (package.json, package-lock.json, tsconfig.json) plus the untracked `apps/web/lib/arkiv.ts`, `apps/web/scripts/arkiv-probe.ts` and `apps/web/test/arkiv.test.mjs`. I checked the SDK calls against the installed source in `apps/web/node_modules/@arkiv-network/sdk/src` (1.0.1). I did not run the live probe or `npm run build`, and I did not read `.env`.

Two small fixes are needed, both in claude-frontend's files, both unit-test-only. Neither changes the happy path, so the live probe does not need another run (and another tGLM spend) after they land.

## Findings (CHANGES)

### F1 (MEDIUM) `apps/web/lib/arkiv.ts:13,17`: out-of-range keys get past the shape check, and the error then neither names the variable nor hides the value
- **What:** line 13 checks only `isHex` and length 66. `0x00…00` and `0xff…ff` (and anything at or above the curve order) pass, and `privateKeyToAccount` at line 17 then throws noble's `expected valid private key: 1 <= n < 1157…, got <the key as a decimal>`. I reproduced it through `arkivClients()`: for both keys the message does not contain `ARKIV_PRIVATE_KEY`, and for `0xff…ff` it prints the value.
- **Why:** the spec AC says a malformed `ARKIV_PRIVATE_KEY` "throws an error that names the variable and never echoes its value". No real key leaks this way (an out-of-range value can't be a valid key), but the AC as written is false, and the probe would print noble's text through `redactArkivError`, which only strips the access key.
- **Fix:** let viem do all the validation (hex, length, range) and rethrow without the cause. This replaces the hand check, the magic 66 and the `isHex` import:
  ```ts
  let account: PrivateKeyAccount; // import type { PrivateKeyAccount } from "viem/accounts"
  try { account = privateKeyToAccount(env.ARKIV_PRIVATE_KEY as Hex); }
  catch { throw new Error("ARKIV_PRIVATE_KEY is missing or malformed."); } // viem's message can carry the key
  ```
  (Or keep line 13 and wrap only line 17. Either is fine.)
- **Owner:** claude-frontend

### F2 (MEDIUM) `apps/web/test/arkiv.test.mjs:12-19,33-41`: three regressions pass the tests
I ran the 4 tests against mutated copies of `lib/arkiv.ts` in the scratchpad (the repo was not touched):

| Mutation | Caught? |
|---|---|
| redaction removed | yes |
| only the raw form replaced (encoded dropped) | yes |
| empty access key accepted (`=== undefined` guard) | yes |
| access-key guard deleted | yes |
| whole private-key check deleted | yes |
| **only the encoded form replaced (raw dropped)** | **no** |
| **length check deleted** | **no** |
| **`isHex` check deleted** | **no** |

- **Why:** the AC says the redaction test "checks both forms", but the test only feeds an error holding the encoded form, so the raw-form replacement is never exercised. The one malformed key (`0xnot-a-key-but-secretish`) fails both `isHex` and the length check, so neither check is tested alone.
- **Fix (a few lines in the existing tests):**
  - redaction: `assert.ok(!redactArkivError(new Error(\`raw ${ACCESS}\`), ACCESS).includes(ACCESS))`
  - key: add a hex key of the wrong length (`0x1234`), a key without the `0x` prefix (`"11".repeat(32)`, the usual `.env` slip), and, once F1 is in, an out-of-range one (`0x` + `"ff".repeat(32)`). Assert `/ARKIV_PRIVATE_KEY/` and that the message doesn't include the input. Build the inputs at runtime as the file already does, so no 64-hex literal sits in the file.
- **Owner:** claude-frontend

## Optional (LOW, not blocking)
- `apps/web/scripts/arkiv-probe.ts:21`: the output adds `expiresInMin`, but the spec lists exactly `{writer, entityKey, txHash, createMs, queryMs, found}`. It's public and harmless. Drop it, or the orchestrator adds it to the spec line. Pick one so the spec and the code agree.
- `apps/web/scripts/arkiv-probe.ts:9`: `note: str().indexed()`. Nothing filters on `note`, so `.indexed()` is unused. `at` does need its index (it's the `where`).
- `apps/web/lib/arkiv.ts:8`: `ARKIV_TIMEOUT_MS = 30_000` is 3x viem's default with no stated reason. Add a reason (the 2.5 h outage, slow receipts) or use plain `http()`.
- `apps/web/test/arkiv.test.mjs:7`: a dynamic `await import(...)` where `dither.test.mjs` uses a plain static import of a `.ts` lib. A static import does the same with less code.

## Checked and fine
- **SDK 1.0.1 calls are correct.**
  - `createEntity(schema, values, options)`: the decorator in `clients/decorators/arkivWallet.ts:109-114` takes schema, values, options and optional txParams, and returns `{entityKey, txHash, expiresAt}`. The values accept bare or typed input (`ColumnInput = ValueOf | BareOf`, `schema/schema.ts:197`), so `note: "dep-5 probe"` and `at: u64(at)` are both valid. It waits for the receipt (`utils/arkivTransactions.ts:196`) and takes the key from the decoded `EntityCreated` log.
  - `ExpirationTime.fromMinutes(30)` gives 1800 s, which `toBlocks` turns into 900 blocks at `BLOCK_TIME = 2`. It's a whole multiple, so it isn't rejected, and it's far below `MAX_LIFETIME`.
  - `defineSchema("mcplus.probe.v1", {...})`: the two-argument form is a tagged schema, and the name is validated as a `str` of 128 bytes or less.
  - `select({...}).from(Probe).where(eq("at", u64(at))).ownedBy(address).limit(5).fetch()`: `from` adds the schema tag filter, `where` after `from` requires an indexed column (`at` is one), `ownedBy` adds an `$owner` filter, `limit` must be 1 to 100, and `fetch` returns a `QueryResult` with `.entities`.
  - `rabdi({ accessKey })` URL-encodes the key into the RPC path (`chains/rabdi.ts:45`) and only warns on `""`, so refusing an empty key at `lib/arkiv.ts:15` is right.
- **`found` proves the read path.** The key comes from the write receipt's log. The match comes from a separate `arkiv_query` call that the node filters by schema tag, `at` value and owner. Through `.from(Probe)` (default `onMismatch: "skip"`), an entity that didn't decode against `note`/`at` would be skipped, so `found: true` also means the stored values decoded. The only failure mode I see is a false negative if the node's query view lagged the receipt block, which would exit 1 rather than pass wrongly. The live run (285 ms, found) shows it didn't.
- **Exit codes:** `process.exitCode = 1` when not found (the JSON is still printed) and on any throw, including env errors, since `arkivClients()` is inside the `try`. It's 0 otherwise. Top-level `await` sits inside the `try/catch`, so there's no unhandled rejection. Only `err.message` is printed (no `cause`, no `body` object), and it goes through `redactArkivError`. viem's `HttpRequestError` prints the URL unchanged (`getUrl` only strips userinfo), so the encoded form is the one that shows up, and it's covered.
- **`allowImportingTsExtensions`:**
  - It's required. With it off, `tsc` fails with TS5097 at `scripts/arkiv-probe.ts:7`.
  - It has no emit effect, because `noEmit: true` is already set (TypeScript requires one of the two).
  - Next 16 doesn't touch it. No reference in `next/dist` outside the docs, and Next's own Vite-migration guide puts it in a Next tsconfig. Turbopack resolves explicit `.ts` specifiers.
  - `npx tsc --noEmit` exits 0, and `--listFilesOnly` confirms the probe and the lib are type-checked.
  - I considered a `.mjs` probe, which would need no flag (the tests already import `.ts` that way), but it would lose type checks on the SDK calls. Those checks are worth the one line.
- **NFR-3:** nothing under `app/` or `components/` imports `lib/arkiv.ts` or `@arkiv-network/sdk`. The builder's `.next/static` grep came back clean. `server-only` is correctly not added yet: it would throw under plain Node and break the probe and the tests. Phase 4's writer route is where that boundary matters.
- **NFR-8:** the entity holds a fixed note and a unix timestamp, owned by the writer. No personal data.
- **Dependency:** the lockfile adds only `@arkiv-network/sdk@1.0.1` (exact, with integrity hash). There are no transitive packages, and the `viem ^2` peer is met by 2.57.13. It still needs the human's yes at the gate (PIPELINE §11).
- **Scope:** every file traces to DEP-5, NFR-3, NFR-8 or SR-ARK-1. Nothing from FR-ARK-1–5 or FR-PRIV-2 was built. There's no contract ABI in this batch, so ARCHITECTURE §2 doesn't apply. The probe schema is separate from §5's `mcplus.offer.v1`, as it should be.
- **Verified by me:** `node --test test/arkiv.test.mjs` passes 4/4, `npx tsc --noEmit` exits 0, and `npx eslint` on the three files exits 0.
- **Note (pre-existing, not this batch):** Node prints `MODULE_TYPELESS_PACKAGE_JSON` on stderr when it loads `lib/*.ts`, because `apps/web/package.json` has no `"type"`. `dither.ts` already triggers it. Adding `"type": "module"` would change how the Next and PostCSS configs load, so leave it alone.

## Report
DONE: review written at this path. Findings are verified by mutation runs in the scratchpad and by a direct `arkivClients()` call with out-of-range keys.
OPEN: F1 and F2 (claude-frontend). After the fixes, `npm test` reruns, and the live probe does not need another run.
NEEDS THE USER: the new dependency `@arkiv-network/sdk@1.0.1` (PIPELINE §11).
