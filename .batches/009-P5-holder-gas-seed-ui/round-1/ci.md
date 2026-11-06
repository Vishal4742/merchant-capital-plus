VERDICT: PASS

Lane-run checks (PIPELINE §3b), 2026-11-06 10:57 IST, contracts worktree, from contracts/:
```
$ forge build
No files changed, compilation skipped
build exit 0
$ forge test
Ran 11 test suites in 62.39s (138.52s CPU time): 154 tests passed, 0 failed, 0 skipped (154 total tests)
$ forge test --isolate --match-test test_Gas_FullRepaymentByHolderCount -vv   (whitechain fork, block 12,303,386)
  holders 2: needs 387400 gas (refund 72740 at the end)
  holders 3: needs 421338 gas (refund 79527 at the end)
  holders 4: needs 455277 gas (refund 86315 at the end)
  holders 5: needs 489627 gas (refund 93185 at the end)
  holders 6: needs 523976 gas (refund 100055 at the end)
  holders 8: needs 593499 gas (refund 113959 at the end)
```

**Q19 result: the relayer's fixed 400k gas limit covers a full invoice repayment with 2 holders, not 3.**

| holders | gas the limit must cover | under 400k |
|---|---|---|
| 2 | 387,400 | yes (12,600 spare) |
| 3 | 421,338 | no |
| 4 | 455,277 | no |
| 5 | 489,627 | no |
| 6 | 523,976 | no |
| 8 | 593,499 | no |

Method: each call runs as its own transaction (`--isolate`), so storage starts cold, as in a real tx. Isolate mode leaves out the 21,000 base and calldata: a cold `balanceOf` measures 9,763, the same figure as the live trace in the dry run below. So the test adds 23,700 (21,000 + ~2.7k for payInvoice's 292 calldata bytes). The merchant and fee recipient hold USDT first, as live (that alone moves each figure by 17.1k). This is a full repayment, the worst case: every holder burned to zero, then Settled. The limit must cover the gas before the end-of-tx refund (refunds shown in the log).
Calibration: the live 2-holder AT-7 payInvoice used 277,255 after refund. The fork's figure for the same case is 314,660 after refund, about 12% higher. If live always runs 12% lower, 3 holders would need about 384k (fits) and 4 about 418k (doesn't), but that isn't proven. Recommendation for I2: cap invoice holders at 2, or raise the relayer's gas limit for payInvoice (8 holders need ~594k).

**Seed dry run** (`forge script script/Seed.s.sol --sig "fund()" --rpc-url whitechain`, no --broadcast, CUSTOMER = a fresh placeholder): `TeamWalletShort(116669115, 0)`. The team wallet holds 148.430885 USDT; UI runs need **116.67 USDT more** (less by whatever the real browser guest already holds); WBT is enough. Reclaim first doesn't change this: fund only tops wallets up to their targets.

Tests: the Seed targets and the CustomerRequired revert went red first (compile error, then 5 old hard-coded amounts), then green. `contracts/src` is unchanged (frozen).
