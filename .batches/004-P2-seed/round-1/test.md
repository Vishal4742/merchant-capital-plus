VERDICT: PASS

# Test: 004-P2-seed, round 1 (tester)

Scope: `git diff 3db8bad..HEAD -- contracts` = `contracts/script/Seed.s.sol` (new), `contracts/test/Seed.t.sol` (new), `contracts/broadcast/Seed.s.sol/1874/reclaim-latest.json` (live record). HEAD 8579cab, branch `contracts`, forge 1.8.6.
No UI in this batch: browser walk at 375/1440 and Lighthouse skipped (no web page changed, so no `shots/`). No relayer change, so no p95 timing. NFR-4 / NFR-12–14: not applicable.
Never run: `forge script` (any mode), any key, `.env`. Live checks are read-only `cast` calls on https://rpc.ankr.com/whitechain_testnet (chain id 1874).

Tester added `contracts/test/SeedEdges.t.sol` (7 fork tests, untracked; the lane must commit it with the batch). Each one was shown to fail when the behaviour it checks breaks (mutation table below).

## Acceptance criteria

| # | Criterion | Result | Proof |
|---|---|---|---|
| 1a | `fund` brings each wallet exactly to target | PASS | `test_Fund_TopsUpEachWalletToItsTarget` (from 0) and tester `test_Fund_TopsUpPartlyFundedWalletsToTheirTarget` (debtor at 30 ends at exactly 100e6, merchant at 0.005 WBT ends at exactly 0.02, team pays exactly 180e6 USDT and 0.015 WBT) |
| 1b | a second `fund` sends nothing | PASS | `test_Fund_IsIdempotentAndNeverOverfills` (team USDT and WBT unchanged on run 2); `test_EntryPoints_FundAndReclaimTheEnvWallets` (second `fund()` moves only the customer's 56) |
| 1c | a wallet above target is left alone | PASS | USDT: `test_Fund_IsIdempotentAndNeverOverfills` (80 stays 80). WBT: tester `test_Fund_LeavesWbtAboveTargetAlone` (merchant at 0.05 stays 0.05, team WBT unchanged) |
| 1d | payers get 0 WBT, merchant exactly 0.02 | PASS | `test_Fund_TopsUpEachWalletToItsTarget` asserts `merchant.balance == 0.02 ether` and payers' sum 0; via the real `.env` entry point: tester `test_EntryPoints_…` asserts 0.02 |
| 1e | team short: reverts naming the shortfall, moves nothing | PASS | USDT: `test_RevertWhen_TeamWalletShort_AndNothingMoves` → `TeamWalletShort(166e6, 0)`. WBT: tester `test_RevertWhen_TeamWalletShortOfWbt_NamesTheWbtShortfall` → `TeamWalletShort(0, 0.015 ether)`. The check runs before `vm.startBroadcast` (Seed.s.sol:70-78) |
| 2a | `reclaim` returns every script wallet's USDT to the team | PASS | `test_Reclaim_ReturnsUsdtWithoutGasFromTheWallets` (+210e6). With the real `reclaim()` entry point and all five env keys incl. PAYER: tester `test_EntryPoints_…` (team ends at 300 − 56 + 1; PAYER 0; CUSTOMER keeps 56, never reclaimed) |
| 2b | wallets' WBT and nonce unchanged (deployer submits) | PASS | `test_Reclaim_…` (merchant keeps 0.02 WBT; nonces 0); tester `test_EntryPoints_…` (`payer.balance + vm.getNonce(payer) == 0`); live: see 3b |
| 2c | wallets at 0 are skipped | PASS | tester `test_Reclaim_SubmitsOneAuthorizationPerNonEmptyWallet`: `vm.expectCall(USDT, transferWithAuthorization.selector, 1)` with one of four wallets funded. Note: the builder's `test_Reclaim_SkipsEmptyWallets` alone does not catch a removed skip (mutation M5 below) |
| 2d | a reclaim signature can't be redirected | PASS | `test_RevertWhen_ReclaimSignatureIsRedirected`: `TetherToken: invalid signature` for `to = thief`, then the same signature succeeds to the team |
| 3a | live dry run of `fund()` prints the exact shortfall while short | PASS (arithmetic checked, not rerun, per instruction) | Builder-reported `TeamWalletShort(99378458, 0)`. Chain: team USDT = 110621542 at blocks 12306500, 12307000, 12307300 and 12307459 (constant before the reclaim); `210000000 − 110621542 = 99378458` (no CUSTOMER set). WBT short 0: team held 1.990758599 WBT ≥ 0.02. The four demo wallets were empty then: the reclaim simulation one block later skipped all four (one tx in `reclaim-latest.json`). Caveat: on the short path the script reverts before printing any per-wallet table (OPEN 2) |
| 3b | live `reclaim()` with `--broadcast`: PAYER 1 USDT back, PAYER 0 WBT / nonce 0 | PASS | tx `0x7fa9fdedb61ffda48ececbffc64735dae4d29fcf6373c24d0558baa02708ecf0`: `cast receipt` → block 12307460, status 1 (success), gasUsed 79577, from `0xb4E7eDe967E108858DDb5d88B25FDc70723B714D` (the deployer/team wallet, HANDOFF.md:40), to USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, tx nonce 7. Logs: `AuthorizationUsed(0xE53f…309b, 0x7cda…5f13)` + `Transfer(0xE53f…309b → 0xb4E7…714D, 0xf4240 = 1e6)`. PAYER `0xE53fBc545e9b72f315699e3295a8A300c192309b`: block 12307459 USDT 1000000, WBT 0, nonce 0; block 12307460 USDT 0, WBT 0, nonce 0; latest (12307730) USDT 0, WBT 0, nonce 0. Team USDT 110621542 → 111621542, team nonce 7 → 8 |
| 4a | `forge build` 0 warnings | PASS | `forge build --force` → "Compiling 53 files with Solc 0.8.38 … Compiler run successful!", no warnings |
| 4b | `forge lint` clean | PASS | `forge lint` exit 0, 0 output lines (whole project, incl. SeedEdges.t.sol) |
| 4c | `forge fmt --check` | PASS | exit 0 |
| 4d | tests cover 100% of the script's money paths | PASS | `forge test -vv --match-path 'test/Seed*.t.sol'` → 15 passed, 0 failed (8 builder + 7 tester). `forge coverage --ir-minimum --match-path 'test/Seed*.t.sol'` → `script/Seed.s.sol` 100.00% lines (62/62), 100.00% statements (81/81), 100.00% funcs (9/9), branches 82.35% (14/17). The 3 branches lcov marks as missed (Seed.s.sol:83 `require(USDT.transfer…)`, :87 `require(sent…)`) are exercised: mutations M13/M14 are killed by tester tests that hit exactly those reverts; under `--ir-minimum` the require branches map badly. Builder's own figure was 66% lines (entry points untested); the tester `test_EntryPoints_…` covers `fund()`, `reclaim()`, `_demoTargets`, `_scriptWalletKeys`, `_walletOf` with `vm.setEnv` test keys |

Full suite (scratch copy, same sources): `forge test` → 54 passed, 0 failed across 5 suites.

### Demo-sizing checks (spec "Serves AT-1 – AT-7, G5"; SRS on `main` c4b783e at ÷100)
The AT scenarios themselves need Phase 3 contracts, so they are not run here; the seed targets were checked against them.
| Target | Need | Result |
|---|---|---|
| MERCHANT 1 USDT | AT-2 full refund of 25 after the 0.10 fee (`relayFee = 100_000`, MerchantPay.sol:51) needs 0.10 | PASS |
| INVESTOR_A 69 | AT-3 10 + AT-6 60/(1+0.12·60/365) ≈ 58.84 = 68.84 | PASS |
| INVESTOR_B 40 | AT-6 40/1.019726 ≈ 39.23 | PASS |
| DEBTOR 100 | AT-7 pays 100 | PASS |
| CUSTOMER 56 | AT-1 25 (refunded in AT-2) + AT-4 5 + AT-5 10/20% = 50 + one more sale at `MIN_PAYMENT` 1 USDT (MerchantPay.sol:24) | PASS |
| G5 | reclaim makes runs repeatable | PASS (tests 2a–2d + live 3b) |

## Mutation check (scratch copy of `contracts/`, `script/Seed.s.sol` mutated there only; worktree file diffed identical after)
| Mutation | All 15 tests | Builder's 8 only | Killed by |
|---|---|---|---|
| M1 USDT top-up sends the full target, not the difference | KILLED | survived | `test_Fund_TopsUpPartlyFundedWalletsToTheirTarget` |
| M2 WBT top-up sends the full target | KILLED | survived | same |
| M3 pre-check ignores WBT | KILLED | survived | `test_RevertWhen_TeamWalletShortOfWbt_…` ("WBT transfer failed" ≠ expected) |
| M4 WBT shortfall reported as 0 | KILLED | survived | same (`TeamWalletShort(0, 0)` ≠ `(0, 1.5e16)`) |
| M5 no skip for empty wallets | KILLED | survived | `test_Reclaim_SubmitsOneAuthorizationPerNonEmptyWallet` |
| M6 PAYER dropped from reclaim | KILLED | survived | `test_EntryPoints_…` |
| M7 CUSTOMER never funded | KILLED | survived | `test_EntryPoints_…` |
| M8 merchant target WBT 0 | KILLED | survived | `test_EntryPoints_…` |
| M9 WBT `held < target` guard removed | KILLED | survived | `test_Fund_LeavesWbtAboveTargetAlone` |
| M10 wallet submits its own reclaim | KILLED | killed | `test_Reclaim_ReturnsUsdt…`, `test_EntryPoints_…` |
| M11 reclaim pays the wallet itself | KILLED | killed | 3 tests |
| M12 shortfall counts above-target wallets | KILLED | killed | `test_Shortfall_SumsOnlyWhatIsMissing` |
| M13 `USDT.transfer` result ignored | KILLED | survived | `test_RevertWhen_UsdtTransferReturnsFalse` |
| M14 WBT send result ignored | KILLED | survived | `test_RevertWhen_WbtTransferFails` |

### Probes (scratch only, not committed)
- P1 duplicate wallet in the target list (two entries for one wallet, target 100, team holds 150): `shortfall` = 200000000 and `fund` reverts `TeamWalletShort(50e6, 0)` although 100 is enough. With targets 100 then 40 the wallet ends at 100 (the max), so no overfill. See OPEN 1.
- P2 team key in the reclaim list: the team's self-transfer succeeds, team delta = only the debtor's 5 USDT. Harmless.
- P3 team wallet as a fund target: self-transfer, balance unchanged, no revert. Harmless.
- P4 two reclaims of one wallet with the same balance in the same block: the second reverts `TetherToken: auth invalid` (nonce = keccak(from, block.timestamp, balance)). Nothing moves. See OPEN 3.

## DONE
- `contracts/test/SeedEdges.t.sol:1-154` (tester lane, new, untracked): 7 fork tests covering partial top-ups, WBT above target, the WBT shortfall, a failing USDT transfer (`vm.mockCall` → false), a WBT target that rejects value, one authorization per non-empty wallet, and both `.env` entry points end to end. Verified: `forge test -vv --match-path 'test/Seed*.t.sol'` 15/15 PASS; mutation table above. Keys there are `makeAddrAndKey` test keys set with `vm.setEnv` inside the forge process only. No file is written, `.env` is not read, nothing is broadcast (fork test). It reuses `SeedHarness` from `Seed.t.sol`.
- All acceptance criteria PASS with the proof above; live tx and balances checked with `cast receipt`, `cast call balanceOf --block`, `cast balance --block`, `cast nonce --block`.

## OPEN (none blocking)
1. `contracts/script/Seed.s.sol:48-55` with `:112-120` (claude-contracts, LOW): a wallet listed twice (CUSTOMER set to a script wallet's address, or two env keys equal) is counted twice by `shortfall`, so `fund` can refuse with a false `TeamWalletShort` (probe P1). No money moves and nothing overfills. Fix if cheap: revert when CUSTOMER equals a script wallet; otherwise a `ponytail:` note.
2. `contracts/script/Seed.s.sol:73-77` (claude-contracts, LOW): on the short path the dry run prints only the totals `TeamWalletShort(usdt, wbt)`, not the per-wallet plan. The table at :91-93 prints only after funding. The spec says "prints the real plan and, while the float is short, the exact shortfall". The totals are exact. To make the plan visible when short, log each wallet's need before the revert.
3. `contracts/script/Seed.s.sol:104` (claude-contracts, INFO): the reclaim nonce reuses on two runs of the same wallet with the same balance within one 1 s block (probe P4). It fails safe; rerun works next block. No action needed.
4. `contracts/test/Seed.t.sol:136-139` (claude-contracts, INFO): `test_Reclaim_SkipsEmptyWallets` passes even with the skip removed (TetherToken accepts 0-value authorizations, M5), and the builder's suite let M1/M2 (overfilling a partly funded wallet) through. Both are now covered by SeedEdges; no change required.
5. `contracts/script/Seed.s.sol:122-129` (claude-contracts / human, INFO): `reclaim()` empties PAYER (as the spec says) but `fund()` never refills it, so `SmokeMerchantPay.s.sol:25` and `RelayPull.s.sol:31`, which pay from PAYER, need a manual top-up after a reclaim. PAYER holds 0 USDT now (block 12307730).
6. `contracts/script/Seed.s.sol:73` (claude-contracts, INFO): the WBT check doesn't reserve gas for the team's own 5–6 txs. The team holds 1.99 WBT against 0.02 needed, so it doesn't matter today.
7. Docs (claude-research, INFO): `main` HANDOFF.md:42 says "Float ≈150 USDT fits", but `fund()` tops up every wallet at once and needs 210 USDT (266 with a customer). The `contracts` branch still carries the old ÷10 HANDOFF/SRS text until it merges `main` (c4b783e).

## NEEDS THE USER
1. Float (spec NEEDS THE USER 1): the team wallet holds 111.621542 USDT + 1.9904 WBT (block 12307730). `fund()` is short by 98,378,458 units without a customer and 154,378,458 with one. Choose option (a), (b) or (c) from the spec.
2. PIPELINE §11: this script moves team-wallet money with the deployer key and signs with five script-wallet keys. You need to see it run and answer "grill me".
3. Tester's `SeedEdges.t.sol` sets the names `DEPLOYER_PRIVATE_KEY`, `DEMO_*_PRIVATE_KEY`, `PAYER_PRIVATE_KEY`, `CUSTOMER` to test keys inside the forge test process (never a real key, never written to a file). Please confirm this pattern is acceptable (reviewer-security should look at it too).
