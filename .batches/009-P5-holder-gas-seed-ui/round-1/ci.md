VERDICT: PASS

Lane-run checks (PIPELINE §3b), 2026-11-06 11:28 IST, contracts worktree, from contracts/, after the security review fixes (528f5ce):
```
$ forge build
Compiler run successful!
build exit 0
$ forge test
Ran 11 test suites in 66.89s (117.35s CPU time): 154 tests passed, 0 failed, 0 skipped (154 total tests)
$ forge test --isolate --match-test test_Gas_RepaymentByHolderCount -vv   (whitechain fork, block 12,303,386)
[PASS] test_Gas_RepaymentByHolderCount() (gas: 98962664)
  1 holders, invoice: full 330172, at 0 USDT 347272
    partial at 0 USDT 310785
    advance sale: settling 352653, at 0 USDT 369753
    5 USDT sale at 0 USDT 335111
  2 holders, invoice: full 363700, at 0 USDT 397900
    partial at 0 USDT 356281
    advance sale: settling 386181, at 0 USDT 420381
    5 USDT sale at 0 USDT 380607
  3 holders, invoice: full 397638, at 0 USDT 448938
    partial at 0 USDT 402392
    advance sale: settling 420119, at 0 USDT 471419
    5 USDT sale at 0 USDT 426718
  4 holders, invoice: full 431577, at 0 USDT 499977
    partial at 0 USDT 447272
    advance sale: settling 454058, at 0 USDT 522458
    5 USDT sale at 0 USDT 471598
  5 holders, invoice: full 465927, at 0 USDT 551427
    partial at 0 USDT 492768
    advance sale: settling 488408, at 0 USDT 573908
    5 USDT sale at 0 USDT 517094
  6 holders, invoice: full 500276, at 0 USDT 602876
    partial at 0 USDT 540111
    advance sale: settling 522757, at 0 USDT 625357
    5 USDT sale at 0 USDT 565053
  7 holders, invoice: full 535037, at 0 USDT 654737
    partial at 0 USDT 585607
    advance sale: settling 557518, at 0 USDT 677218
    5 USDT sale at 0 USDT 608701
  8 holders, invoice: full 569799, at 0 USDT 706599
    partial at 0 USDT 629256
    advance sale: settling 592280, at 0 USDT 729080
    5 USDT sale at 0 USDT 653582
```

**Q19 result (corrected 11:2x; the first version added the 21k base twice).** The relayer simulates and sends every tx with a fixed 400k gas limit, and that limit must cover `gasTotalUsed` (the base and calldata are included, and refunds only come at the end). Every refund equals gasTotalUsed / 5, EIP-3529's cap on the whole tx, which confirms the base is counted.

| holders | invoice, full repayment (holders at 0 USDT) | advance, sale that clears the cap (holders at 0 USDT) | advance, 5 USDT sale (at 0 USDT) |
|---|---|---|---|
| 1 | 330,172 (347,272) | 352,653 (369,753) | 335,111 |
| 2 | 363,700 (**397,900**) | 386,181 (**420,381** ✗) | 380,607 |
| 3 | 397,638 (448,938 ✗) | 420,119 ✗ | 426,718 ✗ |
| 8 | 569,799 (706,599) | 592,280 (729,080) | 653,582 |

- **Safe caps at 400k: 2 invoice holders, 1 advance holder**, pinned by the test (the worst case fits, one more holder doesn't). Two advance holders fail only when the first payout clears the whole cap while both sit at 0 USDT. claude-relayer enforces both caps in /fund and refuses anything above 400k by eth_estimateGas (no tx sent).
- Each holder at 0 USDT adds 17.1k (a 0 → nonzero write). An empty fee recipient adds the same; the relayer hot wallet's USDT fees only accumulate (no fee swap).
- The fork runs about 5% above live (2-holder AT-7: 277,255 live after refund, 290,960 here).

**Seed** (Q5): CUSTOMER required, 156.10 USDT; the debtor gets 0; investor A keeps 69 (the pack's 58 left AT-6 a 0.16 margin). CUSTOMER can't be the team wallet or a script wallet (review L1). Dry run on the live chain at 10:5x: `TeamWalletShort(116669115, 0)` at 148.43 USDT. Since then the human approved a sweep and swap (1.99 WBT collector → team, tx 0x9c2a1d9e…a0ef; 1.9 WBT → 137.388103 USDT, tx 0xa1c6df75…7045), so the team wallet holds 305.818988 USDT and 0.2695 WBT. That covers the 96.67 still missing plus a second run.
Broadcast procedure (review L2/notes): dry-run first; the human checks the printed CUSTOMER against the address the browser shows (a typo loses 156.10 for good); never broadcast while another deployer-key tx is in flight (nonces). Reclaim first only changes the shortfall if the debtor or PAYER wallets hold USDT.

Tests went red first for the Seed targets and CustomerRequired (a compile error, then 5 old hard-coded amounts). The CUSTOMER collision test was written together with its check and mutation-checked (removing the check → 1 fail). `contracts/src` is unchanged (frozen).
