# CI · 036-P5-capital-merchant · round 1

Branch p5-capital-merchant, after `git merge origin/main` (a6bc609). Run from apps/web on 2026-11-06.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (next typegen && tsc --noEmit) | exit 0, "✓ Types generated successfully", no tsc errors |
| Lint | `npm run lint` (eslint) | exit 0, no problems |
| Web tests | `npm test` | exit 0: tests 598, pass 596, fail 0, skipped 2 |
| Batch tests | `node --test test/ui-capital-merchant.test.mjs` | pass 12, fail 0 |
| Build | `npm run build` | exit 0, "✓ Compiled successfully", route `◐ /merchant/capital` |
| Secret scan | CI's `git grep -nE 'PRIVATE_KEY=0x…|BEGIN … PRIVATE KEY|sk-…|sm_…|gh[pousr]_…'` | exit 1 (no match) |
| Pre-push hook | `git push` (tools/githooks/pre-push) | "pre-push: all checks passed" (web typecheck, lint, tests) |

## Page check (next start on :3736, throwaway local AUTH_SECRET, public addresses only, live chain reads via Ankr)

Signed in as the demo merchant 0x37F9…42B1 through a session cookie made with the throwaway secret (deleted after).

| Width | Horizontal scroll | Console errors / CSP violations |
|---|---|---|
| 375 | none (scrollWidth 375 = clientWidth 375) | none |
| 1440 | none (scrollWidth 1440 = clientWidth 1440) | none |

What the live chain showed: advanceOf(merchant) = 0 and offer 1 (the G4 advance) settled, so M1 shows "Repaid. Sales now
go 100% to you, minus the fee." with the form (AT-5 state). Invoice 1 is paid, so M2 shows its empty state. With AT-3's
terms typed (10, 11, 20, 30 days) the page shows "When investors fund it, you get 10.00 USDT. You repay 11.00 USDT
(cost 1.00 USDT) from 20% of each sale until it's repaid." before any wallet prompt; submitting in headless Chrome (no
wallet) shows "No browser wallet found. Install MetaMask or a similar wallet, then try again." No transaction was sent.
Arkiv: ARKIV_ACCESS_KEY isn't set locally, so the server logged "Arkiv offers unreadable, Buy disabled" (redacted path).

Screenshots (local only): scratchpad cap036-375.png, cap036-1440.png, cap036-filled-375.png, cap036-filled-1440.png.

Not run here: reviewer-code / reviewer-security / reviewer-ux-ui passes (phase mode: the full pass is at the G5 gate),
forge (no contract change).

VERDICT: PASS

Re-run after the 5 MEDIUM UX fixes (PR #32 review by claude-frontend: 200 s publish timeout plus a Publish-again guard
while a publish is in flight or until the book is re-read, dashboard amount format, cents-only inputs and one decimal
style per line, the deadline line only on open offers, the unpublished message said once) and `git merge origin/main`
(c78cc07): typecheck exit 0, lint exit 0, `npm test` 644 tests / 642 pass / 0 fail / 2 skipped (batch file 15 pass),
build exit 0 (`◐ /merchant/capital`), secret scan no match. VERDICT: PASS
