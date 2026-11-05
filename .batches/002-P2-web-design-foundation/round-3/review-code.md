VERDICT: PASS

# Code review: 002-P2-web-design-foundation, round 3 (reviewer-code, last round)

Scope: `git diff -- apps/web` plus the untracked `app/tokens.css`, `components/{DitherScene,Button,HoldButton}.tsx`, `lib/dither.ts` and `test/dither.test.mjs`. I read every changed file in full. Inputs: spec.md, build-claude-frontend.md (rounds 2 and 3), my round-1 review, and the tester's round-2 and round-3 reports. I ran `npm test` myself: 16 pass, 0 fail. I didn't run `npm run build`, because ci runs it. No `.env` value was read.

New probes from this round are in `round-3/probes/review-code-activity-{remount,hold}.mjs`, with their output in the matching `.json` files. Both run the real components on React 19 dev builds in headless Chromium, with no server.

## Why PASS
Every HIGH and MEDIUM finding from round 1 is fixed, and the tester measured each fix (rounds 2 and 3). No spec acceptance criterion fails. I found one new MEDIUM (D1 below), but it can't happen on this batch's page: `/` is the only route and there is no client navigation. It must land before a second route ships. Everything else open is LOW.

## Traceability, ABI, scope
- Every change maps to the spec: tokens, fonts, scene, buttons, the page restyle and the 001 follow-ups (N4, `typecheck`, the `anon.ts` comments, L1). The `useProof` rethrow (`app/page.tsx:31-37`) is what lets a rejected sign return the HoldButton to idle.
- ARCHITECTURE.md §2 doesn't apply: there are no contract calls.
- Hex grep on `components/`, `app/page.tsx` and `app/layout.tsx` finds nothing (exit 1).
- Dependency pins are exact in the lockfile: `three` 0.186.1 (`package-lock.json:6534`) and `@types/three` 0.186.0 (`:1828`).
- Scope creep: none of substance. Speculative exports are listed under LOW #7.

