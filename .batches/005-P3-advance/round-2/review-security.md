VERDICT: PASS

# Security review: 005-P3-advance, round 2

Reviewer: reviewer-security (Opus). Scope: `git diff 444e7aa..HEAD -- contracts packages` (HEAD de3ceac): ClaimToken running-total freeze check, Ownable2Step on ClaimToken and InvestorRegistry, CapitalMarket `MerchantCannotFund`, MerchantPay sink guard and uint96 bound, DeployPhase3 (pauses the round-1 MerchantPay), both new broadcast records, `packages/shared/contracts.ts`. Read: my round-1 review, build-contracts.md "Round 2".
Live state read with `cast call` only (chain 1874). No `.env`, no keys, no `forge script`, no code edits. PoCs ran in my scratchpad copy (symlinked `src`/`lib`), not in the repo.

H1 is fixed and my round-1 PoC now reverts. M1 (cheap fix), L1 and M3 (two-step ownership) are fixed. The running-total change opens no new hole. The open items below are follow-ups and don't block.

## Round-1 findings

| ID | Status | Evidence |
|---|---|---|
| H1 batch with repeated ids moves frozen units | **Fixed** | `ClaimToken.sol:183-191` adds up the earlier entries for the same id. `_checkTransfer` (`:198-207`) compares that total with the unfrozen balance before anything moves. Re-run PoC: `[1,1,1]/[40,40,20]` reverts with `ERC7943InsufficientUnfrozenBalance(a, 1, 80, 40)`. |
| M1 merchant self-funding | **Fixed (cheap option a); the residual risk is a product call** | `CapitalMarket.sol:305` sits in `_prepareFunding`, so it covers both `fund` and `fundWithAuthorization`. PoC: the merchant's `fund` now reverts `MerchantCannotFund`. The residual is described under M1r below. |
| M2 gas with 8 holders (~537k) | Open, owner claude-relayer | No contract change; claude-relayer was told (build notes). |
| M3 single admin EOA, single-step Ownable | **Partly fixed** | `ClaimToken.sol:37` and `InvestorRegistry.sol:12` now use `Ownable2Step`. Live `pendingOwner` = 0 on all three. One deployer EOA `0xb4E7…714D` still owns all three (disclosure: claude-research). |
| L1 `paySale` to the market | **Fixed** | `MerchantPay.sol:176-179` rejects MerchantPay, the market and USDT as the merchant. PoC: a sale naming the market reverts `InvalidOrder`. |
| L2 no sweep on CapitalMarket | Open (follow-up) | A plain USDT transfer to the market is still locked forever. L1 closed the only in-protocol way to strand funds there. |
| L3 dust holders block funding | Open (follow-up) | Unchanged. |
| L4 relayer checks for `fundWithAuthorization` | Open, owner claude-relayer | Unchanged. |
| L5 info | Unchanged | Claim-level freeze still has no caller; constructor `feeRecipient_ == this`; leftover rounding order. |
| F5 (tester) uint96 overflow of gross | Fixed | `MerchantPay.sol:114`: `amount ≤ uint96.max − MAX_FEE`. |

## Did the running-total change open a new hole?
I checked each way it could:
- **Last occurrence carries the full total.** For each id, the final entry in the batch compares the id's whole batch total with `_unfrozen` taken from balances before the move, so no ordering can sneak frozen units past it. PoC: interleaved `[1,2,1]/[40,10,40]` reverts.
- **The skip when the total exceeds the balance** (`sent > balanceOf`, which leaves the error to ERC-1155) can't be abused. When `from ≠ to`, OZ subtracts each entry from storage in turn, so a total above the balance always reverts (PoC `[40,61]` reverts, balance unchanged). When `from == to`, the move is a no-op: balance, freeze and holder list stay as they were (PoC).
- **Overflow:** `sent += values[j]` uses checked math, so `[40, uint256.max, 1]` reverts (PoC).
- **canTransfer:** the NatSpec now says `amount` is the id's batch total, and the view returns false for 100 and true for 40 in the PoC setup, the same answer a real transfer gives. The holder cap still runs on final balances in `_move` (`test_BatchRepeatingAnIdCountsOnceForTheHolderCap`).
- **Burns and forced transfers:** neither path changed. They don't use the new loop (`to == 0` takes the `_lowerFrozen` branch; `forcedTransfer` calls `_move` directly), and a market burn still lowers the freeze (PoC). No public burn or batch burn exists.
- **Quadratic gas:** only `safeBatchTransferFrom` pays it, and only the sender pays. A 200-entry batch of one id costs 9.25M gas in total, most of it the registry calls and holder scans for each entry. The relayer allowlist (ARCHITECTURE §3, guard 1) never sponsors ClaimToken transfers, and no market path sends batches. INFO only.

## FOLLOW-UP (non-blocking)

