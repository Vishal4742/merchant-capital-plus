VERDICT: PASS

# Security review: 003-P1-arkiv-probe, round 1 (reviewer-security)

Scope: `git diff -- apps/web` (package.json, package-lock.json, tsconfig.json) plus the untracked `apps/web/lib/arkiv.ts`, `apps/web/scripts/arkiv-probe.ts` and `apps/web/test/arkiv.test.mjs`. I didn't run the live probe or `npm run build`, and I didn't read `.env`. This batch has no contracts, relayer, webhook or UI, so those checklist items don't apply.

No CRITICAL, HIGH or MEDIUM findings. There are two LOW items and three INFO notes. None of them blocks the gate.

## DONE (what was checked, how verified)

### NFR-3: the writer key stays on the server
- Nothing in app code imports `lib/arkiv.ts` or `@arkiv-network/sdk`. A grep over `apps/web` (excluding node_modules and .next) finds only `scripts/arkiv-probe.ts:4-7`, `lib/arkiv.ts:3-4` and `test/arkiv.test.mjs:7`. The three `"use client"` files (`app/page.tsx`, `components/HoldButton.tsx`, `components/DitherScene.tsx`) import neither.
- `NEXT_PUBLIC` appears nowhere in `apps/web` (sources and config).
- I grepped `.next/static` for `ARKIV_|rpc\.rabdi|arkiv-network|db-chain\.testnet|hub\.arkiv|PRIVATE_KEY|ACCESS_KEY`: no files (exit 1). `.next/server` has no hits either. The existing build (`BUILD_ID` 23:33:58) is newer than the sources (23:33:27), so the grep covers this diff.
- `.env` is git-ignored (`.gitignore:29`, `apps/web/.gitignore:34 .env*`). No `.env` file is tracked. The tracked `.env.example` has empty `ARKIV_PRIVATE_KEY=` and `ARKIV_ACCESS_KEY=` placeholders and isn't changed by this batch.

### Secret leakage through the access key in the RPC URL
- SDK source: `node_modules/@arkiv-network/sdk/dist/chains/index.js`. `rabdi()` builds the path as `/${encodeURIComponent(accessKey)}` for both `http` and `wss`. Its only `console.warn` fires on `accessKey === ""`, and `lib/arkiv.ts:15` refuses an empty key, so it never fires. `MissingAccessKeyError` doesn't echo the key.
- viem 2.57.13, `_esm/errors/utils.js` `getUrl`: the URL comes back unchanged unless it has basic-auth credentials. `HttpRequestError`, `WebSocketRequestError` and `RpcRequestError` put `URL: …` into `metaMessages`, and those end up in `.message`. The URL is also kept as an enumerable `.url` property.
- Is raw plus `encodeURIComponent` enough? Yes, for this code path. The only form that reaches a message is `encodeURIComponent(key)`, because `getUrl` returns it as is. Even with basic auth, WHATWG `URL.toString()` leaves existing `%XX` escapes and the `!~*'()` characters alone, so the encoded form survives unchanged. The raw form covers anything that echoes the key directly. `replaceAll` with a string argument is literal, so regex characters in the key can't break it.
- **Offline end-to-end check.** I ran a scratchpad script that stubs `globalThis.fetch`, uses a fake access key `fakeAK_q/r+s=t` and drives the probe's real `createEntity` and `select…fetch()` paths. No network was used. It tried four failure modes: HTTP 500, a thrown `fetch failed`, a JSON-RPC error, and `eth_blockNumber` succeeding before a JSON-RPC error. That gives 8 error cases (the error types were `HttpRequestError`, `InvalidInputRpcError` and `EntityMutationError`). Results:
  - `redactArkivError(err)`: clean in 8/8.
  - raw `err.message`: leaks the key in 7/8.
  - `util.inspect(err)`: leaks in 8/8.
  - the cause chain (`.message` and `.url`): leaks in 8/8.

  The probe prints only `redactArkivError(err, process.env.ARKIV_ACCESS_KEY)` (`scripts/arkiv-probe.ts:24`). Every `await` is inside the `try` (lines 12-26), so no error object reaches Node's uncaught-error printer, and no stack is printed. The success output (`:21`) contains only public values. **This batch's output is clean.** The leaks in `.message`, inspect and the cause chain matter later; see LOW-2.
