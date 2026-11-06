# 035-P5-capital-investor
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-research (agent)
Request: human 16:26 "quickly build the things": the Capital tab's investor view at /capital (docs/CAPITAL-TAB.md screens I1-I4).
Mode: phase mode
Money: yes (the investor signs the EIP-3009 fund authorization that POST /api/v1/capital/fund relays)
Log:
- batch started on branch p5-capital-investor from origin/main 1f92783.
- tests first (9b37391, red), lib/capital-wallet.ts green 12/12, UI for I1-I4, screens at 375 and 1440.
- claude-contracts 16:50: typed data PASS (lib/capital-wallet.ts).
- round-1 ci PASS; PR #33 opened (not merged). Open: /capital CSP rule in next.config.ts (outside these paths, G10).
