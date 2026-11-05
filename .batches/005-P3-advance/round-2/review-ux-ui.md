VERDICT: PASS

Scope: contracts-only batch. `git diff --stat 444e7aa..HEAD | grep -c apps/` returned 0, so no UI changed in the round-2 delta. No screenshots apply. The round-1 review (`/Users/vg890/ethglobal-contracts/.batches/005-P3-advance/round-1/review-ux-ui.md`) still stands, including its copy rules and error table. This round adds one row.

## Addition to the error copy list

| Error | Who sees it | Plain copy | Next action |
|---|---|---|---|
| CapitalMarket MerchantCannotFund | Merchant (acting as investor) | "You can't fund your own offer. Share it with an investor instead." | Hide or disable the fund button on the merchant's own offers. Check the connected account against the offer's merchant before enabling it, so the revert is only a fallback. |

Same rules as round 1: never show the error name, an address or "revert". This copy appears only in the merchant and investor views, never on `/pay` (FR-PAY-7).
