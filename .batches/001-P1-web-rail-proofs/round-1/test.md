VERDICT: CHANGES

# Test report: 001-P1-web-rail-proofs, round 1 (tester)

Setup: production build served by `next start -p 3100` (apps/web, Next.js 16.4.3), Node v26.10.0, Playwright 1.64.1 with headless Chromium 1248, fresh browser context per run. Five browser sessions in all, each with a Chrome net log (`--log-net-log`). That log records all browser traffic, including the Nym worker's sandboxed iframe and its Web Worker. Walkthrough script: `round-1/walk.mjs` (modes `happy`, `fail`, `bootfail`). Net logs and JSON reports: `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/pw/`. No `.env` value was printed. The guest key was compared in code and never printed.

The spec cites no AT-* IDs, so there are none to report.

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit && npm run lint && npm run build` exit 0 | PASS | In apps/web: `tsc exit=0`, `lint exit=0` (rerun after the tester test file was added; `npx eslint test/guest-wallet.test.mjs` exit 0). Build ran in an APFS clone so the live :3100 server kept running: `build exit=0`, `✓ Compiled successfully in 1188ms`, `Finished TypeScript in 1489ms`, `○ /` static. :3100 still returned 200 afterwards. |
| 2a | `/` shows the latest 1874 block read through the Nym worker, labelled "via Anon-RPC (Nym)" | PASS | `OK · Block 12,296,209 on chain 1874, via Anon-RPC (Nym) (38.5 s)` (1440), `… 12,296,243 … (34.1 s)` (1440 after reload), `… 12,296,374 … (19.5 s)` (375), plus 29.9 s and 19.6 s in the failure-mode runs. Console: `[worker] nym tunnel ready`. |
| 2b | No direct request to rpc.ankr.com | PASS | Playwright: `ankrHits = 0` in every run. Chrome net log, all 5 sessions: `ankr=0` occurrences (`net-happy-1440`, `net-happy-375`, `net-happy-375b`, `net-fail-375`, `net-bootfail-375`). |
| 2c | "only the bootstrap mainnet `eth_call`s and the bundle fetch go out in plain" | **FAIL** | Each Nym boot also sends **7 plain GETs to `validator.nymtech.net`** (`/api/v2/unstable/nym-nodes/skimmed/entry-gateways`, `/api/v1/epoch/key-rotation-info`, `/api/v1/nym-nodes/rewarded-set`, `/api/v2/unstable/nym-nodes/skimmed/mixnodes/active`, `/api/v2/nym-nodes/described`, …) and opens **one WSS to a Nym entry gateway on :9001**. Gateways seen: bulgaria.nymgateway.com, nym-exit.argentina.nymtech.net.ar, nym-exit.ch-11.spectredao.net, exits-nl-24.aurorasky.org, gateway16.petroff-staking.space. With jsdelivr blocked, the harness falls back to **`GET https://unpkg.com/@nymproject/anon-rpc-worker@0.1.0/…`**. 1440 run, 2 page loads: `GET localhost:3100: 30, POST ethereum-rpc.publicnode.com: 4, GET cdn.jsdelivr.net: 2, GET validator.nymtech.net: 14`, 8 local `blob:null` worker URLs. The build report's network claim omits these. |
| 3 | Guest wallet created once, persists across reloads, `verifyTypedData` → true for the 1874/USDT domain | PASS | Browser: `sameAddressAfterReload = true`, `keyUnchangedAfterReload = true`, key shape `0x`+64 hex, `OK · Guest wallet 0xd807…425F signed and verified typed data for chain 1874` both before and after the reload. Unit tests: 5/5 pass (below). The domain the code signs with hashes to the deployed USDT `DOMAIN_SEPARATOR()`. On-chain `eth_call 0x3644e515` → `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25`, `eth_chainId` → `0x752`. |
| 4 | Clear states for each proof: connecting / ok / failed with the error message | **FAIL** | The states exist: `tester-1440-connecting.png`, `tester-*-both-ok.png`, `Failed: The saved guest wallet is unreadable.`, and a DEP-6 failure each for a timeout and a blocked boot. Two defects. (a) After a failed Nym boot, **Run again never recovers.** With the bootstrap unblocked it failed again in 1.557 s with the stale error, `requestsDuringRetry = []`; only a reload fixed it (`OK … (19.6 s)`). (b) At 375 the boot-failure message **widens the page to 660 px**: `tester-375-bootfail.png` is 660x900. |
| 5 | No key or `.env` value in source, logs or page; the guest key never leaves the browser | PASS | Checked 16 `.env` values against 258 files (apps/web without node_modules, including the `.next` build output, and `.batches`): **0 matches for every one**. No `.env*` in apps/web. No `process.env` or `NEXT_PUBLIC` in app/ or lib/. Guest key: `keyInRequests = 0` (URLs and POST bodies of every request), `keyInConsole = 0`, `keyInPageHtml = false` (1440 and 375). |
| 6 | Screenshots at 375 and 1440 in round-1/shots/ | PASS | Files listed under DONE. |

