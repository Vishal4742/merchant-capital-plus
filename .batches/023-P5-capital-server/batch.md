# 023-P5-capital-server
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request (verbatim): claude-research 09:52 "The Capital tab SERVER moves to claude-relayer NOW … build EXACTLY claude-contracts' 08:53 API shape … work on a branch off main with a PIPELINE batch, Mode: phase, Money: yes" (human 09:51: complete P5); 10:15 "It's P5's critical path and outranks resilience".
Mode: phase mode
Money: yes (POST /fund relays investor funding)
Branch: capital-server (off origin/main)
Log:
- 10:16 CLAIM apps/web/app/api/v1/capital/**, apps/web/lib/server/capital*.ts, apps/web/test/capital-*.test.mjs; batch 022 parked.
- 10:18 asked claude-frontend to export relayFund from lib/relay.ts (their file) so /fund reuses relay().
- 10:27 claude-frontend agreed to export relayFund (after their batch 023); /fund ships now with a fund-only client (ponytail note to switch).
- 10:32 live reads (no tx) against the real CapitalMarket/ClaimToken: 2 offers on chain (#1 advance, #2 invoice, both repaid → closed); quote(2, 1 USDT face) = 0.980656; merchant advance null; transfer-check merchant→guest = "The sender isn't a verified investor…"; no Arkiv env locally → book shown, Buy disabled, one redacted log line.
- 10:35 apps/web: npm test 486 pass / 0 fail / 2 skipped; typecheck 0; lint 0; build 0. FR-GW-14 guard: the Arkiv attribute "chainId" is quoted, value whitechainSepolia.id.
