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
- 10:58 security round 1 FAIL (F1, F2 HIGH): fixed with F3, F4, F5, F7 in this commit; tests 5c15fcf (RED) → green. apps/web npm test 514/0, typecheck 0, eslint 0; local fundingNonce == CapitalMarket.fundingNonce on chain. Deferred: F6 (200-offer window), F8 (claude-frontend guard regex), F9 (relayer breaker, pre-existing → batch 022).
- 10:50 security round 2 PASS. New LOWs R1 (/merchant limit per address, chainOffers uncached) and R2 (list/publish/cancel loop costs Arkiv gas): deferred with F6.
- 10:55 claude-contracts approved the API shape (10:35) + decisions D1-D3/Q12 (10:49) applied, plus their LOWs: refresh patches only (no double create), expiry at maturity, err.name log. Their MEDIUM (createdBy) was already fixed in 4db17af. Capital tests 27/0, typecheck 0, eslint 0.
- 11:04 human: "Ship it". PR #23 merged after GitHub CI passed (web job pass).
