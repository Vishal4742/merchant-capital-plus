VERDICT: CHANGES

# Code review: 001-P1-web-rail-proofs, round 1 (reviewer-code)

Scope: everything under `apps/web/` except node_modules and .next (all untracked), plus the tracked edit to `docs/FRONTEND-PLAN.md`. I read every source and config file in full. I also read the harness host (`node_modules/@anon-rpc/browser-harness/dist/host.js`) and viem's retry path, because the open questions depend on them. The tester's 9 findings stand, and I don't repeat them below. I only extend #1 and #7, where the source changes the fix. No `.env` value was read or printed.

## Checks
1. **Traceability.** Each file maps to NFR-11 (scaffold), DEP-6/FR-PRIV-1 (`lib/anon.ts`), DEP-3 (`lib/guest-wallet.ts`) or the proof page. Tor, CSP, `iframeUrl`, the meter and design were left out as the spec requires. One file was edited outside the spec's file list: R5. `next.config.ts` (`cacheComponents`, `partialPrefetching`, turbopack CSS rule) is not scope creep. It is byte-for-byte what create-next-app 16.4.3 writes for its defaults; I checked against the cached template in `~/.npm/_npx/18aab40df0b74b53/.../create-next-app/dist`.
2. **ABI (ARCHITECTURE.md §2).** No contract from §2 is called in this batch. The only on-chain shape is USDT `ReceiveWithAuthorization` (§7), which I checked on-chain. `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` (selector `0x7f2eecc3`) on `0xcedfB561…55a7` via Ankr returns `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8`, which equals keccak256 of the type string encoded by `receiveTypes` (guest-wallet.ts:23-32). The tester already matched the domain separator. viem 2.57.13 `whitechainSepolia` has id 1874 and multicall3 `0xcA11…CA11`, matching §7, so the `batch: { multicall: true }` that §4 requires will batch in Phase 2. One doc mismatch: R6.
3. **Logic.** Checked with no finding:
   - SSR and client both start in `running`, so hydration matches.
   - StrictMode's double effect shares one client promise (`??=`).
   - The dynamic import keeps the harness out of SSR.
   - Passing `worker.fetch` unbound is safe, because the harness binds it (host.js:572).
   - `isHex` is strict by default, plus the 66-character length check.
   - The button is hidden while a run is in flight, so no run can overlap.
4. **Ponytail.** The code is small. R7 and R8 are the leftovers.
5. **Tests.** The 5 DEP-3 tests pass (`node --experimental-test-module-mocks --test test/` → pass 5, fail 0). They miss the type hash (R3). `lib/anon.ts` has no check at all, which is how the false "retry works" claim got through (R1c).

Re-run here: `npx tsc --noEmit` exit 0, `npm run lint` exit 0 (Node v26.10.0). I skipped `npm run build` so I wouldn't disturb the tester's running :3100 server; ci runs it.

## OPEN (findings)

**R1 [MEDIUM] Tester #1's fix is needed but not enough.** `apps/web/lib/anon.ts:20-39`. Owner: claude-frontend.
- (a) **`worker.close()` on failure is required, not optional.** `#fail` (host.js:577) rejects the calls but never removes the iframe or the window `message` listener. Only `close()` does that (host.js:737-740). The iframe is appended before boot completes (host.js:615). So for a failure after that point (`worker-error` host.js:608, `boot-error` :626, `failed` :629), the forget-and-retry path would leave the dead sandboxed iframe and its Web Worker behind on every Run again, and the next boot adds another. Fix: in the `.catch` of `getChainClient`, close the worker before clearing `client`. That means `connect()` has to make the worker reachable on failure, for example `await worker.ready.catch((e) => { worker.close(); throw e; })` inside `connect()`.
- (b) **A worker that dies after `ready` stays cached for the page's lifetime.** Per the harness comment at host.js:558 ("boot failure, worker crash, close"), `worker-error` and `failed` can fire after a successful boot. Every later `worker.fetch` then throws the stored failure (host.js:693-694), and `getChainClient` keeps returning the dead client. Harness 0.4.0 has no public "failed" signal after `ready` resolves. The lazy fix is a `ponytail:` comment on `getChainClient`: "a worker that dies after ready stays cached until reload; harness 0.4.0 exposes no failure signal after ready." Name the upgrade trigger too: when Phase 2 boots one worker per app, watch for the failure (`acceptLog()` rejects once the log queue is closed with the failure) and reset there. Don't build that now.
- (c) **Ship the fix with one check.** Add a small `node:test` that mocks the harness with `mock.module("@anon-rpc/browser-harness", …)`, the same pattern as `test/guest-wallet.test.mjs`. Give it a fake `AnonRpcWorker` whose first `ready` rejects and whose second resolves, then assert: the first `getChainClient()` rejects, the first fake was `close()`d, and the second call builds a new worker and resolves. The build report's "A failed boot is forgotten, so retry works" was claimed with no check; this is that check. It runs in milliseconds and ci can run it, whereas the browser re-test (`walk.mjs bootfail`) takes minutes.

