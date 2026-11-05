# Phase 4, contracts lane: Capital on chain (G4 contract half)

Batch `006-P4-g4-live` · no contract change (ABI frozen at G3) · after this batch the **contracts freeze** (human 02:02; SRS 2.0 keeps AT-6–AT-8).

**Live (1874), same final addresses as Phase 3:** MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251` · CapitalMarket `0xecd63a369d23dfddc6bfac921e41a86760c20abe` · ClaimToken `0xce9b171a5c485a41dced9d7f043733bddc26c388` · InvestorRegistry `0x293430fae87ca79844c6e3a64e8044078c4d3e74`.

**G4 live (`script/LiveInvoice.s.sol` from `25b91f5`, 6 txs, all status 1):**
- AT-6: invoice 1 (100 USDT, 60 days) listed as claim 2 at 98,065,556; A funds 60e6 units for 58,839,334 (`0x6b346413…ab3c`), B funds 40e6 for 39,226,223 (`0xab395b1d…9744`); merchant +98,065,557 (`quote` rounds up).
- AT-7: debtor pays 100.10 (`0xd9172e76…03b1`): Paid gross 100,100,000, fee 100,000, toInvestors 100,000,000, toMerchant 0; A +60e6, B +40e6 in the same tx; claim 2 Settled, invoice 1 Paid. The merchant topped up the debtor's 0.10 fee first (`0x7062534e…1cc4`).
- AT-8, read-only, replayable at block **12316357** (A still holds 60e6 of claim 2):
  ```
  C=0xce9b171a5c485a41dced9d7f043733bddc26c388 A=0xc2362c3693e185388e5745badaffac38184c6752 B=0xaf747912b20d4fe6df1b88d4993fccbc7002771b D=0x000000000000000000000000000000000000dEaD
  cast call $C 'canTransfer(address,address,uint256,uint256)(bool)' $A $D 2 1 --block 12316357   # false
  cast call $C 'canTransfer(address,address,uint256,uint256)(bool)' $A $B 2 1 --block 12316357   # true
  cast call $C 'safeTransferFrom(address,address,uint256,uint256,bytes)' $A $D 2 1 0x --from $A --block 12316357
  # reverts 0x705c1eed…dead = ERC7943CannotReceive(0x…dEaD)
  ```
  (`--rpc-url https://rpc.testnet.whitechain.io` on each.)
- Debtor, A and B: 0 WBT, nonce 0. MerchantPay, CapitalMarket and `totalOwed` hold 0 USDT afterwards.

**NFR-10:** E1 `test/EventAbi.t.sol` pins the event topics against independent literals. Coverage (`forge coverage --ir-minimum`): CapitalMarket 100% lines, ClaimToken 99.07%, InvestorRegistry 100%, MerchantPay 97.78%.

**Facts for later:** E1 checks topic hashes only, so it can't see `indexed` flags. Regenerating `packages/shared/contracts.ts` in CI and diffing it would catch those (a CI change, which needs the human). `LiveInvoice.pay()` assumes the debtor holds the face amount and the merchant only tops up the fee. Next for this lane (SRS 2.0): `apps/shop` on the SDK in ≤ 20 lines (AT-14), after claude-relayer ships `packages/sdk`.
