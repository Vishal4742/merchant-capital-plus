VERDICT: PASS

# Test: 002-P2-merchantpay, round 1 (tester)

Scope: `git diff 44772c7..HEAD -- contracts packages` (f885e37 RED, a67d260 GREEN, 2424138 scripts, 099bb97 deploy records + `packages/shared/merchantPay.ts`). Worktree `/Users/vg890/ethglobal-contracts`, branch `contracts`, HEAD 099bb97. Forge 1.8.6, fork of Whitechain Sepolia 1874 at pinned block 12,303,386 (alias `whitechain`). Live checks were read-only: `cast` against https://rpc.ankr.com/whitechain_testnet and the Blockscout API. No key used, no broadcast, no `.env` read.

**Browser walk / screenshots: skipped.** This batch changes no UI or pages, so `shots/` is empty on purpose. Speed for this batch means gas (table below). NFR-12/13/14 belong to the web and relayer lanes.

## Commands run (exact output)
| Command | Output |
|---|---|
| `forge build --force` | `Compiling 49 files with Solc 0.8.38` · `Compiler run successful!` (0 warnings) |
| `forge test -vv --match-path test/MerchantPay.t.sol` | `27 passed; 0 failed; 0 skipped` (fuzz `runs: 256`) |
| `forge test -vv --match-path test/MerchantPayEdges.t.sol` (tester-added) | `5 passed; 0 failed; 0 skipped` |
| `forge test` (all) | `Ran 3 test suites ... 39 tests passed, 0 failed, 0 skipped (39 total tests)` |
| `forge fmt --check` / `forge lint` (after adding the tester file) | exit 0, no output / exit 0, no findings |
| `forge coverage --ir-minimum --report summary` | `src/MerchantPay.sol 96.97% (64/66) lines, 97.40% (75/77) statements, 100.00% (16/16) branches, 100.00% (13/13) funcs` |
| lcov: the 2 uncovered lines | `DA:193,0` `DA:197,0` = `_pause();` / `_unpause();`. Both run in `test_Pause_StopsPaymentsUntilUnpaused` (it hits `EnforcedPause`, then pays after unpause), so this is the ir-minimum line-mapping quirk, not missing coverage |
| `bash contracts/script/export-abi.sh && git diff --exit-code packages/shared` | `wrote packages/shared/merchantPay.ts (merchantPay: 0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7)` · `diff-exit=0` |
| `node -e "import('./packages/shared/merchantPay.ts')..."` (Node 26.10.0) | `loaded KIND_INVOICE,KIND_SALE,MAX_FEE,MIN_PAYMENT,addresses,chainId,merchantPayAbi,nonceParams,receiveWithAuthorizationTypes,usdtDomain abi entries 51`. No `import`/`require` lines in the file |

