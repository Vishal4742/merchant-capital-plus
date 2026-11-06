VERDICT: PASS

Security review, batch 026-P5-holder-caps, round 1 (reviewer-security, 2026-11-06). Diff: `git diff origin/main...HEAD -- apps/web/lib/server/capital.ts apps/web/lib/server/capital-fund.ts apps/web/test/capital-fund.test.mjs apps/web/test/capital-core.test.mjs` (commits 03f5344, 936808b). Read against contracts/src/ClaimToken.sol, contracts/src/CapitalMarket.sol, contracts/src/MerchantPay.sol, apps/relayer/src/relayer.ts and the 009 fork gas table (.batches/009-P5-holder-gas-seed-ui/round-1/ci.md).

No HIGH or CRITICAL finding. Both enforcement points do what the spec says. Three MEDIUM items, one LOW and some INFO notes go under FOLLOW-UP. None of them moves money, and in each one the relayer refuses before any tx exists.

## Enforcement points

**`fundOffer` (capital-fund.ts:43-46)**
- *Case-insensitive compare:* correct. Both sides are lowercased. `f.investor` has already been through `getAddress` (capital.ts:205-207), and viem returns `holdersOf` entries checksummed.
- *Existing holder topping up:* allowed, and that's safe. The exemption applies only to `f.investor`, and the investor is bound three times: by the EIP-712 check (capital-fund.ts:52-54), by the relayer's signer check (relayer.ts `localChecks`), and by `receiveWithAuthorization(investor, …)` inside `fundWithAuthorization`, which mints to that same `investor` (CapitalMarket.sol:176-201). Claiming to be a holder gets you nothing without that holder's signature.
- *Live count:* `holdersOf` drops a holder once its balance reaches 0 (`_move` → `_removeHolder`, ClaimToken.sol:210-216, 238). Repayment burns never add a holder, so the count is the live one.
- *Fail closed:* if the `holdersOf` read fails, the error goes up before any relay (and becomes a 500 through `handle`).
- *Order:* the cap check runs before the quote, the signature check and the relay. The 409 reveals only the holder count, which is public on chain anyway.
- *Kinds:* `HOLDER_CAP[offer.kind]` is always defined, because `readOffer` returns null for anything other than kind 1 or 2 (capital.ts:62-69), and the null case 404s at :38.

**`transferCheck` (capital.ts:161-164)**
- The `fits` formula matches the contract's own semantics: `_move` runs `super._update`, removes `from` once its balance is 0, then adds `to` (ClaimToken.sol:210-216; same shape as `_fitsHolderCap`, :263-266).
- *Whole-position transfer:* `amount === balance` is allowed and the count stays the same (A out, B in). With frozen units, a whole-position send is refused first at :159, and the contract refuses it too.
- *Receiver already a holder:* `toBalance !== 0n` is allowed, and the count stays the same.
- *Self-transfer (from == to):* `toBalance == balance != 0` is allowed, and the count stays the same.
- *Partial send to a new receiver at the cap:* refused with the per-kind message. For an advance this happens at 1 holder (the test covers it), for an invoice at 2.
- *`offer` null at :164 skips the product cap:* this can't happen for real units. Only the market mints, and `_prepareFunding` refuses kind 0 (CapitalMarket.sol:299-301).
- *Already over the cap* (an advance funded with 2 holders before this batch): partial sends to new holders are refused, and whole-position sends or sends to an existing holder are allowed. No transfer can raise the count.

**Product paths to a 2-holder advance.** This worktree's apps/web has no transfer UI: no `safeTransferFrom` caller, and SRS AT-8 says "the demo ships no Send button". So every transfer is a direct wallet call (out of scope), and `/transfer-check` is advisory only. Within the product, the only remaining way is the concurrency window in `/fund`. That is M2.

## Tests run
`node --experimental-strip-types --test test/capital-fund.test.mjs test/capital-core.test.mjs` from apps/web: **18 pass, 0 fail**. That includes "an advance takes 1 investor…" and the transfer cases for both kinds. The lane reports capital tests 30/0, web 547/0, typecheck and eslint.