- Other places the URL could surface:
  - The SDK's debug logger (`dist/query-LMk-y9L8.js:7-16`) is off unless `DEBUG=arkiv:*` is set. When on, it logs payloads, operations, receipts and `error.shortMessage` (`dist/index.js:680`). Short messages leave out `metaMessages`, so the logger never prints the URL or the key.
  - The SDK's `console.error` default (`watchEntityEvents`, `dist/index.js:360`) is never called here.
  - The SDK has no telemetry. Its only network path is the viem transport. The `fetch(` hits in its dist are query-builder methods, not network calls, and the other URLs in it are documentation strings.
- Test `test/arkiv.test.mjs:33-41` builds a real viem `HttpRequestError`. It proves that viem copies the encoded key into the message and that redaction removes both forms.

### Env validation messages
- `lib/arkiv.ts:13` says "ARKIV_PRIVATE_KEY is missing or malformed." and `:15` says "ARKIV_ACCESS_KEY is missing.". Neither includes the value. They are tested at `test/arkiv.test.mjs:12-24`. One edge case gets through: see LOW-1.

### Dependency integrity (`@arkiv-network/sdk` 1.0.1)
- The pin is exact: `"1.0.1"` in package.json, and the lockfile adds the root dependency plus one package entry.
- The lockfile integrity `sha512-DCOFdGunn4I5nYrvIV/YIkMCkLZM7EQNSyNPtqpmQkP2JzTEfRLBJleBSB2rokWMa833/9P8DMiwsEXACr3CUQ==` matches `npm view … dist.integrity`. I also downloaded the tarball with curl into an empty scratch folder and hashed it: same sha512, sha1 `6381ca28a62b91be1554ecfbc923c7079410842d`. `diff -rq` against `node_modules/@arkiv-network/sdk` shows the installed tree is identical to the registry tarball.
- `npm audit signatures`: 384/384 packages have verified registry signatures (0 invalid, 0 missing), and 97 have verified attestations, the SDK among them. The SLSA provenance points to `github.com/Arkiv-Network/arkiv-sdk-js`, `refs/heads/main`, `.github/workflows/ci.yml`. It was published by GitHub Actions OIDC trusted publishing. Maintainers: seequ and krzysiek-golem (golem.network). Published 2026-11-02T19:53Z; it carries the `latest` tag.
- There are no install scripts: lockfile `hasInstallScript: false`, and the package has no `preinstall`, `install` or `postinstall`. `prepublishOnly` and the rest run only on the publisher's side.
- It has no runtime dependencies (`dependencies {}`, `optionalDependencies {}`). The peer dependencies are `viem ^2.0.0`, satisfied by 2.57.13, and `typescript >=5.0.0`, which is optional.
- `npm audit` reports 8 moderate issues, all in the eslint toolchain (`minimatch` via `typescript-eslint` and `eslint-config-next`). They predate this batch, are dev-only, and none is in the SDK.

### NFR-8: no personal data in the entity
- Schema `mcplus.probe.v1` has two attributes: `note` (the fixed "dep-5 probe") and `at` (unix seconds). The SDK adds only the `arkiv.schema` tag and a random salt (`dist/schema-B-qj25Fz.js:925-941`).
- I checked the live transaction on chain over the public keyless RPC, with a read-only call: `eth_getTransactionByHash 0x2d651b87…771e`. The calldata is 996 bytes, and its printable strings are exactly `arkiv.schema`, `mcplus.probe.v1`, `note` and `dep-5 probe`. The receipt has status 0x1 at block 258050. No PII.

### Required grep: `grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the diff's files
- `apps/web/lib/arkiv.ts:12,13`: the variable name `ARKIV_PRIVATE_KEY` only.
- `apps/web/test/arkiv.test.mjs:13,16,17,22,23,27`: the variable name only. The test key is built at runtime (`"11".repeat(32)`), and the fake access key isn't hex.
- `package.json`, `package-lock.json` (diff hunk), `tsconfig.json` and `scripts/arkiv-probe.ts`: no hits.
- The batch markdown has two 64-hex hits, both public on-chain identifiers, not keys:
  - `build-claude-frontend.md:24`, the entityKey `0xe14667bc…439b3d`. It appears in the receipt logs of the transaction below.
  - `build-claude-frontend.md:25`, the txHash `0x2d651b87…771e`. The public RPC resolves it as a transaction.

