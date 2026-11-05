VERDICT: PASS

# Test report: 001-P1-web-rail-proofs, round 3 (tester)

## Setup
- **Server:** the round 3 build on http://localhost:3100 (`next-server v16.4.3`, pid 78589, started 21:37:05; BUILD_ID `Xt2AiDvZSz3JuS9-YEINd`, written 21:36). I didn't restart it.
- **Served code is round 3:** the served chunk `1qi0gsu6e4f0u.js` contains `aria-disabled`, `9e4` (the 90 s deadline), "Private connection timed out" and the pinned hash `f13a448a…`.
- **Tools:** Playwright 1.64.1 with headless Chromium. Every walk ran in a fresh context with a Chrome net log.
- **Walk script:** `round-3/walk.mjs`. It is the round 2 walk plus:
  - each sample now records the `aria-disabled` attribute, native `disabled` and opacity
  - a second Enter while running
  - a new `stall` mode: the bundle fetch is held on all three CDNs. `CLOCK=0` waits the deadline out in real time; the default fast-forwards the page clock. `LATE=1` releases the held fetch after the deadline.
- **Logs:** net logs and JSON reports are in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/pw3/`.
- **Secrets:** no `.env` value was printed. The guest key was compared in code and never printed.
- **AT-\* IDs:** the spec cites none, so there are none to report.

## What changed since round 2 (from build-claude-frontend.md, round 3)
- **R2-1:** `app/page.tsx:101-104`. The button uses `aria-disabled`, and `onClick` is unset while the proof runs.
- **R2-2:** `lib/anon.ts:21,49-60`. `connect()` races `worker.ready` against `BOOT_DEADLINE_MS = 90_000` and calls `worker.close()` when the deadline wins.
- **Tests:** a new deadline test in `test/anon.test.mjs:25-36`.
- **Spec wording:** two WSS connections per boot, and the shots path now names each round.

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit && npm run lint && npm run build` exit 0 | PASS | In apps/web: `tsc exit=0`, `lint exit=0`. The build ran in an APFS clone (`scratchpad/web-r3`) so the live `.next` was untouched: `build exit=0`, `○ /` static. |
| 2a | `/` shows the latest 1874 block via the Nym worker, labelled "via Anon-RPC (Nym)" | PASS | 12 of 13 boots that reached a read returned a block (the failure is under OPEN 3). Examples: `OK · Block 12,298,807 on chain 1874, via Anon-RPC (Nym) (29.1 s)` at 375 and `OK · Block 12,298,736 … (115.7 s)` at 1440 (that boot switched gateway first, see OPEN 1). Other cold reads at 375 took 26.9, 17.1 and 27.5 s. Warm re-reads took 3.4 s (×4 at 375) and 13.2 s (1440). |
| 2b | No direct request to rpc.ankr.com | PASS | Playwright `ankrHits: 0` in all 12 walks. Chrome net log: `ankr occurrences in raw log: 0` in all 12 logs. |
| 2c | Plain traffic limited to what Anon-RPC needs | PASS, with a wording note | Per boot: `POST ethereum-rpc.publicnode.com` ×2 (always `0x3898587d`, then `0x1c67ff29`); `GET cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js`; 7 GETs to `validator.nymtech.net`; WSS to the entry gateway. With jsDelivr blocked, the bundle came from `GET unpkg.com` (fail-375). <br>Wording: a boot whose first gateway fails opens WSS to a **second** gateway. happy-1440 opened `wss://exit-node.finland-23.nym.cat:9001` ×1, then `wss://nym-exit.ro-16.lunardao.net:9001` ×2 (OPEN 4). |
| 2d | The pinned worker hash refuses a swapped bundle | PASS (regression) | badhash-375: `hashCallsForged: 1` gave `Failed: The private-read worker changed on-chain; refusing to run it.`, with `bundleFetchesWhileLying: 0` and `iframesAfterFail: 0`. A keyboard retry then gave `OK · Block 12,298,926` in 38.3 s. |
| 3 | Guest wallet created once, persists across reloads, verifies for 1874/USDT | PASS (regression) | happy-1440, happy-375 and the 3 extra 375 walks all report `sameAddressAfterReload: true`, `keyUnchangedAfterReload: true` and `keyShapeOk: true`. With a corrupt saved key (fail-375): `Failed: The saved guest wallet is unreadable.` and `corruptKept: true`. All 6 DEP-3 unit tests pass. |
| 4a | Running state with a live seconds counter | PASS | At load the card shows `Connecting privately… (2 s)`. On a retry the counter reads `(0 s)` at 150 ms and `(3 s)` at 3.2 s. With the clock fast-forwarded it shows `(86 s · still working)` at 375 and `(87 s · still working)` at 1440. DEP-3 shows "Signing…". |
| 4b | OK state | PASS | `tester-1440-both-ok.png`, `tester-1440-both-ok-dark.png`, `tester-375-both-ok.png`, `tester-375-stall-recovered.png` |
| 4c | Failed state: one plain line that wraps at 375 | PASS | Timeout at 375: `{"text":"Failed: Private connection timed out. Try again.","renderedLines":1,"pWidth":301,"pScrollW":301}`, page `scrollW 375 = clientW 375`. Boot failure: `Failed: HTTP request failed.` on 1 line. The hash refusal wraps to 2 lines with no overflow. |
| 4d | **Retry recovers from a failed boot without a reload** | PASS (regression) | bootfail-1440: OK in 38.8 s. bootfail-375: OK in 40.8 s. Each retry made `bootstrapPostsDuring: 2` and ended with `iframesAfterRetry: 1`. |
| 4e | **Retry recovers from a stalled boot (90 s deadline)**, round 2 OPEN 2 | **PASS (new)** | See "Stalled boot" below. The boot fails at the deadline, then the retry recovers: at 375 with a fast-forwarded clock, at 1440 in real time, and at 1440 with a late CDN answer. |
| 4f | **Retry button keeps keyboard focus**, round 2 OPEN 1 | **PASS (new)** | All 11 of 11 keyboard presses of "Read block again" kept focus (round 2: 0 of 14). See "Focus" below. |
| 5 | `npm test` passes | PASS | `ℹ tests 11 ℹ pass 11 ℹ fail 0`, exit 0. Includes `✔ a boot that never gets ready times out at the deadline and closes its worker`. |
| 6 | No key or `.env` value in source, logs or the page; the guest key never leaves the browser | PASS | 16 `.env` values were checked against 342 files: apps/web without node_modules but with `.next`, plus `.batches`, which includes this round's walk. Result: **0 matches**. There is no `process.env` or `NEXT_PUBLIC` in app/ or lib/. Guest key in all 5 happy walks: `keyInRequests: 0`, `keyInConsole: 0`, `keyInPageHtml: false`. |
| 7 | Screenshots at 375 and 1440 | PASS | 28 files in `round-3/shots/` (listed under DONE 4). |

