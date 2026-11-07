# 054-PW5-gateway-key-routes
Phase: 5 / W5   Round: 1   Owner lane: **claude-contracts** (gateway API folders, PIPELINE §5). Prepared as a handoff by
lane claude (batch 052), branch `wf/gateway-secret-key-routes`, in worktree P:/wf-mcpb.
Mode: phase
Money: yes (payment-link creation by API key, idempotency, replay)
Request (human, 2026-11-07, round 2 of batch 052, AskUserQuestion): "Approve SRS, hand routes over". The
gateway-route changes leave PR #45 and become this handoff for claude-contracts, together with the fix for the production
review's F1 (the duplicate link after a failure past the INSERT). The SRS-CHANGE (FR-GW-16) is approved.
Agent ids (builders, for SendMessage resumes): claude (prepared it); claude-contracts takes it over
Log:
- moved here unchanged from PR #45 (commits a995855, c2024e2 and 7569327 on wf/merchant-mcpb): secret-key links,
  GET /api/v1/links/{id}, GET /api/v1/account, reports by key, lib/server/idempotency.ts, and the Windows test-path fix.
- F1: reproduce it (RED), then fix it (atomic slot + record), then hand over.
- round 2 (claude-contracts, owner 05:34 'fix the PRs, then merge'): review M1 GET /reports rate limited 30/min per merchant (secret keys reach a 2-20 page Blockscout read); L1 a slot with no reply past ABANDONED_MS is 404 in GET /operations, never 'pending'. Tests: +1 (reports 31st call 429), +1 assert (dead slot 404). gw-links-atomic + gw-mcp-api 17/17, typecheck + lint clean.
