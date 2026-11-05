VERDICT: PASS

# Code review: 005-P3-advance, round 2 (reviewer-code)

Scope: `git diff 444e7aa..HEAD -- contracts packages` (HEAD de3ceac): ClaimToken running-total freeze check and Ownable2Step, InvestorRegistry Ownable2Step, CapitalMarket `MerchantCannotFund`, the MerchantPay `paySale`/uint96 guards, the new and adopted tests (ClaimToken.t.sol, ClaimTokenProbe.t.sol, CapitalMarket.t.sol, CapitalMarketProbe.t.sol, MerchantPay.t.sol), DeployPhase3, both broadcast records, and packages/shared/contracts.ts. I read the round-1 review, build-contracts.md "Round 2", spec.md and round-1 review-security.md against the code. I edited no code, read no `.env`, ran no `forge script` and used no key.

No HIGH or MEDIUM findings. Each round-2 fix is correct and has a test that fails if the fix is reverted. All findings below are LOW and don't block.

## DONE (verified)
- **`forge test -j 1`: 150/150 pass** (10 suites, 300 s). `forge fmt --check` is OK and `forge lint` reports 0 findings.
- **H1 fix** (ClaimToken.sol:181-207). For each entry, `sent` = this value plus the earlier values of the same id, checked against the unfrozen balance taken before the move (`_move` runs after the loop, so that balance is the right base). I traced `[40,40,20]` with 40 unfrozen: entry 2 has sent = 80 > 40, so it reverts `(a, ID, 80, 40)`. For `[40,70]` the total is above the balance, so the check skips it and ERC-1155 reverts on the second entry (60 < 70). `[20,20]` passes. `[0,1]` with 0 unfrozen reverts. An overflow in `sent` reverts under checked math. The holder cap counts on final balances, and `_addHolder` is idempotent, so a repeated id counts once (test at ClaimToken.t.sol:438). Mutation check: with `sent = values[i]`, ClaimToken.t.sol:411 fails, because the `[40,40,20]` batch would succeed.
- **Ownable2Step** on ClaimToken and InvestorRegistry. The `Ownable` import is still needed for the `Ownable(owner)` constructor. Tests (ClaimToken.t.sol:58, :216) cover pending, a wrong acceptor, accept, and the old owner losing `setFrozenTokens`.
- **M1** (CapitalMarket.sol:305). The guard sits in `_prepareFunding`, which both `fund` and `fundWithAuthorization` go through, and it runs before any USDT moves. The test (CapitalMarket.t.sol:438) expects the exact selector, so it would fail without the guard: an unapproved, non-eligible merchant would revert with a different error.
- **F5 / F6 / L1** (MerchantPay.sol:114, :176-179). The invoice cap is `type(uint96).max - MAX_FEE`, so `amount + fee` (and any partial payment plus fee) fits uint96. `paySale` now refuses MerchantPay, the market and USDT as the merchant. With the market unset, `address(market)` is 0, which was already refused. Tests: MerchantPay.t.sol:492-498 and CapitalMarket.t.sol:445.
- **Round-1 F3 is closed** by the adopted CapitalMarketProbe.t.sol (16 tests): lien capped by the remainder (`test_InvoiceAndAdvance_LienTakesOnlyTheRemainder`), a revoked and frozen investor still repaid (test 7), funding after a partial payment on funded and unfunded invoices, invoice cancel and relist, and 3 to 8 holders (fixed case plus fuzz).
- **packages/shared/contracts.ts**: all 4 ABIs equal a fresh `forge inspect` (MerchantPay 61, CapitalMarket 47, ClaimToken 60, InvestorRegistry 15 entries). The ABI changes for consumers only add things: `MerchantCannotFund`, plus `pendingOwner`, `acceptOwnership` and `OwnershipTransferStarted` on ClaimToken and InvestorRegistry. The addresses equal the DeployPhase3 record.
- **Deploy and live**:
  - Broadcast records: DeployPhase3 at commit `ef5fee4`, 9/9 status 1, including `pause()` on the round-1 MerchantPay 0x8eff. LiveAdvance at commit `ef5fee4`, 16/16 status 1, calling only USDT, MerchantPay 0xab81 and CapitalMarket 0xecd6.
  - `contracts/src` and foundry.toml are unchanged since `ef5fee4`.
  - Read with `cast call`: MerchantPay.market == ClaimToken.market == 0xecd6…, CapitalMarket.merchantPay/claimToken are right, and ClaimToken.registry == 0x2934…. The Phase 2 and round-1 MerchantPays are paused; the new one is not. Market USDT is 0, `totalOwed` is 0, and MerchantPay holds 0 USDT. Claim 1 has outstanding 0 and supply 0. All three `pendingOwner` are 0, and `supportsInterface(0x41c4fbad)` is true.
  - Deployed code sizes equal local `deployedBytecode` (6491 / 9525 / 8949 / 928), and Blockscout shows `is_fully_verified: True` for all four.
