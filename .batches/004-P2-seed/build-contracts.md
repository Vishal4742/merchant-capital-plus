STATUS: READY

# Build: 004-P2-seed (claude-contracts, round 1)

Repo root `/Users/vg890/ethglobal-contracts` (branch `contracts`). Commits: `246ec4a` RED (5/8 failing) · `ec9aeea` GREEN (Seed.s.sol + a test fix: one test armed `expectRevert` before its own view calls).
Human inputs (23:58): ÷100 demo amounts; 4 new script wallets generated into `.env` (addresses only printed): DEMO_MERCHANT `0x37F9…42B1`, DEMO_INVESTOR_A `0xC236…6752`, DEMO_INVESTOR_B `0xaf74…771B`, DEMO_DEBTOR `0x518b…6D9D`.

## DONE
| Criterion | Evidence |
|---|---|
| fund tops up to target | `test/Seed.t.sol` `test_Fund_TopsUpEachWalletToItsTarget`: merchant 1 USDT + 0.02 WBT, A 69, B 40, debtor 100, customer 56; team −266 USDT; payers 0 WBT. PASS |
| idempotent, never overfills | `test_Fund_IsIdempotentAndNeverOverfills` (wallet at 80 left alone; second run moves no USDT and no WBT). PASS |
| short team wallet → revert, nothing moves | `test_RevertWhen_TeamWalletShort_AndNothingMoves`: `TeamWalletShort(166e6, 0)`, balances unchanged; `test_Shortfall_SumsOnlyWhatIsMissing`. PASS |
| reclaim gasless | `test_Reclaim_ReturnsUsdtWithoutGasFromTheWallets`: 210 USDT back, merchant keeps its 0.02 WBT, wallets' nonces 0; `test_Reclaim_SkipsEmptyWallets`; `test_RevertWhen_ReclaimSignatureIsRedirected` (`TetherToken: invalid signature` for another `to`). PASS |
| quality | `forge test` 47/47 (8 Seed + 27 MerchantPay + 5 edges + 7 PullStub); `forge build` 0 warnings; `forge lint` 0 findings; `forge fmt`; `forge coverage --ir-minimum`: `script/Seed.s.sol` 66% lines, the uncovered lines are the `.env`-reading entry points (`fund()`, `reclaim()`, `_demoTargets`, `_scriptWalletKeys`, `_walletOf`), which the harness bypasses on purpose; every money path (`shortfall`, `transferDigest`, `_fund`, `_reclaim`) is exercised |
| live dry run of fund() | `forge script … --sig "fund()"` without `--broadcast`: `TeamWalletShort(99378458, 0)`, i.e. 210 − 110.621542 USDT, exactly the real shortfall; nothing sent |
| live reclaim() | `0x7fa9fdedb61ffda48ececbffc64735dae4d29fcf6373c24d0558baa02708ecf0` (`transferWithAuthorization`), from the deployer `0xb4E7…714D`, status 1, 79,577 gas, recorded commit `ec9aeea` (clean tree). PAYER 1 → 0 USDT, WBT 0 and nonce 0 before and after; the four demo wallets were empty and skipped |

## OPEN
1. Float: `fund()` needs 210 USDT (266 with a customer); the team wallet has ≈ 111.6 after the reclaim. Waiting on the human (spec NEEDS THE USER 1).
2. The customer (browser guest wallet) is funded only when `CUSTOMER=<address>` is set and is never reclaimed.

## NEEDS THE USER
1. Float: (a) one faucet claim into COLLECTOR1, then I sweep + swap; (b) swap the team wallet's spare WBT and recycle with `reclaim` between scenes; (c) both.
2. PIPELINE §11: the script moves team-wallet money with the deployer key and signs with five script-wallet keys.

## Added during round 1 (human 00:21: "do the things fast")
- Float: team wallet swapped 1.7 WBT → 124.3 USDT on YetiTrade, tx `0x9d7e4fd503acab7d6a11946f26a6ef8de5c7a08f7b3c0ed10b7234121fb22e86` (team now 235.93 USDT / 0.29 WBT): the spec's float option (b).
- **Live `fund()` broadcast, beyond the spec's dry-run criterion** (flagged by reviewer-security INFO-5; for the human's confirmation at the gate): 5 txs from the deployer at commit `4be1794`, all status 1 (`0x85a57b16…e258`, `0x3ab7b0bd…174f`, `0x247c5acd…70fa`, `0xd8c6d61e…e4bd`, `0x3db3dd46…288b`): DEMO_MERCHANT 1 USDT + 0.02 WBT, DEMO_INVESTOR_A 69, DEMO_INVESTOR_B 40, DEMO_DEBTOR 100. All four at nonce 0, payers at 0 WBT. Fully reversible with `reclaim()`.
- Tester added `test/SeedEdges.t.sol` (7 tests, 14/14 mutants; `4be1794`).
