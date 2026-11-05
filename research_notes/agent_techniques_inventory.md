# Agent techniques inventory (vg890), surveyed 2026-11-05

Read-only survey of ~/.claude, ~/Zcash, ~/withclaude_website, ~/ethglobal. No secret values were read: settings were parsed for key names only, and .env files were skipped.

## A. Techniques

| Technique | What it makes the agent do | Where it's configured | Reuse in a new repo |
|---|---|---|---|
| **Three techniques** (umbrella) | Runs Boris Cherny's team tips, the ECC loop and the Ponytail ladder together | `~/.claude/skills/three-techniques/` (SKILL.md, `scripts/setup.sh`, `templates/`) | `bash ~/.claude/skills/three-techniques/scripts/setup.sh typescript` inside the repo. It installs ecc + ponytail at project scope, copies ECC rules into `.claude/rules/ecc/`, copies the templates without overwriting, and merges settings. It runs `git init` if the folder has no repo yet. |
| Plan mode + second-Claude plan review | Plans complex work first. `plan-reviewer` (read-only, max 25 lines) checks what won't work, which exit criteria can't be verified, the riskiest step, what to cut and what's missing | `templates/agents/plan-reviewer.md` | Copy the agent file |
| Living CLAUDE.md | After every correction, adds a line to "Mistakes and rules"; prunes daily | `templates/CLAUDE.md`, example in `~/Zcash/CLAUDE.md` | Copy the template and fill the `{{}}` placeholders |
| Worktrees | Independent phases run in `.claude/worktrees/<name>` (gitignored) and merge back by PR | Zcash has `web`, `web-polish`, `hero` | `git worktree add .claude/worktrees/<lane>` |
| "Grill me" / "Prove it works" | Agent asks the 3 riskiest questions before it commits, and shows real command output | `templates/commands/commit-phase.md` | Copy `/commit-phase` |
| ECC: search-first, tdd-workflow (RED→GREEN), verification-loop, `/code-review` in a fresh context, `/security-scan`, `npx -y ecc-agentshield scan` | Research and reuse before writing; tests first; lint, types, tests, coverage, a secret grep and a diff review | Plugin `ecc@ecc` 2.2.3, **installed at project scope for ~/Zcash only** | Install at project scope (setup.sh does this). Stack-relevant extras in ECC: skills `evm-token-decimals`, `defi-amm-security`, `agent-payment-x402`, `typescript-patterns`, `nextjs-turbopack`; agents `typescript-reviewer`, `security-reviewer` |
| Ponytail: YAGNI ladder, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt` (`ponytail:` shortcut ledger) | Picks the smallest change that holds and flags over-engineering | `ponytail@ponytail`, user scope (4.10.0; 5.3.3 in Zcash) | Already global. Pin it at project scope so a clone gets it |
| verify-app agent | Fresh-context verifier. Never edits; reports PASS/FAIL with quoted output | `templates/agents/verify-app.md` | Copy |
| code-simplifier, `/techdebt`, `/phase-close`, `/smoke` | Post-phase cleanup under the ladder; end-of-day cut list; full phase close; stack-detecting checks | `templates/agents`, `templates/commands` | Copy |
| Phase notes | `notes/phase-N.md`: built / verified (real output) / decisions / open / next | `templates/notes/README.md`, `~/Zcash/notes/phase-hackday-close.md` | Copy the format |
| **SRS-first change control** | Requirements → design → plan → review, and only then code, on the user's go-ahead. A change updates the SRS first, then the traceability matrix, then design and tests, and bumps each doc's version line. Commits cite requirement IDs (`FR-8`) | `~/Zcash/docs/00-README.md` §Change control, `03-srs.md` (version line, e.g. "v1.1 adds EI-6, FR-15..."), `11-traceability-matrix.md`, `13-engineering-standards.md` (DoD) | Copy the 00-README change-control paragraph, the DoD checklist and the PR template |
| Independent design review | A fresh-context staff-engineer review. Table columns: #, Sev (Blocker/Major/Minor), Finding, Disposition. Closed only when every finding is dispositioned | `~/Zcash/docs/reviews/2026-10-30-design-review.md` | Copy the format |
| Multi-session contract | One owner per file, shared types and signatures written first, integration order, a blockers-for-the-user table; "change this doc before changing a signature" | `~/Zcash/notes/coordination.md` | Same idea as ethglobal ARCHITECTURE.md §2 |
| **Batch / round / verdict loop** | Orchestrator → architect spec → developer + designer (disjoint files) → tester → 4 reviewers in parallel, WAIT FOR ALL → ci. Exact first lines: `STATUS: READY/BLOCKED`, `VERDICT: PASS/CHANGES`. Max 2 resumes (3 rounds), then NEEDS THE USER. Ships as one PR after "ship it" | `~/withclaude_website/.claude/CLAUDE.md`, `.claude/agents/*.md`, `.batches/NNN-slug/` (git-excluded) | ethglobal already has `PIPELINE.md`, `tools/batch-start.sh`, `tools/batch-close.sh`, `.claude/agents/{tester,reviewer-*,ci}.md` |
| Outside-model second opinions | Read-only reviews by other models; their output is an opinion to confirm in code | withclaude CLAUDE.md: `codex exec -s read-only --ephemeral -C <repo> - < prompt.txt`; `cmdc -p ... -m moonshotai/kimi-k3 / deepseek/deepseek-v4-pro --permission-mode plan ...`; `perl alarm` as the macOS timeout; split big diffs. Skill `codex-review` | Copy that section, with the repo path changed |
| Fact-Forcing Gate (ECC GateGuard) | PreToolUse deny on the **first Edit/Write of each file**, demanding facts (importers, public API, data schema) based on the target class. Destructive Bash needs targets, a rollback plan and a quote of the instruction. Routine Bash gets a one-time quote check | `~/.claude/plugins/cache/ecc/ecc/2.2.3/scripts/hooks/gateguard-fact-force.js` (hook ids `pre:edit-write:gateguard-fact-force`, `pre:bash:dispatcher`) | Comes with ecc. Tune with `GATEGUARD_EXEMPT_GLOBS`, `GATEGUARD_FACT_FORCE_MAX_DENIALS`, `GATEGUARD_BASH_ROUTINE_DISABLED=1`; turn off with `ECC_GATEGUARD=off` or `ECC_DISABLED_HOOKS` |
| remember plugin | Captures sessions into tiered daily logs in `.remember/`; `/remember` saves state for the next session | `remember@claude-plugins-official`, user scope | Already global; gitignore `.remember/` |
| supermemory | Recall on prompt, capture on Stop | `ethglobal/.claude/settings.json` (project scope) | Already in ethglobal |
| agentbus | File bus (`~/.agentbus`) between Claude Code, zcode and opencode. `CLAIM`/`DONE <path>`. Refuses messages that look like secrets. Stop hook with `--wait` turns delivery into push | `ethglobal/tools/agentbus.py`; wired as hooks **only in `ethglobal/zcode.json`**. `~/.claude/settings.json` has empty `UserPromptSubmit`/`Stop` arrays, so Claude Code isn't hooked | Add `agentbus.py hook session/prompt/stop --as claude` to project settings if push delivery is wanted |
| Stuck rule, done-means-verified, Start Fresh, research-first | 3 failures → stop and ask; web: tsc + lint + build + screenshot, contracts: forge test (+coverage) | `ethglobal/AGENTS.md`, `research/harness_engineering_applied.md` (Rec 6/11/12/18) | Already in place |
| Context hygiene | `skillOverrides: "name-only"` hides 13 LinkedIn/redesign skills; HANDOFF split into facts and log | `~/Zcash/.claude/settings.local.json`; ethglobal HANDOFF_LOG.md | Copy the skillOverrides block |
| Other always-on | humanizer (prose filter, global CLAUDE.md), i-have-adhd (output shape), pstack (`poteto-mode`, principles such as prove-it-works and sequence-verifiable-units, Comment Sicko agent), pr-review-toolkit (6 reviewer agents incl. silent-failure-hunter), claude-security (`/claude-security` deep scan + patch), ralph-loop | user-scope plugins | Already global |

## B. Enforcement

**Blocks for real (hooks, tool limits, CI):**
- ECC PreToolUse hooks (exit 2 / `permissionDecision: deny`), **active only where ecc is installed (currently ~/Zcash)**: GateGuard fact-forcing; `block-no-verify` (stops `--no-verify` and `core.hooksPath` bypass); `config-protection` (no edits to existing linter/formatter configs); `pre-bash-commit-quality` (lint on staged files plus commit-message format, exit 2); dev-server block (outside tmux); MCP health check; hookify-runtime (project-local Hookify rules on Pre/Prompt/Stop). Stop-time format + `tsc` run once per response.
- security-guidance (user scope): PostToolUse pattern warnings on edits and Bash; at Stop, an LLM diff review that can return `decision: block`.
- ralph-loop Stop hook: blocks stop until the completion promise appears, but only while a loop is running.
- agentbus `send`: refuses secret-looking text (hard floor).
- Subagent tool allowlists: verify-app and plan-reviewer have no Edit/Write; withclaude reviewers and architect have no Edit.
- ethglobal `tools/pipeline-gate.sh`: a PreToolUse gate written to block product-code edits outside an active batch. **Not wired**: ethglobal `.claude/settings.json` only enables supermemory.
- CI: Zcash `ci.yml` (`cargo fmt --check`, `clippy -D warnings`, `cargo test`, `permissions: contents: read`); `deploy-web.yml` (fails when a file referenced by index.html is missing). withclaude `ci.yml` (`npm run build` incl. astro check, vitest) and `preview-smoke.yml` (real-browser smoke on Vercel previews, gating held production builds through Deployment Checks).
- Permission allowlist: three-techniques read-mostly `allow` list (fewer prompts, but it adds no denies).
- Not found: no git hooks in Zcash or withclaude (`.git/hooks` has only samples). Branch protection wasn't checked.

**Advisory only (never block):** format-on-edit.sh, stop-reminder.sh, ponytail SessionStart/SubagentStart injection, i-have-adhd, remember capture, ECC doc-file-warning, suggest-compact, console.log check.

**Written rules only:** ponytail ladder, plan review, grill me / prove it, SRS-first change control, Mistakes section, stuck rule, done-means-verified, one owner per file and CLAIM on agentbus, "only the orchestrator runs state-changing git", "only ci runs the full suite", "a denied command is never retried", NEEDS THE USER flag list, "outside-model output is opinion", "nothing invented", Start Fresh, no commits unless asked.

## C. Files

**Copy (all rules/templates, which Start Fresh allows):**
- `~/.claude/skills/three-techniques/templates/{CLAUDE.md, agents/*, commands/*, hooks/*, notes/README.md, settings.json}`, or run `setup.sh typescript`. Zcash's copies are byte-identical to these.
- `~/Zcash/.github/workflows/ci.yml` (shape: read-only token, fmt/lint/test; swap in `forge fmt --check`, `forge test`, `npm ci && npx tsc --noEmit && npm run lint && npm run build`).
- `~/Zcash/.github/pull_request_template.md` (requirement ID + checks); `~/Zcash/docs/00-README.md` §Change control; `docs/13-engineering-standards.md` §4 DoD; `docs/reviews/2026-10-30-design-review.md` (format); `notes/coordination.md` (format); `GUARDRAILS.md` (structure: limits enforced in code, kill switch, no override).
- `~/withclaude_website/.claude/CLAUDE.md` sections "The loop", "Batch files", "Outside agents", "Rules for every agent"; `.github/workflows/preview-smoke.yml` if deploying on Vercel.
- `~/Zcash/.claude/settings.local.json` `skillOverrides` block.
- Wire `ethglobal/tools/pipeline-gate.sh` and ECC into the hackathon repo's `.claude/settings.json`.

**Do NOT copy:**
- Any `.env`, `.env.local` (Zcash, withclaude, ethglobal), `.vercel/`, `.wrangler/`, `.neon`, `.mcp.json`, `.dev-auth/`, `.remember/`, `.supermemory/`, `~/Zcash/tools/wallets`, `data/`, `.claude/worktrees/` (full repo copies).
- Project-specific content: Zcash Mistakes-and-rules lines (Bitrefill, 1Click, zat), GUARDRAILS limits, withclaude "Always flag" paths, `.commandcode/taste`.
- `~/Zcash/.codex/hooks.json` (absolute Zcash paths); `~/.claude/settings.json` `autoMode`, `skipDangerousModePermissionPrompt` (machine-level).
- Any pre-Thu-21:00 product code or assets (Start Fresh).
