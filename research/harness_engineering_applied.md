# Harness Engineering applied to our workflow

Source: Barbaste et al., "Harness Engineering: Anatomy, Architecture, and Evolution of Coding Agents", Wavestone AI Lab, July 2026. arXiv 2609.00006, https://arxiv.org/html/2609.00006v1 (§16 = the 18 recommendations). Found via @AnnatarXBT on X, 2026-10-23.

Core claim: **agent = model + harness.** Same model, better environment → more reliable work. They read the source of 11 coding agents (Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider, ...). All 11 share 7 parts: loop, LLM layer, tools, context/memory, safety, orchestration, extensions.

We don't build a harness. We *configure* three of them (Claude Code, zcode, opencode). So each recommendation is read as "what does this mean for how we run them".

## Applied (done 2026-10-26)

| Rec | Paper says | What we did |
|---|---|---|
| 6 | Auto-discovered Markdown context files (AGENTS.md / CLAUDE.md) at project scope; all 11 systems converged on it | Added `ethglobal/AGENTS.md` (shared rules) + `CLAUDE.md` that imports it. Before, the rules lived only in Claude Code's private memory, so zcode/opencode never saw them. |
| 11 | Safety rules as data/policy, with a hard floor that survives "YOLO" | `tools/agentbus.py send` now refuses text that looks like a key/token/mnemonic (tx hashes still pass). Selfcheck covers it; 0 of 51 past messages would have been blocked. |
| 12 | Stay single-agent unless a phase is truly breadth-first; multi-agent costs ~15x tokens (Anthropic) and "most coding tasks involve fewer truly parallelizable tasks than research" | Written into AGENTS.md: fan out for research and review; one agent per build lane joined by the ABI in ARCHITECTURE.md §2. |
| 18 | Don't over-build stuck detection, but ship the cheap caps (OpenCode: 3 identical calls → ask) | "Stuck rule" in AGENTS.md: 3 failed attempts → stop, post, ask. |

## Already doing it (paper confirms)

- **Rec 8 / 16, no RAG over code:** 0/11 agents use vector search for code. We use rg/glob. Don't add embedding search to PayKit.
- **Rec 14, skills over MCP:** skills lead MCP 9/11 vs 8/11. Our Figma MCP quota wall (20 calls/month) is the textbook case. Third-party skills = packages: we read the Elaya skills in full before installing.
- **Rec 7, compaction:** durable decisions live in files (HANDOFF.md, memory, .remember), so a context reset loses nothing.
- **Rec 15, no agent frameworks:** PayKit has no LangChain/CrewAI anywhere. Keep it that way.
- **Verification:** the quoted Lunar article argues most agent failures are environment failures. Our "done = tsc + lint + build + screenshot / forge test" is that idea.

## Approved by the human 2026-10-27 (1 + 3 done; 2 happens Thu 21:00)

1. **Split HANDOFF.md.** It is 18 KB and every agent loads all of it each session; the log is ~46% of it (8.5 KB). Keep facts + decisions in HANDOFF.md, move the log to HANDOFF_LOG.md (read on demand). Paper: context rot in long windows (Rec 7, ref [19]). Touches zcode's sections, so agree on the bus first.
2. **Commit AGENTS.md into the PayKit repo at Thu 21:00.** ETHGlobal asks teams to "document AI usage and commit spec/prompt files". AGENTS.md + the ABI doc are exactly that, and they're rules/templates, which Start Fresh allows.
3. **Hackathon lanes:** contracts (zcode) and app (Claude Code) build; opencode does review + research + screenshots, not a third build lane. Same reason as Rec 12.

## Not relevant to us

Rec 1–5, 9, 10, 13 (loop design, provider adapters, edit-tool contracts, approval modes, OS sandboxes, ACP servers) are for people writing a harness. Rec 4 (deferred tool loading above 15 tools) is already how Claude Code runs here. Rec 17 (don't wrap SaaS APIs 1:1) only matters if PayKit grows an agent; it doesn't.

## Open (zcode verifying → research/harness_verify.md)

- Does opencode really read CLAUDE.md / AGENTS.md and `~/.claude/skills`? If yes, the new AGENTS.md reaches it for free.
- Exact multi-agent token multiplier in Anthropic's post.
- OpenCode doom-loop guard: real, and how to configure.
