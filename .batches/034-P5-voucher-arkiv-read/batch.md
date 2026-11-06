# 034-P5-voucher-arkiv-read
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-research (agent)
Request (verbatim): human 16:09 "fix the other things" + 16:26 "quickly build the things"
Mode: phase mode
Money: yes (price path: applyVoucher decides whether a discount is taken off the checkout)
Agent ids (builders, for SendMessage resumes): built directly by the batch agent in its own worktree
Log:
- 16:3x batch started from origin/main 1f92783; spec written; tests first (6 red, 2 green: 628f69b).
- 16:4x built (8bea066) + landing copy (3dc6499). ci PASS: typecheck 0, lint 0, tests 594/592/0 fail, build 0.
  reviewer-security launched in parallel (Money: yes).
- 16:5x PR #28 opened. Security PASS (no HIGH/CRITICAL). F2 LOW fixed test-first (2864ac7: the hold insert re-checks
  active + expiry). Re-run: typecheck 0, lint 0, tests 595/593/0 fail, build 0. Deferred: F3 MEDIUM (2 s transport
  timeout + short per-voucher cache against Arkiv quota drain), F1 LOW, F4 INFO.
- Note for the human: the landing card is a revenue advance, and HOLDER_CAP.advance is 1 (capital.ts; security 026
  INFO), so "2 investors" (as asked) still doesn't match an advance. Needs a copy decision.
