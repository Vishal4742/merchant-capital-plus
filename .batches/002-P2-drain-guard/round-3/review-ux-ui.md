VERDICT: PASS

No UI in this batch. API-contract check against claude-frontend's mapping (replay = locked; other 422 = unlock with plain reason; 503 = retry later; 502 = locked and poll): consistent, with one note.

- Codes are stable and jargon-free as keys. The UI owns the copy, so FR-PAY-7 / NFR-6 hold if it maps `code` and never shows `error` (developer text).
- Suggested plain copy: below_minimum "Minimum payment is 1.00 USDT"; insufficient_funds "Not enough USDT in this wallet"; payer_has_code / bad_signature "This wallet can't be used here, try another"; not_yet_valid / expired / window_too_long / 400 = client bug, "Something went wrong, please try again" (re-sign); gas_price_cap 503 "Busy right now, try again in a minute"; replay "Payment already submitted, checking it"; 502 with txHash "Confirming your payment" (poll, show explorer link when done); reverted / receipt_mismatch (with txHash) "Payment didn't go through" after the poll settles.
- 403/413/415 are not reachable from the pay page; treat as generic error.
- 502 rule is clear in spec L34: no txHash = nothing sent, safe to re-POST (auto-retry once, then plain error); txHash = poll, never re-POST.

Note (LOW, owner claude-frontend, no spec change needed): the concurrent same-authorization case may return 422 `replay` OR 422 `would_revert` (spec acceptance). A `would_revert` can therefore hide a payment already in flight. The pay page should, before unlocking on `would_revert`, treat the checkout as locked if it already POSTed this authorization (double-click, retry), or re-check order status first. Otherwise a second sign could be offered while the first is pending.
