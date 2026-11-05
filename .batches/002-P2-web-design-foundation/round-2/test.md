VERDICT: CHANGES

# Test report: 002-P2-web-design-foundation, round 2 (tester)

Everything the round 1 reports asked for now passes, except one AA failure on the hero: the "Phase 1 · rail proofs" label reaches 4.31:1 over lit dots at 640 px and up. The fix is one word (see OPEN 1).

## Setup
- **Server:** the existing `next start` on :3100 (pid 25391). `.next/BUILD_ID` was written at 22:32:23, after every changed source file (22:32:01), and the served HTML contains `data-motion="essential"` and `whitespace-nowrap`. I didn't restart it.
- **`next dev`:** I started `next dev -p 3104` for one probe. Next 16.4.3 writes dev output to `.next/dev` (`node_modules/next/dist/server/config.js:1107`), so the :3100 build wasn't touched. I stopped it afterwards (`lsof -tiTCP:3104` returns 0 listeners).
- **Tools:** Playwright 1.64.1, headless Chromium. Each probe ran in a fresh context.
- **Probes:** all in `round-2/probes/`. The round 1 scripts are copied unchanged: `walk.mjs`, `regress.mjs`, `unmount.mjs`, `px.mjs`, the four `review-code-*.mjs` and `review-security-hold-probe.mjs` (the security reviewer's scratchpad `hold-probe.mjs`). The new ones are `hold-state-trusted.mjs`, `busy-paint.mjs`, `dev-hold.mjs`, `hero-contrast.mjs` and `layout-resize.mjs`.
- **Secrets:** I read no `.env` value. `grep -rlE '0x[0-9a-fA-F]{64}' round-2/probes/` matches nothing.
- **AT-\* IDs:** the spec cites none.

## Static checks (apps/web)
- `npm test`: `tests 16 · pass 16 · fail 0`, exit 0.
- `npm run typecheck` (`next typegen && tsc --noEmit`): exit 0.
- `npx eslint --max-warnings 0`: exit 0.
- Hex grep: `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' components/ app/page.tsx` finds nothing (exit 1).
- `lib/` diff: only comment lines changed. Grepping the `git diff -- apps/web/lib` lines that aren't comments finds nothing (exit 1).
- I didn't run `npm run build`, because it would overwrite the `.next` that :3100 is serving. The served build is from 22:32:23 and is newer than the sources. ci runs the full build.

## Requested re-checks

| Check | Expected | Result | Evidence |
|---|---|---|---|
| Held Enter | exactly 1 confirm | **PASS** | `review-code-enter-repeat.mjs`: `{"clicks":1,"confirms":1,"labels":["Signing","Signed","Hold to sign again"]}` (was 44 clicks, 5 confirms). Security probe, CDP `autoRepeat` for 2.5 s: `enterHeld: {signs: 1, clicksFired: 1}` (was 58 clicks, 6 signs). |
| Untrusted events (S3) | no confirm | **PASS** | Security probe: `scriptClick.signs 0`, `dispatchedClick.signs 0`, `syntheticHold.signs 0`. The trusted paths still work: `enterOnce.signs 1`, `mouseHeld3s.signs 1`. |
| Late release | no second confirm | **PASS** | `hold-state-trusted.mjs` runs the real `HoldButton.tsx` under StrictMode with trusted mouse input. A release 1 s into a 4 s confirm leaves the label on `Busy`. A second full hold during that confirm leaves `callsWithinFlight: 1`. I also swept the release time from 860 to 950 ms: below 900 ms you get `Hold` and 0 calls, from 900 ms you get `Busy` and 1 call. A second press never adds a call, and all 9 runs read `consistent: true`. |
| Touch slide-off | cancels | **PASS** | `review-code-touch-slide.mjs` (375, CDP touch, finger 176 px below the button for 1 s): `labelsWhileOffButton: []`. Control (`still`): `["Signing","Signed"]`. `walk.mjs touch 375`: a 300 ms tap gives `labels: []`; an 1100 ms press gives `["Signing","Signed","Hold to sign again"]`. |
| Right-button hold | no confirm | **PASS** | Live page (`busy-paint.mjs`): `rightButtonHold_domStates: []`. Harness: `E_rightButtonHold: {calls: 0}`. |
| Reduced motion: scene | static, no loop | **PASS** | `walk.mjs reduced 1440`: `gl.draws: 1` in total, `drawsPerSecond: 0`. The canvas changes 0 pixels across load+700 ms, settled+700 ms, mouse in, and mouse moved (was 3,169 px per 700 ms at 60 draws/s). `layout-resize.mjs`: resizing 1440 → 1000 gives exactly one more draw (`draws 1 → 2`) and a 1000 px bitmap. 1 s later it is still at 2 draws. |
| Reduced motion: hold fill | still animates | **PASS** | `review-code-reduced-fill.mjs` at 150 ms: `reduce: matrix(0.14818, …)` and `no-preference: matrix(0.14811, …)` (was `scaleX(1)` at once under reduce). |
| Dot colour | WebGL = 2D fallback = token #1723e2 | **PASS** | `px.mjs`, top pixel colour: WebGL `23,35,226` (1440 light 11,690 px, 1440 dark 11,575, 375 light 3,148). The 2D fallback is also `23,35,226`, from all three no-WebGL routes: `--disable-webgl*` at 1440 and 375, `--use-gl=disabled`, and the aborted three chunk. #1723e2 = rgb(23,35,226). All 3 theme blocks in `tokens.css` (lines 16, 42, 68) hold `#1723e2`. |
| Quiet button | aligned, 44 px | **PASS** (one note for ux-ui) | `layout-resize.mjs`: "Read block again" is `h 44`, `padding 0px 8px` (was 32 px tall with 24 px padding). Both action buttons' boxes start at the card text edge: 375: 41/41/41; 1440: 249/249 and 757/757. The quiet button's text starts 8 px in from that edge (`px-2`). ux-ui asked for `px-0`, flush with the text, so I leave that call to them. |
| Busy on a pointer hold | visible | **PASS** | Before, the pointer path never entered busy. Now `flushSync` commits it every time. `walk.mjs hold 1440` B: `904ms Signing dots=3` → `905ms Signed` → `1356ms idle`. `busy-paint.mjs` samples the label in every animation frame: at 6× CPU the frames show `["Hold…","Signing","Signed","Hold…"]` (`busyPainted: true`). At 1× CPU the DEP-3 sign settles within one frame, so no frame shows busy, but the DOM does: `"Signing|dots=3"`. A confirm that takes longer than one frame stays on `Busy` (harness C, 4 s). |
| No WebGL | no three.js console errors | **PASS** | `nowebgl-1440`, `nowebgl-375`, `nowebgl2-1440` and `nothree-1440` each show `contexts: 0`, `ctx2d: 1`, the page usable and DEP-3 signed. Their only console errors are `ERR_CONNECTION_REFUSED` (publicnode, blocked on purpose) and `ERR_FAILED` (the three chunk I aborted). The 3 "WebGL context could not be created" lines from round 1 are gone. When no WebGL is available, the 2D fallback redraws on resize: 1440 → 800 gives an 800×404 bitmap. |
| `next dev` | not stuck on busy | **PASS** | `dev-hold.mjs` against :3104. The fiber's StrictMode bit is set (`strictModeOnFiber: true`). Three Enter presses and three 1 s pointer holds make `signedDuringLoop: 6`, and after each one the label is back to `Hold to sign again` with `aria-disabled="false"`. Enter held for 2 s: `confirms: 1`. `pageErrors: []`. |
| Unmount frees the GPU context (round 1 OPEN 4) | context lost | **PASS** | `unmount.mjs`: after a forced React unmount, `drawsPerSec: 0`, the canvas is gone, `contextLost: true` (was `false`), and the scene's 3 listeners are removed. The `pageerror` is the probe's own forced error. |

## Smoke tests

| Check | Result | Evidence |
|---|---|---|
| 375 and 1440, light and dark | PASS | `shots/tester-{375,1440}-{light,dark}-{load,settled}.png`, `-focus-1`. No horizontal overflow (375 = 375, 1440 = 1440). The wordmark is on one line at 375, and the label is hidden below `sm`. |
| Fonts self-hosted | PASS | Loaded faces are `Instrument Sans normal 400 700`, `Instrument Serif italic 400` and `Geist Mono normal 100 900`. The serif's normal face is gone, as the code review asked. `googleFontRequests: 0` in every walk. |
| Hero contrast with the night wash | **FAIL for one text pair** | `hero-contrast.mjs` hides the text and keeps the scene and the wash. It finds the brightest background pixel under each line box across 3 frames, 700 ms apart. Wordmark: 12.96 at 375, 15.63 at 1440. h1: 7.58 at 375, 13.43 at 1440. "device": 15.63 / 13.64. Paragraph at opacity 0.8: **5.26** at 375 (over raw dots; the wash ends at 75 %), 9.57 at 1440. **"Phase 1 · rail proofs" (13 px mono, opacity 0.7): 4.31 at 768 and 1440, light and dark**, over a full `rgb(23,35,226)` dot (OPEN 1). Light and dark give the same numbers, because the hero uses scene tokens that don't change with the theme. |
| Hold fill contrast (ux 6) | PASS | From the tokens, with `bg-ink/20` over the accent: label on the full fill is 7.99 (light) and 8.52 (dark), up from 6.35 and 7.13 on the bare accent. The fill only adds contrast now (was 3.77 and 4.47). |
| Other page text pairs | PASS | `walk.mjs views`: `contrast_{light,dark}_settled_fail` lists only the label above. At load, "Read block again" is 2.03 / 2.45 while `aria-disabled` at opacity 0.45. That's an inactive control, which WCAG 1.4.3 exempts (as in round 1). |
| Batch 001: Nym read | PASS | `views-375`: `Block 12,301,986 on chain 1874, via Anon-RPC (Nym) (41.4 s)`, pill `OK`. `views-1440`: `Block 12,302,108 … (18.1 s)`, `OK`. `regress.mjs`: cold read `Block 12,302,505 … (21.5 s)`. Pressing Enter on "Read block again" keeps focus, sets `aria-disabled="true"` and pill `Running`, then a warm read returns `Block 12,302,507 … (1.1 s)` with focus still on the button. See the note under OPEN about two failed cold sessions. |
| Batch 001: 0 requests to Ankr | PASS | `ankrRequests: 0` in every walk, and `ankr: 0` in both `regress` runs. Hosts per load: localhost, publicnode ×2, jsDelivr ×1, validator.nymtech.net ×7–8, plus the harness blobs. Same as batch 001. |
| Off-screen pause and remounts | PASS | `walk.mjs cleanup 375` (H=400): 60 draws/s while visible, 0 off-screen, 60 back on screen. 20 navigation cycles: `contexts: 1`, `contextLostWarnings: 0`. |
| Keyboard, reject, focus | PASS | `walk.mjs hold 1440`. Enter goes busy at 1 ms, done at 2 ms, idle at 454 ms. Space: 6 / 6 / 458 ms. Enter at 20× CPU: 31 / 48 / 505 ms. Focus stays on the button at every sample. A rejected sign (unreadable key) goes busy → idle by pointer (902 ms) and by keyboard (1 ms), with pill `Failed`. A release at 400 ms cancels (fill `0.185` at 200 ms, then `0`). Leaving the button cancels. Focus ring: `solid 2px`, offset `2px`. |

## DONE
- All 10 requested re-checks and the smoke tests above, run against the live build on :3100. The `next dev` check ran on :3104, which is now stopped.
- Shots (22) are in `round-2/shots/`: `tester-{375,1440}-{light,dark}-{load,settled}.png`, `tester-{375,1440}-focus-1.png`, `tester-1440-reduced-scene-mouse.png`, `tester-1440-motion-scene-mouse.png`, `tester-{1440,375}-nowebgl.png`, `tester-1440-nowebgl-usegl-disabled.png`, `tester-1440-nothree.png`, `tester-1440-hold-200ms.png`, `tester-1440-hold-busy-throttled.png`, `tester-1440-hold-rejected.png`, `tester-1440-hold-done-throttled.png`, `tester-375-touch-after.png`, `tester-375-cleanup-after-cycles.png`.
- JSON and output for every check are in `round-2/probes/`.

## OPEN
1. **MEDIUM, spec criterion 7 FAIL (AA on every text pair): "Phase 1 · rail proofs" is 4.31:1 over lit dots at 640 px and up.** `apps/web/app/page.tsx:124`, `opacity-70`. Owner: claude-frontend.
   - At `sm`+ the label sits at the header's right end, past where the night wash stops (75 %), over the full-colour sky dots.
   - 13 px text needs 4.5:1. Measured from pixels: 4.31 at 768 and at 1440, in both themes. `walk.mjs` audit agrees (`ratioOverDot 4.31`).
   - You can see it in `shots/tester-1440-dark-settled.png`.
   - Fix (one word, tested in arithmetic): drop `opacity-70`. Glass-ink at full opacity over `#1723e2` is 7.58:1, and `opacity-85` would give 5.79.
2. **LOW, note for ux-ui (not a tester FAIL): the quiet button's text sits 8 px in from the card text** (`components/Button.tsx:15`, `px-2`). Owner: claude-frontend if ux-ui wants it.
   - Its box lines up with the card edge and is 44 px tall.
   - Round 1 ux asked for `px-0` so the text is flush. The build chose `px-2`.
3. **Environment note, not this batch: 2 of 5 cold Nym sessions failed** with the plain line `HTTP request failed.`, after `[worker] nym tunnel ready` (`probes/views-1440-run1-nymfail.json`, `probes/regress-run1-nymfail.json`). In the regress run, the warm retry on the same tunnel failed too. Reruns passed (18.1 s and 21.5 s).
   - `lib/anon.ts` has only comment changes in this batch, so this isn't a regression here.
   - The failure UI behaved as designed: pill `Failed`, one plain line, and the retry button still works.
   - Worth a look in batch 003 (claude-frontend): when a read fails after the tunnel is ready, rebuild the tunnel or pick another IPR before retrying.
4. **INFO:** at 1× CPU, the DEP-3 sign settles within one frame, so a pointer hold paints `Signed` without a visible busy frame. Busy is committed every time and paints whenever `onConfirm` takes more than a frame, as the Phase 3 pay will. Nothing to fix.

## NEEDS THE USER
- **Real devices (carried from round 1):** headless CDP can't show these.
  - On a real iPhone and Android, does a 900 ms touch-hold confirm without a context menu, text selection or `pointercancel`?
  - Can VoiceOver and TalkBack activate the HoldButton now that it checks `isTrusted` and `detail === 0` (their default action should be a trusted click)?
- **New dependency** three 0.186.1 and @types/three 0.186.0 (PIPELINE §11). The build report says the human approved it at the 001 gate (21:58).
- **Public copy:** the hero copy is internal-page copy. Phase 2 replaces the page.