### Focus (criterion 4f)
- **Where measured:**
  - "Read block again", 11 presses: happy-1440, happy-375, the 3 extra 375 walks, bootfail-1440, bootfail-375, badhash-375 and the 3 stall walks
  - "Sign again": the 5 happy walks
- **Each sample** reads `{"tag":"BUTTON","text":"Read block again","onButton":true,"disabled":false,"ariaDisabled":"true"}` at 150 ms and at 3 s. After the read settles, `ariaDisabled` is `"false"` and focus is still on the button.
- **While running:** `nativeDisabledWhileRunning: false`, `ariaDisabledWhileRunning: "true"`, `opacityWhileRunning: "0.5"`.
- **Through a whole stalled boot:** in all 3 stall walks the button was focused while it was aria-disabled (`focusWhileBooting.ariaDisabled: "true"`). After the failure it was still focused (`focusAfterFail.onButton: true`). The walk then pressed Enter **without re-focusing**, and the retry ran.
- **A second Enter while running** was pressed in every walk still running at 150 ms. It caused no error. The bootfail, badhash and stall retries each made exactly 2 bootstrap POSTs. The client cache would collapse a duplicate boot anyway, so this does not show on its own that the press was ignored. The code path is `onClick={… ? undefined : onRetry}` at `page.tsx:102`.

### Stalled boot (criterion 4e)
In all three walks the bundle fetch was held on jsDelivr, unpkg and raw.githubusercontent.
- **stall-clock-375** (`page.clock` fast-forwarded):
  - At 86 s on the counter the card still shows "Connecting…" and the button has `aria-disabled="true"` (`tester-375-stall-before-deadline.png`).
  - After 6 more seconds: `Failed: Private connection timed out. Try again.`, with `iframesAfterFail: 0`, `ariaDisabledAfterFail: "false"` and focus on the button (`tester-375-stall-timeout.png`).
  - With the bundle fetch released, pressing Enter gave `OK · Block 12,298,671` in 40.3 s, with `retryBootstrapPosts: 2` and `iframesAfterRetry: 1` (`tester-375-stall-recovered.png`).