### Other checks
- The probe spends only bounded resources. It is one-shot, the expiry is 30 minutes (`scripts/arkiv-probe.ts:10,16`), and the SDK estimates gas before sending, so a reverting create never broadcasts. Gas gets 25% headroom, capped at 2^24 (`dist/index.js:614-623`, `consts`). The per-request timeout is 30 s (`lib/arkiv.ts:8,18`).
- `allowImportingTsExtensions` has no security effect, because `noEmit` is true.
- The unit tests make no network calls: `arkivClients()` only builds clients, and the redaction test builds its error locally.

## OPEN (findings)

### LOW-1: an out-of-range private key is echoed in decimal (`apps/web/lib/arkiv.ts:17`)
- **What.** Line 13 accepts any 66-character hex string. `privateKeyToAccount(key)` then calls noble-curves 1.9.1 (`esm/abstract/utils.js:194`), which throws `expected valid private key: 1 <= n < …, got <key as decimal>` when the key is 0 or ≥ n. The probe prints that message as is, because redaction covers only the access key. I verified this with dummy keys `0x00…00` and `0xff…ff`: both values were echoed.
- **Exploit sketch.** None in practice. A scalar that is 0 or ≥ n can't be anyone's private key, and a typo landing in that range has odds of about 2^-128. It does contradict the spec's "never echoes its value", and the error doesn't name the variable.
- **Fix (one line).** Wrap the call: `try { account = privateKeyToAccount(key) } catch { throw new Error("ARKIV_PRIVATE_KEY is missing or malformed.") }`. Add one assertion to the existing malformed-key test with `0x${"ff".repeat(32)}`.
- **Owner.** claude-frontend. It can ride along in any later batch.

### LOW-2 (forward-looking, Phase 4 writer route): redaction is opt-in and covers only the message string
- **What.** See the offline check above: the raw `err.message` (7/8 cases), `util.inspect(err)` (8/8) and the `err.cause` chain and its `.url` (8/8) all carry the access key. Of the error types, only `EntityMutationError`'s own message is clean, and its cause still holds the URL. The probe is safe because it prints one redacted string.
- **Exploit sketch.** In Phase 4, a server route that lets an Arkiv error throw, or logs it with `console.error(err)`, sends the full inspected error, with URL and access key, into the server or hosting logs. Anyone with log access could then reuse the key against Rabdi under our quota. Per `.env.example` the key is origin-restricted and the note calls it "not a secret", so the impact is quota abuse, not funds. The writer private key is never at risk this way.
- **Fix when the writer route lands.** Sanitize at the source, not in each caller. Inside `arkivClients`, either pass a wrapping `fetchFn` to viem's `http()` or wrap the client actions, so any thrown error is rethrown as a fresh `Error(redactArkivError(err, key))` with no `cause`. At the route boundary, log or return only that string. Also add `import "server-only"` to `lib/arkiv.ts` in the same batch; it breaks the Next build if a client component ever imports the file. Plain Node tests and the probe would then need `--conditions=react-server`. Check whether Next's built-in alias resolves `server-only` or whether the package must be installed; installing it is a new dependency and needs the human's yes.
- **Owner.** claude-frontend, Phase 4 (FR-ARK-1) batch. It doesn't block 003.

### INFO
- I-1: there's no `server-only` guard today. That is acceptable for now: nothing imports the file from app code, Next doesn't inline non-`NEXT_PUBLIC_` env into browser bundles, and the `.next/static` grep is clean. Covered by LOW-2's fix.
- I-2: the probe prints an extra `expiresInMin` field (`scripts/arkiv-probe.ts:21`) that the spec's output list doesn't include. It's a public constant with no security impact; whether it stays is the code reviewer's call.
- I-3: the SDK reads `globalThis.localStorage` to check `DEBUG`, so Node 26 prints an `ExperimentalWarning` about localStorage on stderr. It's harmless and leaks nothing.

## NEEDS THE USER (PIPELINE §11)
- A new dependency, `@arkiv-network/sdk` 1.0.1, needs your yes at the gate. The integrity, provenance and no-install-script checks above all pass.
- This batch touches secrets: `ARKIV_PRIVATE_KEY` and `ARKIV_ACCESS_KEY` are server-only env vars, and the access key travels in the RPC URL path. LOW-2 is the item to carry into Phase 4.
