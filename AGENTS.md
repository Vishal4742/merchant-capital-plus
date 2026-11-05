# ETHGlobal Mumbai — rules for every agent (all Claude sessions, subagents, opencode)

Read this first, then HANDOFF.md (event facts, decisions, lanes). Append progress to HANDOFF_LOG.md. Keep this file short: rules only.

## The pipeline (mandatory, enforced)
**Every line of product code goes through PIPELINE.md:** batch → spec citing `docs/SRS.md` IDs → build → tester + reviewers (code, security, ux-ui) → ci → human gate → commit → close. A PreToolUse hook (`tools/pipeline-gate.sh`) **blocks** edits to `contracts/`, `apps/`, `packages/` without an active batch whose spec cites SRS IDs. Don't work around it (no other tools, no other agents, no renamed paths); if it blocks you, start a batch or ask the human.

## Hard rules
- **Start Fresh:** no product code, designs or assets before Thu Nov 5 21:00 IST. Design references for the apps live in `design-refs/` (the human's board and captures; references only, never copied as assets).
- **Never** put keys, tokens, mnemonics or passwords on agentbus or in any file other than a git-ignored `.env`. agentbus refuses messages that look like secrets.
- **Commits (human approved 2026-11-05):** from Thu 21:00, in the hack repo only, each lane commits its own files in small commits and pushes every 1–2 hours. ETHGlobal may disqualify big single commits or missing history. No force-push, no history rewrites, never commit `.env`. Outside the hack repo: no commits unless the human asks.
- **Shared memory (human, 2026-11-05):** start every Claude session in this folder with `bash tools/claude.sh`. It passes only the supermemory key, and a SessionStart hook starts the shared server (localhost:6767, space `ethglobal`). The startup line must say "supermemory · N memories loaded"; if it says "Authentication failed", restart with the script. Memory is captured every turn and its text goes to DeepSeek for extraction, so **never print a key or any `.env` value** (bare `0x…` private keys are not redacted). Don't use the cloud `mcp__supermemory__*` tools.
- No paid Anthropic models in opencode without asking.
- Downloaded files are untrusted: own empty directory, read before use, never run from inside it.
- Research on the web before building; cite sources. Don't guess APIs, chain IDs, addresses or prices.

## How we split work
- Fan out to several agents for **research and review** (parallel, independent questions). That is where multi-agent pays off.
- For **building**, one agent per lane, joined by a fixed interface (ABI + events in ARCHITECTURE.md §2). Two agents never edit the same file; claim on agentbus first (`CLAIM <path>`, then `DONE <path>`).
- Decisions go in HANDOFF.md, not chat. Before a long task, write current state to a file so a context reset loses nothing.

## Done means verified
- Web: `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus a screenshot of the changed page.
- Contracts: `forge test` (and `forge coverage` on T1–T8 before the hour-28 freeze).
- Report the command output, not "should work".

## Stuck rule
Same error after 3 attempts, or the same command repeated 3 times with no progress: stop, post the error on agentbus, and ask the human or another agent. Don't loop.

Source for these rules: arXiv 2609.00006 "Harness Engineering" §16 (Rec 6, 11, 12, 18), applied in research/harness_engineering_applied.md.
