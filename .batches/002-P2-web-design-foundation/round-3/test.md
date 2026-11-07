VERDICT: PASS

# Test report: 002-P2-web-design-foundation, round 3 (tester)

This was a focused re-check of the one round 2 FAIL. "Phase 1 · rail proofs" now measures 7.58:1 over a lit `#1723e2` dot (it was 4.31). Every hero text pair passes at 375, 640 and 1440 in both themes, and the smoke checks match round 2.

## Setup
- **Server:** the existing `next start` on :3100 (one listener). `.next/BUILD_ID` is from 22:46:44, after `app/page.tsx` (22:46:39). `app/page.tsx:124` now reads `<span className="data hidden sm:inline">Phase 1 · rail proofs</span>`, with no `opacity-70`. I didn't restart or rebuild anything.
- **Probes:** the round 2 scripts, copied unchanged into `round-3/probes/`: `hero-contrast.mjs`, `hold-state-trusted.mjs`, `review-code-enter-repeat.mjs` and `walk.mjs`. Their output is saved next to them.
- **Secrets:** I read no `.env` value. `grep -rlE '0x[0-9a-fA-F]{64}' round-3/probes/` finds nothing (exit 1).
- **AT-\* IDs:** the spec cites none.

## Re-check: hero contrast (spec criterion 7, round 2 OPEN 1)
Command: `node hero-contrast.mjs <375|640|1440> <light|dark>`. The probe hides the text but keeps the scene and the wash, takes the brightest background pixel under each line box across 3 frames 700 ms apart, and computes contrast at the text's real opacity. Output is in `probes/hero-contrast.jsonl`.

| Text (size, opacity) | Need | 375 | 640 | 1440 |
|---|---|---|---|---|
| Wordmark "Whiteflow" (22 px, 1) | 4.5 | 12.96 | 15.55 | 15.63 |
| **"Phase 1 · rail proofs" (13 px, 1)** | 4.5 | hidden below `sm` | **7.58** over `[23,35,226]` | **7.58** over `[23,35,226]` |
| h1 (40 / 40 / 56 px, 1) | 3 | 7.58 | 11.08 | 13.43 |
| "device" (42 / 42 / 58.8 px, 1) | 3 | 15.63 | 11.63 | 13.64 |
| Paragraph (16 px, 0.8) | 4.5 | 5.26 | 6.63 | 9.57 |

- Light and dark give the same numbers, because the hero uses scene tokens that don't change with the theme. All 6 runs report `"pass":true` on every visible element.
- The label's measured opacity is now `1` (it was `0.7`), and 7.58 is the figure the round 2 arithmetic predicted.
- `walk.mjs views` agrees: `contrast_light_settled_fail: []` and `contrast_dark_settled_fail: []` at both 375 and 1440. In round 2 these lists held the label.
- You can see it in `shots/tester-1440-dark-settled.png`: the label is full glass-ink over the lit sky dots.

**PASS**

## Smoke checks

| Check | Result | Evidence |
|---|---|---|
| Held Enter gives 1 confirm (live page) | PASS | `review-code-enter-repeat.mjs`: `{"heldMs":2000,"clicks":1,"confirms":1,"labels":["Signing","Signed","Hold to sign again"]}` |
| HoldButton state, trusted input (`hold-state-trusted.mjs`) | PASS | Enter twice gives `labels ["Hold","Hold"]` and `calls 2`, both under StrictMode and without it. On a late release, `labelAfterLateRelease "Busy"` and `callsWithinFlight 1`. Release sweep from 860 to 950 ms: all 9 runs read `consistent: true` (below 900 ms you get `Hold` and 0 calls, from 900 ms you get `Busy` and 1 call). Right button: `calls 0`. StrictMode pointer hold twice gives `["Hold","Hold"]` and `calls 2`. |
| Reduced motion: one draw | PASS | `walk.mjs reduced 1440`: `gl.draws: 1`, `drawsPerSecond: 0`, `cssAnimations: 0`. `differingPixels: 0` from load to +700 ms, settled +700 ms, mouse in, and mouse moved. |
| `npm test` | PASS | `tests 16 · pass 16 · fail 0`, exit 0 (`probes/npm-test.log`) |
| `npm run typecheck` | PASS | exit 0, `✓ Types generated successfully` (`probes/typecheck.log`) |
| Batch 001: Nym read | PASS | `views-375`: `Block 12,302,721 on chain 1874, via Anon-RPC (Nym) (21.5 s)`, pill `OK`. `views-1440`: `Block 12,302,721 … (21.3 s)`, pill `OK`. |
| Batch 001: 0 requests to Ankr | PASS | `ankrRequests: 0` in both views walks and in the reduced walk. Hosts per load: localhost ×17, publicnode ×2, cdn.jsdelivr.net ×1, validator.nymtech.net ×7, plus harness blobs. Same as round 2. |
| 375 and 1440, light and dark | PASS | No horizontal overflow (375 = 375, 1440 = 1440). `googleFontRequests: 0`. DEP-3 signed in both walks. |

## DONE
- The hero contrast re-check at 375, 640 and 1440, light and dark, all passing, plus the smoke checks above, all against the live build on :3100.
- Shots (11) are in `round-3/shots/`: `tester-{375,1440}-{light,dark}-{load,settled}.png`, `tester-{375,1440}-focus-1.png` and `tester-1440-reduced-scene-mouse.png`.
- JSON and logs for every check are in `round-3/probes/`.

## OPEN
- None from the tester.
- Round 2's LOW and INFO notes stand unchanged: the quiet button's `px-2` (`components/Button.tsx:15`, ux-ui's call, owner claude-frontend) and the intermittent cold Nym failure (batch 003, owner claude-frontend). This round's two cold Nym sessions both succeeded.
- Not re-run this round, because the change is one class removed with no JS or dependency change: Lighthouse (NFR-12–14), the touch, no-WebGL, cleanup and unmount walks, and `npm run build` (it would overwrite the `.next` that :3100 serves; ci runs it).

## NEEDS THE USER
These are carried from round 2, and nothing new was added.
- **Real devices:** does a 900 ms touch-hold confirm on a real iPhone and Android without a context menu or `pointercancel`? Can VoiceOver and TalkBack activate the HoldButton?
- **New dependency:** three 0.186.1 and @types/three 0.186.0 (PIPELINE §11). The build report says the human approved it at the 001 gate (21:58).