## Secret scan
`grep -nE --exclude='.env*' '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the 4 code files plus the batch's spec.md and batch.md: **1 hit**, capital-fund.ts:71 `process.env.RELAY_API_SECRET`. That is the env var name, on a pre-existing line. **Lines added by the diff: 0 hits.** The tests build keys at runtime with `generatePrivateKey()`, and `"s3cret"` is a dummy value. No key, token or mnemonic.

## FOLLOW-UP

### M1 (MEDIUM, new with the 1-holder cap): one small funding locks a merchant's advance against every other investor
- **Where:** capital-fund.ts:43-46 (cap), :51 (1 USDT minimum); CapitalMarket.sol:158 (`cancelOffer` needs `sold == 0`), :113 (`AdvanceActive`), :349 (settles only when supply reaches 0); for invoices :135 (`claimOfInvoice` blocks a relist).
- **Scenario:** a merchant lists a 100 USDT advance. Verified investor X funds the 1 USDT minimum through `/fund`, so `holdersOf = [X]`. Every other investor now gets a 409 (only after signing, see L1). The merchant can't cancel (the offer is already funded) and can't list a new advance (`AdvanceActive`) until X's ~1.1 USDT of face has been repaid out of sale holdbacks. X earns the advance's yield and can do the same to the relisted advance, so the attack pays for itself and can be repeated. An honest investor trying the product with 5 USDT causes the same lockout by accident. That is the more likely case in a demo. For invoices (2 slots, already true since 022), two small fundings lock the invoice for good: it can't be cancelled or relisted, and it stays financed at that fraction.
- **Fix:** when a new investor would take the last free slot (`holders.length == HOLDER_CAP[kind] - 1` and the investor isn't a holder), require `f.units == offer.face - offer.sold`, so the last slot buys everything left. For an advance this means one investor funds the whole advance at once (AT-3 already does that). This changes product behaviour, so it needs a human/claude-research decision. The UI must then quote "all remaining units" for that slot.
- **Owner:** claude-relayer (capital-fund.ts), claude-frontend (Buy amount), with sign-off from the human/claude-research.

### M2 (MEDIUM): two concurrent fundings of a fresh advance both pass the cap and leave 2 holders
- **Where:** capital-fund.ts:43-44 (the check reads chain state at request time); relayer.ts:421-433 (the in-lock re-simulation passes because ClaimToken allows 8 holders), :193/:498 (`serialized`).
- **Scenario:** an advance is listed and two investors press Buy within a few seconds of each other. Both web requests read `holdersOf = []` and both are relayed. The relayer sends A, waits for its receipt, then re-simulates B on fresh state. That passes, so B is sent too, and the advance now has 2 holders. From the 009 table, a sale that clears the advance with both holders at 0 USDT needs **420,381 gas**. Once the amount still owed is below one sale's holdback, every gasless sale for that merchant clears it, and the relayer refuses each one with 422 `too_much_gas` before any tx exists. The web still maps that to "That approval didn't work… please try again" (capital-fund.ts:90 and lib/relay.ts; fix 2 from 022 M1 is still open), so the customer retries forever. Recovery needs one holder to send its whole position to the other (transferCheck and the contract allow it), or a sale paid without the relayer. The window is web read → relayer receipt, about 2-4 s (Ankr round trips of 0.65-1.15 s, 1 s blocks), and longer if Ankr serves a lagging node. A fresh listing, when two investors are most likely to act together, is exactly when it opens. The top-up exemption has the same race: holder A's top-up passes the web check, A then sends its whole position to B from its wallet before the mint lands, and the result is `[B, A]`. 022 accepted the invoice version (it needed 3 holders). For advances, two first fundings are now enough.
- **Fix:** re-check the cap in the relayer inside `send` (the serialized section) for `fundWithAuthorization`. Read `offers(claimId).kind` and `holdersOf(claimId)` in the existing simulate/nonce round, and refuse with `holder_cap` if the investor isn't a holder and the count is at the per-kind cap. The lock is held through the receipt (relayer.ts:450) and there is one relayer process (:189), so the second request sees the first one's mint. That closes the product path. Map `holder_cap` to the 409 message in `relayFunding`. Keep the caps in one place (packages/shared) so web and relayer can't drift apart.
- **Owner:** claude-relayer.

### M3 (MEDIUM, carried over from 022 M1, still unmeasured): a payInvoice can pay both claims in one tx, and the per-kind caps don't cover that
- **Where:** CapitalMarket.sol:213-229 (`onPayment` distributes to the invoice claim, then sends `remaining` through the merchant's advance lien); MerchantPay.sol:156-157 (net = credited amount).
- **Scenario:** an invoice offer passes its deadline only partly sold (2 holders), and its merchant has a running advance (1 holder). The debtor's payInvoice pays the invoice holders their units, and the rest goes through the advance in the same tx. The caps were measured one kind at a time. 2 invoice holders at 0 USDT already need 397,900 gas, which is 2,100 under the cap, so any advance routing on top almost certainly goes past 400k. The result is a 422 with no tx, and that invoice can't be paid gaslessly. A fully-sold invoice (AT-6/AT-7) leaves `remaining == 0` and isn't affected. So the spec's claim that every claim stays repayable under 400k doesn't hold for this combination.
- **Fix:** claude-contracts measures "partly-sold invoice, 1 and 2 holders, plus a 1-holder advance, holders at 0 USDT". If it's over, add a product rule, for example: while the merchant has an open advance, an invoice takes 1 holder, or an invoice is financed only if it is fully sold.
- **Owner:** claude-contracts (measurement), claude-relayer (rule).

### L1 (LOW): the book doesn't show that an advance is taken, so other investors sign and only then get the 409
- **Where:** capital.ts:86-91, 112-113 (`status: "open"` and `units_left > 0` for an advance whose one slot is taken).
- **Scenario:** the Capital UI offers Buy on a taken advance. The investor signs a ReceiveWithAuthorization, valid for up to 15 min, and gets a 409. No money moves: the request is refused before the relay, and only `CapitalMarket.fundWithAuthorization` can redeem that signature, on exactly the signed terms. But it teaches users to sign things that fail, and the signed authorizations stay valid until they expire.
- **Fix:** add `holders` or `open_to_new_investors` to `offerJson`, and disable Buy for non-holders when it's false.
- **Owner:** claude-relayer (API), claude-frontend (UI).

### INFO
- apps/web/components/landing/Sections.tsx:260: the advance card still says "640.00 of 1,000.00 funded · 3 investors", which contradicts the 1-investor cap. Owner: claude-frontend.
- Testnet state: `/fund` didn't cap advances until this batch. Before G5, sweep `holdersOf` (read-only) for every open advance. Any advance with 2 or more holders needs one holder to send its whole position to another before its clearing sale. Owner: claude-relayer or claude-contracts.
- `forcedTransfer` (owner-only, ClaimToken.sol:108-120) keeps only the 8-holder cap. The compliance runbook should move whole positions on advances. This is a direct call and out of scope.
- Test gap: no test has a mixed-case `holdersOf` entry (fixtures use the same checksummed `INVESTOR` as the body). The code is correct as written. A lowercase holder entry would pin it. Owner: claude-relayer, optional.
