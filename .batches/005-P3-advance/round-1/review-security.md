VERDICT: CHANGES

# Security review: 005-P3-advance, round 1

Reviewer: reviewer-security (Opus). Scope: `git diff f28c502..HEAD -- contracts packages` (HEAD 444e7aa): CapitalMarket, ClaimToken, InvestorRegistry, MerchantPay v2, interfaces, tests, DeployPhase3 / LiveAdvance / export-abi.sh, both broadcast records, packages/shared/contracts.ts. Read: PIPELINE.md (incl. §3a fast mode), spec.md, build-contracts.md, ARCHITECTURE.md §2–§3, SRS FR-TOK/FR-ADV/NFR-1/2.
Live state read with `cast call` only (chain 1874). No `.env`, no keys, no `forge script`, no code edits. PoCs ran in a scratchpad copy (symlinked `src`/`lib`, own `test/PoC.t.sol`), not in the repo.

One HIGH (a transfer-rule bypass in the live ClaimToken), so CHANGES under §3a. Everything that moves USDT checked out: I found no way for anyone to take holders' or merchants' USDT.

## HIGH

### H1. A batch transfer that repeats an id moves frozen units (FR-TOK-4, ERC-7943 partial freeze)
- **Where:** `contracts/src/ClaimToken.sol:181-183` (transfer branch of `_update`) and `:189-198` (`_checkTransfer`).
- **Bug:** each `(id, value)` pair is checked on its own against the sender's unfrozen balance *before* anything moves. `safeBatchTransferFrom` accepts the same id several times, so every entry passes while their sum is larger than the unfrozen balance.
- **Exploit (PoC passes):** `a` holds 100 units of id 1. The admin calls `setFrozenTokens(a, 1, 60)`, leaving 40 unfrozen. `a` calls `safeBatchTransferFrom(a, b, [1,1,1], [40,40,20], "")`. Each entry is ≤ 40, so each check passes, and all 100 units move to `b`, the 60 frozen ones included. `getFrozenTokens(a, 1)` still reads 60 against a balance of 0. Any eligible holder can do this to get around a compliance hold (sell or park frozen claims with another eligible investor). `test_BatchTransferAppliesRulesPerId` covers duplicate ids but never with a freeze.
- **Fix (no ABI change):** check the result after the move, so duplicates can't add up past the limit:
  ```solidity
  _move(from, to, ids, values);
  if (from != address(0) && to != address(0)) {
      for (uint256 i; i < ids.length; ++i) {
          uint256 frozen = _frozen[from][ids[i]];
          if (frozen != 0 && balanceOf(from, ids[i]) < frozen) {
              revert ERC7943InsufficientUnfrozenBalance(from, ids[i], values[i], 0);
          }
      }
  }
  ```
  Keep `_checkTransfer` for its clearer errors on eligibility, lock and claim freeze. Add a test: the `[40,40,20]` batch above must revert, and `[20,20]` must pass.
- **Cost:** ClaimToken is live, `ClaimToken.setMarket` and `MerchantPay.setMarket` are one-time, and CapitalMarket holds ClaimToken and MerchantPay as immutables. A fix therefore means redeploying ClaimToken, MerchantPay and CapitalMarket (InvestorRegistry can stay), regenerating `packages/shared/contracts.ts` and re-running G3. If you redeploy, bundle M1 (self-funding guard), L1 and L2 into the same deploy.
- **If the human accepts the risk for the testnet demo:** don't use `setFrozenTokens` live. To stop an investor trading, revoke them in the registry instead: that blocks every transfer they send (`canSend` false), and they keep receiving repayments (FR-TOK-7). The human makes that call (NEEDS THE USER 1).
- **Owner:** claude-contracts (ClaimToken was built by its developer subagent).

## FOLLOW-UP (MEDIUM / LOW; these don't block)

