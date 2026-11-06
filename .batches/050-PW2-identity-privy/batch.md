# 050-PW2-identity-privy
Phase: W2 (owner's Stage 3)   Round: build   Owner lane: whiteflow-f3
Mode: phase
Money: yes
Request (verbatim, owner 2026-11-06): "build the mco, use privy for signins on whitechain … do not assume any implementation"; AskUserQuestion answers: Privy login = "Email + external wallet (Recommended)"; MCP = "Remote OAuth MCP (Recommended)"; pacing = "Stacked PRs, keep going (Recommended)".
Agent ids (builders, for SendMessage resumes): whiteflow-f3
Log:
- 2026-11-06: branch wf/stage3-identity stacked on wf/stage2-port (batch 049). Design reuses the snapshot's frozen 032 spec (whiteflow-ef) with the Privy login leg; SRS FR-BIZ-6 amended to v3.1 per the owner's answer.