## SRS IDs

- **NFR-11**: PASS (criterion 1, plus page screenshots).
- **DEP-6 / FR-PRIV-1 (first read)**: PASS. The read works through Nym and nothing goes direct to Ankr. Open items: reliability was 5 of 6 cold reads OK, and the extra plain Nym traffic still needs disclosing.
- **DEP-3**: PASS.
- **NFR-8**: PASS. `package-lock.json` has no analytics packages. A grep of app/, lib/ and `.next/static` for google-analytics, gtm, gtag, posthog, segment, mixpanel, plausible, sentry, vercel/analytics, hotjar and datadog found nothing. The net log shows no tracker hosts. The one caveat is the Cloudflare NEL header (OPEN 8).
- **FR-PAY-7 / NFR-6 groundwork**: N/A. The page is internal and has no customer copy.

## DONE

- Added `apps/web/test/guest-wallet.test.mjs`. It uses Node's built-in runner and adds no dependency. Run it from apps/web with `node --experimental-test-module-mocks --test test/`, exit 0:
  ```
  ✔ creates one key on first use and returns the same account afterwards
  ✔ uses an existing saved key and never replaces it
  ✔ throws on an unreadable saved value and leaves it untouched
  ✔ signs the USDT ReceiveWithAuthorization shape for the real 1874 USDT domain, and it verifies
  ✔ a signature from a different key does not verify for the guest address
  ℹ tests 5  ℹ pass 5  ℹ fail 0
  ```
  The test wraps viem's `verifyTypedData` with `mock.module` and captures the exact typed data and signature that `proveTypedDataSigning` uses. It then asserts:
  - the domain equals the on-chain separator;
  - value is 0, from and to are both the signer, and validBefore is 0;
  - `recoverTypedDataAddress` returns the signer.

  The test key is derived at runtime, so the file contains no key literal.
- Browser walkthrough at 1440 and 375 (`round-1/walk.mjs`). Screenshots in `round-1/shots/`:
  - `tester-1440-connecting.png`: DEP-6 connecting, DEP-3 OK
  - `tester-1440-both-ok.png`, `tester-1440-both-ok-dark.png`: both proofs OK, light and dark
  - `tester-375-connecting.png`, `tester-375-both-ok.png`: 375 connecting, then both OK (no overflow: scrollWidth 375 = clientWidth 375)
  - `tester-375-dep6-timeout-after-120s.png`: DEP-6 `Failed: HTTP request failed. … Details: operation timed out` after 120 s, on a cold boot whose tunnel reported ready
  - `tester-375-dep3-corrupt-key-failed.png`: a corrupt saved key gives `Failed: The saved guest wallet is unreadable.`, and the value stays `not-a-key` after load and after Run again (never overwritten)
  - `tester-375-jsdelivr-blocked-still-ok.png`: jsdelivr blocked, the bundle comes from unpkg.com and DEP-6 still reads OK (29.9 s)
  - `tester-375-bootfail.png`, `tester-375-bootfail-run-again.png`: bootstrap RPC blocked, then unblocked and Run again; the failure is stuck and the page overflows to 660 px
- Test artifact, not an app bug: in `fail` mode the console shows `pageerror: Failed to read the 'localStorage' property … sandboxed`. My `addInitScript` also ran inside the Nym sandboxed iframe and caused it.

## OPEN (CHANGES findings)

1. **[MEDIUM] A failed Nym boot is cached for the page's lifetime.** File: `apps/web/lib/anon.ts:16-28` and `:34-39`. Owner: claude-frontend.
   - `connect()` returns the client right after `new AnonRpcWorker(...)` and never awaits `worker.ready`.
   - A boot failure (bootstrap read, bundle fetch, worker crash) therefore never rejects `connect()`, and the `.catch` that resets `client` never fires.
   - The harness then makes every later `worker.fetch` throw the stored failure (`node_modules/@anon-rpc/browser-harness/dist/host.js:575-586`, and `#fetch`: `if (this.#failure !== void 0) throw this.#failure`).
   - Measured: after unblocking the bootstrap, Run again failed in 1.557 s with no network request (`requestsDuringRetry = []`).
   - This contradicts the build report's DONE line "A failed boot is forgotten, so retry works".
   - Proposed fix: `await worker.ready;` in `connect()` before returning the client. The existing catch then forgets the dead worker; optionally call `worker.close()` on failure.
   - Unverified side effect: boot time would also stop counting against the 60 s viem request timeout, which may explain the 120 s timeout in OPEN 7.
   - Re-test: `node round-1/walk.mjs bootfail 375 <shots> <netlog>`.