### M1. MEDIUM: a merchant can route invoice revenue around its own advance lien
- **Where:** `contracts/src/CapitalMarket.sol:213-230` (invoice holders take `min(net, supply)` first, then the advance takes from what's left) and `:293-308` (`_prepareFunding` lets anyone fund, including the offer's own merchant).
- **Exploit (PoC passes):** a merchant with a funded advance, or a friendly eligible investor, buys the whole invoice claim for the merchant's own invoice. If the merchant buys it, the price goes from the merchant to itself, so it costs nothing. When the debtor pays, the full 100 USDT goes to the invoice claim and `remaining == 0`, so the advance holders get **0** from 100 USDT of revenue (FR-ADV-4 expects `min(gross × bps, owed, net)`). This works with any eligible accomplice, too. The order (invoice first, then advance) follows ARCHITECTURE §2, so this is a product rule as much as a bug. Diverting sales off-platform is already possible, so the on-chain path adds little extra risk.
- **Fix options:** (a) cheap: `if (investor == offer.merchant) revert` in `_prepareFunding`; (b) refuse `listInvoice` while the merchant has a running advance (`advanceOf != 0 && totalSupply != 0`); (c) send the holdback on invoice-funding proceeds (the cost paid to the merchant) to the advance holders. (b) or (c) is a product decision (NEEDS THE USER 2). **Owner:** claude-contracts + human.

### M2. MEDIUM: a payment routed to 8 holders needs about 537k gas, more than the relayer's 400k cap and the 0.10 fee
- **Where:** `contracts/src/CapitalMarket.sol:326-357` (per holder: `balanceOf`, burn, USDT push), `contracts/src/ClaimToken.sol:37` (`MAX_HOLDERS = 8`); ARCHITECTURE §3 drain guard (5) caps gas at 400k.
- **Measured (PoC):** one 5 USDT sale with an advance spread over 8 holders costs **536,773 gas**, against 256–278k for 1 holder live. An invoice payment that pays both an 8-holder invoice claim and an 8-holder advance is about 1M. An investor who spreads units over 8 eligible wallets makes every sale of that merchant fail under a 400k gas limit, or costs the relayer about twice the fee per sale.
- **Fix:** relayer: set the gas limit from simulation, keep a hard ceiling around 1.1M, and price the fee by holder count (or refuse with a clear reason). Contracts (next deploy): consider a lower `MAX_HOLDERS`, or a pull accumulator, which the ponytail note at `ClaimToken.sol:49` already names. **Owner:** claude-relayer (now), claude-contracts (later).

### M3. MEDIUM: one deployer EOA holds every admin power
- **Where:** `contracts/script/DeployPhase3.s.sol:29-37`. Live owner of InvestorRegistry, ClaimToken and MerchantPay: `0xb4E7eDe967E108858DDb5d88B25FDc70723B714D`, the same key that submitted the LiveAdvance transactions.
- **Powers:** `ClaimToken.forcedTransfer` (`ClaimToken.sol:107`) moves any holder's units to any eligible address, and the same owner decides who is eligible (`InvestorRegistry.sol:25`). Together, the admin can redirect any claim's future repayments to itself. MerchantPay's owner can also `setRelayFee` up to 0.25 to any recipient, `pause` and `sweep`. ERC-7943 requires forced transfers, so this is the design, but the key should stay off any hot path. ClaimToken (`:36`) and InvestorRegistry (`:11`) use single-step `Ownable`, while MerchantPay uses `Ownable2Step`: one mistyped `transferOwnership` loses the compliance admin for good.
- **Fix:** keep the deployer key cold (no relaying); use `Ownable2Step` for ClaimToken and InvestorRegistry on the next deploy; say "multisig in production" in the README. **Owner:** claude-contracts; tell the human.

### L1. LOW: `paySale` can name the market as the merchant, and the USDT is then stranded
- **Where:** `contracts/src/MerchantPay.sol:174`. It rejects `address(this)` as merchant but not `address(market)`.
- **Exploit (PoC passes):** `paySale(merchant = CapitalMarket, …)`: `hasClaimsOn(market, 0)` is false, so the 4.9 USDT net goes straight to the market. The market's balance then exceeds `totalOwed` (breaking NFR-2), and nothing can withdraw it. Only a payer who signs this hurts themselves, but it breaks the invariant F1 asserts.
- **Fix:** `|| merchant == address(market)` in the `InvalidOrder` check. **Owner:** claude-contracts (next deploy).