## Acceptance criteria (spec.md)
| # | Criterion | Result | Proof |
|---|---|---|---|
| M1 | `payInvoice`: merchant gets gross − fee, fee recipient gets fee, one tx, payer 0 WBT, third-party submitter | PASS | `test_PayInvoice_SplitsFeeAndMerchant_PayerNeedsNoGas` (25 USDT; `payer.balance == 0` before and after; submitted by `anyone`; MerchantPay balance 0) |
| M1 | signature can't pay another invoice id / another amount | PASS | `test_RevertWhen_InvoiceSignatureUsedForAnotherInvoice` → `TetherToken: invalid signature`; amount: `test_RevertWhen_InvoicePartlyOrOverPaid` → `WrongAmount` (the amount must equal what's owed and is also inside the signed struct) |
| M1 | replay reverts | PASS | `test_RevertWhen_InvoicePaidTwice` (same signature again → `InvoiceNotOpen`) |
| M1 | third party can't redeem on the token (`to != msg.sender`) | PASS | `test_RevertWhen_ThirdPartyRedeemsAuthorizationOnToken` → `TetherToken: to != msg.sender` |
| M1 | paid / cancelled / unknown invoices and partial / over-payments revert | PASS | `test_RevertWhen_InvoicePaidTwice`, `test_RevertWhen_PayingCancelledOrUnknownInvoice`, `test_RevertWhen_InvoicePartlyOrOverPaid`, `test_RevertWhen_CancellingPaidInvoice` |
| M2 | `paySale` same split | PASS | `test_PaySale_SplitsFeeAndMerchant_PayerNeedsNoGas` |
| M2 | 0.99 USDT reverts (minimum) | PASS | `test_RevertWhen_SaleBelowMinimum` (999,999 → `WrongAmount`); boundary: tester `test_MinimumPaymentIsAccepted` (exactly 1 USDT sale and invoice pay, merchant gets 0.90 each) |
| M2 | sale signature can't pay another merchant / orderRef | PASS | `test_RevertWhen_SaleSignatureReusedForAnotherPayment` (other merchant, other orderRef, other amount, other salt → `TetherToken: invalid signature`) |
| M2 | same order can't be paid twice (new salt) | PASS | `test_RevertWhen_OrderPaidTwice` → `OrderPaid` |
| M2 | `setRelayFee` > 0.25 or by non-owner reverts | PASS | `test_SetRelayFee_OwnerOnlyAndCapped` (`OwnableUnauthorizedAccount`, 250,001 → `FeeTooHigh`, zero recipient → `ZeroAddress`, 250,000 accepted and charged) |
| M2 | paused → pay reverts, unpause → pays | PASS | `test_Pause_StopsPaymentsUntilUnpaused` (both pay paths → `EnforcedPause`; stranger can't pause) |
| M3 | refund only by that payment's merchant | PASS | `test_RevertWhen_RefundByAnyoneButThatMerchant` (payer, submitter, owner, unknown id → `NotMerchant`) |
| M3 | partial then full; cumulative > gross reverts | PASS | `test_Refund_PartialThenFull_FromMerchantWallet` (10 then 15 of 25; 1 more → `RefundTooLarge`) |
| M3 | works while paused; payer gets the USDT; nothing else moves | PASS | `test_Refund_WorksWhilePaused_ForInvoicePayments`; fee recipient unchanged and MerchantPay 0 in the partial/full test; tester `test_RevertWhen_RefundAllowanceOrBalanceTooSmall` (failed pulls record nothing and move nothing) |
| F1 | for any amount ≥ 1 USDT and fee ≤ 0.25: fee + toMerchant == gross, MerchantPay balance 0 after pay and refund | PASS | `testFuzz_SplitAddsUpAndNothingStays (runs: 256, μ: 519564, ~: 519940)`; amount bounded 1–100 USDT (the payer's funding). See OPEN 1 for a merchant value outside this criterion |
| F5 | USDT `DOMAIN_SEPARATOR()` pin; nonce views match the `abi.encode` formula | PASS | `test_UsdtDomainMatchesTheFieldsOtherLanesHardCode`, `test_NonceViewsMatchTheDocumentedEncoding`. Also on the live contract: `saleNonce(deployer, 0x64f1…e9d7, 2e6, 0x…07)` = `0xb3685129…fe45c` = `cast keccak(cast abi-encode(1874, MP, 2, uint(deployer), orderRef, 2e6, salt))`; `invoiceNonce(7, 5e6, 0x…07)` = `0x7e81fffa…42dbd` = the formula; live `DOMAIN_SEPARATOR()` `0xcdcfacb6…d2a25` = keccak of {"Tether USD","1",1874,USDT} |
| Q | `vm.expectEmit` on every event with exact arguments | PASS (after tester additions) | Builder suite: InvoiceCreated, InvoiceCancelled, Paid (invoice + sale), Refunded (first refund), RelayFeeSet (setter). Gaps the builder suite didn't cover, now closed: constructor `RelayFeeSet` (`test_ConstructorEmitsRelayFeeSet`) and cumulative `Refunded.totalRefunded` on a second refund (`test_SecondRefundEmitsCumulativeTotal`). Event ABI vs ARCHITECTURE §2 (param types, `indexed`, names, parsed from the doc): `InvoiceCreated MATCH, InvoiceCancelled MATCH, Paid MATCH, Refunded MATCH, RelayFeeSet MATCH`; `InvoiceAcknowledged` absent (FR-PAY-13, Phase 5, out of scope). Function ABI vs §2: createInvoice, cancelInvoice, payInvoice, paySale, refund, setRelayFee all MATCH |
| Q | `forge build` 0 warnings, `forge lint` clean, `forge fmt --check`, coverage ≥ 95% lines | PASS | table above |
| Live | clean committed tree at broadcast; record names a commit with the deployed source | PASS | `jq -r .commit .../DeployMerchantPay.s.sol/1874/run-latest.json` → `2424138`; `git diff --stat 2424138 HEAD -- contracts/src contracts/foundry.toml contracts/lib` → empty. Stronger check: Blockscout `source_code` is byte-identical to `contracts/src/MerchantPay.sol` (`cmp` → identical) and is a full match. The dirty-tree check itself can't be replayed after the fact; the full match against committed source and settings covers it |
| Live | `grep -c /Users/` on the verification input = 0 | PASS | `forge verify-contract ... --show-standard-json-input` → `grep -c /Users/ in.json = 0`; settings `viaIR:true, evmVersion:prague, optimizer 200, remappings [@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/, forge-std/=lib/forge-std/src/]`; Blockscout JSON also 0 hits |
| Live | Blockscout `is_fully_verified` → true | PASS | `curl -s .../api/v2/smart-contracts/0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7 \| jq -e .is_fully_verified` → `true` (exit 0); `is_verified true, is_partially_verified false, compiler v0.8.38+commit.1835d247, evm prague, viaIR true` |
| Live | one sale and one refund submitted by the deployer (FR-REL-7) | PASS | sale `0xae155c49b9e10c098ff3f6146dd29256c75a52acaac85a3367e0c8e30e3cfb1a` status true, from `0xb4E7eDe967E108858DDb5d88B25FDc70723B714D`, block 12,303,977; refund `0xbd91e67e672cf3a1c94e0fbf82335be719e2c77a4e0499328a9b767d3347f939` status true, same from, block 12,303,983 (approve `0xcae6b8344b9421e83131c42ff1cfd6e9e7c3dfa048016037f50d176d7606e4a7` before it). Sale logs in order: `Paid` (topic `0x90133e34…` = `Paid(uint256,address,address,uint256,bytes32,uint256,uint256,uint256,uint256)`; paymentId 1, merchant deployer, payer `0xE53f…309b`, invoiceId 0, gross 2,000,000, fee 100,000, toInvestors 0, toMerchant 1,900,000) → USDT `AuthorizationUsed` → `Transfer` payer→MP 2,000,000 → MP→`0xdd02…a651` 100,000 → MP→deployer 1,900,000. Refund logs: `Refunded(1, 1,000,000, 1,000,000)`, one `Transfer` deployer→payer 1,000,000, allowance `Approval` → 0 |
| Live | payer `cast balance --block <saleBlock>` = 0, `cast nonce` = 0 | PASS | `cast balance 0xE53f…309b --block 12303977` → `0` (also 0 at 12303976 and latest); `cast nonce` → `0`. Payer USDT at blocks 12303976 / 12303977 / 12303983: `2000000 / 0 / 1000000` |
| Live | `cast receipt <sale> gasUsed` recorded as "paySale, no market call" | PASS | `217194` (see Gas) |
| Live | state after the smoke | PASS | `payments(1)` = (deployer, 2000000, payer, 1000000); `paymentCount` 1; MerchantPay USDT `0` at 12303983 and latest; `owner` deployer; `relayFee` 100000; `feeRecipient` `0xdd02FE971Ad9e21365673E701693e7ab7bF9a651`; `paused` false; chain id 1874 |
| Shared | `packages/shared/merchantPay.ts` generated, dependency-free, matches a fresh export | PASS | export + `git diff --exit-code packages/shared` → exit 0; address in the file = the deployed address |

### AT-* in spec.md
| ID | Result | Proof |
|---|---|---|
| AT-1 (gasless 25 USDT shop sale, fee to relayer recipient, rest to merchant, webhook) | PASS for the contract part; the relayer submission and webhook belong to claude-relayer and claude-frontend | fork: `test_PaySale_SplitsFeeAndMerchant_PayerNeedsNoGas` (25 USDT, payer 0 WBT, one tx, 0.10 to the fee recipient, 24.90 to the merchant); live: sale `0xae155c49…fb1a` is one tx with 0.10 to `0xdd02…a651` (the relayer hot wallet) and 1.90 to the merchant, payer 0 WBT |
| AT-2 (merchant refunds; customer gets USDT; investors untouched) | PASS for the contract part (no investors exist until Phase 3) | fork M3 tests; live refund `0xbd91e67e…f939`: the only USDT movement is merchant→payer 1 USDT |

## Probes asked for by the orchestrator
1. **Re-entry through a malicious ERC-1271 payer: disproved (re-entry is impossible), on the fork.** `test_Erc1271PayerCannotReenterPaySale` (contracts/test/MerchantPayEdges.t.sol:79): the wallet's `isValidSignature` tries `paySale` with another payer's *valid* armed authorization and approves its own payment only if that inner call reverted. Outer payment goes through once (paymentCount 1, inner order unpaid, inner payer untouched); afterwards the same armed call pays normally, which shows it was valid and failed only as a re-entry. `-vvvv` trace: `ReenteringWallet::isValidSignature(...) [staticcall]` → `MerchantPay::paySale(...)` → `[Revert] ReentrancyGuardReentrantCall()`, so MerchantPay's guard trips first. With `nonReentrant` removed from `paySale` (mutant in a scratchpad copy), the same test still passes and the trace shows `[StateChangeDuringStaticCall]`: the token's staticcall (verified `contracts/Tether/util/SignatureChecker.sol:68` of implementation `0x26425662d126412128967ecf0a02ec48573026f7`) blocks it independently. Tether `_transfer` has no recipient hooks, so the 1271 staticcall is the only callback. Positive side: a contract-wallet payer can pay.
2. **Refund with too small an allowance:** `test_RevertWhen_RefundAllowanceOrBalanceTooSmall` (:108): allowance 1 USDT, refund 2 → `ERC20: transfer amount exceeds allowance`; enough allowance but merchant holds gross − fee, full refund → `ERC20: transfer amount exceeds balance`; `refunded` stays 0, payer and merchant balances unchanged.
3. **Event argument order vs ARCHITECTURE §2:** all five events MATCH (table above).

### Mutation check: each tester-added test fails when its behaviour breaks
Run on a copy of `contracts/` in the session scratchpad (`contracts/src` untouched), both suites each time:
```
refund-total-not-cumulative : failing = test_SecondRefundEmitsCumulativeTotal
ctor-no-RelayFeeSet         : failing = test_ConstructorEmitsRelayFeeSet
sale-min-off-by-one (<=)    : failing = test_MinimumPaymentIsAccepted
invoice-min-off-by-one (<=) : failing = test_MinimumPaymentIsAccepted
due-date-off-by-one         : failing = test_MinimumPaymentIsAccepted
refund-pull-unchecked       : failing = test_RevertWhen_RefundAllowanceOrBalanceTooSmall
paySale-no-nonReentrant     : NONE (expected: the token's staticcall still blocks; see probe 1)
harness: armed call succeeds inside the staticcall (simulated re-entry) : failing = test_Erc1271PayerCannotReenterPaySale
```
All six of the first six mutants **survived the builder's 27 tests**. These were real gaps, and the new file closes them.

## Gas (live receipts, chain 1874)
| Tx | gasUsed |
|---|---|
| deploy `0x7364ac31…c51b` (block 12,303,909) | 1,146,883 |
| `paySale`, no market call `0xae155c49…fb1a` | **217,194** (fee recipient's USDT balance was 0 at block 12,303,976, so this includes a fresh balance slot) |
| `approve` `0xcae6b834…e4a7` | 53,376 |
| `refund` `0xbd91e67e…f939` | 78,354 |

## DONE
- contracts/test/MerchantPayEdges.t.sol:1 (new, tester): 5 fork tests (ERC-1271 re-entry, refund pull failures, cumulative `Refunded`, constructor `RelayFeeSet`, 1 USDT boundaries). Verified: `5 passed`, full suite `39 passed`, fmt and lint clean, mutation table above. **Not committed** (tester doesn't commit): owner lane **claude-contracts**, please commit it with the batch, or move the tests into `MerchantPay.t.sol` (I didn't edit the builder's file).
- Every spec acceptance criterion: PASS with the outputs above.

## OPEN
1. **LOW, contracts/src/MerchantPay.sol:159** (owner **claude-contracts**): `paySale` accepts `merchant == address(this)`. A sale signed for merchant = MerchantPay strands gross − fee in the contract for good: no sweep, and `refund` can't be called because `msg.sender` would have to be MerchantPay. Fork probe (scratchpad, not in the suite): `paySale(address(mp), …, 5e6)` succeeds, `MerchantPay USDT after sale to itself: 4900000`, `refund(1, 1e6)` → `NotMerchant`. It needs the payer to sign that merchant, so only a buggy or hostile integration hits it. It breaks the literal "MerchantPay keeps no USDT" of NFR-2 but not the F1 criterion as written. Fix: one line, `|| merchant == address(this)` in the `InvalidOrder` check, plus a test. Fold it into the Phase 3 redeploy, or into this batch if a redeploy happens anyway. `merchant == USDT` already reverts (`TetherToken: transfer to the contract address`, probed). Until then, **claude-relayer** should refuse a `paySale` whose merchant is MerchantPay. The same applies to `setRelayFee(fee, address(this))`, but that one is owner-only.
2. **INFO, ERC-1271 gas burn** (owner **claude-relayer**, drain guard 11, already in the spec's out of scope): with the guard on, the blocked re-entry costs 861 gas, but a hostile wallet's `isValidSignature` can burn any amount (with the guard removed it burned 37,420,395 gas inside the staticcall). The relayer must simulate and cap gas before it submits for contract payers.
3. **INFO, order squatting from the mempool** (owners **claude-relayer**, **claude-frontend**): a random `orderRef` can't be guessed, but it is visible in a pending `paySale`. If the 1874 mempool is public (not checked), anyone can front-run with their own ≥ 1 USDT and turn the customer's tx into `OrderPaid`. The spec's rule covers it: count an order as paid only if `payments(saleOf(...)).gross` equals the session amount; on `OrderPaid` with a mismatched gross, start a new session and ask for a new signature. Cost to the attacker: ≥ 1 USDT, which goes to the merchant.
4. **INFO, docs** (owner **claude-research**): ARCHITECTURE §2 still says `MerchantPay(usdt)`. The deployed constructor is `(usdt, feeRecipient)` (spec says research updates §2). `InvoiceAcknowledged`/`acknowledge` are absent by design (Phase 5).

## NEEDS THE USER
1. **Fee recipient** (spec NEEDS THE USER 1): the live contract already sends fees to the relayer hot wallet `0xdd02FE971Ad9e21365673E701693e7ab7bF9a651` (`feeRecipient()` on chain). Confirm that, or have the owner call `setRelayFee` to point it at the team wallet.
2. **"An order is paid once"** plus the random-orderRef rule (spec item 2). OPEN 3 is the residual risk.
3. **OPEN 1:** fix the self-merchant guard now (redeploy, re-verify, re-smoke, new address for both lanes) or in Phase 3's planned redeploy.
4. **PIPELINE §11:** a money-moving, permissionless contract is live on 1874 and pausable by the deployer key. The deploy and smoke scripts use the deployer and payer keys (I didn't run them), and `packages/shared` is a new package.
