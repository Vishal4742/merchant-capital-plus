VERDICT: PASS

Scope: contracts-only batch. `git diff --stat f28c502..HEAD | grep -c apps/` returned 0, so no UI changed. No screenshots apply. Nothing to fail on UX. The rest is advice for claude-frontend.

## Rules for the copy
- Customer pay flow (FR-PAY-7): never show these errors there. A customer paying an invoice that is financed still pays normally. Only the merchant and investor views map them.
- Never show the error name, an address or "revert". Show the plain sentence plus one next action.
- Amounts are USDT with 2 decimals and tabular numbers.
- FR-ADV-6: before the merchant signs, show principal, total cost (cap minus principal), holdback and term. Do this from the same terms the contract checks, so BadTerms is rare.
- FR-TOK-8: run the checks (`canSend`, `canReceive`, unfrozen balance, `_movable`) as view calls before the button enables. Show the reason inline under the button. The revert copy below is the fallback.

## Error copy (merchant and investor views)

| Error | Who sees it | Plain copy | Next action |
|---|---|---|---|
| BadTerms (advance: `principal == 0`, `cap < principal`, holdback 0 or over max, `term == 0`, deadline in the past) | Merchant | "These terms don't work. Check the amount, the total repayment (it must be at least the amount you receive), the holdback and the deadline." | Highlight the offending field. Prevent in the form. |
| BadTerms (invoice sale: `price == 0`, `price >= amount`, bad recourse, deadline too late) | Merchant | "The sale price must be below the invoice amount, and the offer must close at least a day or so before the due date." Use the real LOCK_WINDOW value. | Same. |
| AdvanceActive | Merchant | "You already have an open advance. Repay or close it before asking for another." | Link to the open advance. |
| InvoiceNotListable | Merchant | "This invoice can't be sold. It is already paid, closed, or already offered." | Hide the sell button for those states. |
| OfferClosed | Investor, merchant | "This offer is closed. It was cancelled, finished, or its deadline has passed." | Back to open offers. |
| AlreadyFunded | Merchant | "Someone has already funded this offer, so you can't cancel or change it." | Show who and how much funded. |
| WrongUnits | Investor | "Pick a whole amount between 1 USDT and what is still available." Show the remaining amount. | Clamp the input to the remaining amount. |
| NothingOwed | Investor, merchant | "Nothing to collect yet." | Disable the collect button when owed is 0. |
| ERC7943CannotSend | Investor | "Your account is blocked from sending this claim." | Show a support line. |
| ERC7943CannotReceive | Investor (sender view) | "That account can't receive this claim." | Pick another recipient. |
| ERC7943CannotTransfer | Investor | "This claim is locked right now and can't be moved." If it is the lock window, say "Transfers pause close to the due date." Show the date. | Show when it unlocks. |
| ERC7943InsufficientUnfrozenBalance | Investor | "Part of your claim is frozen. You can move up to X USDT." Use the `unfrozen` value. | Prefill the max movable. |
| TooManyHolders | Investor (receiver or buyer) | "This claim has reached its limit of holders. Ask the seller to send it to an existing holder." | Disable the buy or transfer button. |
| MerchantPay InvoiceFinanced | Merchant | "This invoice is financed, so it can't be changed or cancelled until the advance is repaid." | Link to the advance. |

## Notes
1. InvoiceFinanced is reached from a merchant action on MerchantPay (line 125). It must never appear on `/pay`. Check how the pay page handles a financed invoice and keep it free of this error.
2. The error list has no pending-tx or explorer copy. Frontend still needs the pending, success and explorer-link states for sign, fund and collect (batch UI round later).
3. Two different reverts map to BadTerms (advance and invoice sale). Use two copy variants, chosen by which call was made.
4. The constructor `BadTerms` (zero address) is deploy-only. No copy needed.
