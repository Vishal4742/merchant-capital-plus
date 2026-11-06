# 008-P4-web-review-fixes
Phase: 4 (PHASES.md)   Round: 1   Owner lane: claude-frontend
Mode: phase
Money: yes
Request (verbatim): human 06:03 "dont do tests in each step test thgings in phase by phase"; gate 006 at 06:18 ("Ship it"; FX limit "±15% of today"); review follow-ups from batch 006 round 2
Agent ids (builders, for SendMessage resumes):
Log:
- 06:22 spec written; built by claude-frontend directly (small edits).
- 06:33 security PASS (3 LOW, 3 INFO). Added: the sign-in loopback domains (the human hit it at 06:30) and F2 (no redirects, secret only to https/loopback). ci re-run: 301 tests (298 pass), build 0.
