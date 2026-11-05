STATUS: READY

# Build report: 002-P2-web-design-foundation (claude-frontend), round 3

## DONE in round 3 (round 2 tester: CHANGES on one criterion; round 2 reviewers not run)
- [tester R2, MEDIUM] The "Phase 1 · rail proofs" label sat past the night wash at 4.31:1 over lit dots. Removing `opacity-70` (`app/page.tsx`) brings it to 7.58:1 by the tester's measurement.
- Kept, per the tester's note for ux-ui: the quiet button's text sits 8 px in (`px-2` inside a 44 px target), aligned with its box.
- Verified: `npm run lint` 0; `npm run build` 0; served again on :3100.

# Round 2 report (kept)

Round 1 was CHANGES from the tester, code, security and ux reviewers; ci was not run. Fixes below, by finding.

## DONE in round 2
- **HoldButton** (security S1–S3, code 1–4 and 6, tester 5):
  - an auto-repeated key is ignored (`onKeyDown` with `e.repeat` calls preventDefault), so a held Enter gives exactly 1 confirm
  - the phase lives in a ref, so a late release or timer can't re-arm a confirm in flight
  - only trusted events confirm (`nativeEvent.isTrusted` on click and pointerdown); left button only
  - touch slide-off cancels (`onPointerMove` bounds check)
  - the `mounted` ref is removed (it broke under StrictMode's dev remount and left the button stuck on busy); unmount clears the timer
  - `flushSync` paints busy
  - the fill is `bg-ink/20`, so contrast only rises, and it's marked `data-motion="essential"` so reduced motion keeps the progress fill (code 5)
- **DitherScene** (tester 1, 2, 4, 7; code 11, 12):
  - reduced motion renders one frame, plus one per resize, with no loop and no twinkle
  - `#include <colorspace_fragment>`, so WebGL dots match the token
  - checks for WebGL2 itself and passes the context to three (no three.js console errors without WebGL)
  - `forceContextLoss()` on unmount; `powerPreference` removed; the 2D fallback redraws on resize
- **Dot colour (human 22:21, after a side-by-side):** `--scene-dot` is electric **#1723e2** in tokens.css (all three theme blocks), in the design system and in the demo.
- **Button** (tester 3, ux 1, code 6):
  - each variant owns its size (primary and glass `h-12 px-6`, quiet `min-h-11 px-2`, a 44 px target)
  - clicks are ignored while `aria-disabled`
  - `buttonClasses()` is exported for link-styled buttons
- **Page** (ux 3, 4; tester 6):
  - a night wash (`from-scene-night` gradient) behind the hero text for AA over lit dots
  - the wordmark no longer wraps; the "Phase 1 · rail proofs" label is hidden below `sm`
- **CSS and fonts** (code 8, 10): type-style classes moved into `@layer components`; Instrument Serif loads italic only.
- **Not done (LOW, recorded):**
  - code 7: HoldButton repeats Button's class strings
  - code 9 and 14: a comment pointing at the design system for tokens.json
  - code 13: shared brightness numbers
  - code 15: deeper dither seed tests
  - security S4 (frame-ancestors and X-Frame-Options) goes into batch 003, the first batch that wires HoldButton to money

## Verified (apps/web, round 2)
- `npm run typecheck` → 0 · `npm run lint` → 0, 0 warnings · `npm test` → 16 pass, 0 fail · `npm run build` → 0
- Served again on :3100 for the round 2 tester.

# Round 1 report (kept)

## DONE
- `app/tokens.css`: generated from the design system's `tokens.json` with the same values.
  - App differences: font families point at the next/font variables; dark mode also follows the OS (`prefers-color-scheme`, guarded by `:root:not([data-theme="light"])`); `--shadow-glow` added for the primary button hover.
- `app/globals.css`: Tailwind 4 `@theme inline` maps every colour token, the fonts, `radius-pill`, the shadows and `ease-spring`, plus the type-style classes (display-xl, display, amount-xl, title, label, emphasis, data). Reduced motion turns animations off.
- `app/layout.tsx`: Instrument Sans (variable), Instrument Serif (400, normal + italic) and Geist Mono through `next/font/google`, self-hosted at build time.
- `lib/dither.ts` (pure): `sceneIntensity` (sky glow, moon, skyline with lit windows, Queen's Necklace lamps, sea and reflection) and `buildDots` (4×4 Bayer dither, depth 0–1, scattered starts, seeds, brightness). Seeded, so the same box gives the same picture.
- `components/DitherScene.tsx` (client), with three.js **0.186.1** loaded via `import("three")` after first paint:
  - every dot is a GPU point (ShaderMaterial); the gather takes 1.8 s with a left-to-right stagger; dots are larger while in flight
  - depth layers drift with the cursor (parallax, 14 px); dots within 120 px part (26 px)
  - lamps and windows twinkle; the moon shimmers
  - reduced motion: static, no push or parallax
  - IntersectionObserver pauses rendering off-screen
  - unmount disposes the renderer, geometry and material and removes the listeners
  - no WebGL or no three.js: a still 2D drawing
- `components/Button.tsx`: primary / glass / quiet pill, spring press, hover lift and glow, `aria-disabled` styles.
- `components/HoldButton.tsx`: press and hold (human pick).
  - 900 ms fill; release, leave or cancel resets it
  - keyboard (`detail === 0`) confirms at once
  - busy (pulsing dots, `aria-disabled`, focus kept) → done (positive) → idle after 450 ms; a rejected `onConfirm` → idle
  - context menu suppressed so long-press on mobile doesn't open it
- `app/page.tsx`: the night scene header (wordmark, `display-xl` with the serif-italic "device"), proof cards on `surface` with status pills.
  - "Read block again" (quiet Button, `aria-disabled` while running) and "Hold to sign again" (HoldButton)
  - batch 001 logic unchanged: auto-run, live counter, one plain failure line
- Batch 001 follow-ups:
  - comments in `anon.ts` (cold-read worst case about 3.5 min; what `close()` can't do); `shortcut:` → `ponytail:` (L1)
  - a zero-key case in the guest-wallet test (N4)
  - a `typecheck` script running `next typegen && tsc --noEmit` (ci finding)
  - N2 marked superseded by the human's "reduce" decision (batch 003)

## Verified (apps/web)
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0, 0 warnings (fixed one no-unused-expressions in the new test)
- `npm test` → 16 pass, 0 fail (11 from batch 001 + 5 dither)
- `npm run build` → exit 0
- Chrome at 1440 (dark OS theme), served by `next start -p 3100`:
  - the three.js scene renders (moon, skyline, dots), the headline is in Instrument Sans with the serif-italic word
  - the DEP-3 card is OK with "Hold to sign again"; the DEP-6 card shows Running with the counter
  - no console messages; no fonts.googleapis/gstatic requests (fonts self-hosted)
  - screenshot `/var/folders/83/4v55h6t5737ff030n1d1n43c0000gn/T/claude-chrome-screenshots-0PT2Kb/screenshot-1793896422471-39.jpg` (copy into round-1/shots/)
- **Not verified by the builder:** 375 width, light theme, press-and-hold with a real pointer (the browser tool can't hold a button), reduced motion, WebGL fallback.

## OPEN
- The hero copy ("Private reads. Signed on your device.") is internal-page copy; Phase 2 replaces the page.
- The design system artifact gets `shadow-glow` in its tokens.json (frontend to republish).

## NEEDS THE USER
- New dependency three 0.186.1 / @types/three 0.186.0 (approved by the human at the 001 gate, 21:58).