2. **[MEDIUM] Failed state overflows at 375.** File: `apps/web/app/page.tsx:62` and `:71`. Owner: claude-frontend.
   - The raw viem `error.message` includes an unbroken JSON request body, which pushes the page to 660 px wide (`tester-375-bootfail.png`).
   - The message's newlines are collapsed, and the RPC URL and request body end up in UI copy.
   - Proposed fix: add `break-words` / `[overflow-wrap:anywhere]` on the status `<p>`, and show viem's `shortMessage` (BaseError) rather than `message`.
3. **[MEDIUM, accuracy] The network claim is wrong in the build report and in the spec's criterion 2 parenthetical.** Files: `.batches/001-P1-web-rail-proofs/build-claude-frontend.md` ("Verified", network tab bullet) and `spec.md`. Owners: claude-frontend for the report and spec wording; claude-research for the FR-PRIV-4 README exclusions.
   - Plain traffic also includes the Nym directory (`validator.nymtech.net`, 7 GETs per boot), the entry-gateway WSS, and the unpkg.com fallback (see 2c).
   - apps/web can't remove these: the Nym worker bundle makes them from inside the sandboxed iframe. They can only be disclosed.
4. **[LOW] The DEP-3 card shows Nym-specific waiting copy.** File: `apps/web/app/page.tsx:63`. Owner: claude-frontend.
   - The DEP-3 card shows "Connecting privately… the first private read can take one to two minutes." on first render and on Run again, but DEP-3 is a local signature.
   - Proposed fix: pass a per-card running message.
5. **[LOW] Run again can return a cached block.** File: `apps/web/app/page.tsx:38`. Owner: claude-frontend.
   - `client.getBlockNumber()` uses viem's default `cacheTime` (4 s here), so Run again inside that window returns the cached block. Observed: `Block 12,296,201 … (0.0 s)` twice.
   - Proposed fix: `getBlockNumber({ cacheTime: 0 })` so Run again is a real private read.
6. **[LOW] No `test` script, so ci won't run the new tests.** File: `apps/web/package.json:5-10`. Owner: claude-frontend (package.json is product config; the tester doesn't edit it).
   - Proposed fix: add `"test": "node --experimental-test-module-mocks --test test/"`.
7. **[LOW, reliability / demo risk] 1 of 6 cold DEP-6 reads timed out.** Owner: claude-frontend.
   - It failed after 120 s with `operation timed out`, even though the console showed `nym tunnel ready` (`tester-375-dep6-timeout-after-120s.png`).
   - The other five succeeded in 38.5, 34.1, 29.9, 19.6 and 19.5 s.
   - Run again after a timeout could not be exercised because the timeout didn't recur.
   - Related to the builder's OPEN item on the 60 s timeout, and possibly to OPEN 1.
8. **[LOW, informational] jsdelivr's response sets a Cloudflare NEL / Report-To policy.** Owners: claude-research (disclosure), reviewer-security.
   - The policy points to `a.nel.cloudflare.com` with `success_fraction: 0.01`, so Chrome may send sampled network reports to Cloudflare about the bundle fetch.
   - No upload was observed: `"uploads":0` in all 5 net logs.
   - It's browser-level, so a CSP won't stop it. Add it to the FR-PRIV-4 disclosure.
9. **[LOW] Unused dependency.** File: `apps/web/package.json:13`. Owner: claude-frontend, for reviewer-code's call.
   - `@arkiv-network/sdk` is installed in this batch but only used in batch 002.

## NEEDS THE USER

- **An SRS change for FR-PRIV-4.** FR-PRIV-4 now lists relayer writes, the bootstrap read, explorer history and the server-side read. Should these extra plain connections from every Nym boot be accepted as disclosed exclusions?
  - Nym directory API `validator.nymtech.net`
  - entry-gateway WSS
  - unpkg.com fallback for the bundle
  - Cloudflare NEL sampling

  This is a privacy claim in the README, and claude-research drafts the change.
- **DEP-6 demo risk:** a cold first read took 19 to 39 s, and 1 of 6 failed after 120 s. Decide whether the demo pre-warms the worker before judges look.
- **PIPELINE §11:** new dependencies from the build: viem 2.57.13, @anon-rpc/browser-harness 0.4.0, @arkiv-network/sdk 1.0.1. The tester's test uses Node's experimental `mock.module` and adds no dependency.
- **Guest key in localStorage:** any XSS on our origin could read it. The builder marked this as a shortcut; it belongs in the README limitations.
