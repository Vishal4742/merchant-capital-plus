VERDICT: PASS

# Test: 005-P3-advance, round 2 (tester), HEAD de3ceac
No UI, and no web or relayer file in the diff: no browser walk, Lighthouse or p95 run.

## Round-1 CHANGES item
- T1 partial freeze: FIXED. `ClaimToken._checkTransfer` now takes a running per-id total (loop over earlier entries of the same id). `ClaimTokenProbe.t.sol` passes (repeated id reverts; repeat within the unfrozen balance passes). Extra shapes in ClaimToken.t.sol: `test_RevertWhen_BatchRepeatsAnIdPastTheUnfrozenBalance` ([40,40,20]) and `test_BatchRepeatingAnIdCountsOnceForTheHolderCap`. Interleaved ids go through the same j<i loop (code read; no separate test).

## Suite
`forge test -j 1` -> `Ran 10 test suites in 296.17s: 150 tests passed, 0 failed, 0 skipped`.

## New guards (tests present, passing in the 150)
- MerchantCannotFund: CapitalMarket.t.sol:440.
- paySale merchant = MerchantPay/market/USDT -> InvalidOrder: CapitalMarket.t.sol:450, MerchantPay.t.sol:483.
- uint96 - MAX_FEE cap: MerchantPay.t.sol:496.

## Live (read-only, chain 1874)
- Blockscout (explorer.testnet.whitechain.io) `is_fully_verified: True`, no `/Users/` in the output, for InvestorRegistry 0x293430fa..., ClaimToken 0xce9b171a..., MerchantPay 0xab817593..., CapitalMarket 0xecd63a36...
- Wiring (cast): `ClaimToken.market` = `MerchantPay.market` = 0xEcd63A369d23dfdDc6bFAC921e41A86760C20ABE; `CapitalMarket.claimToken` = 0xce9b...c388, `.merchantPay` = 0xAb81...4251. `isEligible` true for 0xC2362c36...6752 and 0xaf747912...771B.
- `paused()` true for round-1 MerchantPay 0x8EFF...248F and Phase 2 0x83b5...73b7.
- G3 re-run txs, all status 1: listAdvance 0x6e4aea7b...0253 and fund 0x8d4958eb...6810 (to CapitalMarket). AT-4 sale 0x9fc06d89...5ec8: Paid gross 5000000, fee 100000, toInvestors 1000000, toMerchant 3900000. After-cap sale 0x0269606d...4360: Paid gross 1000000, fee 100000, toInvestors 0, toMerchant 900000.
- `packages/shared/contracts.ts`: re-ran `export-abi.sh`; `git status` and `git diff` on packages are empty, so it matches a fresh export.

## OPEN (non-blocking, builder follow-ups)
- Routed sale gas ~537k with 8 holders; the relayer must estimate gas (owner: claude-relayer).
- Admin-trust disclosure and ARCHITECTURE section 2 freeze text (owner: claude-research).
- CI flake under Ankr 429: use `-j 1` or a keyed RPC.

## NEEDS THE USER
PIPELINE section 11 gate (live money contracts), the tests-after-code deviation, fee-on-top invoices. Unchanged from round 1.
