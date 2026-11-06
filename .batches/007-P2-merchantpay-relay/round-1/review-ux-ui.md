VERDICT: PASS

No UI in this batch. Short API-contract check against spec.md Interface:

- 200 fields (paymentId, gasUsed, gasCostWei): the customer pages need only txHash/paymentId for the receipt and explorer link. gasUsed/gasCostWei are merchant/operator data and must stay off customer screens (FR-PAY-7).
- 422 codes map to plain states, each a distinct code the pages can switch on:
  - order_paid: "This order or invoice is already paid."
  - wrong_amount: "The amount doesn't match. Reload and try again."
  - bad_merchant: "This payment link isn't valid." (no crypto words)
  - Pages must not show the raw code or revert name.
- Invoice: the payer signs amount + relayFee. The invoice page can show this as "Total to pay" with the fee as a line item, or fold it in. It needs the fee before signing, so the API or shared package should expose relayFee (single-flight read, cached 60 s). Display in USDT, 2 decimals, tabular numbers.
- Note for claude-frontend: the invoice remainder may be under 1 USDT, so the page must not apply the sale minimum there.
