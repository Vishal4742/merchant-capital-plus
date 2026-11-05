VERDICT: CHANGES

# Code review: 002-P2-web-design-foundation, round 1 (reviewer-code)

Scope: `git diff HEAD -- apps/web` plus the untracked `components/`, `lib/dither.ts`, `app/tokens.css` and `test/dither.test.mjs`. I read every changed file in full. The tester's 7 OPEN items in `test.md` are not repeated here. Where a finding here changes the weight of one of them, it says so.

How I checked: I read the code, looked at the built output in `apps/web/.next`, and ran four probes in headless Chromium. Three ran against the tester's `next start` on :3100. `review-code-hold-state.mjs` ran the real `components/HoldButton.tsx` (compiled with the repo's `typescript`) on React 19 dev builds. All four are saved in `round-1/probes/review-code-*.mjs` so round 2 can run them again. I tested each proposed fix the same way before writing it down. No `.env` value was read.

## Traceability, ABI, scope
- Every change maps to the spec: tokens, fonts, scene, buttons and the page (NFR-6, FR-PAY-7 groundwork, NFR-8, NFR-11, the design lock and the three.js request), plus the 001 follow-ups (N4, the `typecheck` script, the `anon.ts` comments, L1). The `useProof` rethrow (`page.tsx:31-37`) is what lets a rejected sign return the HoldButton to idle, so it is in scope.
- ARCHITECTURE.md §2 (the contract ABI) doesn't apply: this batch makes no contract calls.
- Dependencies: exact `three@0.186.1` and `@types/three@0.186.0`, as the spec says. The types' extra packages (`@dimforge/rapier3d-compat`, `fflate`, `meshoptimizer` and others) are `"dev": true` in the lockfile, so none of them ship.
- `tools/watch-research.sh` is untracked, outside `apps/web`, and not in this spec. Don't commit it under 002.

## What holds up
- **Dynamic import:** `import("three")` runs inside the effect and builds as its own chunk. The `cancelled` flag and `cleanup` are local to each effect run, so an unmount before load and the StrictMode dev remount both behave.
- **Shaders:** correct for a `ShaderMaterial`. three prepends the matrices, `position`, the precision line and the WebGL2 `attribute`/`gl_FragColor` defines.
- **Twinkle decoding:** it reads today's brightness codes correctly (lamp 1.0, window 0.85, moon 0.97). Sky glow peaks near 0.47 and the sea near 0.64, so neither lands in the 0.8–0.9 window band.
- **Camera and gather:** the y-down orthographic camera is fine, and `uProgress` = 1 clamps every dot home.
- **Disposal:** geometry on relayout and on unmount, plus the material, the renderer, the listeners, the observer and the loop (`forceContextLoss` is tester OPEN 4).
- **Tailwind map:** all 17 colour tokens are mapped. Computed values match (tester).

## Findings (owner: claude-frontend for all)

### HIGH
1. **`components/HoldButton.tsx:69`: holding Enter confirms again and again.**
   - What: the label tells people to hold, so a keyboard user holds Enter, and the browser fires a `click` with `detail === 0` on every auto-repeated keydown. Every time the button gets back to idle (450 ms after done), the next repeat confirms again.
   - Measured (`review-code-enter-repeat.mjs`): holding Enter for 2 s gave 44 clicks and **5 confirms** ("Signed" ×5).
   - Why it matters: on the Phase 3 pay page, holding Enter longer than one payment plus 450 ms pays twice.
   - Fix: `onKeyDown={(e) => e.repeat && e.preventDefault()}` on the button. Tested: 1 click, 1 confirm. Space is safe already, because it clicks on keyup.
2. **`components/HoldButton.tsx:27-34, 40, 42, 44`: in `next dev` the button sticks on busy after the first confirm.**
   - What: Next turns StrictMode on for the App Router when `reactStrictMode` isn't set (`node_modules/next/dist/build/define-env.js:150-151`, and `next.config.ts` doesn't set it).
   - StrictMode's dev remount runs the cleanup (`mounted.current = false`), and the setup never puts it back to `true`. So `.then` returns early and the phase stays `busy` with `aria-disabled`. The button is dead until reload.
   - Measured (`review-code-hold-state.mjs`): StrictMode plus a keyboard confirm still reads `Busy` after 1 s. The control without StrictMode reads `Hold`.
   - Why the tester missed it: production (`next start`) has no dev remount. But every Phase 2 session in `next dev` will hit it.
   - Fix, by deletion: remove the `mounted` ref and its three checks, and keep `useEffect(() => () => clearTimeout(timer.current), [])`. React 18+ ignores setState after unmount. Tested: `Hold` after 1 s under StrictMode.

