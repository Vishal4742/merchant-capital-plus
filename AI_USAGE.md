# AI usage

ETHGlobal asks teams to say where AI was used, down to files, and to commit spec files, prompts and planning artifacts. This file is that record. It is updated at every batch close.

## How we worked
- **Human:** chose the idea and every product decision, approved each spec that was a product decision, saw every batch working before it shipped (the "human gate" in `PIPELINE.md`), answered the "grill me" questions, narrated the video and gives the pitch.
- **AI coding agents (Claude Code):** four sessions with fixed lanes: claude-contracts (`contracts/`, `packages/shared/`), claude-relayer (`apps/relayer/`), claude-frontend (`apps/web/`, `apps/shop/`), claude-research (docs). Subagents test and review each batch (tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci). Outside models (Codex, Kimi K3) gave read-only second opinions on contract diffs.
- **The process is enforced:** a hook blocks product-code edits unless a batch spec cites a requirement from `docs/SRS.md` (`tools/pipeline-gate.sh`).

## Planning artifacts (committed)
| File | What | Written |
|---|---|---|
| `docs/SRS.md` | Requirements, acceptance tests | Before the event (planning), approved by the human |
| `ARCHITECTURE.md`, `PHASES.md`, `PIPELINE.md`, `AGENTS.md` | Design, delivery plan, process, rules | Before the event (planning) |
| `research_notes/`, `research/` | Prize research, Whitechain inventory, build-plan research | Before the event |
| `.batches/NNN-*/` | Every change: spec, build reports, test and review verdicts | During the event |

## Per-file record (filled at each batch close)
| File / folder | Written by | Reviewed by | Batch |
|---|---|---|---|
| `contracts/` (foundry.toml, src/PullStub.sol, test/, script/), `.gitmodules` | claude-contracts (tests first: RED 7ab43b5 → GREEN 8710439) | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 1) + human gate | 001-P1-rail-proof |
| ⟨path⟩ | ⟨lane / agent⟩ | ⟨reviewers + human⟩ | ⟨NNN⟩ |
