VERDICT: CHANGES

# Test report: 002-P2-web-design-foundation, round 1 (tester)

## Setup
- **Server:** the existing `next start` on http://localhost:3100 (pid 7216). `.next/BUILD_ID` was written at 22:03:25, after every changed source file (22:02:39), and the served HTML contains "Hold to sign again". I didn't restart it.
- **Tools:** Playwright 1.64.1, headless Chromium 1248. Every walk ran in a fresh context.
- **Scripts:** `round-1/walk.mjs` (modes `views hold touch reduced motion nowebgl nothree cleanup`) and `round-1/probes/{unmount,regress,px}.mjs`. The JSON reports are in `round-1/probes/*.json`.
- **Network:** only the two `views` walks and `regress.mjs` let the Nym read run. Every other mode blocks `ethereum-rpc.publicnode.com` to keep the network quiet, so their shots show DEP-6 "Failed / HTTP request failed." on purpose.
- **Secrets:** no `.env` value was read or printed. The JSON reports contain no 64-hex string (`grep -c '0x[0-9a-fA-F]\{64\}'` returns 0 on every file).
- **AT-\* IDs:** the spec cites none.

## Unit tests and static checks (apps/web)
- `npm test` gives `ℹ tests 16 ℹ pass 16 ℹ fail 0`: the 11 from batch 001 plus 5 dither tests. The dither tests cover seeding, bounds and depth, the lit moon with a dark sky, lamps only below the horizon, and an empty or tiny box. N4, the 64-zero key, is in `guest-wallet.test.mjs:56`.
- `npm run typecheck` gives `typecheck exit=0` (`next typegen && tsc --noEmit`, "Types generated successfully").
- `npm run lint` gives `lint exit=0`.
- Hex grep: `grep -rnE '#[0-9a-fA-F]{3,8}\b' components/ app/page.tsx` finds nothing (exit 1). `grep -rnE 'rgb\(|rgba\(|hsl\('` on the same paths also finds nothing (exit 1).
- Tokens against the approved demo (`design-refs/merchant-capital-demo.html`), compared selector by selector:
  - light: 21 compared, 0 diffs
  - dark: 14 compared, 0 diffs
  - the OS-dark media block equals `[data-theme="dark"]`: 22 compared, 0 diffs
  - the only differences are the ones the build report lists: font families point at next/font variables, and `--accent-glow` became `--shadow-glow`
  - computed styles: card `border-radius: 16px` (= `--radius-md`), buttons `999px`
  - I couldn't read the claude.ai tokens.json artifact, so the demo was the reference.

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | tokens.css matches the design system; Tailwind maps it; no hex in components | PASS | See the token diff above; the hex grep finds 0 matches. |
| 2 | Instrument Sans, Instrument Serif italic and Geist Mono through next/font; no runtime Google requests | PASS | Loaded faces: `Instrument Sans normal 400 700`, `Instrument Serif italic 400`, `Geist Mono normal 100 900`. h1 is `"Instrument Sans", "Instrument Sans Fallback"…`; `.emphasis` is `"Instrument Serif"… italic`. `googleFontRequests: 0` in all 13 walks and probes. The only hosts were localhost plus the Nym hosts. |
| 3a | Scene as GPU points, 4×4 Bayer, three loaded after first paint | PASS | `gl.contexts: 1`, 60 `drawArrays`/s. three comes from a separate chunk (`0qim1xdlnxjks.js`, found by the `nothree` route). |
| 3b | Dots gather on load (about 1.8 s) | PASS | `motion`: 14.7 % of canvas pixels change between 0 and 700 ms (7,015 blue pixels at 0 ms, 58,457 settled). |
| 3c | Parallax and push with the cursor; lamps twinkle | PASS | Moving the mouse into the scene changes 12.4 % of pixels; idle twinkle changes 0.5 % per 700 ms. Shot: `tester-1440-motion-scene-mouse.png`. |
| 3d | **Reduced motion: static, no push or parallax** | **FAIL** | No gather (0.50 % vs 14.7 %) and no push (mouse 0.55 % vs idle 0.51 %), but **not static**: with `reducedMotion: "reduce"`, 3,169 pixels still change every 700 ms (`settled_700ms_noMouse.differingPixels`, the same as without reduce), and the loop still draws at 60/s. See OPEN 1. |
| 3e | Pauses off-screen | PASS | `cleanup-375` (viewport 375×400): `drawsVisible: 60`/s; with the hero scrolled away (`bottom: -96`), `drawsOffscreen: 0`; back on screen, `drawsBackOnScreen: 60`. |
| 3f | Unmount disposes renderer, geometry, material and listeners | PASS, with one LOW | `probes/unmount.mjs` forces a React unmount (an error boundary takes over). After it, `drawsPerSec: 0` and the canvas is gone. The scene's `pointermove`, `pointerleave` and `resize` listeners are removed (9 tracked before, 6 after; the 3 removed are the scene's). The old canvas still reports `isContextLost(): false`, so the GPU context isn't released (OPEN 4). Navigating away and back is a full document load on this one-route app: 20 cycles at each width give `contextLostWarnings: 0` and `contexts: 1` per document. |
| 3g | No WebGL or no three: a still 2D drawing, no crash | PASS | All three variants draw `ctx2d: 1`, `contexts: 0`, no pageerror, and the page stays usable (DEP-3 OK, hold button visible): `--disable-webgl --disable-webgl2 --disable-3d-apis` at 1440 (25,928 blue pixels) and 375 (9,030); `--use-gl=disabled`; and the three chunk aborted (`nothree`, WebGL still available). Shots: `tester-1440-nowebgl.png`, `tester-375-nowebgl.png`, `tester-1440-nowebgl-usegl-disabled.png`, `tester-1440-nothree.png`. Console: three.js logs 3 `console.error` lines first (OPEN 7). |
| 4 | `lib/dither.ts` is pure, and its tests cover the listed cases | PASS | 5/5 in `npm test`. No DOM or three import in `lib/dither.ts`. |
| 5a | Button: primary, glass, quiet; pill; aria-disabled styles | PASS, with one LOW | Pill radius `999px`. While running, "Read block again" has `aria-disabled="true"`, `opacity 0.45` and no lift on hover (`translate: 0px`). The primary lifts on hover (`translate: 0px -1px`, bg `accent-hover`). The quiet variant's `px-2` loses to the base `px-6`: computed `padding: 4px 24px`, so the text sits 24 px in from the card edge (OPEN 3). |
| 5b | HoldButton: a release before 900 ms cancels | PASS | `hold-1440` A: mouse down, release at 400 ms. The fill is at `scaleX(0.185)` at 200 ms and `scaleX(0)` after release. The timeline has one entry (still idle): no sign. Touch at 375 (CDP touch events, 300 ms): `labels: []`, click `detail=1`, no confirm. Leaving the button mid-hold also cancels (C: one entry). |
| 5c | Holding about 1 s confirms: busy, done, idle | PASS, with one LOW | Hold for 1000 ms: idle → `Signed` (`aria-disabled="true"`) at **905 ms** → idle at **1358 ms** (done lasts 453 ms). The fill is `scaleX(0.48)` at 450 ms. Touch press for 1100 ms: `["Signed","Hold to sign again"]`. On the pointer path, busy (pulsing dots) never paints, even with the CPU throttled 20×, because the DEP-3 sign settles in the same task (OPEN 5). A press during done is ignored (one sign in B2). |
| 5d | A keyboard press confirms at once and focus stays | PASS | Enter: busy `Signing` with 3 dots at **2 ms** → `Signed` at 3 ms → idle at 454 ms. Space gives the same at 6, 7 and 459 ms. Enter with the CPU throttled 20×: busy at 38 ms, done at 55 ms, idle at 506 ms. `focusOnBtn: true` at every step; focus samples at 0, 30, 100, 300 and 800 ms all land on the button. |
| 5e | A rejected onConfirm returns to idle | PASS | With the saved key set to `not-a-key`: the pointer hold goes idle → idle at 905 ms, status `The saved guest wallet is unreadable.`, pill `Failed`, and no "Signed". Enter: busy → idle at 2 ms, and focus stays. Shot: `tester-1440-hold-rejected.png`. |
| 5f | "Hold to sign again" on the DEP-3 card | PASS | Screenshots at both widths. |
| 6 | Page restyled; batch 001 behaviour unchanged | PASS | DEP-6 through Nym: `Block 12,300,365 on chain 1874, via Anon-RPC (Nym) (24.7 s)` at 375 and `Block 12,300,359 … (19.2 s)` at 1440. The pill shows `OK`. `ankrRequests: 0` in all walks. Hosts per load: publicnode ×2, jsDelivr ×1, validator.nymtech.net ×7, the same as batch 001. `probes/regress.mjs`: Enter on "Read block again" keeps focus, shows `aria-disabled="true"` and pill `Running`, then `Block 12,300,710 … (2.4 s)` warm with focus still on the button. DEP-3 verifies at both widths. No horizontal overflow (`scrollW 375 = clientW 375`, and 1440 = 1440). |
| 7 | Theme follows the OS; AA on every text pair | PASS for the page's token pairs, with notes | `emulateMedia` light and dark switch the page; the shots differ. Every text node passes AA against its composited background in both themes. One exception: "Read block again" while running at opacity 0.45 (2.03 light, 2.45 dark). It is an inactive control, which WCAG 1.4.3 exempts. Hero text against the night colour: 15.86, 8.15 and 10.36. Against a lit dot pixel it drops to 3.88, 2.70 and 3.06 (OPEN 6). Transient pairs, computed from tokens: on-accent/accent is 6.35 (light) and 7.13 (dark); the done state's surface/positive is 5.56 and 8.26; text over the full hold fill is 3.77 and 4.47 (OPEN 6). The focus ring is `solid 2px` accent, `offset 2px`, on both buttons. |
| 8 | Shots at 375 and 1440, light and dark | PASS | `shots/tester-{375,1440}-{light,dark}-{load,settled}.png` plus `-focus-1`, hold, touch, reduced, motion, no-WebGL, no-three and cleanup shots. |
| N4 | Zero-key case in the guest-wallet test | PASS | `test/guest-wallet.test.mjs:56`, in the 16/16. |
| ci | `typecheck` script | PASS | `"typecheck": "next typegen && tsc --noEmit"`, exit 0. |
| L1 | `shortcut:` → `ponytail:`, comments only | PASS | `git diff lib/` touches only comment lines (`anon.ts:18,48-49,74`, `guest-wallet.ts:10`). |

