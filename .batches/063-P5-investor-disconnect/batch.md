# 063-P5-investor-disconnect
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-frontend
Mode: phase
Money: no (wallet connection state only; no signature, no transaction)
Request (verbatim, human in claude-frontend's chat, 2026-11-07 09:56): "disconnect wallet option ?"
Agent ids: none
Log:
- 09:58 Survey: the dashboard has Sign out; checkout and invoice pay end their wallet session after each attempt (endWalletSession); the investor pages (/capital, /capital/holdings) connect a wallet and offer no way out, and reconnect silently on every load (useInvestor run(false)). Branch p5-investor-disconnect from origin/main 8c9138b. Merge only after judging (submission is main at 08:25).
- 10:05 GREEN: lib/investor-off.ts + useInvestor disconnect + WalletChip Disconnect; 4/4, tsc 0, lint 0, build 0. Browser (b063-shots/flow.mjs, stub wallet that keeps offering its account after a revoke) at 375 light + 1440 dark: connected shows Disconnect; Disconnect -> Connect + wallet_revokePermissions sent; reload stays disconnected; /capital/holdings too; Connect reconnects and a reload keeps it; h-scroll 0. (Console errors only from the test stub inside a sandboxed iframe.)
