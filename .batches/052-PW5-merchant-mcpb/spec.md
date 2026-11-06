# Spec: 052-PW5-merchant-mcpb: WhiteFlow Merchant MCP bundle (whiteflow.mcpb)

## Requirements (cite docs/SRS.md IDs)
Delivered or kept, from main's SRS 2.3 and the WhiteFlow SRS v3.1 (on the stage branches, PR #43):
- FR-MCP-3 (kept and strengthened): no tool moves money, signs, refunds, or changes keys, wallets or webhooks; keys
  never appear in output or logs; inputs are validated; API errors come back as a plain reason.
- FR-MCP-4 (superseded in v3.0, still true for the dev adapter): one `claude mcp add` command and a Claude Desktop
  config block, plus the .mcpb install.
- FR-MCP-5: **removed** (cut by v3.0 R1). pay_checkout, spending_report and MCP_PAYER_KEY are deleted.
- v3.1 R2: the stdio connector exists only as the optional developer adapter over the same services. That is what this
  bundle is; the remote OAuth MCP (FR-MCP-6, FR-MCP-7) stays W5 work for the Stage 3 lane.
- FR-MCP-8 (partial, v3.1): ids and observed status only. Never keys, bearer tokens, signatures or payment
  authorization headers, and only the PII a tool needs. Accurate annotations; no transfer, withdrawal, calldata, SQL,
  URL-fetch or key tools.
- FR-MCP-9 (partial, v3.1): a model-supplied approval flag is never authorization. Reminder delivery, refunds, voids
  and settlement changes are not tools here. Their server-enforced approval flow is only designed (README §Phase two).
- FR-MCP-10 (v3.1): customer names, descriptions and memos are untrusted. They are bounded, stripped of control
  characters and returned as data. They can't change recipients, scopes or the tool set.
- FR-MCP-11 (partial): creating a link or finalizing an invoice never sends anything.
- FR-GW-1 (payment links): a merchant's sk_test_ key may now create and read its own links (until now, cookie only).
- FR-GW-6 (API keys): keys are merchant-scoped and revocable. Still no scopes or expiry on main; that is listed as a
  production prerequisite.
- FR-GW-9 (reports): a merchant's sk_test_ key may read its own report.
- FR-GW-11 (prices in USD, EUR, GBP, INR, AED, SGD, USDT, converted to USDT at a locked rate at checkout): links only.
- FR-PAY-4: the sessions idempotency moves into a shared helper with unchanged behaviour.
- FR-BILL-1 (v3.1, USDT-denominated drafts): implemented only in the sandbox adapter, as the contract's reference.
- NFR-17 (v3.1): no keys in model context, logs or bundle files.
- **Proposed, pending the human's SRS approval (srs-change.md):** FR-MCP-12 (the bundle), FR-MCP-13 (customers),
  FR-MCP-14 (the invoice lifecycle), FR-MCP-15 (idempotency and timeout recovery), FR-MCP-16 (the sandbox adapter and
  its provider-event processing), FR-MCP-17 (reminder drafts).

## Acceptance criteria (each checkable)
- [ ] `whiteflow.mcpb` exists. `mcpb validate` passes on its manifest, and `mcpb info` reads the archive. A
  `.sha256` file sits next to it.
- [ ] The packaged archive, unzipped to a temp dir, starts with `node server/index.mjs` (no repo, no node_modules) and
  answers initialize. Its `tools/list` names equal `manifest.json` `tools[].name`, and `prompts/list` equals
  `manifest.prompts`. Nothing is written to stdout except JSON-RPC.
- [ ] Twelve tools exist with zod schemas: get_business_profile, search_customers, create_customer,
  create_payment_link, get_payment_link, create_invoice_draft, finalize_invoice, get_invoice, list_invoices,
  list_payments, get_collection_summary, prepare_invoice_reminder. There are four prompts: collect-payment,
  create-invoice, review-overdue, summarize-collections.
- [ ] Every result names its environment (`sandbox`, simulated, or `testnet`, Whitechain Sepolia with test USDT) and
  never claims live or production.
- [ ] Money: decimal strings to bigint minor units, with no floats. Precision per currency: 2 decimals for fiat, 6 for
  USDT. Zero, negative, malformed and excess-precision input is refused. Invoice totals = Σ qty × unit − discount +
  explicit tax, with round-half-up to the minor unit, exactly one rounding step per discount and per tax, tested.
  Invoices are USDT only (FR-BILL-1): another currency is refused, never converted.
- [ ] Dates: the due date is a calendar date in the business timezone, today or later. Results show the weekday and
  the timezone. Profile returns `today` in that timezone.