## DONE
- All of the above. The press-and-hold, keyboard, touch, reject, no-WebGL, no-three, off-screen pause, unmount and batch 001 regression checks ran against the live build. The command and JSON output are in `round-1/probes/`.

## OPEN (owner: claude-frontend for all)
1. **MEDIUM, spec FAIL (3d): the scene isn't static under reduced motion.** `components/DitherScene.tsx:145-148`. `uniforms.uTime.value = t / 1000` runs on every frame whatever `reduce` is, so lamps, windows and the moon keep twinkling and the loop renders at 60 fps. Measured: 3,169 pixels change per 700 ms with reduce on, the same as with it off. The approved demo does the same (demo line 653), but the spec and the build report both say "static". Proposed fix: when `reduce` is on, render one frame (and again on resize) and start no animation loop. That also saves the GPU work.
2. **MEDIUM, also NEEDS THE USER: the WebGL dots aren't the token colour, so the two render paths disagree.** `components/DitherScene.tsx:37,97`.
   - `new THREE.Color(cssColor("--scene-dot"))` converts `#5468f2` to linear values. The ShaderMaterial writes them out unconverted.
   - Measured top pixel: WebGL dots render `rgb(23,35,226)` (49,189 px, `probes/px.mjs` on `tester-1440-light-settled.png`). The 2D fallback renders the token `rgb(84,104,242)` (24,897 px, `tester-1440-nowebgl.png`).
   - Arithmetic: sRGB→linear of 84, 104 and 242 gives exactly 23, 35 and 226.
   - The demo has the same code (lines 599 and 622), so the look the human approved is the saturated `rgb(23,35,226)`.
   - Fix A, to honour the token: add `#include <colorspace_fragment>` after `gl_FragColor` in the fragment shader. The scene then turns lighter, like the fallback.
   - Fix B, to keep the look: make the token the rendered colour, and the fallback with it.
