VERDICT: PASS

No UI in this batch (relayer API only). API-contract check for claude-frontend:

- Error codes are distinct and stable, so the pay page can map each to plain text with no crypto words (FR-PAY-7, NFR-6):
  - 429 rate_limited: "Too many attempts, try again in a bit."
  - 422 payer_banned: "This payment can't be processed from this account. Contact the merchant."
  - 503 breaker_open / budget_exhausted / paused: "Payments are briefly unavailable. Nothing was charged. Try again later."
  - 401 unauthorized is server-to-server only. The web server must never show it, and should map it to the generic "Something went wrong" state.
- Suggestion, not blocking: add a Retry-After header on 429 and 503 so the page can show a wait time.
- /health gasSpentToday and budgetLeft are WBT strings. That is fine for the merchant "who pays gas" panel (FR-REL-6), but the frontend must format them itself. Costs shown to the customer stay in USDT.