- **Traceability**: H1 → FR-TOK-4 (T1 partial freeze), M1 → FR-ADV-4, Ownable2Step → FR-TOK-6 admin / security M3 (OZ `Ownable2Step` is in the spec's ponytail ladder), L1/F5 → "MerchantPay v2" review items and NFR-2. Nothing was built outside the spec.

## FOLLOW-UP (LOW, not blocking)

**R1. ClaimTokenProbe.t.sol can be deleted.** `contracts/test/ClaimTokenProbe.t.sol` (61 lines) repeats `test_RevertWhen_BatchRepeatsAnIdPastTheUnfrozenBalance` (ClaimToken.t.sol:411). That test asserts the exact error and covers the `[20,20]` pass, the over-balance case and the zero-unfrozen case, while the probe uses a bare `vm.expectRevert()`. Fix: delete the probe file, or keep it on purpose as the tester's red test and say so in the batch notes. Owner: claude-contracts.

**R2. The uint96 bound is only tested from above.** MerchantPay.t.sol:496 hard-codes `250_000` instead of `mp.MAX_FEE()`. Nothing checks that `amount == type(uint96).max - MAX_FEE` is accepted, so an off-by-one (`>=`) would go unnoticed. The amounts are absurd, so this only matters for correctness. Fix: use `mp.MAX_FEE()` and add the accept case (createInvoice only; no payment needed). Owner: claude-contracts.

**R3. CapitalMarketProbe.t.sol repeats CapitalMarket.t.sol's fixture.** It has its own copy of setUp and of `_sig`, `_fund`, `_sale`, `_payInvoice`, `_listAdvance`, `_listInvoice` and `_bal`, 491 lines in all. Fix (whenever the lane next touches tests): move the shared fixture into one abstract base, or merge the probe tests into CapitalMarket.t.sol. Owner: claude-contracts.

**R4. Round-1 F1 (the ARCHITECTURE §2 freeze text) needs these round-2 items too.** It is still due before `GATE G3 PASSED`:
- the four new addresses;
- error `MerchantCannotFund` (an offer's merchant can't fund its own offer);
- `paySale` refuses MerchantPay, the market or USDT as the merchant (`InvalidOrder`);
- the invoice amount cap `type(uint96).max - MAX_FEE`;
- `Ownable2Step` on ClaimToken and InvestorRegistry as well (`pendingOwner`, `acceptOwnership`, `OwnershipTransferStarted`);
- `canTransfer(from, to, id, amount)`: for a batch, `amount` is the id's total across the batch, and `ERC7943InsufficientUnfrozenBalance` reports that running total.

ARCHITECTURE.md:54 and README.md:18 still name 0x83b5 as the MerchantPay. Owner: claude-contracts (§2), claude-research (README).

**R5. DeployPhase3 pauses only the MerchantPays it knows about.** It now has one hard-coded pause per earlier deploy (DeployPhase3.s.sol:21-23, :43-44). A third deploy would leave 0xab81 unpaused unless someone adds a third constant. That is fine for now; whoever redeploys next must add it. Owner: claude-contracts.

**Still open from round 1** (tracked, unchanged in this round):
- F2: gas for routed payments to many holders (relayer).
- F4: the rule that a partial payment must leave 0 or at least 1 USDT (frontend and relayer). The contract-side test is partly covered by the probe fuzz, which pays an exact remainder that can be below 1 USDT.
- F7: the Buy pre-check (frontend).
- F8: ponytail items (the foundry.toml lint exclusion vs the inline disables; export-abi.sh `$abis` trap, `chmod 644` and the `LOCK_WINDOW` copy).
- F10: `capitalMarketAbi` has no ClaimToken errors; no status constants are exported.

Round-1 F5 and F6 are closed, F3 is closed, and F9 is resolved: the probe file is adopted and committed in `2fb72d3`.

## NEEDS THE USER
Nothing new. The round-1 items (fee on top for invoices, the Phase 5 items that would need all four contracts redeployed, disclosing the admin powers) still stand. M1's guard only stops the merchant's own wallet; an eligible accomplice can still fund the merchant's invoice (security M1 options b/c are a product call).