3. **LOW: the quiet Button's padding is overridden.** `components/Button.tsx:13` sets `px-2`, and the base string (`:6`) sets `px-6`. Tailwind emits `px-6` later, so it wins: computed `padding: 4px 24px`. In every shot, "Read block again" is indented 24 px from the card text. `h-auto` beating `h-12` (computed height 32) is also down to class order. Fix: move `h-12 px-6` out of `base` into `primary` and `glass`.
4. **LOW: the WebGL context isn't released on unmount.** `components/DitherScene.tsx:176`. three 0.186's `renderer.dispose()` doesn't call `forceContextLoss()`. After the unmount the old canvas reports `isContextLost(): false`. Today navigation always reloads the document, so this is harmless here. The Phase 2 routes will mount and unmount the scene client-side, and Chrome warns after 16 live contexts. Fix: `renderer.forceContextLoss()` before `renderer.dispose()`.
5. **LOW: on the pointer path, busy is skipped when `onConfirm` settles within the same task.** `components/HoldButton.tsx:36-37`.
   - `confirm()` runs from a `setTimeout`. React batches `setPhase("busy")` with the `setPhase("done")` that follows the microtask-fast DEP-3 sign.
   - So a hold goes idle → Signed with no pulsing dots, even with the CPU throttled 20×. The keyboard path does show busy, because discrete events flush synchronously.
   - A network-bound onConfirm, like the Phase 3 pay, will show busy, so this is cosmetic for now.
   - Optional fix: `flushSync(() => setPhase("busy"))` in `confirm`.
