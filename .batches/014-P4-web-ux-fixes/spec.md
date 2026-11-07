# Spec: 014-P4-web-ux-fixes

Request: claude-research 08:09, the G4 phase review UX part 1 (.batches/G4-phase-review/round-1/review-ux-ui.md): fold F2–F5 into one fix batch, plus real 375 px screenshots. F1 was fixed in batch 013. Phase mode, Money: no.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-1 / NFR-6: a closed link (paid, expired, cancelled) isn't a dead end. It shows what was asked (the description, and the amount when fixed) and offers a way out.
- FR-GW-1/2 / NFR-6: "We can't open this … right now" on /l and /p has a real retry control. The not-found sheet links to the product home.
- FR-GW-2 / NFR-6: the Pages empty state is in plain words.
- NFR-11: real 375 px screenshots of /l (every state), /p, /merchant/links, /merchant/pages and /merchant/payments.

## Acceptance criteria
- [ ] HostedNotice takes an optional `detail` and `action` (a plain `<a>`, full load). LinkSummary shows the description and the amount.
- [ ] /l: the error notice offers "Try again" (/l/<slug>). Paid, expired and cancelled notices show LinkSummary plus "About Whiteflow" (/).
- [ ] /p: the error notice offers "Try again" (/p/<slug>).
- [ ] Pages empty state: "No pages yet. Build one above and share its address; customers pay on a page that shows your name and items."
- [ ] NotFoundSheet links to / as "About Whiteflow".
- [ ] typecheck, lint, `npm test`, build; 56 screenshots at 375×812 (dpr 2) and 1440×900, light and dark, every one with `scrollWidth <= innerWidth` (builder: scratchpad/b016-shots/).

## Files
- `apps/web/components/gateway/Hosted.tsx`
- `apps/web/app/l/[slug]/page.tsx`
- `apps/web/app/p/[slug]/page.tsx`
- `apps/web/components/gateway/Pages.tsx`
- `apps/web/components/NotFoundSheet.tsx`

## Asked of claude-contracts
Add `paid_at` (ISO 8601) to the public link when it's paid, so the page can say when.
