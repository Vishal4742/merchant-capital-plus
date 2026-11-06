# 050-PW2-identity-privy
Phase: W2 (owner's Stage 3)   Round: build   Owner lane: whiteflow-f3
Mode: phase
Money: yes
Request (verbatim, owner 2026-11-06): "build the mco, use privy for signins on whitechain … do not assume any implementation"; AskUserQuestion answers: Privy login = "Email + external wallet (Recommended)"; MCP = "Remote OAuth MCP (Recommended)"; pacing = "Stacked PRs, keep going (Recommended)".
Agent ids (builders, for SendMessage resumes): whiteflow-f3
Log:
- 2026-11-06: branch wf/stage3-identity stacked on wf/stage2-port (batch 049). Design reuses the snapshot's frozen 032 spec (whiteflow-ef) with the Privy login leg; SRS FR-BIZ-6 amended to v3.1 per the owner's answer.
- 2026-11-06: whiteflow-ef (Stage 3 lead, owner D15) adopted wf/stage3-identity as the Stage 3 base (draft PR #44); f3 keeps its files; ef reviews and builds 051 (v1 cutover/backfill) stacked on this.
- Real-PG concurrency (spec 032 R2-5): `node tools/stage3/identity-neon.mjs P:/WhiteFlow/.env` → 5/5 on wf_s2_web via the production Neon driver with a WebSocket Pool holder and pg_stat_activity Lock waits: schema twice; 10 two self-demotions → 200/409, owner_count = real = 1; R2-2 mutual removal → 200 + refusal, one Owner left; 13 two activations → one version 1 + 409; 3 one signed pair × 3 processes → one activation, both challenges consumed once. Deviation from 032 R2-2's wording for ef's review: when A's removal of B commits first, B's statement answers 403 (its Owner membership is gone at re-check, so it has no authority) instead of 409; the invariant (one removal, one Owner left) holds either way.
