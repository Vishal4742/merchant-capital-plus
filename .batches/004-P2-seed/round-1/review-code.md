VERDICT: PASS

# Code review: 004-P2-seed, round 1 (reviewer-code)

Scope: `git diff 3db8bad..HEAD -- contracts` at HEAD 4c8c64f (branch `contracts`). Batch commits: 246ec4a (RED), ec9aeea (GREEN, `script/Seed.s.sol`, `test/Seed.t.sol`), 8579cab (`broadcast/Seed.s.sol/1874/reclaim-latest.json`), and two that landed during this review: 4be1794 (tester's `test/SeedEdges.t.sol`) and 4c8c64f (`broadcast/Seed.s.sol/1874/fund-latest.json`, live fund). The other files in the range (AI_USAGE, HANDOFF*, PHASES, README, SRS) are claude-research commits 5776625/191e7d0 from batch 002, not this batch.
Read in full: spec.md, build-contracts.md, round-1/outside.md, round-1/test.md, Seed.s.sol, Seed.t.sol, SeedEdges.t.sol, both broadcast records, SmokeMerchantPay.s.sol and RelayPull.s.sol for reuse. Never read `.env`, never ran `forge script`, never used a key.

Ran: `forge fmt --check` → exit 0. `forge test --match-path 'test/Seed*.t.sol'` → "15 tests passed, 0 failed, 0 skipped" (8 Seed + 7 SeedEdges, fork of 1874 at 12,303,386).

## 1. Traceability and scope
- Every code line traces to CON-8 (fund from the team wallet, no faucet), CON-4 (payers get 0 WBT, the deployer submits each reclaim so the wallets keep nonce 0) and CON-7 (keys only from env; `console.log` at Seed.s.sol:92 prints only addresses and balances). The targets match the ÷100 AT-1–AT-7 figures (checked below). G5 repeatability is `reclaim()`.
- No scope creep in code: one script, one test file, no new contract, no new dependency, no `src/` or `packages/shared/` change.
- Bookkeeping (LOW, claude-contracts): spec.md "Files to touch" doesn't list `contracts/test/SeedEdges.t.sol` or `contracts/broadcast/Seed.s.sol/1874/{reclaim,fund}-latest.json`. All three are legitimate (tester gap tests; live evidence, and `contracts/.gitignore` already keeps only `*-latest.json`). Add them to the spec's file list, or note them in build-contracts.md, so the commit-of-only-batch-files check holds.

## 2. ABI (ARCHITECTURE.md §2)
No change. Seed is a forge script; it only calls the prize USDT's `transfer`, `balanceOf`, `DOMAIN_SEPARATOR` and `transferWithAuthorization(from,to,value,validAfter,validBefore,nonce,v,r,s)`. The live record shows that exact selector (`0xe3ee160e`) succeeding (status 1, 79,577 gas).

## 3. Logic, edge cases
Checked and correct:
- Top-up is `target − held`, never above target, for USDT and WBT (Seed.s.sol:82-88). Balances are re-read inside the send loop, so a duplicate entry can't overpay.
- Shortfall pre-check before `vm.startBroadcast` (:70-77). Both components are exact and floor at 0. In forge script, any revert also means nothing gets broadcast, so "moves nothing" holds twice over.
- Zero cases: an all-empty reclaim skips every wallet (:103). A target at 0 WBT never sends value. A fund where nothing is short is a no-op (the second-run test).
- Reclaim digest: EIP-712 typehash string matches EIP-3009 `TransferWithAuthorization`, `validAfter = 0`, OZ `MessageHashUtils.toTypedDataHash` with the token's own domain separator. The authorization binds `to = team`, so it can't be redirected (test :141-155).
- Rounding: no division anywhere. Demo sizing: AT-6 at 12% APR, 60 days: 60/1.019726 ≈ 58.84 and 40/1.019726 ≈ 39.23, so A = 10 + 58.84 ≤ 69 and B ≤ 40. AT-5: FR-ADV-4 takes the holdback from the gross sale, 20% × 50 = 10 = the remaining owed, so the customer's 56 = 25 (refunded) + 5 + 50 + 1 MIN_PAYMENT is exact. The merchant's 1 USDT covers the 0.10 `relayFee` on a full refund. The merchant's 0.02 WBT at the observed 5 gwei covers roughly 4M gas, far more than four admin txs.
- Live `fund-latest.json`: 4 USDT transfers (1, 69, 40, 100) and one 0.02 WBT value transfer (`0x470de4df820000`) to DEMO_MERCHANT, all status 1. No WBT goes to any payer.

Findings (none blocking):
1. `contracts/script/Seed.s.sol:48-55` with `:113-119` (LOW, claude-contracts): a wallet listed twice (CUSTOMER set to a script wallet, or two equal env keys) is counted twice in `shortfall`, so `fund` can refuse with a false `TeamWalletShort`. It fails safe (it never overpays). Fix if cheap: `require(customer != t[i].wallet)` in `_demoTargets`. Otherwise add a one-line `ponytail:` comment. Same as tester OPEN 1.
2. `contracts/script/Seed.s.sol:73-77, :91-93` (LOW, claude-contracts): when the float is short, the dry run shows only the totals. The per-wallet lines print only after a successful simulation, and they show raw units with no header. That meets the spec's wording ("the exact shortfall"), but the operator can't see which wallet needs what. Optional: one `console.log(wallet, usdtNeed, wbtNeed)` per target before the revert check.
3. `contracts/script/Seed.s.sol:73` (INFO): the WBT check doesn't reserve the team wallet's own gas. The team now holds 0.29 WBT against 0.02 needed, plus about 0.0016 WBT gas per full fund at 5 gwei. Fine for the demo, so no change.
4. `contracts/script/Seed.s.sol:104` (INFO): the nonce is keccak(tag, from, timestamp, balance). A collision needs the same wallet with the same balance in the same 1 s block, and then the duplicate just fails with `auth invalid`. No change.
5. `contracts/script/Seed.s.sol:128` with `script/RelayPull.s.sol:31` (INFO, human/claude-contracts): `reclaim()` drains PAYER, but `fund()` never refills it. SmokeMerchantPay self-funds PAYER (:44); RelayPull doesn't. Only matters if RelayPull is rerun.

## 4. Ponytail ladder
- Reuse is right: OZ `IERC3009`, `IERC20Permit`, `MessageHashUtils` (already used by SmokeMerchantPay and the MerchantPay tests). No helper library was invented. The digest is 2 lines, so a shared EIP-712 lib across three scripts isn't worth it.
- `shortfall` and `transferDigest` are public only because tests use them, and each has a single production caller. Fine.
- Deletable (INFO, optional): `test/Seed.t.sol:66-73` `test_Targets_MatchTheDivideBy100Demo` only re-asserts the constants' literal values, which the funding tests already assert. `test/Seed.t.sol:136-139` `test_Reclaim_SkipsEmptyWallets` doesn't catch removing the skip, because the token accepts 0-value authorizations (tester M5). `SeedEdges.t.sol:113-122` is the real check, so this test now only proves "doesn't revert". Keeping either is harmless.
- Stale comment outside this batch's files (INFO): `script/SmokeMerchantPay.s.sol:43` says "the demo seed script is batch 003". It's 004. Fix whenever that file is next touched.

## 5. Tests vs acceptance criteria
Every criterion has an assertion that fails when the behaviour breaks: to-target, idempotent, above target left alone (USDT and WBT), payers 0 WBT, merchant exactly 0.02, USDT and WBT shortfall errors with exact values, reclaim returns everything with unchanged WBT and nonce, empty wallets skipped (expectCall count 1), redirect rejected, and both env entry points end to end including PAYER and the never-reclaimed CUSTOMER. The tester's mutation table (14/14 killed with SeedEdges, 3/14 with the builder's 8 alone) confirms the builder's suite was too weak on its own. With 4be1794 committed, it isn't anymore.
`SeedEdges.t.sol:125-141` `vm.setEnv` overrides process env with `makeAddrAndKey` test keys. No other test reads these names (grep `vm.env` in `test/`: none). It leaves no state outside the forge process. reviewer-security owns the final word on that pattern (tester NEEDS THE USER 3).

## NEEDS THE USER (PIPELINE §11)
1. Money moved live during round 1, before all five verdicts: the reclaim (spec acceptance) and, at 00:25, `fund()` with `--broadcast`. The spec's acceptance criteria only called for a fund dry run, but batch.md logs the human's float choice (b) and "do the things fast". Please confirm at the gate that the live fund was intended.
2. The script moves team-wallet money with the deployer key and signs with five script-wallet keys. "Grill me" applies.
