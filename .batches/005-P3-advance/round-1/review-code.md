VERDICT: PASS

# Code review: 005-P3-advance, round 1 (reviewer-code, fast mode §3a)

Scope: `git diff f28c502..HEAD -- contracts packages` (HEAD 444e7aa), read in full: the 3 interfaces, InvestorRegistry, ClaimToken, CapitalMarket, MerchantPay v2, DeployPhase3, LiveAdvance, export-abi.sh, the test diffs, and packages/shared/contracts.ts. Spec, build-contracts.md, SRS §3–6 and ARCHITECTURE §2–3 were read against the code. I edited no code.

No HIGH or CRITICAL findings. The money paths are correct, including the cases the suite doesn't test, which I checked with probe tests. MEDIUM and LOW items are under FOLLOW-UP. One of them, the ARCHITECTURE §2 freeze text, has to be done **before GATE G3 PASSED is posted**, not in a later batch (see F1).

## DONE (verified)
- `forge test --match-contract CapitalMarketForkTest`: 20/20 pass on the fork (42 s).
- **Probe tests** (a scratch copy, not in the repo): `/private/tmp/claude-501/-Users-vg890-ethglobal-contracts/c6b19a0f-dc4e-4bc4-b19c-2f27badbf70b/scratchpad/cm/test/Probe.t.sol`. 8/8 pass:
  - invoice 60/100 financed plus advance: holders 60, lien 11, merchant 29, market 0
  - fully financed invoice plus advance: lien gets 0, merchant 0
  - lien capped by net: 95 financed, so the lien takes 5 of a possible 20
  - a revoked investor still receives its 1 USDT through MerchantPay → market (FR-TOK-7)
  - funding after a partial payment reverts `OfferClosed`
  - invoice cancelOffer → relist → fund works
  - 3 uneven holders: the leftover sums exactly, market 0
  - gas for payInvoice with 8 invoice holders plus an advance (partial 50): **517,793**. Fork state is warm in-test, so the real cost is higher.
- **Logic checks**:
  - `_distribute` (CapitalMarket.sol:326–357) always ends: Σ balances == supply ≥ amount, and the leftover is below the number of holders. The leftover loop gives one unit to each of the first holders, never above a balance. Burns run before pushes, and a failed push goes to `owed`/`totalOwed`.
  - `onPayment` (:206–233) sends `toInvestors ≤ net`, and toInvestors + remaining == net.
  - Advance lifecycle: `advanceOf` is cleared on cancel or settle; one advance per merchant; another advance can be listed after the cap is repaid (AT-5 test).
  - Invoice funding stops after any payment (`paid != 0`) and after a MerchantPay cancel (status check).
  - `quote` rounds up, so no unit is ever free.
  - The lock is set once at the first funding, at `dueDate − LOCK_WINDOW ≥ offerDeadline`.
  - Holder bookkeeping: every balance change goes through `_move`, so `holdersOf` matches the non-zero balances.
- **AT numbers in the tests**: AT-3 merchant +10 and 11e6 units. AT-4 `Paid(… gross 5e6, fee 1e5, toInvestors 1e6, toMerchant 3.9e6)` and outstanding 10e6. AT-5 outstanding 0, `liensOf` [], next sale 5e6 − fee. AT-6 quotes 58_839_334 / 39_226_223 (PRICE 98_065_556 = 100e6·365/372.2, rounded down). AT-7 60e6/40e6 to the holders, `Settled`, market 0.
- **Live state on 1874** (read with `cast call`, no key): claim 1 settled with supply 0. Market USDT balance 0 and `totalOwed` 0. MerchantPay.market == ClaimToken.market == 0xEADF…, and CapitalMarket.merchantPay == 0x8EFF…. The old MerchantPay 0x83b5 is `paused() == true`. LOCK_WINDOW 60, relayFee 1e5, feeRecipient 0xdd02…a651. `contracts/src` and foundry.toml are unchanged since the deploy commit 79b6013 (`git diff --stat 79b6013..HEAD -- contracts/src contracts/foundry.toml` is empty).
- **packages/shared/contracts.ts**: all 4 ABIs equal a fresh `forge inspect` (MerchantPay 61 entries, CapitalMarket 46, ClaimToken 57, InvestorRegistry 12). The addresses match the DeployPhase3 record. It typechecks with viem (`tsc --strict` plus `Address` assignment and `offers` output-name extraction: TSC_OK). Every export of the old merchantPay.ts is still there. No consumer imports the deleted `merchantPay.ts`: both the web app and the relayer inline their own ABIs today.
- **Traceability**: every contract change maps to FR-ADV-1–6, FR-INV-1/3/4/5, FR-TOK-1–4/6/7 (+5 for the interface id, as the spec says), FR-KYC-1, FR-PAY-2/16, NFR-1/2, or the "MerchantPay v2" list in the spec. Nothing outside the spec was built (small file-list gaps in F9).