### M1r. MEDIUM (residual of M1): the advance lien can still be routed around through another wallet
- **Where:** `CapitalMarket.sol:213-230` (invoice claims are paid before the advance); the guard at `:305` only checks the address that funds.
- **PoC passes:** investor B funds the merchant's whole invoice claim and sends the units to the merchant with `safeTransferFrom`. This needs the admin to have listed the merchant as eligible. The debtor's 100 USDT then pays only the invoice claim, and the advance gets 0. An eligible accomplice who just holds the units gets the same result without any transfer.
- **Fix:** a product decision, as in round 1 (NEEDS THE USER 2): refuse `listInvoice` while the merchant has an advance running, or send the holdback on invoice proceeds to the advance. Until then, don't put merchant wallets in the InvestorRegistry. **Owner:** human + claude-contracts.

### L6. LOW: the retired round-1 market can still be funded
- **Where:** round-1 CapitalMarket `0xeadf…e940` (it has no pause), registry `0x0e71…018c`, where demo investors A and B are still eligible until 1796498536. Its MerchantPay `0x8eff…248f` is paused (live `paused()` = true).
- **Risk:** a merchant can still list on the old market, and A or B can still fund it. The merchant gets the USDT, but no repayment can ever come, because the only `onPayment` caller is paused. That takes a signature naming the old market (the nonce and `to` bind it), so the danger is a stale frontend or relayer config, not an attacker.
- **Fix:** the admin revokes A and B in the old registry (`setEligible(…, 0)`), which makes the old `mint` revert. Relayer and web allowlist only the `contracts.ts` addresses. **Owner:** claude-contracts (one tx each), claude-relayer, claude-frontend.

### INFO
- `paySale` still accepts other contracts that can't move funds (for example ClaimToken or InvestorRegistry) as the merchant. Only the payer who signed loses, and none of our invariants break, so no change is needed.
- The old ClaimToken `0xedb4…aa10` still has the H1 bug. Claim 1 has 0 supply and the old market can only mint through a dead flow (L6), so there's no live impact.

## Live state (read-only, chain 1874)
- Owners: InvestorRegistry `0x2934…3e74`, ClaimToken `0xce9b…c388` and MerchantPay `0xab81…4251` are all owned by `0xb4E7eDe967E108858DDb5d88B25FDc70723B714D`, `pendingOwner` = 0 on each.
- Wiring: `ClaimToken.market` = `MerchantPay.market` = CapitalMarket `0xecd6…0abe`. `ClaimToken.registry` = the new registry; `LOCK_WINDOW` = 60; `supportsInterface(0x41c4fbad)` = true. `CapitalMarket.merchantPay`/`claimToken`/`usdt` and `MerchantPay.usdt` are correct. `feeRecipient` = relayer `0xdd02…a651`, `relayFee` = 1e5, the new MerchantPay is not paused.
- Old MerchantPays: Phase 2 `0x83b5…73b7` paused = true; round-1 `0x8eff…248f` paused = true.
- Funds: CapitalMarket USDT 0, `totalOwed` 0; MerchantPay USDT 0. Claim 1: supply 0, holders [], `outstanding` 0. `offerCount` = 1.
- Registry: A and B are eligible until 1796500938.
- Code: the live runtime code matches a build of HEAD `src` byte for byte, except at immutable placeholders (InvestorRegistry 928, ClaimToken 8949, MerchantPay 6491, CapitalMarket 9525 bytes). Blockscout shows ClaimToken `is_fully_verified: true`, v0.8.38. `contracts.ts` addresses = the four live addresses.
- Broadcasts: DeployPhase3 commit `ef5fee4`, 9 txs, all status 1; the last one is `pause()` on `0x8eff…`. LiveAdvance commit `ef5fee4`, 16 txs, all status 1.

## Tests run (scratchpad copy)
- New PoCs: `PoCFreeze` 8/8 and `PoCMarket` 26/26 (inherits the 23 current CapitalMarket fork tests, plus the round-1 self-fund and sale-to-market PoCs, both now expecting a revert, and the M1r residual).
- Repo ClaimToken 42/42 and ClaimTokenProbe 2/2 (the third suite in that run passed 6/6; no InvestorRegistry.t.sol exists under contracts/test).

## Secret grep (`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on every diff file, values masked)
- `contracts/script/DeployPhase3.s.sol:31`: 1 hit, the env-var **name** `vm.envUint("DEPLOYER_PRIVATE_KEY")`. No value.
- `contracts/broadcast/DeployPhase3.s.sol/1874/run-latest.json` (86) and `…/LiveAdvance.s.sol/1874/run-latest.json` (560): I grouped every hit by its JSON path without printing it. The hits are receipt/log/tx hashes, `logsBloom`, log topics and data, tx `input` calldata, and `recovery_generation`. The 31 `arguments[]` hits are `fundWithAuthorization` salt/r/s (×1) and `paySale` orderRef/salt/r/s (×7). No JSON key names private, secret, mnemonic, seed or password. **No private key found.**
- `src/*`, `test/*`, `packages/shared/contracts.ts`: 0 hits.
- Web/relayer: there is no web or relayer code in this batch. `contracts.ts` holds only ABIs, public addresses and constants, so it adds no PII.

## NEEDS THE USER
1. M1r: invoice claims senior to a running advance (current) or not. Until that's decided, keep merchant wallets out of the InvestorRegistry.
2. L6: revoke demo investors A and B in the retired registry `0x0e71…018c`.
3. PIPELINE §11 is unchanged from round 1: four money-moving contracts are live and one deployer EOA holds every admin power.
