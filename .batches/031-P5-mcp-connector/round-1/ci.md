# CI: 031-P5-mcp-connector, round 1

Run 2026-11-06 in the batch worktree (branch p5-mcp-connector), Node v26.10.0, after `rm -rf node_modules && npm ci`
in packages/mcp. No live payment: every test uses a scripted fetch.

## packages/mcp: npm run typecheck

```
> @merchant-capital/mcp@0.1.0 typecheck
> tsc --noEmit

typecheck exit=0
```

## packages/mcp: npm test (node --test test/)

```
✔ without MCP_PAYER_KEY only the four merchant tools exist: nothing pays, signs, refunds or edits keys (FR-MCP-3, FR-MCP-5)
✔ with MCP_PAYER_KEY the payer tools are added
✔ a payer-only server has no merchant tools
✔ startup refuses bad config, and the error never repeats the key
✔ create_checkout posts the checkout with the secret key and returns the hosted URL; no payment (FR-MCP-2, AT-16)
✔ create_checkout validates before any request: amount format, currency list, description length (FR-MCP-3)
✔ get_checkout takes an id or the hosted URL; once paid it gives the tx hash and its explorer link (FR-MCP-2, AT-16)
✔ get_checkout refuses a URL on another site and a malformed id, before any request
✔ list_payments passes the limit and links each tx; a bad limit is refused (FR-MCP-2, FR-MCP-3, AT-16)
✔ sales_summary pages through payments and sums gross, refunded and count for the dates, inclusive (FR-MCP-2)
✔ sales_summary refuses bad dates before any request
✔ API errors come back as their plain reason, naming MCP_SECRET_KEY, with the key scrubbed (FR-MCP-3)
✔ a network failure is a plain reason without either key (FR-MCP-3)
✔ the checkout page parser reads the sale terms from the live page's flight data
✔ pay_checkout signs exactly the browser's sale authorization and posts it once (FR-MCP-5)
✔ the approval never outlives the checkout
✔ refuses a payment above the per-payment cap (default 10 USDT) before signing (FR-MCP-5)
✔ refuses a payment that would pass the day cap (default 25 USDT); the report shows what was spent (FR-MCP-5)
✔ the day resets at UTC midnight, and the spending file survives a restart
✔ caps can be lowered or raised by env, never above 100 USDT (FR-MCP-5)
✔ refuses a checkout URL on another site, and a page naming another MerchantPay, before signing
✔ refuses a paid, pending or nearly expired checkout before signing
✔ a refusal (4xx) is not counted; an unknown outcome (5xx, no answer) is counted and never retried (FR-MCP-5)
✔ a concurrent second call waits for the first, so two payments can't both slip under the day cap
✔ a corrupt spending file stops payments instead of resetting the budget
ℹ tests 25
ℹ pass 25
ℹ fail 0
test exit=0
```

## stdio smoke (initialize + tools/list, fake sk_test_ key, no network)

```
1 {'name': 'merchant-capital', 'version': '0.1.0'}
2 ['create_checkout', 'get_checkout', 'list_payments', 'sales_summary']
stderr: (empty)
no key: "merchant-capital-mcp: Set MCP_SECRET_KEY (your sk_test_ key) for the merchant tools, and MCP_PAYER_KEY only
to let the assistant pay checkouts." exit=1
```

## Other checks

- `npm audit --omit=dev`: found 0 vulnerabilities (zod 4.6.7; 3.25.x has GHSA-mrhx-c7xc-m3w5).
- CI secret-scan pattern over tracked files: no match.
- Parser checked against a real checkout page: an unpaid 6 USD checkout opened from the public demo page
  /p/egAwjNvIhu (no payment), saved as test/fixtures/checkout-live.html.

## Not covered by this file

- tools/githooks/pre-push and .github/workflows/ci.yml have no packages/mcp job: a packages/ change runs only the web
  checks there, never this package's typecheck and tests (other lanes' files, not edited).
- AT-16's live half (Claude Code + a real paid checkout + the explorer) needs the human's sk_test_ key.

VERDICT: PASS
