VERDICT: PASS

# UX/UI review: 002-P2-web-design-foundation, round 3 (last)

Reviewed from `round-3/shots/` (375 and 1440, light and dark, settled, focus, reduced motion), `components/Button.tsx`, `round-3/test.md` and the build report. No new shots; the server was not touched.

## Round-1 findings, status
1. Quiet button size/target: fixed. `min-h-11` (44 px target), each variant owns its size, so `px-2` now takes effect. See "Quiet button call" below.
2. Reduced motion: fixed. Tester: 1 draw, 0 draws/s, 0 differing pixels across load, settled, mouse in and mouse moved.
3. Text over lit dots: fixed. Night wash behind the text; label hidden below `sm`; tester measures 7.58 for the label and 5.26 or more for the paragraph at 375, 640, 1440. `tester-375-light-settled.png` and `tester-1440-dark-settled.png` read cleanly.
4. Wordmark wrap: fixed (one line at 375).
5. Dot colour: closed by the human (#1723e2, same token everywhere). Shots show the electric blue in both paths.
6. Hold fill contrast: fixed. Fill is `bg-ink/20`, so contrast only rises.
7. Busy state on pointer: fixed (`flushSync`).

## Quiet button call: keep `px-2`, add `-ml-2` (deferrable)
Keep the 44 px target and the `px-2`. In `tester-375-light-settled.png` the text "Read block again" starts about 8 px right of the card text and the focus ring in `tester-375-focus-1.png` is a clean pill, so it is fine. The only flaw is that the underlined text sits 8 px in from the card's text edge, while the primary on the sibling card is flush. Fix: add `-ml-2` to the quiet variant (or `-mx-2`) so the glyphs align and the target stays 44 px. Cosmetic, LOW. Not a PASS blocker.

## Fidelity to the lock
Mercury + dither holds at 375 and 1440 in both themes: Instrument Sans, serif-italic "device", pill buttons, electric-dot night scene with moon and skyline, surface cards with outline status pills, no horizontal overflow, focus ring visible (2 px accent, offset) on both buttons, hold button states present (hold, busy, signed, retry). Dark primary is the lighter accent with dark label and keeps contrast. Tokens are reused, no hex in components.

## Must-fix for PASS
None.

## Deferrable to batch 004 (real pages), owner claude-frontend
- Quiet button `-ml-2` alignment (above), when it first sits beside body text.
- Customer pay page: no crypto words (FR-PAY-7), USDT 2 decimals with `.amount-xl` tabular numbers, explorer-link, empty and error states. None exist on this internal proof page.
- Merchant advance: show the cost before signing (FR-ADV-6) with HoldButton; plan a non-hold fallback for assistive tech (VoiceOver/TalkBack unverified, per tester NEEDS THE USER).
- Real iPhone/Android check of a 900 ms touch-hold (human).
- Replace internal copy ("chain 1874", "Nym") with customer copy on customer pages.
