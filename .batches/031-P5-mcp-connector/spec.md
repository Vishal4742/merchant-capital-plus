# Spec: 031-P5-mcp-connector

## Requirements (cite docs/SRS.md IDs)
- FR-MCP-1: `packages/mcp`, a stdio MCP server on the official `@modelcontextprotocol/sdk`. Signs in with the merchant's
  own `sk_test_` key from `MCP_SECRET_KEY`; base URL `MCP_BASE_URL` (default https://merchant-capital.vercel.app). Calls
  only the public gateway API, through packages/sdk's `Gateway` client. The web app is unchanged.
- FR-MCP-2: tools `create_checkout` (amount, currency, description → hosted URL; POST /api/v1/sessions; no payment),
  `get_checkout` (id or URL → GET /api/v1/sessions/:id; status, amount, tx hash + explorer link once paid),
  `list_payments` (limit → GET /api/v1/payments, each with its explorer link), `sales_summary` (from, to → gross,
  refunded, net, count, computed from list_payments pages).
- FR-MCP-3: no merchant tool moves money, signs, refunds or touches keys, wallets or webhooks. Keys (sk_ and the payer
  key) never appear in tool output, errors or logs (one redact pass over every result). Inputs validated: amount a
  decimal string with at most 6 decimals, currency from the API's list (USDT, USD, EUR, GBP, INR, AED, SGD), description
  at most 40 characters (it becomes the reference), limit 1-100, dates YYYY-MM-DD. API errors come back as their plain
  reason.
- FR-MCP-4: packages/mcp/README.md gives one `claude mcp add` command (stdio, --env for both keys) and a Claude Desktop
  JSON block.
- FR-MCP-5: only when `MCP_PAYER_KEY` is set, `pay_checkout(url)` and `spending_report` are registered. pay_checkout
  takes the sale terms (merchant, orderRef, amount, expiry) from the hosted checkout page the gateway renders (the same
  terms the browser signs; GET /api/v1/sessions/:id carries no orderRef and needs the owner's key), never from the
  model; refuses a URL off MCP_BASE_URL's origin and a MerchantPay address other than packages/shared's; signs the
  same EIP-3009 ReceiveWithAuthorization as apps/web/lib/pay.ts saleAuthorization + lib/sign-sale.ts; POSTs
  {from, salt, validBefore, signature, amount} to /api/v1/sessions/:id/pay, never retried. Caps: 10 USDT per payment,
  25 USDT per UTC day (MCP_MAX_PER_PAYMENT / MCP_MAX_PER_DAY override, never above 100). An attempt is recorded before
  it is sent and counts against the day unless the gateway refused it (4xx). State: a JSON file under the user's
  config dir. spending_report lists each payment with its tx hash and explorer link.

## Acceptance criteria (cite AT-… where one exists; each must be checkable)
- [ ] AT-16 (offline part, mocked fetch): create_checkout returns the hosted URL; get_checkout returns Paid with the tx
      hash and its explorer link; list_payments includes it; no tool output contains the key.
- [ ] Payer tools are absent from tools/list without MCP_PAYER_KEY.
- [ ] pay_checkout refuses above the per-payment cap, above the day cap, and a cap env above 100; signs a signature
      that verifies against saleAuthorization's typed data for the page's terms.
- [ ] Key redaction: a gateway error that echoes either key comes back with "[redacted]".
- [ ] Input validation: bad amount, unknown currency, long description, bad limit, bad dates refused before any fetch.
- [ ] `npm run typecheck` and `npm test` pass in packages/mcp. No live payment in this batch.

## Files to touch (owner lane: only these)
- packages/mcp/** (package.json, package-lock.json, tsconfig.json, README.md, THIRD_PARTY_LICENSES, src/**, test/**)
- .batches/031-P5-mcp-connector/**

## Ponytail ladder (why this is the smallest change that works)
- Reuses packages/sdk `Gateway` (key scrub, timeouts, retries, redirect: "error") and packages/shared/contracts.ts
  (addresses, USDT domain, types, nonce params). viem for signing (already the repo's chain library). Pixa's layout,
  budget limiter and spending report, adapted to bigint USDT units and a persisted file. No build step: Node runs the
  TypeScript directly (Node >= 22.18).

## Out of scope
- Any apps/web change (a JSON sale-terms endpoint would be sturdier than reading the checkout page; web lane).
- CI and pre-push coverage for packages/mcp (tools/ and .github are other lanes' files).
- A live payment.