- **stall-real-1440** (real time, no fake clock):
  - The failure came **89.4 s** after the bundle request was held. The boot timer starts about 0.5 s earlier, at the bootstrap reads.
  - The retry gave `OK · Block 12,298,761` in 41.3 s (`tester-1440-realtime-stall-*.png`).
- **stall-late-1440** (late CDN answer; fake clock):
  - The deadline fired the same way.
  - Its retry failed *after* the new tunnel was ready (OPEN 3).
  - The late answer itself exposed OPEN 2.
- **Unit test mutation check** on a clone (`scratchpad/web-mut3`), with `Promise.race([worker.ready, deadline])` replaced by `await worker.ready`:
  - `✖ a boot that never gets ready times out at the deadline and closes its worker`
  - the suite then hangs, because the stalled client stays cached; it was killed at 90 s with exit 142
  - so the new test guards the fix

## SRS IDs
- **NFR-11:** PASS (criterion 1).
- **DEP-6 / FR-PRIV-1 (first read):** PASS.
  - 12 of 13 reads succeeded, with 0 direct Ankr requests.
  - Failed boots and stalled boots now both recover from the button, without a reload.
- **DEP-3:** PASS (regression; 6 of 6 unit tests, including the on-chain digest check).
- **NFR-8:** PASS.
  - Grepping app/, lib/, package.json and `.next/static` for trackers found only the `lib/guest-wallet.ts:1` comment ("Privy failed NFR-8").
  - Two `.next` hits are `toStringTag` (a case-insensitive match on "gtag"), not trackers.
  - The net logs show no tracker hosts.
- **FR-PAY-7 / NFR-6 groundwork:** N/A (internal page).

## DONE
1. **Round 2 OPEN 1 (MEDIUM, focus):** fixed and verified, with 11 of 11 keyboard retries keeping focus. Owner: claude-frontend. `app/page.tsx:101-104`.
2. **Round 2 OPEN 2 (MEDIUM, stalled boot):** fixed and verified at 375 with the fast-forwarded clock and at 1440 in real time (89.4 s). Recovery then works with "Read block again". Owner: claude-frontend. `lib/anon.ts:49-60`, `test/anon.test.mjs:25-36`. The mutation check confirms the test guards the fix.
3. **Regression pass** on everything that passed in round 2:
   - happy at 1440 and 375, plus 3 extra cold reads at 375
   - bootfail at 1440 and 375
   - badhash at 375
   - fail at 375 (corrupt key, jsDelivr blocked → unpkg)
   - dark mode at 1440

   All of these pass.
4. **Screenshots** are in `round-3/shots/`:
   - **1440:** `running`, `both-ok`, `both-ok-dark`, `read-again-running`, `bootfail`, `bootfail-retry-running`, `bootfail-recovered`
   - **1440, real-time stall:** `realtime-stall-timeout`, `realtime-stall-retry-running`, `realtime-stall-recovered`
   - **1440, late-CDN stall:** `late-stall-before-deadline`, `late-stall-timeout`, `late-stall-late-bundle-after-deadline`, `late-stall-retry-running`, `late-stall-retry-failed-after-tunnel-ready`
   - **375, main states:** `running`, `both-ok`, `bootfail`, `bootfail-retry-running`, `bootfail-recovered`
   - **375, hash pin:** `badhash-refused`, `badhash-retry-running`, `badhash-recovered`
   - **375, other:** `corrupt-key-jsdelivr-blocked`
   - **375, stall:** `stall-before-deadline`, `stall-timeout`, `stall-retry-running`, `stall-recovered`

## OPEN (none blocking; all LOW)
1. **[LOW, tuning] The 90 s deadline sits right where Nym's own gateway retry finishes.** Owner: claude-frontend (`lib/anon.ts:21`).
   - The Nym worker bundle (hash-checked: `keccak 0xf13a448a…fceb8`) calls `api.signalReady()` right before it logs "nym tunnel ready". So `worker.ready`, and with it the deadline, covers the whole tunnel setup, including the worker's internal retry.
   - Bundle start → tunnel ready in this round:
     - 10 boots took 8–31 s
     - happy-1440 took **85.2 s**: `tunnel setup failed (attempt 1) … gateway selection error` came at +77 s, and the tunnel was up about 2.7 s before the 90 s deadline
     - the late-answer boot, which had no deadline because it had already been closed, took **94.8 s**: `tunnel setup failed (attempt 1) … operation timed out` came after about 84 s. Under the deadline it would have been killed about 5 s before it was ready.
   - Attempt 1 of the worker's tunnel setup gives up after about 77–84 s, so any boot that needs a second attempt finishes at about 85–100 s.
   - Option: raise `BOOT_DEADLINE_MS` to about 120 s, which also matches the "one to two minutes" copy. The spec fixes 90 s, so this is a spec decision (NEEDS THE USER).
