# Phase 3, contracts lane: the advance (+ the full CapitalMarket)

Batch `005-P3-advance` · gate **G3** proven live · ABI frozen (ARCHITECTURE §2, `packages/shared/contracts.ts`).

**Live (1874, all fully verified, from `ef5fee4`):** InvestorRegistry `0x293430fae87ca79844c6e3a64e8044078c4d3e74` · ClaimToken `0xce9b171a5c485a41dced9d7f043733bddc26c388` · MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251` · CapitalMarket `0xecd63a369d23dfddc6bfac921e41a86760c20abe`. Retired + paused: MerchantPay `0x83b5…73b7` (Phase 2), `0x8eff…248f` (round 1). Old round-1 registry: demo investors revoked.

**G3 live (16 txs):** AT-3 fund `0x8d4958eb…6810` · AT-4 sale `0x9fc06d89…5ec8` (1 USDT to the investor in the same tx) · after-cap sale `0x0269606d…4360` (0 to investors). Investor and customer 0 WBT, nonce 0.

**Built:** interfaces first; InvestorRegistry + ClaimToken by a developer subagent (tests first); CapitalMarket + MerchantPay v2 by the lane (code before tests: deviation, accepted by the human at the gate). 150 tests; CapitalMarket 100% lines, ClaimToken 99%, MerchantPay 98%.

**Rounds:** round 1 CHANGES: H1, a batch transfer repeating an id moved frozen units (reviewer-security + tester independently) → running total per id, redeploy of all four. Round 2 all PASS after one test-infra fix (fork RPC moved to the official Whitechain RPC; Ankr's rate limit surfaced as bare reverts; every exact counterexample replay passed).

**Human decisions (G3 gate):** invoices take the relay fee on top; invoice financing is senior to a running advance and merchant wallets never go on the investor list; Phase 5 contract items stay cut (no more redeploys).

**Facts for later:** routed sale ≈ 256–278k gas with one investor (≈ the 0.10 fee), ~537k with 8 holders (relayer must estimate gas); `forge test -j 1` on the official RPC is stable; deploy scripts must list every MerchantPay to pause.