### L2. LOW: CapitalMarket has no recovery for stray USDT
- **Where:** `contracts/src/CapitalMarket.sol` has no sweep. USDT sent to the market by a plain transfer, or through L1, is locked forever.
- **Fix:** an owner-only `sweep(to)` limited to `balance − totalOwed`, so `owed` balances stay untouchable. This needs an owner on the market (it has none today), so it goes with the next deploy, or gets a ponytail note accepting the loss. **Owner:** claude-contracts.

### L3. LOW: 8 dust holders can block more funding of an offer
- **Where:** `contracts/src/ClaimToken.sol:225`. Once 8 addresses each hold 1 unit, minting to a new investor reverts with `TooManyHolders`, so the rest of the offer can't be sold. This needs 8 KYC'd wallets. **Fix:** a minimum funding size in `_prepareFunding` (for example ≥ 1 USDT of cost, or ≥ face / 8 for new holders). **Owner:** claude-contracts.

### L4. LOW: relayer checks for the new `fundWithAuthorization` action
- **Where:** `contracts/src/CapitalMarket.sol:175-201`; ARCHITECTURE §3.
- **Issue:** USDT forwards all gas to an ERC-1271 `isValidSignature`, and `mint` calls the investor's `onERC1155Received` (`ClaimToken.sol:83`, through OZ `_updateWithAcceptanceCheck`). An investor contract can burn relayer gas, or revert after the simulation runs.
- **Fix:** apply drain guard (11), rejecting code including EIP-7702, to `investor`; before sending, check `value == quote(claimId, units)` and `nonce == fundingNonce(...)`, check `authorizationState` and simulate; allowlist CapitalMarket plus only the `fundWithAuthorization` selector. **Owner:** claude-relayer.

### L5. INFO
- No call path ever sets claim-level freeze: CapitalMarket only calls `setClaimState(id, lockFrom, false)` (`CapitalMarket.sol:314`), so the "frozen claim" half of FR-TOK-4 can't be used live in Phase 3. Fine until default/recourse lands; note it in the ABI-freeze text.
- `MerchantPay` constructor (`MerchantPay.sol:101`) accepts `feeRecipient_ == address(this)`, while `setRelayFee` refuses it. No live impact (the live recipient is the relayer wallet `0xdd02…a651`).
- `_distribute` gives rounding leftovers starting from `holders[0]` every time. That only changes the order of repayment, by at most 1 unit per payment, and never pays a holder more than it is owed.