## Round-1 findings, checked one by one
| # | Round 1 | Now | Evidence |
|---|---|---|---|
| 1 HIGH | Held Enter confirms repeatedly | **Fixed** (`HoldButton.tsx:83`, `e.repeat` → preventDefault) | R3 tester: `clicks 1, confirms 1` |
| 2 HIGH | Stuck on busy under StrictMode | **Fixed**: the `mounted` ref is gone and only the timer is cleared (`:36`) | R2 `dev-hold` on `next dev`: 6 signs, idle after each. R3: StrictMode `["Hold","Hold"]` |
| 3 MEDIUM | Late release re-arms a confirm | **Fixed**: the phase is in a ref (`:32`), and `cancelHold` checks it (`:67`) | R3: `labelAfterLateRelease "Busy"`, `callsWithinFlight 1`. The 860–950 ms sweep is consistent |
| 4 MEDIUM | Touch slide-off didn't cancel; right button confirmed | **Fixed**: bounds check (`:61-65`), `e.button !== 0` (`:56`) | R2: `labelsWhileOffButton []`; right button `calls 0` |
| 5 MEDIUM | Reduced motion jumped the fill to full | **Fixed**: `data-motion="essential"` (`:97`) is left out of the rule (`globals.css:64`) | R2: `scaleX` 0.148 at 150 ms under reduce |
| 6 LOW | Button ignored `aria-disabled` on click | **Fixed** (`Button.tsx:28-30`). `onClick` is destructured out, so the spread can't put it back | By reading. `page.tsx:145` still has its own guard (LOW #6b) |
| 7 LOW | HoldButton repeats Button's classes; unused exports and prop | Open (recorded as not done) | LOW #7 |
| 8 LOW | Type styles beat utilities | **Fixed** (`globals.css:42`, `@layer components`) | |
| 9 LOW | Font self-references; hard-coded glass blur | Open (recorded) | LOW #9 |
| 10 LOW | Unused serif normal face | **Fixed** (`layout.tsx:7`, `style: "italic"`) | R2: only the italic face loads |
| 11 LOW | `powerPreference` | **Fixed** (removed) | |
| 12 LOW | 2D fallback drawn once | **Mostly fixed**: the no-WebGL2 path redraws on resize (`DitherScene.tsx:80-85`) | The three-load-failure path (`:188-191`) still draws once (LOW #12b) |
| 13 LOW | Brightness thresholds duplicated between GLSL and TS | Open (recorded) | LOW #13 |
| 14 LOW | `tokens.css:1-3` says "generated … regenerate" | Open (recorded) | LOW #14 |
| 15 LOW | Dither test checks only the first 300 floats and no depth order | **Not fixed.** The build report lists it under "Not done", and `test/dither.test.mjs:6-10` is unchanged | LOW #15 |
| 16 INFO | The three chunk is the whole library | Unchanged | INFO |

The tester items you asked about:
- DitherScene reduced motion: fixed (`:151`, one draw; R3 `gl.draws 1`, 0 pixels changed).
- Colour space: fixed (`:39`; WebGL = fallback = `23,35,226`).
- WebGL2 check: fixed (`:81-87`; no three.js console errors without WebGL).
- `forceContextLoss`: added (`:185`), but see D1.

## Deferred: must land before the next batch adds a route (owner claude-frontend)

### D1 MEDIUM (new): cleanups treat a hidden route as destroyed, and Next 16 shows it again on the same DOM
**Context:** `next.config.ts` sets `cacheComponents: true`. With it, Next 16 wraps the last routes in `<Activity mode="hidden">` (`node_modules/next/dist/client/components/layout-router.js:518`, flag set at `build/define-env.js:85`). Hiding a route runs every effect cleanup and keeps the DOM and state. Showing it again re-runs the effects on the same nodes. Two components break when that happens.

**a. `components/DitherScene.tsx:185`: after the route is shown again, the scene stays blank.**
- Cleanup calls `forceContextLoss()` on the canvas that React keeps. The re-run then gets the same, now lost, `webgl2` context back.
- `new WebGLRenderer` throws on that context (`WebGLCapabilities.js:59`, `getShaderPrecisionFormat` returns null). The `.catch` swallows the error, and `getContext("2d")` on a WebGL canvas returns null, so nothing draws: you get an empty night.
- The same thing happens in `next dev` after a Fast Refresh edit to DitherScene.tsx.
- This regression came from the round-2 fix for tester OPEN 4.
- Measured (`review-code-activity-remount.json`): as built, 0 draws after the second show, with `webgl2Lost: true`. Control with line 185 deleted: 40 draws in 700 ms.
- Fix: delete line 185 (tested). If freeing the GPU on hide still matters (round-1 OPEN 4), give each effect run its own canvas instead: create it in the effect, append it to the host, and remove it in cleanup.

**b. `components/HoldButton.tsx:36`: hidden during the 450 ms "done" window, the button sticks on "Done".**
- The cleanup clears the done → idle timer, and nothing else ever resets "done". The button stays `aria-disabled` and ignores input until a full remount.
- This is likely in Phase 3, where pay → done → navigate to a receipt.
- Measured (`review-code-activity-hold.json`): after the second show, the label reads `Done`, `aria-disabled "true"`, and Enter does nothing (`calls 1`).
- Fix (tested: back to `Hold`, and the next Enter confirms, `calls 2`). Keep busy as it is, so an in-flight confirm can't be re-armed:
  `useEffect(() => () => { clearTimeout(timer.current); if (phaseRef.current !== "busy") { phaseRef.current = "idle"; setPhaseState("idle"); } }, []);`
- **Trigger:** the first batch that adds a second route or a client `<Link>`/`router.push` (the Phase 2 screens, or batch 003, whichever comes first). Re-run both probes there.

## LOW (defer; owner claude-frontend; fold into the next batch that touches the file)
- **#6b** `app/page.tsx:145`: the `reading ? undefined :` guard is now redundant with `Button.tsx:30`. Use `onClick={() => void retryRead().catch(() => {})}`.
- **#7**
  - `HoldButton.tsx:88-90` duplicates Button's shape, hover and accent classes. Share one string from `Button.tsx`.
  - Delete the unused exports and prop: `HOLD_MS`/`DONE_MS` (`HoldButton.tsx:14-15`), the `aria-describedby` prop (`:27`, `:77`), the `mulberry32` export (`lib/dither.ts:8`), and the `buttonClasses` export (`Button.tsx:22`). `buttonClasses` has no caller outside the file; export it when a link-button exists.
- **#9**
  - `globals.css:23-25`, `--font-*: var(--font-*)`, are self-references. They only work because `tokens.css` is unlayered. Delete them and add one comment.
  - `Button.tsx:13`: use `backdrop-blur-(--glass-blur)`.
- **#12b**
  - `DitherScene.tsx:188-191` repeats the long `drawStatic(...)` call and doesn't redraw on resize. Hoist `drawFallback` above the `import()` and use it in both paths.
  - The no-WebGL2 resize listener (`:84`) isn't debounced, so it runs a full `buildDots` on every resize event. Reuse the 150 ms debounce.
- **#13** `DitherScene.tsx:26-29` against `lib/dither.ts:39-40, 52`: export `LAMP`, `WINDOW` and `MOON` and use them on both sides.
- **#14** `app/tokens.css:1-3`: say "ported by hand from the design system artifact; keep both in step". There is no tokens.json or generator in the repo.
- **#15** `test/dither.test.mjs:9`: use `assert.deepEqual(a, b)` on the whole `Dots`. Today, swapping `mulberry32(7)` (starts and seeds) for `Math.random` still passes.
  - Add one depth-order assert: the deepest sky dot is shallower than the shallowest sea dot.
  - The spec's "covers seeding … depth" is only half met. That's acceptable for groundwork, but close it when the dither file is next touched.
- **#17 (new)** `HoldButton.tsx:63-64`: the bounds check reads the transformed rect. Under `active:scale-[.97]` the box shrinks about 3 px per side on a 200 px button, so a press at the very edge cancels on the first finger jitter.
  - Fix: allow some slop, e.g. `const s = 8;` and compare against `r.left - s` and so on.
  - Check this with the real-device test the tester flagged.

## INFO for batch 003 (pay page)
- `HoldButton.tsx:58` captures `confirm`, and with it `onConfirm`, at press time. If the amount or quote changes during the 900 ms hold, the confirm runs with the old values. Read the latest `onConfirm` from a ref, or make the pay `onConfirm` read its inputs when it is called.
- `e.detail === 0` (`:85`) is the only non-pointer path. Whether VoiceOver and TalkBack activations arrive with `detail 0` is still the tester's NEEDS THE USER (real devices). Settle it before the HoldButton moves money.
- The three chunk is about 184 KB gzipped (round-1 #16). Measure it before the pay page counts against NFR-12.

## Ponytail
- The fix for D1a is a deletion. The fix for D1b is one guarded line.
- Nothing here needs a new dependency or a new abstraction.

## NEEDS THE USER
- Nothing new from code review. The open items are the tester's: real-device hold, VoiceOver and TalkBack, and the three dependency (PIPELINE §11).