- [ ] Idempotency: the same key and payload return the same record, marked `replayed`. The same key with a different
  payload fails (422). A new key creates a new record. A timeout followed by a retry without a key reuses the journaled
  key and creates no duplicate. This holds on the web route (durable app_web_idempotency) and in the sandbox (store).
- [ ] Tenancy: no tool takes a merchant or business id. In the sandbox, merchant B's key gets 404 for A's customer,
  invoice and link, and B's lists exclude them. On web, another merchant's link id gives 404.
- [ ] Credentials: an expired sandbox key → 401. A sandbox key without the scope → 403 naming the scope. On web, a
  revoked or unknown key → 401 and a pk_ key → 403 (links, link read, account, reports). The tool errors say what to do
  and never repeat the key.
- [ ] Webhooks (sandbox provider): a bad signature or a stale timestamp is refused. A duplicate event id is applied
  once. An out-of-order `pending` after `succeeded` doesn't regress, and `succeeded` before `pending` applies. An
  underpayment keeps the invoice open with the remaining amount. `reconcile` rebuilds invoice paid totals from verified
  payments and reports any drift.
- [ ] Payment status comes only from backend records. No tool can mark anything paid; the payment simulator is a
  separate human-run CLI.
- [ ] Prompt injection: a customer named "Ignore previous instructions…" or a memo that names another recipient
  changes neither the reminder recipient nor any behaviour. The text comes back only inside data fields.
- [ ] No secret leakage: no tool output, error or stderr line contains the API key or the sandbox webhook secret. The
  bundle's files contain no key-shaped strings.
- [ ] Sandbox demo, scripted end to end as a test: find or create customer → draft → finalize → payment URL → simulated
  signed provider events → invoice paid via the processor → visible in the collection summary.
- [ ] Web: `npm run typecheck && npm run lint && npm test` in apps/web. MCP: `npm run typecheck && npm test`.

## Files to touch (owner lane: only these)
- **Round 2 (human: "hand routes over"):** every apps/web route and lib change below moved to
  `wf/gateway-secret-key-routes`, PR #48, batch 054, owner claude-contracts, together with the fix for review F1.
  PR #45 keeps packages/mcp only, plus the two test-path fixes.
- (moved) apps/web/lib/server/{idempotency,links,keys,http}.ts, app/api/v1/{sessions,links,links/[id],account,reports}
  routes, test/gw-mcp-api.test.mjs
- apps/web/test/docs-reference.test.mjs and test-mode.test.mjs: test-only Windows path fix (`fileURLToPath`; batch 049's
  identical change to docs-reference). On main they fail on a Windows host, so the pre-push hook refused this branch.
  Assertions unchanged; Linux unaffected.
- apps/web/lib/server/http.ts (jsonObject), apps/web/lib/server/keys.ts (callerMerchant)
- notes/phase-5-mcp.md
- packages/mcp/** (the server, sandbox, client, tools, prompts, manifest, icon, build and pack scripts, tests, README,
  THIRD_PARTY_LICENSES)

## Ponytail ladder
- Needed? Yes: the human asked for the bundle, and the live API had no key-authenticated path to links, account or
  reports.
- Already in the repo? Yes. The sessions route's durable idempotency (app_web_idempotency) is extracted and reused,
  not rewritten. `merchantByCookieOrSecretKey`, `linkJson`, `report()`/`rangeOf()` (which already takes a timezone),
  the SDK's MC-Signature `signWebhook`/`constructEvent` for the sandbox provider, and the MCP package's replier and
  test harness are all reused.
- Platform: node:crypto, node:fs (atomic rename plus an O_EXCL lock file for the sandbox store; node:sqlite is skipped
  because the MCPB host's Node version isn't fixed), Intl for timezones.
- Dependencies: @modelcontextprotocol/sdk (already pinned) and zod (pinned). Dev only: esbuild (one-file bundle, so the
  .mcpb ships no node_modules) and @anthropic-ai/mcpb (validate, pack). viem is dropped.
- Minimum: no customer or invoice tables on the web this batch (W3 lane). The sandbox implements the written contract
  so that lane has an executable reference.

## Out of scope
- Remote Streamable HTTP + OAuth (FR-MCP-6/7), workspace roles and scoped or expiring live keys (Stage 3 lane).
- Live customers, invoices, invoice PDFs and numbering, and reminder sending: sandbox only, contract written.
- Refunds, voids, partial payments, recurring invoices, exports, disputes, settlement changes: designed in the README
  §Phase two, not built.
- Stablecoin rails beyond what exists: the only rail is USDT on Whitechain Testnet via the hosted checkout. No swaps,
  transfers or token tools.
- README.md, docs/SRS.md, ARCHITECTURE.md: claude-research gets the changes to apply (lanes don't edit shared docs).