## Checked and fine
- **Who can call what:** `onPayment` is MerchantPay only (`CapitalMarket.sol:211`); `mint`/`burn`/`setClaimState` are market only (`ClaimToken.sol:59-95`). There is no public burn and no other mint path (ERC1155Burnable isn't inherited; public transfers can't reach `from`/`to == 0`). Both `setMarket` calls are one-time. Live wiring is correct: `ClaimToken.market` = `MerchantPay.market` = `0xeadf…e940`, `CapitalMarket.merchantPay`/`claimToken`/`usdt` are correct, MerchantPay `pendingOwner` = 0, and the Phase 2 MerchantPay is paused. `refund` pulls only from `msg.sender == payment.merchant`; `fund` pulls only from `msg.sender`, so nobody else can spend a stored approval.
- **EIP-3009 binding:** `fundingNonce = keccak(chainid, market, claimId, investor, units, salt)` (`:254-260`). The signed value is `quote(claimId, units)`, and the offer's price and face never change after listing. `receiveWithAuthorization` requires `to == msg.sender`, so only the market can submit the signature, and only for that claim, investor and number of units. MerchantPay nonces bind the invoice id, or the merchant + orderRef, plus the amount. On invoices the fee is bound through the signed value (`amount + relayFee`): if the owner changes the fee, pending invoice signatures fail instead of splitting differently. Nonces for the two contracts can't collide (each includes its own address and `to`).
- **Routing:** `hasClaimsOn` (`:275-280`) runs the same supply tests as `onPayment` (`:206-233`). The only call between them is MerchantPay's USDT transfer to the market. Each `take` is ≤ `remaining`, and `remaining` goes down after the invoice step, so nothing is counted twice. `Σ fee + toInvestors + toMerchant == gross` holds on both paths.
- **Rounding (`_distribute`, `:326-357`):** `amount ≤ supply`, so each floored share is ≤ its balance. The leftover loop always ends, because `Σ(balance − share) = supply − assigned ≥ amount − assigned`. No holder is paid above its balance, and burns equal pushes plus `owed`, which equals `amount`, so no dust stays. `n == 0` with `supply > 0` can't happen, because every balance change goes through `_move`, which keeps the holder list (it would revert with a division by zero, not loop forever). `quote` rounds up, so investors pay at most 1 unit more; the holdback rounds down, so the merchant keeps at most 1 unit. Neither direction helps an attacker.
- **Reentrancy / CEI:** every function that moves money is `nonReentrant` (transient guard). State is written before any external call. The mint callback comes last in both fund paths, after `sold` has been increased. Burns make no callbacks, and pushes are plain USDT. An ERC-1271 or 1155 callback can't re-enter a guarded function, and the unguarded `listAdvance`/`listInvoice`/`cancelOffer` can't touch an offer whose `sold` or `paid` has already been written. `_settle` runs before the burns and pushes. A failed push becomes an `owed` balance, and a gas-starved push can't force that (the 63/64 rule leaves too little gas for the SSTOREs that follow).
- **Burn never blocked:** `_lowerFrozen` can't underflow, even when frozen > balance.
- **Invariant live:** CapitalMarket's USDT balance is 0 and `totalOwed` is 0; MerchantPay's balance is 0. Offer 1: settled, supply 0, no holders, `supportsInterface(0x41c4fbad)` true. The `contracts/src` in the repo are unchanged since the deploy commit `79b6013`, and the deployed code sizes match `forge inspect` (9512 / 8594 / 6402 / 759 bytes).
- **`sweep`** (`MerchantPay.sol:221`) can only take stray funds: MerchantPay holds 0 between transactions on every path.
- **Tests:** the original 20 CapitalMarket fork tests pass in my copy, together with the PoCs. Gaps that matter for security: no test for a batch with a repeated id under a freeze (H1), and no test of an invoice claim held by the merchant itself (M1).

## Secret grep (`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on every diff file, values masked)
- `contracts/script/DeployPhase3.s.sol:29`, `contracts/script/LiveAdvance.s.sol:36-39`: 5 hits, all env-var **names** inside `vm.envUint("…_PRIVATE_KEY")`. No values.
- `contracts/broadcast/DeployPhase3.s.sol/1874/run-latest.json` (86) and `…/LiveAdvance.s.sol/1874/run-latest.json` (538): I sorted every hit by its JSON path without printing it. They are tx/block hashes, `logsBloom`, log topics and data, tx `input` calldata, call arguments (salt, orderRef, and the public r/s of signatures in `fundWithAuthorization`/`paySale`), and `recovery_generation` (a field forge 1.8.6 writes into every script record; it differs per run). No key, secret, mnemonic or private field names. **No private key found.**
- All other diff files, including `packages/shared/contracts.ts`: 0 hits.
- Web/relayer: there is no web or relayer code in this batch. `contracts.ts` holds only ABIs, public addresses and constants. On-chain data adds no PII (`refHash` is a hash; only wallet addresses appear).

## NEEDS THE USER
1. H1: redeploy ClaimToken + MerchantPay + CapitalMarket with the post-move freeze check (and M1a, L1, L2), or accept the risk for the testnet demo and use registry revocation instead of `setFrozenTokens`.
2. M1: should a running advance lien come before or after invoice financing? If invoice financing stays senior, block self-funding at least (`investor != merchant`).
3. PIPELINE §11: four money-moving contracts live, all admin powers on one deployer EOA (M3), and the relayer limits for routed payments (M2, L4).
