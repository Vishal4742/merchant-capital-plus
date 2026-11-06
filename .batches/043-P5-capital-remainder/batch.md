# 043-P5-capital-remainder
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-research (agent)
Request: coordinator after PR #33 merged: claude-frontend's UX review on #33, MEDIUM 1 (funding-rule gap) plus MEDIUMs 2-4.
Mode: phase mode
Money: yes (POST /api/v1/capital/fund refuses a buy that leaves an unfundable remainder)
Claims: apps/web/lib/server/capital-fund.ts claimed for this batch on agentbus by the coordinator (claude-relayer wrote it).
Log:
- batch started on branch p5-capital-remainder from origin/main c57ac69.
- tests first (004798e, 4 red); server rule 9aba0ba; client rule, 2-decimal figures, 2-investor hint, tab order; round-1 ci PASS.
- Not done (LOW 5-7, 9-11 of the #33 UX review); LOW 8 "View transaction ↗" done in passing.
