# 052-P5-vercel-quota
Phase: 5 (PHASES.md)   Round: spec   Owner lane: claude-research (deploy config only)
Request (verbatim): "always check deploy and the github things" (human, 2026-11-07 02:05 IST)
Cause: Vercel Hobby allows 100 deployments per day per account. Every push to any branch creates one
deployment in each of the 3 Git-connected projects, even when the ignore step cancels it. 131 were created
in the last 24 h (54 in the 15Z hour); PR #44's previews failed 'Deployment rate limited — retry in 24 hours'
(18:10Z). A merge to main before 09:00 IST could be refused the same way.
Log:
- 02:15 spec written