**R2 [LOW] The effective DEP-6 timeout is about 4 minutes, not 60 s.** This answers the builder's OPEN item and tester #7 from viem's source. `apps/web/lib/anon.ts:27`. Owner: claude-frontend.
- The http transport defaults to `retryCount: 3` with `retryDelay: 150` (viem/clients/transports/createTransport.ts:73-74, utils/buildRequest.ts:135-136) and backoff `~~(1 << count) * retryDelay` (buildRequest.ts:283).
- `shouldRetry` (buildRequest.ts:296-335) returns `true` for viem's `TimeoutError` and for an `HttpRequestError` with no HTTP status, which is how a harness rejection arrives.
- So a stalled read gets 4 × 60 s + 1.05 s ≈ 241 s before "Failed". The builder's 74 s success was one 60 s timeout plus a retry. A dead worker fails after 150 + 300 + 600 ms of backoff, which matches the tester's 1.557 s.
- The page copy promises "one to two minutes".
- Fix: set the knob explicitly and comment the bound, e.g. `http(ANKR_1874, { fetchFn: worker.fetch, timeout: ANON_TIMEOUT_MS, retryCount: 1 })`. Once R1/tester #1 move boot out of the request, that caps a read at about 2 minutes, matching the copy. It keeps the spec'd `http(ANKR, { fetchFn, timeout: 60_000 })` shape and adds one option. The FR-PRIV-3 meter will need this count to be defined anyway.

**R3 [LOW] The DEP-3 test checks the domain but not the struct type.** `apps/web/test/guest-wallet.test.mjs:63-84`. Owner: tester (author of the file); claude-frontend if the tester isn't re-run.
- Signing and verifying use the same `receiveTypes`. Reorder or rename a field and all 5 tests still pass (`verifyTypedData` → true), while the real USDT contract rejects the signature in Phase 2.
- The code is correct today: the type hash matches on-chain (check 2 above).
- Fix: one assertion that rebuilds the digest from the on-chain constant and compares it with `viem.hashTypedData(verifyCalls[0])`:
  `keccak256(concat(["0x1901", USDT_DOMAIN_SEPARATOR, keccak256(encodeAbiParameters([bytes32, address, address, uint256, uint256, uint256, bytes32], ["0xd099cc98…3de8", from, to, value, validAfter, validBefore, nonce]))]))`.

**R4 [LOW] The tests need a newer Node than Next.** `apps/web/package.json`. Owner: claude-frontend, together with tester #6.
- `test/guest-wallet.test.mjs` imports `../lib/guest-wallet.ts` directly. That needs Node's default type stripping (22.18+), plus `--experimental-test-module-mocks` (22.3+).
- Next only requires `>=20.9.0` (node_modules/next/package.json:138), so a GitHub Actions runner or a teammate on Node 20 gets `ERR_UNKNOWN_FILE_EXTENSION`.
- Fix: when adding the `test` script, add `"engines": { "node": ">=22.18" }`, and have ci use the same version.

**R5 [LOW] A file outside the spec's list was edited, and its pins are now out of date.** `docs/FRONTEND-PLAN.md`. Owner: claude-frontend.
- (a) The file isn't in the spec's "Files to touch". It is the lane's own plan, so the fix is to add it to `spec.md`.
- (b) Line 25 says "**Done in batch 001** (verified in Chrome)", but round 1 is CHANGES. Write that at close.
- (c) The pin table this batch edited disagrees with what the batch installed:
  - react: plan 19.2.9, installed 19.3.0 (explained in the build report, but not updated in the plan);
  - Tailwind: plan says `tailwindcss, @tailwindcss/postcss` 4.3.3, but the batch installed `@tailwindcss/turbopack` + `tailwindcss` 4.3.4;
  - the plan says `--save-exact`, but all seven devDependencies in `apps/web/package.json:19-27` are caret ranges, while the build report says "Pins are exact".
- Fix: run `npm i -D --save-exact` on the devDependencies. The lockfile already holds the exact versions, so node_modules doesn't change. Then update the table to match.

**R6 [LOW, doc drift] ARCHITECTURE.md:112 describes a different transport.** It says `lib/anon.ts` uses "viem `custom` transport over `worker.fetch`". The human's request (batch.md) and the spec say `http(ANKR, { fetchFn: worker.fetch, timeout: 60_000 })`, and the code follows them. The code is right. Per PIPELINE §2, two sources shouldn't disagree silently. Owner: send to claude-research (or whoever owns §4) to fix the row. Not blocking.

**R7 [LOW, Ponytail: reuse what's installed]** Owner: claude-frontend.
- `apps/web/lib/guest-wallet.ts:50`: replace `` `0x${"00".repeat(32)}` `` with viem's `zeroHash`.
- `apps/web/lib/guest-wallet.ts:7`: replace `CHAIN_ID = 1874` with `whitechainSepolia.id`. anon.ts already imports the chain, so the id has one source.

**R8 [LOW, Ponytail: delete] `apps/web/README.md` is unedited create-next-app boilerplate.** It has yarn/pnpm/bun instructions, "Learn More", and Vercel links with `utm_` parameters. Delete it, or replace it with the three commands this app uses: `npm run dev`, the verification line, and the test command. Owner: claude-frontend.

## DONE
- Read every non-generated file under `apps/web/` in full, and diffed the scaffold against the cached create-next-app 16.4.3 `app-tw/ts` template.
- Verified the USDT type hash on-chain (`eth_call 0x7f2eecc3` → `0xd099cc98…3de8`) and recomputed it locally.
- Traced harness failure handling (host.js:558-740) and viem retry and timeout (`utils/rpc/http.ts:100-240`, `utils/buildRequest.ts:135-335`).
- Re-ran `npx tsc --noEmit` (exit 0), `npm run lint` (exit 0), and the unit tests (5/5 pass).

## NEEDS THE USER
- **Public copy (PIPELINE §11).** `apps/web/app/layout.tsx:17` ships the site-wide meta description "Get paid in USDT and raise cash from your future sales." It goes out on every page, including the internal proof page. Approve it or give the wording.
- Everything else the tester listed under NEEDS THE USER still applies: the FR-PRIV-4 SRS change, DEP-6 demo pre-warm, the new dependencies, and the localStorage key.
