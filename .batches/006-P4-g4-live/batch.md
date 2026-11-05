# 006-P4-g4-live
Phase: 4 (PHASES.md)   Round: closed (2 rounds)   Owner lane: claude-contracts
Request (verbatim): "go to the next phase"
Agent ids (builders, for SendMessage resumes): lane-built (no developer subagent)
Log:
- 02:0x spec: AT-6, AT-7, AT-8 (contract half), NFR-10; no contract change (ABI frozen at G3, Phase 5 contract items cut 02:02).
- 02:2x build: LiveInvoice.s.sol + EventAbi.t.sol committed (25b91f5) before the live run, so the broadcast records name a clean commit; live fund() + AT-8 reads + pay(1) on 1874; records committed (ad3918d).
- 02:4x round 1: tester, reviewer-code, reviewer-security, reviewer-ux-ui PASS. Follow-ups: E1 missed ClaimToken.MarketSet (fixed in round 2); E1 can't see `indexed` flags (CI step, human: skip, contracts frozen); top-up cap in LiveInvoice (not fixed: the script ran once and won't run again).
- 02:5x round 2: one E1 assert + invoice 1 status decoded + AT-8 replay at block 12316357; tester, reviewer-code PASS; security + ux-ui light delta (§3a.4); ci PASS (153/153, coverage CapitalMarket 100%, ClaimToken 99.07%, InvestorRegistry 100%, MerchantPay 97.78%; one fork-RPC flake under coverage load passed on rerun).
- 03:0x HUMAN GATE: "Approve and freeze" (§11 live script with demo-wallet keys accepted); CI ABI-diff step: skip; batch 007 deps (@neondatabase/serverless, @electric-sql/pglite dev): both approved. Contracts are FROZEN.
