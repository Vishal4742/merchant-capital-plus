# Phase 2, frontend lane (claude-frontend)

## Batch 002-P2-web-design-foundation

Branch `main` · design lock "Mercury + dither" (human 21:30) and the demo picks (21:37): Instrument Sans, pill buttons, press and hold to pay, three.js scene (21:43), electric dot blue #1723E2 (22:21). Reference: `design-refs/merchant-capital-demo.html` (git-ignored, references only).

### What was built
- `app/tokens.css`: tokens generated from the design system (light, dark, and the forced-theme block). `scene-dot` #1723e2, accent #3b4fd9 (dark #8796ff), ground, surface, ink, hairline, shadow-glow.
- `app/globals.css`: the Tailwind 4 `@theme inline` colour map and the type styles (`display`, `title`, `amount-xl`, `label`, `data`). Reduced motion stops every animation except elements marked `data-motion="essential"`.
- `app/layout.tsx`: Instrument Sans, Instrument Serif (italic only) and Geist Mono via `next/font` (self-hosted, 0 requests to Google).
- `lib/dither.ts` + `components/DitherScene.tsx`: a three.js 0.186.1 points shader (`#include <colorspace_fragment>`, so the dots match the token).
  - Behaviour: gather on load, then depth parallax.
  - Reduced motion draws one frame per resize.
  - WebGL2 is checked before three.js starts; without it there's a 2D canvas fallback.
- `components/Button.tsx`: pill variants that own their sizes (primary/glass `h-12`, quiet `min-h-11` for a 44 px target). Clicks are ignored while `aria-disabled`.
- `components/HoldButton.tsx`: press and hold for 900 ms to confirm. Releasing early cancels; one keyboard or assistive-tech press confirms. It's guarded as a money control:
  - auto-repeated keys are ignored
  - the phase lives in a ref
  - only trusted events count, from the left button only
  - sliding off on touch cancels
  - unmounting clears the timer
- `app/page.tsx`: the Phase 1 proofs page restyled over the night scene, with a wash behind the text.

### Verified (with which output)
- Round 3, every check PASS: tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci. ci reported typecheck 0, lint 0, `npm test` 16/16, build 0 (routes `/` and `/_not-found`, static), and a clean secret grep.
- Contrast: label 7.58:1 over lit dots (4.31 in round 2), paragraph ≥ 5.26, h1 ≥ 7.58, the same in light and dark.
- Hold behaviour:
  - Held Enter gives 1 confirm, and held Space for 2 s gives 1 call.
  - A late release gives 1 call, and the 860–950 ms release sweep is consistent in 9 of 9 runs.
  - Right button, script click, slide-off, a second finger, or unmounting mid-hold: 0 calls.
- Reduced motion: 1 draw, 0 draws per second. Nym read OK at 375 and 1440 (21.5 s and 21.3 s, block 12,302,721), with 0 requests to Ankr.
- Dependency: three 0.186.1 and @types/three 0.186.0 add 8 lockfile packages; all 8 registry integrity hashes match, and none has install scripts.

### Decisions (human gate, 23:30)
- three.js pins approved.
- The keyboard confirms instantly on the pay page, with all framing blocked (X-Frame-Options DENY, batch 004).
- A second payment for the same order must also be impossible on-chain: claude-contracts is asked to make `paySale` refuse an `orderRef` that's already paid.

### Open, carried into batch 004 (the first batch whose hold signs a payment)
- code R3 D1 (`cacheComponents` hides routes in `<Activity>`): drop `forceContextLoss()`; HoldButton comes back idle after a hidden "done" but stays busy while a payment is in flight. Fixed in the 004 scratch copy.
- security R3 D1–D5, fixed in the 004 scratch copy:
  - D1: frame blocking
  - D2: a label change cancels a hold
  - D3: the page owns the payment in flight
  - D4: an unknown outcome hides the button, and one salt is used per checkout
  - D5: blur or a hidden tab cancels a hold
- The touch hold still needs a check on a real iPhone and Android, with VoiceOver and TalkBack (the human).
- LOW clean-ups, folded into the next batch that touches each file: duplicated button classes, unused exports, the dither seeding test, the resize debounce, shared brightness constants.
