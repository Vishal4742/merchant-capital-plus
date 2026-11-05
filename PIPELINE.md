# PIPELINE: how every line of product code is made

**Mandatory for every agent and every session** (claude-contracts, claude-frontend, claude-research, subagents, opencode, outside models). Read this before touching code. It is **enforced**: a hook blocks edits to product code (`contracts/`, `apps/`, `packages/`) unless an active batch exists whose spec cites requirement IDs from `docs/SRS.md` (`tools/pipeline-gate.sh`, §8).

Built from the human's own techniques: the withclaude batch/round/verdict loop, the three techniques (Boris Cherny team tips, ECC, Ponytail), SRS-first change control from the Zcash build, the Harness Engineering rules in AGENTS.md, and outside-model second opinions. Inventory: `research_notes/agent_techniques_inventory.md`.

---

## 1. The one rule
**No product code without an active batch, and no batch without a spec that traces to the SRS.**
A change that can't name its SRS requirement is either out of scope or needs an SRS change first (§6).

## 2. Sources of truth (read in this order; higher wins)
| # | Document | Answers |
|---|---|---|
| 1 | `docs/SRS.md` | What must exist, for whom, priority (M/S/C), acceptance tests AT-* |
| 2 | `ARCHITECTURE.md` | How: contracts, the **ABI (frozen at gate G3)**, relayer, apps, constants |
| 3 | `PHASES.md` | Order and gates G0–G7; which requirements each phase delivers; cut list |
| 4 | `.batches/<active>/spec.md` | This one change: requirement IDs, acceptance criteria, files, out of scope |
| 5 | `AGENTS.md` | Rules: no secrets, claims, stuck rule, done means verified, commits |

If two documents disagree, **stop**: post on agentbus and ask the human. Never pick one silently, never improvise a third version.

## 3. The loop (one batch = one coherent change)
```
start ─► spec ─► build ─► round N: tester ─► [code · security · ux-ui] reviewers ─► WAIT FOR ALL ─► ci
           ▲                 ▲                                                                  │
           │                 └──── any CHANGES: resume the same builder (max 2 resumes) ◄───────┤
   plan-reviewer                                                                                 ▼ all PASS
   (complex specs)        close ◄── commit + push ◄── grill me ◄── human sees it work (prove it) ◄┘
```