### MEDIUM
3. **`components/HoldButton.tsx:52-56`: a late release can lead to a second confirm.**
   - What: `confirm()` runs from a `setTimeout`, so React renders `busy` later. If the pointerup lands in that gap, `cancelHold` still sees the old `phase === "holding"` and sets `idle` while `onConfirm` is still running. The button then reads "Hold to …", and another hold calls `onConfirm` again.
   - Measured (`review-code-hold-state.mjs`, release sent inside `onConfirm`): the label reads `Hold` during a 4 s confirm, and a second hold makes **2 `onConfirm` calls**.
   - Same root as tester OPEN 5 (busy is never painted), but this consequence makes OPEN 5 no longer optional.
   - Fix (one line): `setPhase((p) => (p === "holding" ? "idle" : p))` in `cancelHold`. Tested: the label reads `Busy` and there is 1 call. OPEN 5's `flushSync(() => setPhase("busy"))` closes the gap too. Use one of them, not both.
4. **`components/HoldButton.tsx:64-67`: sliding a finger off the button doesn't cancel on touch.**
   - What: touch pointers are captured to the button on press, so `pointerleave` only fires after the finger lifts. The build report says "release, leave or cancel resets it". That is true for a mouse (tester C) but not for touch, the pay page's main input.
   - Measured (`review-code-touch-slide.mjs`, CDP touch at 375): finger moved 176 px below the button and held 1 s. Result: `pointerleave` count 0, and the label went to **"Signed"**.
   - `releasePointerCapture` in `pointerdown` or in `gotpointercapture` didn't help in Chromium (tested).
   - Fix (tested; it cancels): `onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancelHold(); }}`.
   - In the same handler area: `startHold` takes any button. Add `if (e.button !== 0) return;`, because a right-button press and hold confirms today (and `:70` suppresses its context menu).
5. **`app/globals.css:60-62` with `components/HoldButton.tsx:84`: under reduced motion the hold fill shows "complete" at once.**
   - What: the global `transition: none !important` beats the fill's inline 900 ms transition.
   - Measured (`review-code-reduced-fill.mjs`): 150 ms into a hold the fill is at `scaleX(1)` with reduce, against `0.148` without. A reduced-motion user sees the bar full, lets go before 900 ms, and the press cancels with no sign why.
   - The fill shows progress; it isn't decoration.
   - Fix: mark the fill (`data-hold-fill`) and leave it out of the rule, e.g. `*:not([data-hold-fill]), *::before, *::after { … }`.

### LOW
6. **`components/Button.tsx:21-22`: `aria-disabled` doesn't block `onClick`.** Each caller has to remember to null it (`page.tsx:143` does). Put the guard in the one shared place: `const off = props["aria-disabled"] === true || props["aria-disabled"] === "true";` and pass `onClick={off ? undefined : onClick}`. `page.tsx:143` then shrinks to `onClick={() => void retryRead().catch(() => {})}`.
7. **`components/HoldButton.tsx:71-77` repeats `Button.tsx:5-11`** (height, pill, padding, font, transition, hover lift, accent, glow). Tester OPEN 3's fix moves `h-12 px-6` out of `base`, so the two copies will drift.
   - Fix, together with OPEN 3: export one `shape` string from `Button.tsx` and use it in both files.
   - Delete while you're there:
     - the `"aria-describedby"` prop (`:21`, `:63`); it has no caller
     - the `export` on `HOLD_MS`/`DONE_MS` (`:8-9`) and on `mulberry32` (`lib/dither.ts:8`); nothing imports them
8. **`app/globals.css:42-51`: the type styles sit outside every cascade layer, so they beat all Tailwind utilities.**
   - Verified in the built CSS: `.title`, `.data` and `.display-xl` are unlayered, while `.px-6` is in `@layer utilities`.
   - So `title text-sm`, `data tabular-nums` and any `md:` variant are silently ignored. The `font` shorthand also resets `font-variant-numeric`.
   - Nothing on this page combines them yet.
   - Fix: wrap lines 42-51 in `@layer components { … }`.
