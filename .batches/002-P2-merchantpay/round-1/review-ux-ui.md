VERDICT: PASS

# UX/UI review: 002-P2-merchantpay, round 1

No UI in this batch. Checked, not assumed: `git diff --stat 44772c7..HEAD` lists 10 files, all under `contracts/` (src, test, script, foundry.toml, broadcast records) plus `packages/shared/merchantPay.ts`. `git diff --name-only 44772c7..HEAD | grep -c '^apps/'` returns 0. No page, component, style or public copy changed. `round-1/test.md` agrees (shots empty on purpose). Nothing to screenshot, so no findings on layout, tokens, focus or states.

## Advice for claude-frontend: error names to customer copy

Contract errors never reach the customer raw. The web app maps them to plain words (FR-PAY-7, NFR-6). All ten can be mapped with no crypto words, so none forces CHANGES.

| Error | Customer can see it? | Suggested copy |
|---|---|---|
| WrongAmount | Yes. Pay page, if the invoice amount changed or a sale is under 1.00 USDT | "This amount can't be paid. Check the total with the merchant." |
| InvoiceNotOpen | Yes. Opening an already paid or cancelled invoice link | "This invoice has already been paid or was cancelled." Show as an empty or closed state, not an error toast |
| OrderPaid | Yes. Double tap, or a second device paying the same order | "This order is already paid." Show the success receipt if the payer is the same person |
| EnforcedPause | Yes, during an emergency pause | "Payments are paused for a moment. Try again shortly." |
| InvalidOrder | Unlikely. Only if the QR/link is malformed | "This payment link isn't valid. Ask the merchant for a new one." |
| ZeroAddress | No. Deploy or owner config only | Generic fallback |
| InvalidDueDate | No. Merchant creating an invoice (merchant UI) | Merchant copy: "Pick a due date in the future." |
| NotMerchant | No. Merchant refund screen, only if the wrong wallet is signed in | Merchant copy: "Sign in with the account that received this payment." |
| RefundTooLarge | No. Merchant refund screen | Merchant copy: "You can refund up to X.XX USDT on this payment." Compute the remaining amount before submit so the error rarely appears |
| FeeTooHigh | No. Owner only | Generic fallback |

Also customer-visible, but from the USDT token, not MerchantPay: `TetherToken: invalid signature` and expired or used authorization. Map these to "This payment link expired. Go back and try again." Do not show the raw string.

Notes:
- Add one catch-all: "Something went wrong. You were not charged." Only say that when the tx did not confirm. Never show hashes, "revert", "gas" or a chain name to the payer.
- Amounts in copy must be USDT with 2 decimals (6-decimal token: format `n / 1e6` to `toFixed(2)`), with tabular numbers.
- Merchant-side messages may use the word "USDT" and an explorer link. The advance cost rule (FR-ADV-6) is not in this batch.
- Customer error states still need the full set at build time: loading, empty/closed, error, pending, success.