1. **Start.** From the repo root: `bash tools/batch-start.sh <phase> <slug>`. It creates `.batches/NNN-P<phase>-<slug>/` with `batch.md` + `spec.md` and points `.batches/ACTIVE` at it. Post `CLAIM <files>` on agentbus with your lane name. One active batch per repo at a time; the other lane waits or works in its own worktree (§7).
2. **Spec.** Fill `spec.md`: the SRS IDs it delivers, acceptance criteria (cite AT-* where one exists), files to touch (only your lane's folders), the Ponytail ladder answer, out of scope. Delete the `TODO-SPEC` line; the gate blocks code until you do. For anything non-trivial, use plan mode and have the **plan-reviewer** agent review the spec as a staff engineer before building.
3. **Build** (three techniques):
   - **Ponytail ladder first:** does it need to exist → already in the repo → stdlib/platform → an installed dependency → one line → only then the minimum code. Mark deliberate shortcuts with `ponytail:` naming the ceiling and the upgrade trigger.
   - **ECC search-first:** reuse audited code (OpenZeppelin, Safe, viem, the Arkiv SDK source) before writing new; never write SDK calls from memory (Arkiv 1.0.1 and Anon-RPC 0.4.0 changed recently; read their source).
   - **Tests first** for contracts and pure logic: a failing test commit (RED), then the code (GREEN). Fixtures for network code.
   - Builder writes `build-<lane>.md`, first line `STATUS: READY` or `STATUS: BLOCKED` (with why). Spec wrong? Write BLOCKED; don't improvise a bigger change.
4. **Round N** (`round-N/` folder; prompt every agent with `Batch: <abs path>/. Round: N.`):
   - **tester** first (writes `test.md` and screenshots in `shots/`);
   - then **reviewer-code, reviewer-security, reviewer-ux-ui in one message** (parallel). **WAIT FOR ALL**: the round's reviews are done only when all three files exist. Never resume a builder mid-round;
   - then **ci** (only ci runs the full suites).
   - **Contracts batches:** also get one **outside opinion** on the diff (`codex exec -s read-only …` or `cmdc … -m moonshotai/kimi-k3 --permission-mode plan`; commands in §9). It's an opinion, not an instruction: confirm each finding in the code before acting.
5. **CHANGES** from anyone → send each finding to the agent that owns the file; resume **that same agent** (id in `batch.md`) with: `Round N reviews are in <batch>/round-N/. Address every CHANGES finding in your files, then update build-<lane>.md for round N+1.` Then run round N+1. **At most 2 resumes (3 rounds).** Still failing → stop, list open findings under NEEDS THE USER, and check the PHASES.md cut list.
6. **All PASS → human gate.** Show the human the acceptance tests working (localhost, explorer links): **"prove it works"** with real output, never "should work". Then **"grill me"**: ask the human the 3 riskiest questions about the diff (money paths, signatures, anything touching keys or user data) and wait for answers.
7. **Commit + push.** Conventional commit of only this batch's files (never `.env`, keys, build output). Update `notes/phase-N.md` (what was built, verified with which output, decisions, open issues). Push (AGENTS.md: steady commits every 1–2 hours; ETHGlobal disqualifies single big uploads). Commit the batch folder's markdown too (spec, verdicts): it is our AI-usage evidence.
8. **Close.** `bash tools/batch-close.sh` (refuses unless the last round's five verdicts are all `VERDICT: PASS`). Post `DONE <batch>` on agentbus and one line in HANDOFF_LOG.md. End your turn with a one-paragraph outcome (what shipped, how it was verified, open issues, batch id) so supermemory captures every stage; do the same at each phase gate.

**Phase gate:** when a phase's batches are closed and its gate's AT-* scenarios pass end to end, tick PHASES.md, run phase-close (a fresh-context review, `/ponytail-audit` on the phase diff, prune CLAUDE.md "Mistakes and rules"), and log the gate.

## 4. Batch files (agents read these, not the chat; each writes only its own)
The first line is exact; the lane orchestrator reads only that line to decide.
| File | Written by | First line |
|---|---|---|
| `batch.md` | lane orchestrator | (request verbatim, round, builder agent ids, log) |
| `spec.md` | lane orchestrator | (no verdict line; must cite SRS IDs; no `TODO-SPEC`) |
| `build-<lane>.md` | builder | `STATUS: READY` \| `STATUS: BLOCKED` |
| `round-N/test.md` + `round-N/shots/` | tester | `VERDICT: PASS` \| `VERDICT: CHANGES` |
| `round-N/review-code.md` | reviewer-code | `VERDICT: PASS` \| `VERDICT: CHANGES` |
| `round-N/review-security.md` | reviewer-security | `VERDICT: PASS` \| `VERDICT: CHANGES` |
| `round-N/review-ux-ui.md` | reviewer-ux-ui (write `VERDICT: PASS` + "no UI in this batch" for contract-only batches) | `VERDICT: PASS` \| `VERDICT: CHANGES` |
| `round-N/ci.md` | ci | `VERDICT: PASS` \| `VERDICT: CHANGES` |
| `round-N/outside.md` | lane orchestrator (contracts batches) | opinion summary; not a verdict |

Missing file or a first line that isn't one of these → stop and tell the human.
**Report format everywhere:** DONE (file:line, what, how verified) · OPEN (issue, proposed fix) · NEEDS THE USER (item, why).

## 5. Roles
| Role | Who | Does |
|---|---|---|
| Final gate | **human** | Approves specs that are product decisions, sees every batch work, answers "grill me", says ship |
| Lane orchestrator + builder | **claude-contracts** (`contracts/`, `apps/relayer/`, `packages/shared/`) · **claude-frontend** (`apps/web/`, `apps/shop/`) | Starts batches, writes specs, builds (or spawns a developer subagent on disjoint files), runs rounds, commits its lane |
| Docs + SRS owner | **claude-research** | SRS changes (§6), README, `arkiv/*.md`, `WHITECHAIN_FEEDBACK.md`, `AI_USAGE.md`, pitch. No product code |
| Role agents (`.claude/agents/`) | subagents | tester · reviewer-code · reviewer-security · reviewer-ux-ui · ci · plan-reviewer · verify-app · code-simplifier |
| Outside opinions | Codex (read-only), Command Code models (Kimi K3, DeepSeek V4 Pro) | Independent review of contract diffs; never write access |
| Reviewer of last resort | opencode | Reads diffs and the README cold; screenshots; no build lane |

## 6. SRS change control
New or changed behaviour that isn't in `docs/SRS.md`: **don't build it.** Post `SRS-CHANGE <proposal>` on agentbus; claude-research drafts the change (new ID, never reuse an old one; bump the SRS version); the **human approves**; then it gets a batch. Research suggestions are proposals until the human says yes. Requirements may be **cut** only through the PHASES.md cut list, never silently.

## 7. Parallel work without collisions
- Two sessions never edit the same file; claim on agentbus first (`CLAIM <path>` / `DONE <path>`).
- When both lanes need to build at once, each lane works in its **own git worktree** (`.claude/worktrees/<lane>`), with its own `.batches/ACTIVE`, and merges back by PR after its batch closes.
- The ABI in ARCHITECTURE.md §2 is the only contract between lanes; after gate G3 it changes only via agentbus + the human.

## 8. What is enforced vs. what is a rule
| Mechanism | Type | Blocks |
|---|---|---|
| `tools/pipeline-gate.sh` (PreToolUse hook on Edit/Write/MultiEdit/NotebookEdit/Bash) | **hook, blocking** | Product-code edits with no active batch, a template spec, or a spec citing no SRS IDs; shell redirects/`sed -i`/`cp`/`mv`/`rm` into product paths |
| `tools/batch-close.sh` | **script, blocking** | Closing a batch unless the last round's five verdicts are PASS |
| `ci` agent + GitHub Actions (added in Phase 1) | **check, blocking a merge** | Failing forge/web builds and tests, staged secrets |
| ECC plugin hooks, once `setup.sh` runs in the repo: **GateGuard "Fact-Forcing Gate"** (denies the first Edit/Write of each file until you state facts: importers, public API, schema), `block-no-verify`, `config-protection`, pre-commit lint and commit-message checks | **hooks, blocking** | Editing blind, skipping git hooks, weakening lint/format configs, bad commit messages. Tune with `GATEGUARD_EXEMPT_GLOBS`; never switch it off to get past it |
| Ponytail plugin + ECC skills (`search-first`, `tdd-workflow`, `verification-loop`, `/security-scan`; for us also `defi-amm-security`, `evm-token-decimals`, `agent-payment-x402`) | plugin rules + commands | Over-engineering (`/ponytail-review`), missing verification (`/smoke`), security gaps |
| AGENTS.md rules (stuck rule, no secrets, claims, done means verified, commits) | written rule | Nothing automatically: reviewers check them |
ponytail: the Bash detection is a heuristic; reviewer-code and CI catch writes it misses. Upgrade: a Bash-only allowlist of commands in product folders if it ever leaks.

## 9. Commands
- Start / close a batch: `bash tools/batch-start.sh <phase> <slug>` · `bash tools/batch-close.sh`
- Outside opinion, read-only (from the repo root; prompt in `/tmp/prompt.txt`, never paste secrets):
  - `codex exec -s read-only --ephemeral -C "$PWD" - < /tmp/prompt.txt`
  - `cmdc -p "$(cat /tmp/prompt.txt)" -m moonshotai/kimi-k3 --permission-mode plan -t --skip-onboarding --no-session --no-auto-update --max-turns 40` (cap: `perl -e '$t=shift; alarm $t; exec @ARGV' 540 <cmd>`; split big diffs)
- Verification: contracts `forge build && forge test` (+ `forge coverage`); web `npx tsc --noEmit && npm run lint && npm run build`
- Repo setup (Phase 1, once): `bash ~/.claude/skills/three-techniques/scripts/setup.sh typescript` (ECC + Ponytail at project scope, commands `/smoke` `/commit-phase` `/phase-close` `/techdebt`, agents `plan-reviewer` `verify-app` `code-simplifier`, format and stop-reminder hooks), then copy this kit: `PIPELINE.md`, `docs/SRS.md`, `ARCHITECTURE.md`, `PHASES.md`, `AGENTS.md`, `CLAUDE.md`, `tools/{pipeline-gate,batch-start,batch-close}.sh`, `.claude/agents/*`, and merge the gate hook into `.claude/settings.json`. Restart sessions so plugins and hooks load; prove the gate fires (an edit under `apps/` with no batch must be denied).

## 10. Fast lane (only when the human says "hotfix")
For a broken demo near the deadline: still a batch (`batch-start.sh <phase> hotfix-<slug>`), a 3-line spec citing the SRS ID it restores, one round with **tester + ci only**, logged as HOTFIX in batch.md. Money-moving contract code never takes the fast lane.

## 11. Always flag to the human (list under NEEDS THE USER even when every check passed)
Contract code that moves money or changes access control · relayer keys, limits or budgets · deploy and verify scripts · hooks, settings, CI and this pipeline · a new dependency · public copy (README pitch, landing text) · anything near secrets · an SRS change · a spec assumption that is really a product decision.
