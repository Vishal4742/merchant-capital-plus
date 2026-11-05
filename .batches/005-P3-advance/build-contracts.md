STATUS: READY

# Round 2 (fixes for round-1 CHANGES)
- **H1 fixed** (security H1 = tester T1 partial-freeze FAIL): ClaimToken batch transfers now check a running total per id against the unfrozen balance (`2620f97`, by the developer subagent that wrote ClaimToken; tester's red test `ClaimTokenProbe.t.sol` now passes; new tests for [40,40,20] and the holder cap with repeated ids). ClaimToken + InvestorRegistry → `Ownable2Step` (M3).
- **M1**: `CapitalMarket._prepareFunding` reverts `MerchantCannotFund` when the investor is the offer's merchant. **L1/F6**: `paySale` refuses merchant = MerchantPay, market or USDT. **F5**: invoice amount ≤ uint96.max − MAX_FEE. Tests for each + market constructor zero checks; tester's `CapitalMarketProbe.t.sol` (16) adopted (`2fb72d3`).
- Deploy script also pauses the round-1 MerchantPay (`ef5fee4`).
- **Redeployed from clean `ef5fee4`** (9 txs ok): InvestorRegistry `0x293430fae87ca79844c6e3a64e8044078c4d3e74`, ClaimToken `0xce9b171a5c485a41dced9d7f043733bddc26c388`, MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251`, CapitalMarket `0xecd63a369d23dfddc6bfac921e41a86760c20abe`; all four `is_fully_verified: True`, 0 `/Users/` in inputs. Round-1 MerchantPay `0x8eff…248f` paused.
- **G3 re-ran live** (16 txs ok, commit `ef5fee4`): listAdvance `0x6e4aea7bc6d6e2c54ef5d4a84b29b4cacbbfee0aadbc3195ccbfc2d7a91a0253`, fund `0x8d4958ebb6c20d1a1e4a269bfd6736c641f62ca02d6521e94b92934c8f3f6810`, AT-4 sale `0x9fc06d890b53dde51e469e348fc9b9bdaadfc541f82e9fbb2a833a74edba5ec8`, after-cap sale `0x0269606d7668b50e5c0b8d6dca43449def7b660e92371ff4090fbff199df4360`; claim 1 outstanding 0, advanceOf 0, market 0 USDT; investor A and customer 0 WBT / nonce 0.
- Tests **150/150**, lint 0, fmt ok. `packages/shared/contracts.ts` regenerated (`de3ceac`).
- Not changed (follow-ups, not blocking): routed-sale gas with 8 holders (~537k, relayer must estimate gas; told claude-relayer), admin-trust disclosure (README, claude-research), ARCHITECTURE §2 freeze text, CI flake under Ankr 429 (`-j 1` or a keyed RPC).

# Round 1 (original build report)

# Build: 005-P3-advance (claude-contracts + developer subagent, round 1)

Repo root `/Users/vg890/ethglobal-contracts` (branch `contracts`, pushed). Commits: `2b6174b` interfaces · `624beb1` InvestorRegistry + ClaimToken (subagent, tests first) · `47b98e0` CapitalMarket + tests · `c53d1b8` MerchantPay v2 + test updates + lint config · `79b6013` deploy / live / export scripts · `2749342` + `20f489c` live-script fixes (float recycling; duplicate orderRef caught in simulation, nothing sent) · `444e7aa` deploy + live records, `packages/shared/contracts.ts`.

**Process deviation (flag at the gate):** CapitalMarket and MerchantPay v2 code was written before their tests (tests came right after, in the same session); ClaimToken/InvestorRegistry were tests-first. No RED commit exists for CapitalMarket/MerchantPay v2.

## Design decisions (beyond the spec text)
- Invoices take the relay fee **on top** (payer signs credited amount + fee): otherwise a financed invoice repays holders only `amount − fee` and never settles (AT-7). Sales keep the fee inside (AT-1).
- MerchantPay skips the market (and its extra transfer) when `hasClaimsOn(merchant, invoiceId)` is false, so plain sales stay at ≈190k gas.
- Holdback base for the market = the sale price (FR-ADV-4 "share of the gross"), or an invoice's credited amount.
- Payout rounding: shares round down, the leftover (< holders) goes one unit at a time only to holders with spare balance (never above what a holder is owed); burns before pushes; failed pushes → `owed` + `withdrawOwed`.
- One active lien per merchant (the advance); `liensOf` keeps an array for the ABI. Default/recourse/repay out (cut #5).
- `block-timestamp` lint excluded project-wide (deadlines are minutes–days); other lint disables are scoped with reasons.

## DONE
| Criterion | Evidence |
|---|---|
| Tests | `forge test`: **125/125** (ClaimToken 39, InvestorRegistry 5, CapitalMarket 20 incl. AT-3–AT-7 + 2 fuzz, MerchantPay 34 + edges 5, Seed 15, PullStub 7). `forge lint` 0 findings repo-wide; `forge fmt --check` ok |
| Coverage (`--ir-minimum`) | CapitalMarket 98.6% lines / 87% branches · ClaimToken 99.05% / 100% · InvestorRegistry 100% · MerchantPay 97.7% / 100% |
| Deploy from a clean commit | `run-latest.json` commit `79b6013`, 9 txs all status 1: InvestorRegistry `0x0e71e47ee75f9c0530207c381b2a538127a1018c`, ClaimToken `0xedb4865bea8cfbcd15e60e3da8ddaa90a355aa10`, MerchantPay `0x8effc3e20e99af309cb367e33716b1e7ca71248f`, CapitalMarket `0xeadf4cde549c65cb06d2b53f9b9ce0c0a4d6e940`; `setMarket` ×2; demo investors A/B eligible (30 days); Phase 2 MerchantPay `0x83b5…73b7` paused |
| **Full** Blockscout matches | all four `is_fully_verified: True`; verification inputs have 0 `/Users/` paths |
| **G3 live** (commit `20f489c`, 14 txs all status 1) | AT-3: listAdvance `0x4605f39537344a42000627bf3081e4c6fd89f3e6677dbf8a21eb97e2ca115e3a` (merchant's own tx), fundWithAuthorization `0x8b09182f5b9e4dcb9b6e6c7e9169018d9f58c650eae71ed740f456fa454b0f2b` (deployer-submitted; merchant +10, investor A 11e6 units). AT-4: `0x0367339948045b3b2f99e17c53fa0cb1e7f94d050c6b544f772f426133f81434` Paid gross 5e6 fee 1e5 **toInvestors 1e6** toMerchant 3.9e6. AT-5: claim 1 outstanding 0, `advanceOf` 0, `liensOf` [], next sale `0xdc8c6e4edc9c37087073e441929f286d4aed5a5158306e90263f7e72f6757af1` toInvestors **0** toMerchant 0.9e6. Investor A 69 → 70 USDT, 0 WBT, nonce 0; customer 0 WBT, nonce 0; market holds 0 |
| Gas (live) | routed sale with a lien 256–278k (≈ 0.10 USDT at 73 USDT/WBT: the 0.10 fee is break-even); plain sale 190k; fundWithAuthorization 239k; listAdvance 143k |
| packages/shared | `contracts.ts` (4 ABIs, live addresses, constants, domain, types, nonce params) via the fixed `export-abi.sh` (forge inspect + temp file); replaces `merchantPay.ts`; announced 00:55 |

## OPEN
1. Addresses in `contracts.ts` are lowercase (viem accepts them; checksum them if a consumer needs it).
2. ARCHITECTURE §2 ABI freeze text (claude-contracts may edit §2 at G3): constructor args, fee-on-top invoices, new views (`hasClaimsOn`, `isFinanced`, `fundingNonce`, `withdrawOwed`, `sweep`), no GRACE / markDefault.
3. Routed-sale gas ≈ fee: consider raising the relay fee toward the 0.25 cap for merchants with a lien (owner `setRelayFee`), or accept break-even for the demo.

## NEEDS THE USER
1. PIPELINE §11: four money-moving contracts live; deploy/wiring and live scripts using the deployer and demo keys; the frozen ABI.
2. Confirm the tests-after-code deviation for CapitalMarket/MerchantPay v2 is acceptable given the reviews below.
3. Fee-on-top for invoices (a product rule: the debtor pays 100.10 for a 100 invoice).
