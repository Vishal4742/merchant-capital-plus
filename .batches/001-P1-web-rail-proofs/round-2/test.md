VERDICT: CHANGES

# Test report: 001-P1-web-rail-proofs, round 2 (tester)

## Setup
- The round 2 production build was served by the builder at http://localhost:3100 (`next start`, BUILD_ID `NliIu6UQ3Heri-yb0lwS3`, written 21:16). The served chunk `2ejh63lrj1box.js` contains the pinned hash `f13a448a…`.
- Tools: Node v26.10.0, Playwright 1.64.1, headless Chromium 156.0.8078.4. Every walk used a fresh browser context with a Chrome net log.
- Walkthrough script: `round-2/walk.mjs`, with modes `happy`, `bootfail`, `badhash` (new) and `fail`. The extra probes are in `round-2/probes/`.
- Net logs and JSON reports: `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/pw2/`.
- I needed the full error text behind "HTTP request failed.", so I ran a copy of the build on :3101. It was an APFS clone in the scratchpad with one `console.error` added in `errorMessage`. I stopped that server afterwards. :3100 was never restarted.
- No `.env` value was printed. The guest key was compared in code and never printed.

The spec cites no AT-* IDs, so there are none to report.

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit && npm run lint && npm run build` exit 0 | PASS | In apps/web: `tsc exit=0`, `lint exit=0` (this includes the new test), `npx eslint test/` exit 0. The build ran in an APFS clone so the live :3100 server was untouched: `build exit=0`, `✓ Compiled`, `○ /` static. :3100 still returned 200 afterwards. |
| 2a | `/` shows the latest 1874 block via the Nym worker, labelled "via Anon-RPC (Nym)" | PASS | 16 cold reads, 14 OK. Examples: `OK · Block 12,297,559 on chain 1874, via Anon-RPC (Nym) (14.5 s)` at 1440 and `… 12,297,743 … (24.0 s)` at 375. The other OK times were 15.3, 14.7, 16.2, 17.1, 19.6, 25.0 and 31.9 s, plus the four recoveries below. The 2 failures are under OPEN 3. |
| 2b | No direct request to rpc.ankr.com | PASS | Playwright `ankrHits = 0` in all 14 walks. Chrome net log: `ankr occurrences in raw log: 0` in all 6 logs I parsed (happy-1440, happy-375, bootfail-375 ×2, bootfail-1440). |
| 2c | Plain traffic limited to the listed Anon-RPC needs | PASS, with a wording note | Per boot in the net log: `2x POST ethereum-rpc.publicnode.com` (+1 OPTIONS preflight); `1x GET cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/…`; 7 GETs to `validator.nymtech.net` (+ preflights); 2 `wss://<one gateway>:9001`. Nothing else left localhost. <br>The bootstrap calls are always `eth_call 0x3aCD…eD0 0x3898587d` (workerHash) then `0x1c67ff29`. <br>With jsDelivr blocked, the bundle came from `GET unpkg.com` (fail-375). <br>Wording: the spec says "one WSS", but every boot opened **two** WSS connections to the same entry gateway (OPEN 4). |
| 2d | The worker hash is pinned, so the bootstrap RPC can't swap the bundle | PASS (new browser check) | `badhash` mode forged the `workerHash()` reply (`hashCallsForged: 1`). Result: `Failed: The private-read worker changed on-chain; refusing to run it.`, `bundleFetchesWhileLying: 0`, `iframesAfterFail: 0`. After the forgery stopped, "Read block again" recovered in 17.4 s with no reload: `OK · Block 12,297,793`. Unit tests: accept / refuse / pass-through all pass. |
| 3 | Guest wallet created once, persists across reloads, `verifyTypedData` → true for 1874/USDT | PASS | 1440 and 375 both report `sameAddressAfterReload: true`, `keyUnchangedAfterReload: true`, `keyShapeOk: true`. With a corrupt saved key: `Failed: The saved guest wallet is unreadable.`, and `corruptKept: true`. Unit tests 6/6, including the new type-hash digest check (DONE 1). |
| 4a | Running state with a live seconds counter | PASS | At load the card shows `Connecting privately… … (2 s)`. After a keyboard retry the counter reads `(0 s)` at 150 ms and `(3 s)` at 3.2 s, and it is gone once the read settles. The fake clock shows `(60 s · still working)` at 60 s (`tester-375-still-working-clock-61s.png`), with no overflow at 375 (`[375,375]`). DEP-3 shows "Signing…", not the Nym text. |
| 4b | OK state | PASS | `tester-1440-both-ok.png`, `tester-1440-both-ok-dark.png`, `tester-375-both-ok.png`. |
| 4c | Failed state: one plain line that wraps at 375 | PASS | Boot failure at 375: `{"text":"Failed: HTTP request failed.","renderedLines":1,"pWidth":301,"pScrollW":301}`, and the page is `scrollW 375 = clientW 375` (round 1 was 660). The hash refusal wraps to 2 lines with no overflow. The text never contains the URL or the request body; the instrumented copy confirmed those exist only in the full `message`. |
| 4d | Retry recovers from a failed Nym boot without a reload | **FAIL** (one case) | **Failed boot: PASS.** With the bootstrap blocked, then unblocked and "Read block again" pressed, the read recovered in 17.2 s (1440), 18.7 s (375) and 15.2 s (375, instrumented). Each retry made 2 new bootstrap POSTs, refetched the bundle, opened a new tunnel and ended with `iframesAfterRetry: 1`. Round 1 was stuck with `requestsDuringRetry = []`. <br>**Stalled boot: FAIL (OPEN 2).** If the boot never finishes, the card stays on "Connecting…" and the button stays disabled until a reload: 149 s in real time, 602 s on the fake clock. |
| 4e | Focus stays on the retry button (round 1 ux fix; asked for in this round's prompt) | **FAIL** | 14 of 14 keyboard retries of "Read block again" lost focus: 6 on the :3100 build and 8 on the instrumented copy. In 12 of them focus was confirmed on the button before Enter: `focusBeforeEnter: BUTTON "Read block again"` → `focusAt150ms: BODY`, `focusAt3s: BODY`, `focusAfterSettle: BODY`. "Sign again" keeps focus only because it finishes before it is ever disabled. Cause is confirmed in isolation (`probes/focus-probe.mjs`): Chromium 156 `{"a(disabled)":"BODY","b(aria-disabled)":"BUTTON#b"}`. See OPEN 1. |
| 5 | `npm test` passes | PASS | `npm test` → `ℹ tests 10 ℹ pass 10 ℹ fail 0`, exit 0. |
| 6 | No key or `.env` value in source, logs or page; the guest key never leaves the browser | PASS | 16 `.env` values were checked against 257 files: apps/web without node_modules but with `.next`, plus `.batches`, which includes my new test and walk. Result: **0 matches**. There is no `.env*` in apps/web and no `process.env`/`NEXT_PUBLIC` in app/ or lib/. Guest key, at 1440 and at 375: `keyInRequests: 0`, `keyInConsole: 0`, `keyInPageHtml: false`. |
| 7 | Screenshots at 375 and 1440 | PASS | 19 files in `round-2/shots/`. The spec still says `round-1/shots/` (OPEN 5). |

## SRS IDs
- **NFR-11**: PASS (criterion 1).
- **DEP-6 / FR-PRIV-1 (first read)**: works. 14/16 cold reads and 9/9 warm re-reads succeeded, with 0 direct Ankr requests. A boot that fails now recovers. Still open: the stalled-boot case (OPEN 2) and post-ready reliability (OPEN 3).
- **DEP-3**: PASS. The signed digest now equals the digest the deployed USDT contract computes (DONE 1).
- **NFR-8**: PASS. Grepping app/, lib/, `.next/static` and package.json for google-analytics, googletagmanager, gtag, posthog, segment, mixpanel, plausible, sentry, @vercel/analytics, hotjar, datadog and privy found only the comment at `lib/guest-wallet.ts:1` ("Privy failed NFR-8"). The net logs show no tracker hosts. `@arkiv-network/sdk` is no longer installed.
- **FR-PAY-7 / NFR-6 groundwork**: N/A (internal page).

## DONE
1. **R3 (reviewer-code, assigned to the tester): type-hash digest check.** Added to `apps/web/test/guest-wallet.test.mjs:86-104`.
   - I re-read the type hash on-chain first: `eth_call 0x7f2eecc3` (`toFunctionSelector("RECEIVE_WITH_AUTHORIZATION_TYPEHASH()")`) on USDT `0xcedfB561…55a7` via rpc.ankr.com/whitechain_testnet returned `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8`. `DOMAIN_SEPARATOR()` returned `0xcdcfacb6…2a25` and `eth_chainId` returned `0x752`.
   - The test builds `keccak256(0x1901 ‖ on-chain DOMAIN_SEPARATOR ‖ keccak256(abi.encode(on-chain TYPEHASH, from, to, value, validAfter, validBefore, nonce)))` from the exact typed data the proof signed. It asserts that this equals `viem.hashTypedData(...)`, and that `recoverAddress(digest, signature)` returns the guest address.
   - Passes: `✔ the signed digest is the one the deployed USDT contract computes from its own type hash`.
   - Mutation check, on a clone with `validAfter` and `validBefore` swapped in `lib/guest-wallet.ts`: this test fails (`✖ … ℹ pass 5 ℹ fail 1`), while the other 5 DEP-3 tests still pass. That confirms R3's point.
2. **Mutation check of the builder's retry test.** On a clone with the round 1 `connect()` restored (no `await worker.ready` / `close()`): `✖ a failed boot closes its worker, and the next call boots a fresh one`, `ℹ fail 1`. The test guards the fix.
3. **Walkthroughs.** I ran 14 walks plus 3 probes on Chromium:
   - happy at 1440 and 375
   - bootfail at 1440 and 375 (×2, plus 1 instrumented)
   - badhash at 375
   - fail at 375 (corrupt key + jsDelivr blocked → unpkg)
   - 7 instrumented cold reads at 375
   - the fake-clock "still working" probe, a 150 s real-time stalled-boot probe, and the focus probe

   Retries were sent from the keyboard: focus the button, then press Enter. The `fail` mode's init script now runs in the top frame only, so round 1's sandboxed-iframe `pageerror` is gone.
4. **Screenshots** are in `round-2/shots/`:
   - **1440:** `running`, `both-ok`, `both-ok-dark`, `bootfail`, `bootfail-retry-running`, `bootfail-recovered`
   - **375, main states:** `running`, `both-ok`, `bootfail`, `bootfail-retry-running`, `bootfail-recovered`
   - **375, hash pin:** `badhash-refused`, `badhash-retry-running`, `badhash-recovered`
   - **375, failures and probes:** `corrupt-key-jsdelivr-blocked`, `still-working-clock-61s`, `still-working-clock-10min`, `boot-hang-150s`, `bootfail-run1-retry-failed-after-tunnel-ready`

## OPEN (CHANGES findings)

1. **[MEDIUM] "Read block again" drops keyboard focus to `<body>` on every press.**
   - Where: `apps/web/app/page.tsx:102` (`disabled={proof.state === "running"}`). Owner: claude-frontend.
   - Cause: Chromium runs the focus fix-up rule when a focused button becomes `disabled`, so focus moves to `<body>`. It is not restored when the read settles.
   - Measured in 14 of 14 retries. On :3100 that is happy 1440, happy 375, bootfail ×3 and badhash; the other 8 are on the instrumented copy. Each shows `focusBeforeEnter` on the button, then `focusAt150ms: BODY`. A keyboard user has to tab back from the top of the page after every retry.
   - The round 2 build report's claim ("disabled while running, so focus is kept") is wrong in Chromium.
   - Fix: keep the button focusable by using `aria-disabled={running}` instead of `disabled`, return early in `onClick` while running, and style it with `aria-disabled:` variants. Same-size diff.
   - Check: `node round-2/walk.mjs happy 1440 …` should report `focusAt150ms.onButton: true`.
2. **[MEDIUM] A stalled Nym boot never ends, and the retry button stays disabled until a reload.**
   - Where: `apps/web/lib/anon.ts:47` (`await worker.ready` with no deadline). Owner: claude-frontend.
   - Moving the boot out of the viem request (the round 1 fix) means the 60 s × 2 timeout now covers only the read. The harness has no boot or bundle-fetch timeout either: `@anon-rpc/harness-core/dist/specifier.js:65` is a bare `await fetch(url)`, and host.js has no `setTimeout`.
   - Measured with the bundle fetch held (jsDelivr, unpkg and raw.githubusercontent never answer):
     - real time: `{"text":"Connecting privately… … (149 s · still working)","buttonDisabled":true}` at 150 s (`probes/hang-realtime.mjs`, `tester-375-boot-hang-150s.png`)
     - fake clock: `(602 s · still working)`, `buttonDisabled: true` (`tester-375-still-working-clock-10min.png`)
   - The page copy promises "one to two minutes", and the spec says retry recovers a failed boot without a reload.
   - Fix: race `worker.ready` against a boot deadline (for example 90 s), `worker.close()` on expiry, and throw a plain "The private connection timed out." The existing catch then forgets the worker, and the button re-enables.
   - Add one `node:test` case with a fake `AnonRpcWorker` whose `ready` never settles and a short deadline.
3. **[LOW, reliability / demo risk] 2 of 16 cold reads failed after the tunnel came up.**
   - Owner: claude-frontend (pre-warm in Phase 2); nothing to fix in this batch's code.
   - Both failed with `Failed: HTTP request failed.` about 45–50 s after `[worker] nym tunnel ready`:
     - bootfail-375 run 1: the retry booted a fresh worker, then the read failed at 56.7 s
     - fail-375 with the unpkg fallback: tunnel ready at +9.9 s, failed at +58 s
   - The 7 instrumented reads that would have logged the full error chain all succeeded, so the root cause is not captured.
   - Not exercised: whether "Read block again" recovers from a failure *after* `ready`. That worker stays cached (`anon.ts:63` shortcut), and none of the 4 walks armed for this case failed.
   - Round 1 was 5 of 6 OK; round 2 is 14 of 16.
4. **[LOW, accuracy] The spec says "one WSS to a Nym entry gateway", but every boot opens two.**
   - Where: `spec.md:12`. Owners: claude-frontend for the spec wording; claude-research for the FR-PRIV-4 text.
   - All 9 boots in the net logs show 2 WSS connections to one gateway. Examples: `2x GET wss://gateway12.petroff-staking.space:9001/`, `2x GET wss://coyote.jeffrichards.io:9001/`. The console shows `Websocket to … is now open!` twice: once before and once after `finished registration with gateway`.
   - It is the same single host, so the disclosure stays right if it says "WSS connections to one Nym entry gateway".
5. **[LOW, accuracy] Spec criterion 7 still says `round-1/shots/`.** `spec.md:17`. Owner: claude-frontend. Round 2 shots are in `round-2/shots/`.

## NEEDS THE USER
- **FR-PRIV-4 SRS change** (carried over): approve listing these plain connections as disclosed exclusions. claude-research drafts it.
  - Nym directory `validator.nymtech.net`: 7 GETs per boot
  - entry-gateway WSS: 2 sockets to one gateway per boot
  - unpkg / raw.githubusercontent bundle fallbacks
  - Cloudflare NEL sampling on the jsDelivr response
- **DEP-6 demo risk:** a cold read takes 15–32 s, and 2 of 16 failed after the tunnel was up. Decide whether the demo pre-warms the worker before judges look.
- **PIPELINE §11, new dependencies:** viem 2.57.13, @anon-rpc/browser-harness 0.4.0 (prototype-grade), Next 16.4.3, Tailwind 4.3.3. My test adds none; it uses Node's built-in runner and `mock.module`.
- **Guest key in localStorage:** any XSS on our origin can read it. Accepted for the demo; it goes in the README limitations.
- **Public copy** (`app/layout.tsx`, meta description): "Get paid in USDT and raise cash from your future sales."