## FOLLOW-UP (MEDIUM / LOW: not blocking under §3a.1)

**F1. MEDIUM. ARCHITECTURE.md §2 does not match the frozen, deployed ABI.** Owner: claude-contracts. Due before `GATE G3 PASSED`, since §2 is the freeze document (PIPELINE §3 exception, §7). Deviations, all of them:
- Deploy: `CapitalMarket(merchantPay, claimToken, usdt)`, with no `GRACE` (CapitalMarket.sol:91). Also `InvestorRegistry(owner)`. §2 still says "`packages/shared/merchantPay.ts`" and the old address 0x83b5; it should name `contracts.ts` and the four new addresses.
- MerchantPay:
  - `acknowledge(uint256,uint256,bytes)` and `InvoiceAcknowledged` are missing, and the Invoice struct has no acknowledged field. §2's Phase 3 note required this field in "the last" MerchantPay.
  - **Invoices take the fee on top** (MerchantPay.sol:153–157). The payer signs `amount + relayFee` with nonce `invoiceNonce(id, amount, salt)`. `payments(id).gross` and `Paid.gross` are amount + fee, `toMerchant` = amount − toInvestors, and the refund cap includes the fee. §2 says the fee is "taken inside the payment".
  - Partial payments must be at least 1 USDT or exactly what is still owed (:148).
  - New: `market()`, `sweep(address)`, `MarketSet`, `Swept`, `MarketAlreadySet`, `InvoiceFinanced`; Ownable2Step (`pendingOwner`, `acceptOwnership`, `OwnershipTransferStarted`); a sale's merchant and the fee recipient can't be MerchantPay itself.
- CapitalMarket:
  - `markDefault`, `repay` and `Defaulted` are missing.
  - New views and events: `hasClaimsOn`, `isFinanced`, `fundingNonce` (= keccak256(abi.encode(chainid, market, claimId, investor, units, salt)), signed value = `quote(claimId, units)`), `advanceOf`, `claimOfInvoice`, `owed`, `totalOwed`, `offerCount`, `merchantPay`/`claimToken`/`usdt`, the `OFFER_*` and `MAX_HOLDBACK_BPS` constants, and `OwedWithdrawn`.
  - Freeze the shape of the `offers(claimId)` tuple: (kind, merchant, offerDeadline, bps, cancelled, settled, invoiceId, face, price, maturity, sold). FR-ARK-3 compares against it.
  - The advance cost rounds **up** (:251). §2 says `units × principal / cap`, which is rounding down and would make small buys free. Rounding up is right; fix the doc.
  - The remainder rule changed: §2 says "last holder gets the remainder"; the code gives "one unit each to the first holders with spare balance" (:338–343). Fix the doc.
- ClaimToken: new `setMarket` (one-time), `MarketSet`, `claimState`, `market`, `registry`, `MAX_HOLDERS`, and the ERC-7943 errors. The rest matches.
- InvestorRegistry: `register` and `setAttester` are missing (Phase 5). New: `expiryOf`, `EligibilitySet`.

