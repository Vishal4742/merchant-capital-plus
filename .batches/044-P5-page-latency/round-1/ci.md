VERDICT: PASS

# ci: 044-P5-page-latency, round 1 (phase mode, run by the lane; Money: no)
Run from `apps/web` on branch `p5-page-latency` (merged with origin/main 4cdfd17), 2026-11-06.

- `npm run typecheck`: exit 0 (`✓ Types generated successfully`, `tsc --noEmit` clean)
- `npm run lint`: exit 0 (eslint, no output)
- `npm test`: exit 0, `tests 674 · pass 672 · fail 0 · skipped 2` (the new `test/dashboard-soft-nav.test.mjs` 4 of 4;
  it failed first, commit f9b5cff, then passed with the change)
- `npm run build`: exit 0, `✓ Compiled successfully`, every `/merchant/*` route still ◐; the only "Error" lines are the two
  `shop key check: Error` lines the baseline build on main prints too (no shop key in this worktree's env)

Diff (`git diff --stat origin/main...HEAD -- apps/web`): 7 files, +143 −17: Nav.tsx, FoldedMenu.tsx (new), lib/soft-nav.ts
(new), lib/server/tx-fee.ts (new), app/merchant/payments/page.tsx, app/merchant/page.tsx, test/dashboard-soft-nav.test.mjs.

## Local before/after (`next start`, the same build, Playwright Chromium 1440×900, signed-in session minted with a throwaway secret)
Env: public MerchantPay address and relayer URL, merchant 0x37f9…42b1 (16 Paid logs), no DATABASE_URL (so Links and
Vouchers answer at once with their "couldn't read" message). "full" = what the old plain `<a>` did, "soft" = the new Link.

| Switch to | full: shell / data / requests | soft: shell / data / requests |
|---|---|---|
| Links | 32 / 334 ms / 46, 19 / 325 ms / 45 | 111 / 112 ms / 1, 59 / 60 ms / 1 |
| Vouchers | 199 / 208 ms / 45, 64 / 336 ms / 45 | 56 / 57 ms / 1, 45 / 46 ms / 1 |
| Reports (Blockscout read) | 35 / 373 ms / 45, 28 / 334 ms / 46 | 57 / 386 ms / 2, 48 / 356 ms / 1 |
| Payments (chain reads) | 32 / 1015 ms / 45, 30 / 757 ms / 45 | 29 / 30 ms / 1, 38 / 39 ms / 1 (*) |

- A full switch makes 45–46 requests (document, every JS/CSS chunk, fonts) plus 2–3 third-party Anon-RPC boot requests,
  re-hydrates and reboots Nym; a soft switch makes 1 (the page's RSC payload) and no third-party request.
- (*) Payments was visited before in the run: Next keeps up to 3 visited routes (React Activity), so its last-known rows
  show at once while the one request refetches them (NFR-13 "last-known chain data shows at once"). Reports is
  server-bound (the Blockscout read) either way.
- Fee cache: Payments first render after start (16 receipts read) 1596 ms, then 575 ms and 612 ms (no receipt reads).
- Phone (375): open menu → Links → menu → Payments: same document kept, the returned screen's menu is folded;
  Pages and API keys are full loads (new document), and API keys answers with the strict CSP (no Nym hosts).

Production after-numbers wait for the next deploy (this batch doesn't deploy).

## After merging origin/main (1165425: batch 045 gave every Nav item an href, conflict in Nav.tsx resolved by keeping
## softNav ? Link : a for every item; Webhooks → /merchant/developers#webhooks stays a full load)
- `npm run typecheck` exit 0 · `npm run lint` exit 0 · `npm test` exit 0, `tests 676 · pass 674 · fail 0 · skipped 2`
  (nav-links 2 of 2 and dashboard-soft-nav 4 of 4) · `npm run build` exit 0 (only the two baseline `shop key check` lines)
- Phone check re-run on that build: `{"softKeptDocument":true,"menuOpenAfterReturn":false,"pagesIsFullLoad":true,
  "developersIsFullLoad":true,"developersCspHasNoNym":true}`
