VERDICT: CHANGES

# UX/UI review, 001-P1-web-rail-proofs, round 1

Scope: internal proof page, no brand styling judged. Read `apps/web/app/page.tsx` and the tester's shots at 375 and 1440. Not repeated here: the tester's findings 2 (overflow at 375), 4 (DEP-3 shows Nym waiting copy) and 5 (cached block on Run again), plus the stuck retry. I agree with them. Fix the overflow and the stuck retry before anything else, since they break the failed state.

FR-PAY-7 / NFR-6: N/A (no customer screen). Page copy has no customer-facing crypto words to police. 375 layout otherwise fine: cards stack, no horizontal scroll in the OK and connecting shots, tap targets about 38 px high.

## Findings

1. [MEDIUM] Keyboard focus is lost when Run again is pressed. `app/page.tsx:74` unmounts the button while state is "running", so focus drops to `<body>` and a keyboard user must tab from the top again. Evidence: `shots/tester-375-bootfail-run-again.png` (button gone during the retry). Fix: keep the button mounted and `disabled` with `aria-disabled` and the label "Running…", or move focus to the status `<p>` (`tabIndex={-1}`). Owner: claude-frontend.

2. [MEDIUM] The 20 to 120 s connecting state is a static sentence with no sign of life. `shots/tester-375-connecting.png`, `shots/tester-1440-connecting.png`. A user cannot tell a working boot from a hung page, and a 120 s timeout ends in a raw error (`shots/tester-375-dep6-timeout-after-120s.png`). Fix: show an elapsed-seconds counter (tabular) and/or an indeterminate bar with `prefers-reduced-motion` respected; say "Still working" after 60 s. Keep the text in the live region but do not update it every second (announce once). Owner: claude-frontend.

3. [MEDIUM] The failed state is raw library output with no next step. `page.tsx:71` prints `Failed: {error}`, and the message can contain the RPC URL, request body and "Details: …". `shots/tester-375-dep6-timeout-after-120s.png`. Fix: a one-line plain summary ("The private read did not finish. Try again.") with the technical message inside `<details>` (wrapped with `break-words`, `shortMessage`). This also covers the overflow finding. Owner: claude-frontend.

4. [LOW] Failure is only distinguished by colour and the word "Failed". OK and Failed are ok in text, but the state has no icon or heading weight, and the green/red text at `text-sm` on white is borderline (green-700 passes, red-700 passes; dark-mode green-400/red-400 are fine). Acceptable for an internal page; add an icon with `aria-hidden` when the design system lands. Owner: claude-frontend (Phase 2).

5. [LOW] Numbers are not tabular. Block number and elapsed time (`page.tsx:39`, `:67`) will jitter on each run and are the page's main data. Fix: `tabular-nums` on both. Block numbers use thousands separators, good. The page has no USDT amounts, so the 2-decimal rule is not testable yet. Owner: claude-frontend.

6. [LOW] Button copy: "Run again" is generic and the 0.0 s DEP-3 card keeps a Run again button that does nothing visible. Fix: "Read block again" and "Sign again". The "(0.0 s)" for a local signature is noise; hide it under 0.1 s. Owner: claude-frontend.

7. [LOW] Design tokens: there are none yet, and the card, status and button classes are one-off strings (`border-black/15 dark:border-white/20`, repeated `text-black/60 dark:text-white/60`). Since the human is choosing a direction, wrap the status line, card and button once so the Phase 2 restyle touches one place. Dark mode exists (`shots/tester-1440-both-ok-dark.png`) and looks consistent. Owner: claude-frontend.

8. [LOW] Focus ring: `focus-visible:outline-2 focus-visible:outline-offset-2` has no explicit colour, so it falls back to `currentColor`. Visible, but confirm on the dark card by tabbing. No keyboard-focus screenshot was taken. Owner: tester, next round.

9. [LOW] 1440 layout: a single 672 px column on a wide screen is fine for a proof page. Nothing to change. `shots/tester-1440-both-ok.png`.

## Missing states for later (not blocking)
Empty and explorer-link states are not applicable to this page. The pending-transaction and explorer-link states must exist before any advance or payment screen (FR-ADV-6 cost-before-signing is also out of scope here).

## Verdict reasoning
Findings 1 to 3 make the failed and waiting paths poor for a page whose job is to show those states. Everything else is polish.
