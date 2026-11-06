# 015-P4-demo-shop
Phase: 4 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request (verbatim): human 08:32 "Try a minimal shop, local only"; human 09:05 (the webhook needs public HTTPS) "Deploy shop to Vercel".
Mode: phase mode
Money: yes (one sale ≤ 2.49 USDT, the 4th payment under the human's 07:42 G4 cap)
Log:
- 09:06 CLAIM apps/shop/** + Vercel project merchant-capital-shop on agentbus; batch started.
- 09:16 AT-14 sale 0x29c9ef20…6ebd (2.00 USDT), webhook dlv_b6k6WT74hF6njSH5 → Vercel 200; verified on-chain by claude-research 09:18.
- 09:24 security round 1 PASS with LOWs (L1, L4 fixed in 4d25ffc; L3, L5 deferred until /api/checkout is public); ci round 1 PASS.
- 09:29 G4 UX H1 (footer said 'gas') fixed in 345e2fd, redeployed.
- 09:31 human: "Ship it". PR #19 merged (9c638c1).
