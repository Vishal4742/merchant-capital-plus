VERDICT: PASS

reviewer-security, batch 009 round 1 (phase mode, Money: yes), 2026-11-06 ~11:10 IST.
Scope: `git diff 150f5db..46c1618 -- contracts/` (1a212b7 Seed, 46c1618 gas test). `contracts/src` untouched.
No HIGH or CRITICAL. The Seed change is safe to broadcast. The gas measurement double-counts the base cost, so ci.md's table and its "not 3" are wrong. "Cap at 2" is still the right call, for a different reason (M1, M2).

## Verified
- **No overfill, no double-send.** `_fund` re-reads each wallet's balance inside the loop (`Seed.s.sol:85-93`) and only tops up to the target. If CUSTOMER is the same address as another target, that wallet ends at the larger of the two targets, never their sum. A second run sends nothing (`test_Fund_IsIdempotentAndNeverOverfills`).
- **The shortfall check is still all-or-nothing.** `shortfall()` and `TeamWalletShort` run before `vm.startBroadcast` (`Seed.s.sol:75-83`). forge simulates the whole script before it broadcasts anything, so a revert later in the loop also broadcasts nothing. Test: `test_RevertWhen_TeamWalletShort_AndNothingMoves` (166.10 short, nothing moves).
- **Reclaim never touches the customer.** `reclaim()` reads only the five script keys (`Seed.s.sol:48-49,128-135`) and never reads CUSTOMER. `test_EntryPoints_FundAndReclaimTheEnvWallets` checks that the customer keeps 156.10 after a reclaim.
- **No key is logged.** `Seed.s.sol:97` logs addresses and balances only. The errors carry amounts only. I checked a malformed env value in a scratch project with a fake value: forge's parse error prints the variable name (`$PROBE_FAKE_KEY`), not the value.
- **Required grep** (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` on the 4 contract files and the batch markdown): the only hits are env variable names, at `Seed.s.sol:45,49,121-124,130-134` and `SeedEdges.t.sol:125-130` (`vm.setEnv` of `makeAddrAndKey` test keys). No 64-hex literal anywhere, and no hit in an added line.
- **Runs:** `forge test --match-path 'test/Seed*.t.sol'` gives 15 passed, 0 failed. `forge test --isolate --match-test test_Gas_FullRepaymentByHolderCount -vv` reproduces ci.md's numbers exactly.
- **The relayer refuses an over-limit repayment without sending.** Its simulation spreads `FEES` (gas 400_000n) into `simulateContract` (`apps/relayer/src/relayer.ts:31-33,337-345`). A payInvoice that runs out of gas at 400k is turned away with no tx sent, no WBT spent and no breaker ban.

## FOLLOW-UP (non-blocking under §3b)

### M1 MEDIUM: the gas test adds the base cost twice, so the table is 23,700 too high
- **Where:** `contracts/test/CapitalMarketProbe.t.sol:496-499` (`BASE_GAS = 23_700` and its comment), `:502-507` (the probe), `:518` (`needed = gasTotalUsed + BASE_GAS`). ci.md lines 21-31 repeat the claim.
- **What's wrong:** for a top-level CALL, `vm.lastCallGas().gasTotalUsed` already includes the 21,000 base and the calldata. The probe can't show otherwise, because `USDT.balanceOf` is a view call, so it compiles to STATICCALL. Isolate mode only turns CALLs into their own transactions. A static call never pays the base cost, so `assertLt(..., 21_000)` passes whatever the mode does.
- **Proof from ci.md's own numbers:** every row's refund is exactly `floor((needed - 23,700) / 5)`. For 2 holders, 363,700 / 5 = 72,740, and the same holds for 3, 4, 5, 6 and 8 holders. That is the EIP-3529 refund cap, which is computed on the whole transaction's gas, base included.
- **Scratch checks (forge 1.8.6, nothing written to the repo):**
  - A non-view no-op CALL measures 21,207. A cold static read measures 2,491.
  - 260 bytes of calldata measure exactly the EIP-7623 floor (31,400 for nonzero bytes, 23,720 for zeros).
  - The figures were identical with and without `--isolate`, and forge 1.8.6 has a `--no-isolate` flag, so isolation looks like the default now.
- **Corrected table** (each figure is ci.md minus 23,700; payInvoice's own base is 23,368, measured from its calldata):

  | holders | 2 | 3 | 4 | 5 | 6 | 8 |
  |---|---|---|---|---|---|---|
  | gas needed | 363,700 | 397,638 | 431,577 | 465,927 | 500,276 | 569,799 |

- **Calibration:** the fork's 2-holder figure after refund is 290,960, against 277,255 live. That is about 5% above live, not 12%. The "if live always runs 12% lower" note should go.
- **Direct check at the relayer's real limit:** I ran `mp.payInvoice{gas: 400_000 - intrinsic}(...)` from a scratch subclass of the probe test, on the fork with `--isolate`. With every holder and the fee recipient holding some USDT: **2 holders OK, 3 holders OK** (about 2.4k spare), 4 holders fail. So ci.md's "covers 2, not 3" is wrong as stated.
- **Fix (claude-contracts):**
  - Delete `BASE_GAS` and the `balanceOf` probe.
  - Replace the arithmetic with a pass/fail call capped at the real limit:
    ```solidity
    bytes memory data = abi.encodeCall(mp.payInvoice, (id, customer, amount, 0, validBefore, salt, v, r, s));
    uint256 intrinsic = 21_000; for (uint256 i; i < data.length; ++i) intrinsic += data[i] == 0 ? 4 : 16;
    vm.prank(anyone);
    mp.payInvoice{gas: 400_000 - intrinsic}(id, customer, amount, 0, validBefore, salt, v, r, s); // must not revert for n == 2
    ```
    This also covers the 63/64 rule, which plain arithmetic misses.
  - Correct the ci.md table and send the corrected Q19 numbers to claude-relayer and claude-research.
  - The reviewer scratch version is `/private/tmp/claude-501/-Users-vg890-ethglobal-contracts/c6b19a0f-dc4e-4bc4-b19c-2f27badbf70b/scratchpad/gascap/test/Cap.t.sol`.

### M2 MEDIUM: a 2-holder repayment can still fail at 400k, depending on who holds USDT
- **The measured case isn't the worst case.** The test's investors each keep about 100+ USDT after funding (setUp gives them 200), so each repayment credit lands on a nonzero balance. Crediting a wallet that holds 0 USDT costs 17,100 more (a cold write from zero to nonzero: 22,100 against 5,000).
- **Measured at a 400k limit:**
  - 2 holders, both at 0 USDT, fee recipient funded: OK (about 2.1k spare).
  - 2 holders at 0 USDT and the fee recipient also at 0: **fails**.
  - 3 holders, any of them at 0 USDT: fails.
- **Failure scenario:** the fee recipient is the relayer hot wallet `0xdd02…a651` (`ARCHITECTURE.md:52`). A manual or future swap job converts its USDT fees to WBT and leaves it at 0. In the same run, I2 investors put their whole balances into the claim. Then the AT-7 repayment is refused by simulation and cannot be relayed. No funds move or get stuck; the payer would need WBT to pay directly.
- **Today's demo state is fine:** with Seed's amounts, B keeps 0.77 USDT and A keeps a balance after AT-6. That is why live AT-7 used 277k.
- **Fix:**
  - Keep the I2 cap at **2**: right call, though 3 fits only when every wallet already holds USDT.
  - claude-relayer: any swap of the hot wallet's fees must leave a nonzero USDT balance.
  - If the payInvoice gas limit is ever raised, size it with `eth_estimateGas` plus a margin and a hard ceiling, not from this table. Every holder at 0 USDT adds 17.1k, so 8 such holders plus an empty fee recipient need about 724k. The ~620k in claude-relayer's 11:03 message would not cover that.
- **Owners:** claude-relayer (hot-wallet dust, estimateGas), claude-contracts (state the condition in ci.md).

### L1 LOW: CUSTOMER isn't checked against the team wallet or the script wallets
- **Where:** `Seed.s.sol:117-126`.
- **CUSTOMER = the team (deployer) wallet:** the guest ends up unfunded, and the log at `:97` makes it look funded. How it plays out depends on the team balance:
  - It already holds ≥ 266.10: the customer row asks for nothing and fund() "succeeds" without funding the guest.
  - Somewhat less: fund() broadcasts a useless self-transfer.
  - Less again: the simulation reverts and nothing is broadcast.
  - In every case AT-1 later fails for lack of funds.
- **CUSTOMER = a script wallet** (for example investor A or the debtor): `shortfall()` counts that wallet twice. That errs safe, but it can report a false `TeamWalletShort`. The wallet ends at 156.10, and the next reclaim sweeps it back to the team. No loss, but the browser guest stays unfunded.
- **Fix (claude-contracts):** in `_demoTargets`, revert (e.g. `CustomerIsScriptWallet()`) when `customer` equals `vm.addr(DEPLOYER_PRIVATE_KEY)`, any of `t[0..3]`, or the PAYER address.

### L2 LOW: a wrong CUSTOMER strands 156.10 USDT
- The amount is up from 56. CUSTOMER is never reclaimed, so a mistyped or stale address loses the whole top-up for good.
- forge's env parser doesn't check the EIP-55 checksum (scratch: a case-flipped address parsed without error).
- Nothing on-chain ties the address to the browser: the guest has nonce 0 and no WBT.
- The same loss happens if the browser profile holding the guest key is cleared before the run.
- **Fix (runbook, claude-contracts + human):**
  1. Dry-run fund() first. It prints CUSTOMER and the top-up.
  2. The human compares that address with the one the browser shows.
  3. Then run `--broadcast`.
  4. Reuse the same browser profile between runs. fund() only tops up, so leftover funds aren't wasted.

### L3 LOW: the I2 holder cap is off-chain only
- On-chain `MAX_HOLDERS` stays 8 (`ClaimToken.sol:38`).
- An eligible investor can call `CapitalMarket.fund` or `fundWithAuthorization` directly, or transfer units before `lockFrom`, and push a claim past 2 holders. That invoice can then no longer be repaid through the relayer.
- Eligibility is set by the admin, so only approved wallets can do this.
- **Fix:** claude-relayer / claude-frontend refuse with a clear error (read `holdersOf(claimId).length` before relaying a fund or repayment) and add the README risk line Q19 already asks for.

## Notes (no action needed for this batch)
- ci.md line 33, "Reclaim first doesn't change this": reclaim returns whatever the debtor (target now 0) and PAYER hold, and that lowers the shortfall. The sentence is true only while both are empty.
- Don't run `Seed --broadcast` while the team wallet's WBT sweep or swap is running (agentbus 11:00). They sign with the same deployer key, so nonces could collide partway through. fund() is idempotent, so a partial top-up is safe to rerun. The relayer's hot wallet is a different key, so the relayer doesn't conflict.
