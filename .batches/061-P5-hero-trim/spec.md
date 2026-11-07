# Spec: 061-P5-hero-trim

## Requirements (cite docs/SRS.md IDs)
- FR-GW-11: rates a visitor sees must be the checkout's; the landing ticker showed fixed 5-Nov rates under a different date than the checkout's live quote (third-party audit 2026-11-07 M1, "three different rate dates on the landing"). Removed, as the human asked.
- NFR-13: one fewer client island on the home page (the per-second IST clock).

## Acceptance criteria
- [ ] The home page no longer shows the three hero corners (coordinates, "Whitechain testnet" + IST clock, "Fig. 01 — Atomic settlement") nor the rates ticker.
- [ ] Their dead code goes too: IstClock and istTime (Live.tsx), Ticker/Rates/RATES (Hero.tsx), .lp-corner and .lp-ticker CSS. LockTimer keeps everySecond.
- [ ] The hero still renders (headline, CTAs, sheet, scene) at 375 and 1440; h-scroll 0, console 0, CSP 0.
- [ ] tsc, lint, npm test, build.

## Files to touch
- apps/web/components/landing/Hero.tsx, components/landing/Live.tsx, components/landing/landing.css, app/page.tsx, test/landing-trim.test.mjs (new)

## Ponytail ladder
- Deletion only.

## Out of scope
- The hero sheet's own "rate of 6 Nov" line and the landing maths (audit M1c), unless asked.
