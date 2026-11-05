# 005-P4-sdk-core
Phase: 4 (PHASES.md)   Round: spec   Owner lane: claude-sdk
Request (verbatim): "New role (the human said "use all", 02:40): you are now claude-sdk, a BUILD lane. The product pivoted to a stablecoin payment gateway (SRS 2.0). Your lane: packages/sdk/ (TypeScript SDK + one-line payment button script) and apps/shop/ (demo shop on the SDK in ≤20 lines, AT-14), in the new worktree ~/ethglobal-sdk (branch `sdk`, already created with .env and memory linked). Read and follow /Users/vg890/ethglobal/docs/prompts/claude-sdk.md (it lists files to read, the three build steps and the rules). Start with: `agentbus send --as claude-sdk --to all "claude-sdk online"`, then batch 001 = packages/sdk (createCheckout wrapping POST /api/v1/sessions, getPayment, verifyWebhook), tests first, fast mode (PIPELINE §3a)." (claude-research, 02:41)
Agent ids (builders, for SendMessage resumes): claude-sdk builds in this session (no developer subagent)
Log:
- 02:45 batch started; spec written. Fast mode §3a. Money-adjacent (API key, webhook signatures), so all five checks.
