VERDICT: PASS

Batch 039-P5-m3-mixed-repayment-gas, round 1. Branch contracts, HEAD 965bd8f. Phase mode, Money: no.
Diff vs origin/main: spec.md and contracts/test/CapitalMarketProbe.t.sol only; contracts/src unchanged.
Web, relayer and sdk folders untouched, so skipped.

1. `forge build` (PATH with ~/.foundry/bin): exit 0
   tail: No files changed, compilation skipped

2. `forge test` (full suite): exit 0
   tail: Suite result: ok. 18 passed; 0 failed; 0 skipped
         Ran 11 test suites: 155 tests passed, 0 failed, 0 skipped (155 total tests)

3. `forge test --isolate --match-test test_Gas_ -vv`: exit 0
   Suite result: ok. 2 passed; 0 failed; 0 skipped
   M3 (mixed repayment, advance running):
     2 invoice holders, advance settles true,  gas 504115
     2 invoice holders, advance settles false, gas 457214
     1 invoice holders, advance settles true,  gas 453488
     1 invoice holders, advance settles false, gas 406587
   All four match the expected numbers.
   Holder table (invoice: full / at 0 USDT):
     1: 330172 / 347272
     2: 363700 / 397900
     3: 397638 / 448938
     4: 431577 / 499977
     5: 465927 / 551427
     6: 500276 / 602876
     7: 535037 / 654737
     8: 569799 / 706599

4. Secret scan (git grep with the pre-push/CI pattern over tracked files, .env* excluded): no matches.
   `git diff --cached --name-only`: empty (nothing staged).
   Diff vs origin/main contains no .env, .pem or .key files.
