VERDICT: PASS

Scope: API-only. `git status --short` shows changes only under apps/web/app/api/v1/ (new dirs), lib/server, db, test, package files. Nothing under apps/web/components, no page outside app/api/v1.

Checked every `fail(...)` and `HttpError(...)` string in apps/web/lib/server/*.ts and app/api/v1/**/route.ts.

Good:
- No SQL, stack, "null", or status-code jargon reaches the caller. The 500 is "Something went wrong on our side. Try again." and the DB-down 503 is plain (http.ts:35-37).
- No message blames the user. Typical: "Wait a minute and try again.", "Nothing was charged.", "Revoke one first.", "Delete one first."
- Payer-facing strings (public/links, public/pages, quotes, vouchers, cart errors in pages.ts, links.ts 410) use none of sign, gas, wallet, chain, WBT (FR-PAY-7, NFR-6). Examples: "This payment link is {status}.", "No such payment page.", "\"X\" is in the cart twice.", "Exchange rates are unavailable right now. Price in USD or USDT, or try again in a minute."
- Amounts are described in USDT with 1 to 1,000 bounds and 2-decimal examples ("25.00").

LOW (not blocking, optional):
1. Validation messages lead with raw field names (`value must be...`, `max_redemptions must be...`, `open_amount.min must not be above open_amount.max.`, `items[0].name is required.`) in vouchers.ts, pages.ts, http.ts. The dashboard should map these to labels, or the copy should say "Voucher value" etc. Owner: backend (copy) or frontend (field mapping).
2. pages.ts:137-138 "amount must be at least 5.00 EUR" is shown on a customer checkout. Prefer "Enter at least 5.00 EUR." Owner: backend.
3. settlements.ts:14 "The wallet balance isn't available right now." is merchant-facing, so it's fine today. Don't surface it on a payer page. Owner: backend.
4. webhooks/dispatch 401 "Missing or wrong cron secret." is machine-to-machine, fine.