**F2. MEDIUM. Routed payments with many holders go over the relayer's 400k gas cap** (ARCHITECTURE §3 rule 5). Measured 517,793 (warm) for 8 invoice holders plus an advance. Live: 256–278k with one holder. The money is safe because anyone can submit (FR-REL-7), but the relayer will refuse those payments, and the 0.10 fee doesn't cover them (build OPEN #3). Fix: the relayer raises its gas cap for `payInvoice`/`paySale` routed through the market, or the UI caps holders at about 3 per claim for the demo. Owner: claude-relayer, with the number from claude-contracts.

**F3. MEDIUM. The tests miss parts of the spec's acceptance criteria.** CapitalMarket was written before its tests. Uncovered:
- C5 "capped by **net**", and the order when an invoice claim and an advance share one payment. A regression there (`remaining -= take` underflow) would make every financed-invoice payment from a merchant with an advance revert.
- T1 "revoked still paid" end to end through the market (ClaimToken.t.sol only tests the burn).
- Funding after a partial payment; invoice cancel and relist; more than 2 holders.

Mutations the current tests do catch: a waterfall instead of pro-rata (the 36/24 burn check), holdback on net instead of gross (AT-4), a missing burn, a missing `advanceOf` clear, and a wrong `toInvestors`. Fix: copy the 7 functional cases from the probe file above into `contracts/test/CapitalMarket.t.sol`; they pass as they are. Owner: claude-contracts.

**F4. LOW. A remainder under 1 USDT can't be relayed.** MerchantPay.sol:148 accepts it (e.g. 4.5 paid of 5 leaves 0.5), but the relayer's 1 USDT minimum on the signed value turns 0.5 + 0.10 away, so a financed invoice's last units wait for someone to submit with their own WBT. The cheapest fix needs no contract change: the UI and relayer only offer partial payments that leave 0 or at least 1 USDT. Put the rule in §2. Separately, MerchantPay.t.sol:259–279 never exercises the "exact remainder below 1 USDT" branch: its remainder is exactly 1e6. Owners: claude-frontend and claude-relayer (rule), claude-contracts (test).

**F5. LOW. The uint96 guard ignores the fee.** MerchantPay.sol:113 allows `amount = type(uint96).max`, but `_record(…, amount + fee)` (:155, :252) then fails `SafeCast` on a full payment. The amounts involved are absurd, so this is only for correctness: compare against `type(uint96).max - MAX_FEE` at the next redeploy. Owner: claude-contracts.

**F6. LOW. `paySale` accepts `merchant == address(market)`** (MerchantPay.sol:174). `hasClaimsOn(market, 0)` is false, so the net goes to the market and stays there (it has no sweep). That breaks NFR-2 "the market keeps only what it owes", though only with the payer's own signed money. Fix: the relayer rejects it now; the contract can reject it at the next redeploy. Owner: claude-relayer (now), claude-contracts (later).

**F7. LOW. The UI needs one more check before Buy.** When an invoice is cancelled in MerchantPay while its offer is listed but unfunded (MerchantPay.sol:121–128), `offers(claimId)` still shows the offer as open (`cancelled=false`). Funding then reverts with `OfferClosed`, which the relayer's simulation catches, but the Buy button should also check `invoices(invoiceId).status == 1 && paid == 0`. Owner: claude-frontend (FR-ARK-3).

**F8. LOW. Ponytail.**
- foundry.toml:23–25 excludes `block-timestamp` for the whole project, which makes the inline disables at ClaimToken.sol:243 and InvestorRegistry.sol:20 dead. Keep one of the two.
- export-abi.sh:10 cleans up `$tmp` on failure but leaves `$abis` behind: `trap 'rm -rf "$tmp" "$abis"' EXIT`.
- export-abi.sh:93: `mv` of a mktemp file leaves contracts.ts at mode 0600 locally (git stores 0644): add `chmod 644`.
- export-abi.sh:45 hard-codes `LOCK_WINDOW_SECONDS = 60`, a second copy of DeployPhase3's constant. Read it from the deploy or document it.
- `_distribute`'s `% n` wrap and the `shares[i] < balances[i]` guard never fire: the leftover is below n and every share is below its balance whenever amount < supply. They are harmless guards; no action needed.

Owner: claude-contracts.

**F9. LOW. The spec's file list is incomplete.** The diff also touches `script/LiveAdvance.s.sol`, `foundry.toml` (lint) and the broadcast records. All are needed by the spec's own criteria (the live AT-3/4/5 run), so this is not scope creep; list them in the batch notes. Separately, `contracts/test/CapitalMarketProbe.t.sol` is untracked and came from another round-1 agent, not this builder. Don't commit it with this batch unless the lane adopts it. Owner: claude-contracts.

**F10. LOW. Notes for consumers of contracts.ts.**
- `capitalMarketAbi` has none of ClaimToken's errors, so viem can't decode `ERC7943CannotReceive` or `TooManyHolders` when it simulates `fundWithAuthorization`. Merge them: `[...capitalMarketAbi, ...claimTokenAbi.filter(x => x.type === "error")]`.
- No invoice status constants (0 None, 1 Open, 2 Paid, 3 Cancelled) and no USDT `authorizationState` fragment are exported.
- The AT-6 listing price formula (`face × 365 / (365 + apr × days)`, rounded down) isn't written anywhere a UI can reuse it (FR-INV-2).

Owner: claude-contracts (shared), claude-frontend and claude-relayer (usage).

## What changes for the other lanes (announce with F1)
- **claude-relayer**:
  - Allowlist (FR-REL-2): switch to 0x8eff… and 0xeadf….
  - `fund` now means `fundWithAuthorization` (same signature as §2). `acknowledge` and `register` don't exist; drop them.
  - `payInvoice` value = credited amount + `relayFee()`.
  - Gas cap: F2.
  - The ERC-1271 "reject payers with code" rule must cover **investors** in `fundWithAuthorization` too, since the investor is the USDT `from`.
- **claude-frontend**:
  - The web checkout still targets 0x83b5, which is now paused, so AT-1 and AT-2 on the web app fail until it moves to `addresses.merchantPay`.
  - The invoice pay page signs amount + `relayFee()`.
  - No acknowledge step on /pay (ARCHITECTURE §4 still lists one).
  - Offer checks: F7.

## NEEDS THE USER
1. **Fee on top for invoices** (a product rule, already live): a 100 USDT invoice costs the debtor 100.10. It is the simplest way a fully financed invoice can settle: with the fee inside, 0.10 of units could never be repaid. ARCHITECTURE §2 says otherwise, so the human has to approve it (PIPELINE §2, §11).
2. **"The last MerchantPay" freezes the Phase 5 contract items out.**
   - MerchantPay.setMarket and ClaimToken.setMarket are one-time, CapitalMarket.merchantPay is immutable, and ClaimToken.registry is immutable.
   - So `acknowledge` (FR-PAY-13), `markDefault`/`repay` (FR-ADV-7, FR-INV-6/7) and EAS (FR-KYC-2/3) each need **all four contracts redeployed**: new addresses and an ABI change after G3.
   - They are all C priority and on the cut list (#5, #6, #8). Confirm they stay cut, or plan one post-G3 redeploy.
   - For cut #5 "freeze only": no contract path freezes a defaulted claim. The admin's per-holder `setFrozenTokens` is the only stand-in.
3. **Admin powers**, also raised in Codex's opinion: the ClaimToken owner can force-transfer and freeze, and InvestorRegistry can revoke. Both use single-step `Ownable`; MerchantPay uses Ownable2Step. Disclose this in the README.
4. Tests came after the code for CapitalMarket and MerchantPay v2 (build NEEDS THE USER 2). In my judgement the suite plus the probe cases is strong enough to catch a broken split. F3 closes the remaining gaps.