9. **`app/globals.css:23-25`: the Tailwind map relies on name collisions with Tailwind's own variables.**
   - `--font-sans: var(--font-sans)` (and serif and mono) do nothing. The build emits `@layer theme{:root{--font-sans:var(--font-sans)…}}`, a self-reference that only works because `tokens.css` sets the same names outside a layer.
   - Likewise, `rounded-md` comes out at 16 px only because `tokens.css` overrides Tailwind's built-in `--radius-md:.375rem` by name, not through the map.
   - Fix: delete lines 23-25, and add one comment saying `tokens.css` must stay unlayered because it overrides Tailwind's `--font-*`/`--radius-*` by name.
   - Also, `Button.tsx:12` hard-codes `backdrop-blur-[20px]` while the `--glass-blur` token exists. Use `backdrop-blur-(--glass-blur)`.
10. **`app/layout.tsx:7`: `style: ["normal", "italic"]` preloads a serif face nothing uses.** The `Link: rel=preload` header on `/` carries 4 fonts, including Instrument Serif normal (15 KB, `d902bc2bfdd0a4cb-s.p.*.woff2`). Only `.emphasis` (italic) uses the serif, and the spec says "Instrument Serif (italic)". Fix: `style: "italic"`.
11. **`components/DitherScene.tsx:79`: `powerPreference: "high-performance"` asks dual-GPU laptops to wake the discrete GPU** for a background picture. Delete it and take the default.
12. **`components/DitherScene.tsx:43-56, 81, 181`: the 2D fallback is drawn once, at the mount size.**
    - On resize or rotation, CSS stretches the bitmap (`h-full w-full`).
    - The same long call `drawStatic(canvas, buildDots(host.clientWidth, host.clientHeight), host.clientWidth, host.clientHeight)` appears twice.
    - Fix: `drawStatic(canvas, host)` reads the size itself, and the fallback redraws from the same debounced resize handler.
13. **`components/DitherScene.tsx:26-29` and `lib/dither.ts:39-40, 52` share brightness values that only match by accident.** The shader tells lamps, windows and the moon apart by thresholds (0.98, 0.8–0.9, >0.9) that mirror bare numbers in `sceneIntensity` (1, 0.85, 0.97). Changing 0.85 to 0.92 would quietly make windows shimmer like the moon. Fix: export `LAMP`, `WINDOW` and `MOON` from `dither.ts`, and use them both in `sceneIntensity` and in the GLSL string.
14. **`app/tokens.css:1-3` says "generated from tokens.json … Edit tokens.json, then regenerate", but the repo has no tokens.json and no generator.** Reword it to "ported by hand from <artifact>; keep both in step".
15. **`test/dither.test.mjs:6-10, 12-22`: the tests don't fully check what the spec lists.**
    - Seeding compares only the first 300 position floats. `starts` and `seeds`, which drive the gather, are never compared, so swapping `mulberry32(7)` for `Math.random` still passes.
    - The depth test checks 0 ≤ z ≤ 1, but not the order the parallax depends on.
    - Fix: `assert.deepEqual(a, b)` on the whole `Dots`, and assert that the deepest sky dot is shallower than the shallowest sea dot.

### INFO (not blocking)
16. **The three chunk is the whole library.** `0qim1xdlnxjks.js` is 737 KB, 184 KB gzipped, and contains `AnimationMixer` and `CubeTextureLoader`: a namespace `import("three")` can't be tree-shaken. It loads lazily after first paint, so the spec criterion holds. If mobile load on the pay page matters later: put the GL half in its own module with static named imports, `import()` that module, and measure before and after.

## Ponytail summary
- Delete: the `mounted` ref (#2), the 3 font self-references (#9), `powerPreference` (#11), the unused prop and exports (#7).
- Reuse: one disabled guard inside Button (#6), one `shape` string shared by both buttons (#7).
- Everything else is a one-to-three-line change.
- Nothing here needs a new dependency.

## For round 2
- Run `round-1/probes/review-code-*.mjs` again:
  - Enter held: expect 1 confirm
  - StrictMode: expect `Hold`, and the race: 1 call
  - touch slide: expect no "Signed"
  - reduced fill: expect `scaleX` < 1 at 150 ms
- Also do one `next dev` check of the hold button.
