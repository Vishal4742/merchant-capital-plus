VERDICT: PASS

# UX/UI review, 001-P1-web-rail-proofs, round 3

Scope: internal proof page, brand styling not judged. Sources: round-3/test.md (tester PASS), round-3/shots/, apps/web/app/page.tsx.

## Round-1 MEDIUMs

1. Retry focus: RESOLVED. The button stays mounted and uses aria-disabled (page.tsx:101-104). The tester measured 11 of 11 keyboard retries keeping focus, including after a failed or stalled boot. The focus ring is visible (blue, offset) in shots/tester-375-stall-timeout.png.
2. Sign of life while connecting: RESOLVED. A seconds counter in tabular mono shows "(N s)" and "- still working" from 60 s. It is aria-hidden, so the live region is not spammed. A 90 s deadline now ends the boot, and the retry recovers (shots/tester-375-stall-before-deadline.png, shots/tester-375-stall-recovered.png).
3. Plain failure text: RESOLVED. "Failed: Private connection timed out. Try again." sits on one line at 375 with no overflow (shots/tester-375-stall-timeout.png). The hash refusal wraps to 2 lines without overflow.

## Round-1 LOWs (fine for an internal page)
- Numbers use tabular-nums; button labels are specific ("Read block again", "Sign again"); the 0.0 s noise is hidden under 1 s.
- No <details> for the technical message; acceptable.
- Red/green text is accessible; dark mode is consistent.

## Non-blocking notes for batch 002
- Failure is still colour plus the word "Failed", with no icon.
- Card, button and status styles are one-off Tailwind strings; move them into design-system tokens when batch 002 lands.
- The "Failed:" prefix on a plain-language line is slightly redundant.

FR-PAY-7 and NFR-6: N/A (no customer screen). FR-ADV-6, the empty state and the explorer link are out of scope here and must exist before any advance or payment screen.

Nothing must be fixed before the human gate.