2. **[LOW] Closing a worker whose bundle hasn't arrived doesn't stop its boot.** Owner: claude-frontend (report upstream to Anon-RPC; correct the comment at `lib/anon.ts:48`).
   - Cause, in harness 0.4.0:
     - `#boot()` (`node_modules/@anon-rpc/browser-harness/dist/host.js:589-615`) never checks `#failure` after `await fetchAndVerifyBundle(…)`
     - `close()` (`:737`) removes an iframe only if one exists already
     - the bundle fetch is a bare `fetch(url)` with no timeout (`harness-core/dist/specifier.js:66`)
   - Measured (stall-late-1440): after the deadline closed worker 1, I released the held jsDelivr response. 40 s later the page showed `Failed: Private connection timed out.`, yet the closed worker had appended an iframe and connected: `{"iframes":1,"newSockets":["erikg3.daoariwas.cloud:9001","erikg3.daoariwas.cloud:9001"]}`.
   - It kept running: its tunnel was ready at +97.6 s. After the user's retry the page held 2 iframes (`iframesAfterRetry: 2`).
   - Effect: an orphan Nym client that serves nothing and adds plain directory GETs and gateway WSS. It happens only when a CDN answers after the deadline. A stall during tunnel setup is unaffected, because the iframe already exists and `close()` removes it.
3. **[LOW, carried from round 2 OPEN 3; Nym side] A read failed after the tunnel was up.**
   - stall-late-1440: the retry's fresh worker was ready at +56.1 s, then `Failed: HTTP request failed.` came at about +104 s (62.7 s after Enter, about 48 s after ready). This matches round 2's 45–50 s pattern.
   - A closed worker from OPEN 2 was running in the same page at the time, so I can't rule out interference.
   - Still not exercised: whether a second "Read block again" recovers from a failure *after* `ready`. That worker stays cached (`lib/anon.ts:73` shortcut).
   - Totals: round 2 was 14 of 16, and round 3 is 12 of 13.
4. **[LOW, accuracy] The spec says "WSS connections (2 per boot) to one Nym entry gateway". A boot that switches gateway opens WSS to two hosts.** Owners: claude-frontend (`spec.md:12`); claude-research (FR-PRIV-4 text).
   - happy-1440: 1 WSS to `exit-node.finland-23.nym.cat`, then 2 to `nym-exit.ro-16.lunardao.net`.
   - Suggested wording: "WSS connections to a Nym entry gateway (another if the first fails)".
5. **[note for reviewer-ux-ui, no action] The focus ring fades with the dimmed button.** While the button is aria-disabled, its focus ring is drawn at 50% opacity (`tester-375-stall-before-deadline.png`). WCAG 1.4.11 exempts inactive components, and the ring is full strength once the button is enabled.

## NEEDS THE USER
- **Boot deadline value (OPEN 1):** keep 90 s (spec) or raise it to about 120 s. On the measured data, 90 s can cut off a boot that Nym's own gateway retry was about to finish (1 boot ready with 2.7 s to spare; 1 that would have missed by about 5 s). The retry still recovers either way.
- **DEP-6 demo risk** (carried): cold reads take 17–116 s, and 1 of 13 reads failed after the tunnel was up. Decide whether the demo pre-warms the worker before judges look.
- **FR-PRIV-4 SRS change** (carried; claude-research drafts it). Approve listing these plain connections as disclosed exclusions:
  - the Nym directory (`validator.nymtech.net`, 7 GETs per boot)
  - entry-gateway WSS (one or two gateways per boot)
  - unpkg and raw.githubusercontent bundle fallbacks
- **PIPELINE §11, new dependencies** (carried): viem 2.57.13, @anon-rpc/browser-harness 0.4.0 (prototype-grade; see OPEN 2), Next 16.4.3, Tailwind 4.3.3. This round's tester work adds no dependency.
- **Guest key in localStorage** (carried): any XSS on our origin can read it. Accepted for the demo; it goes in the README limitations.
- **Public copy** (carried, `app/layout.tsx` meta description): "Get paid in USDT and raise cash from your future sales."
