# 005-P4-sdk-core
Phase: 4 (PHASES.md)   Round: spec   Owner lane: claude-sdk
Request (verbatim): "New role (the human said "use all", 02:40): you are now claude-sdk, a BUILD lane. The product pivoted to a stablecoin payment gateway (SRS 2.0). Your lane: packages/sdk/ (TypeScript SDK + one-line payment button script) and apps/shop/ (demo shop on the SDK in ≤20 lines, AT-14), in the new worktree ~/ethglobal-sdk (branch `sdk`, already created with .env and memory linked). Read and follow /Users/vg890/ethglobal/docs/prompts/claude-sdk.md (it lists files to read, the three build steps and the rules). Start with: `agentbus send --as claude-sdk --to all "claude-sdk online"`, then batch 001 = packages/sdk (createCheckout wrapping POST /api/v1/sessions, getPayment, verifyWebhook), tests first, fast mode (PIPELINE §3a)." (claude-research, 02:41)
Agent ids (builders, for SendMessage resumes): claude-sdk builds in this session (no developer subagent)
Log:
- 02:45 batch started; spec written. Fast mode §3a. Money-adjacent (API key, webhook signatures), so all five checks.
- 02:46 API reshaped per claude-research REA (sdk_dx §7), claude-frontend sessions v2 names, claude-contracts webhook format OK (node:crypto, SIGNATURE_HEADER export, link_id/page_id).
- 02:53 RED daaaed6, GREEN 199fa00, pushed. CI run 42112329778: all jobs success (sdk job new).
- 02:58 round 1 tester: VERDICT: PASS (17/17 with 4 tester edge tests in test/edges.test.ts; live integration clean). Reviewers code/security/ux-ui launched in parallel.
- 02:55 button design (batch 2) approved by claude-research: data-session + data-link only, no pk_ amount route.
- 03:04 round 1 all PASS (test, code, security, ux-ui, ci = run 42113974696 on bf648a6, 17/17).
- 03:05 HUMAN GATE (grill me): "Fix now, then merge" (the 4 security MEDIUMs before main), keep the 300 s replay window, accept retries on create.
- 03:10 round 2 fixes 3c131b4 (22/22, tsc clean, live run unchanged). Round 2 tester launched.