6. **LOW (for ux-ui): text over the scene and the hold fill.**
   - `app/page.tsx:120-127`: hero text over lit dot pixels falls to 2.70 (`Phase 1 · rail proofs`: 13 px mono at opacity 0.7), 3.06 (the paragraph) and 3.88 (the wordmark).
   - At 375, the wordmark and the "Phase 1 · rail proofs" label each wrap to 2 lines, and the label sits on the moon (`tester-375-light-settled.png`).
   - `components/HoldButton.tsx:81`: over a full fill, the label is 3.77:1 (light) and 4.47:1 (dark) for up to 900 ms.
7. **LOW: three.js logs 3 `console.error` lines before the 2D fallback** ("A WebGL context could not be created…", "Error creating WebGL context."). Not a crash. Optional: probe `document.createElement("canvas").getContext("webgl2")` before constructing the renderer.
- **Environment note, not a finding:** every headless run with a WebGL context logs 4 `GL Driver Message … GPU stall due to ReadPixels` warnings at about 0.3 s. Runs without WebGL log 0. DitherScene never calls `readPixels`, and the builder's real-GPU Chrome had a clean console, so this is headless capture noise.

## NEEDS THE USER
- **Scene blue (OPEN 2):** should the dots be the token `#5468f2` (lighter, as in the 2D fallback) or the deeper `rgb(23,35,226)` the approved demo actually renders? Either way the two render paths should match.
- **New dependency** `three@0.186.1` and `@types/three@0.186.0` (PIPELINE §11). The build report says the human approved it at the 001 gate (21:58).
- **Not verifiable headless:** a long press on a real iPhone or Android. Does a 900 ms touch-hold confirm without a context menu, text selection or `pointercancel`? And can VoiceOver or TalkBack activate a button that only confirms on `detail === 0` clicks or a held pointer? CDP touch events confirmed the hold path; the screen-reader activation path is untested.
- **Public copy:** the hero copy ("Private reads. Signed on your device.") is internal-page copy. The build report says Phase 2 replaces the page.
