VERDICT: CHANGES

# UX/UI review: 002-P2-web-design-foundation, round 1

Reviewed from the tester's shots (`round-1/shots/`), `app/page.tsx`, `components/Button.tsx`, `app/globals.css` and the demo HTML. I took no new shots. No server was started.

## Fidelity to the demo: good
Tokens match the demo (tester: 0 diffs). Instrument Sans, the Instrument Serif italic "device", pill buttons, `surface` cards with `shadow-card`, outline status pills, dither header and the hold-fill gradient all read as the approved design in light and dark. No hex in components. 375 has no horizontal overflow. Focus ring is `2px` accent with a `2px` offset on both buttons (`globals.css:53`).

## Findings

1. **MEDIUM, quiet button is mis-padded and off-grid.** `shots/tester-375-light-settled.png`, `shots/tester-1440-dark-settled.png`: "Read block again" sits about 24 px in from the card text, while the primary on the sibling card is flush left. The two cards' actions don't align. Cause: `Button.tsx:6` `px-6` beats the quiet `px-2` (class order). Fix: move `h-12 px-6` from `base` into `primary` and `glass`; quiet then gets `px-0 py-1` so it's flush with the text. Also give the quiet button a 44 px tap area at 375 (padding `py-3` with `-my-2`, or `min-h-11`), because 32 px high is under the touch target guideline. Owner: claude-frontend.

2. **MEDIUM, reduced motion is not static** (confirms tester OPEN 1). Under `prefers-reduced-motion` the lamps and moon still twinkle at 60 fps (3,169 px change per 700 ms). The spec says static, and WCAG 2.3.3 / the OS setting expects no ambient animation. Fix: with `reduce`, render one frame (and again on resize) and run no loop. Owner: claude-frontend.

3. **MEDIUM, hero text over lit dots is below AA** (confirms OPEN 6, extends it). `shots/tester-375-light-settled.png`: at 375 the mono label "Phase 1 · rail proofs" wraps to 2 lines (`Phase 1 · rail / proofs`) and sits on the moon, with the worst contrast (2.70 at opacity 0.7). The paragraph reaches 3.06 and the wordmark 3.88. In the 1440 dark shot the paragraph's last line ("browser.") crosses the dot band and is hard to read. Fixes, any of: (a) drop `opacity-70` / `opacity-80` on hero text (demo uses .75/.82, so this is stricter than the demo, and that is intended); (b) add a soft `scene-night` gradient or text-shadow behind the text block, from tokens; (c) have the scene draw fewer or dimmer dots in the text area (a dither-lib mask, since text is left-aligned). At 375, hide the label below `sm` or set `whitespace-nowrap` and move it under the wordmark so it is not over the moon. Owner: claude-frontend.

4. **LOW, wordmark wraps at 375** ("Merchant / Capital+" on two lines, shots above). Fix: `whitespace-nowrap` on the wordmark (the label then goes, per 3). Owner: claude-frontend.

5. **LOW, dot colour disagrees between render paths** (confirms OPEN 2). WebGL renders `rgb(23,35,226)` (deep, saturated, as in the approved demo); the 2D fallback renders the token `rgb(84,104,242)`. The human approved the demo look, so my recommendation is Fix B: keep the saturated look as the one rendered colour and make the fallback match it, so the token and the screen agree. Needs the human's call, as the tester said. Note the deeper blue on `scene-night` has low contrast with itself only as decoration; it is fine as art, not as text background (see 3). Owner: claude-frontend, decision: human.

6. **LOW, hold button label contrast during the fill** (confirms OPEN 6). `shots/tester-1440-hold-200ms.png` shows the label crossing the lighter fill; it falls to 3.77 (light) at full fill for up to 900 ms. Transient, but the label is the key instruction. Fix: keep `text-on-accent` and make the fill a darker shade of the accent (so it only increases contrast) rather than lighter. Owner: claude-frontend.

7. **LOW, busy state is never seen on the pointer path** (OPEN 5). The hold goes straight to "Signed". For the Phase 3 pay this will show correctly, but the busy state has not been seen by a user on pointer. `flushSync(() => setPhase("busy"))` fixes it. Owner: claude-frontend.

8. **LOW, state coverage for the page.** Running, ok, failed, pending text ("Connecting privately…"), a live region and the elapsed counter all exist. The failed state (`shots/tester-1440-hold-rejected.png`) shows red text only inside the card, with the pill "Failed"; the retry button remains. Acceptable for an internal proof page. Empty and explorer-link states are out of scope for this batch. No customer-flow crypto words check applies (the page is internal and says "chain 1874", "Nym", "Whitechain" on purpose; the customer pay page must not reuse that copy). Owner: none.

9. **LOW, amounts and type.** No USDT amounts appear on this page. Block numbers use `tabular-nums`. The `.amount-xl` class has tabular numbers in the demo and should be checked when the pay page lands (FR-PAY-7). Owner: none now.

10. **LOW, the dark 375 shot (`tester-375-dark-settled.png`) is correct** and the dark theme cards (`surface` on night) keep their border; the pill outline contrast passes. No change.

## Contrast summary
Page text pairs pass AA in both themes (tester measured). Failures are only over the lit dots (finding 3) and the transient hold fill (finding 6). The 0.45 opacity disabled state is exempt.

## Ask
Fix findings 1 to 4 and 6; 5 needs the human's colour choice; 7 is optional. Then a round 2 with new 375 light and dark shots showing the header text, the quiet button alignment and a reduced-motion run.
