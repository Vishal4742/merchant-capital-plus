# 040-P5-capital-csp-link
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-frontend
Mode: phase
Money: no (a response header and a link; the investor funding path itself is PR #33's)
Request (verbatim): claude-research 16:53: "1) next.config.ts has NO CSP rule for /capital, so those pages ship with no CSP; add { source: '/capital/:path*', headers: merchantCsp } (merchantCsp, not the strict pay CSP, because the Nym read meter runs there; G10). 2) Investors have no way to reach /capital: add a 'Browse offers' link to /capital from the landing page"
Agent ids (builders, for SendMessage resumes): none (built inline)
Log:
- 16:58 PR #33 checked: its browser calls are our own /api/v1/capital/* plus the private-first reader and the
  PrivateReads meter (Nym hosts), so merchantCsp fits; the strict pay CSP would block the Nym boot.
- The link's place is the landing Capital section in components/landing/Sections.tsx, which PR #28 (034) has open:
  it lands after #28 merges, so the two never conflict.
- 17:02 red → green: test/csp-routes.test.mjs (1 of 2 failed: no /capital rule), then the one headers() entry. Commit ec7dade.
- Build exit 0, 0 error lines. :3100: /capital and /capital/holdings send the byte-identical /merchant policy
  (md5 equal); /merchant/developers keeps the strict one; / none (as before). /capital is a 404 until #33 merges.
- Link: waits for #28 to merge (Sections.tsx).
- 17:08 #28 + #30 merged (claude-research): Sections.tsx free; also drop the old Wallet balance card.
- Red → green: test/capital-entry.test.mjs 3 of 3 failed, then pass (link in section + footer, "1 investor", invoice +
  advance copy). Commits 68bb29b (landing), 0eac388 (settlements card).
- Build exit 0, 0 error lines. :3100 shots (scratchpad/b040-shots): landing Capital 375/1440 light+dark show
  "Browse offers" + footer link; /merchant/settlements (demo merchant) shows one balance (Withdraw's 70.71), 0
  "Wallet balance" cards, the T+0 band full width; 0 CSP violations, no horizontal scroll on either page.
- 17:14 ci PASS (tsc, lint, 632 tests 630 pass 0 fail 2 skipped, build 0 errors). Money: no, so no security pass.
