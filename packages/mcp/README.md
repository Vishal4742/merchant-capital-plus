# Whiteflow Merchant MCP

Manage payment collection by asking your AI assistant: create payment links and invoices, check whether they're paid, see what's outstanding, and draft reminders. It's a local MCP server (stdio), packaged as **`whiteflow.mcpb`** for MCPB clients such as Claude Desktop, with a manual config for other clients.

> **Not production.** It runs in one of two modes, and every result says which:
> - **Sandbox** (the default): a simulator on your computer. No account, no network, no real money. URLs on `sandbox.whiteflow.invalid` don't open.
> - **Testnet**: the Whiteflow gateway on Whitechain Testnet with your `sk_test_` key. Test USDT only. Payment links, payments and collection summaries are live once the gateway routes in [PR #48](https://github.com/Vishal4742/whiteflow/pull/48) are deployed. Customers, invoices and reminders are **not on the testnet backend yet**, and those tools say so.

## Install

### Claude Desktop (.mcpb)

```bash
cd packages/mcp && npm ci && npm run pack
```

This builds `dist/whiteflow.mcpb`, plus `whiteflow.mcpb.sha256` (the archive) and `whiteflow.mcpb.contents.sha256` (its files). The archive also contains `sbom.cdx.json`, a CycloneDX list of every package bundled in it. Open the `.mcpb` with Claude Desktop, or use Settings → Extensions → Install extension. Then fill in the settings:

| Setting | Default | Notes |
|---|---|---|
| Mode | `sandbox` | `testnet` to use the real gateway |
| Whiteflow secret key | empty | testnet only: your `sk_test_` key. Marked sensitive |
| Gateway URL | `https://whiteflow.org` | testnet only |
| Business time zone | `UTC` | e.g. `Asia/Kolkata`. Used for due dates and "this week" |

Check the archive before installing: `sha256sum dist/whiteflow.mcpb` (PowerShell: `Get-FileHash dist\whiteflow.mcpb`) must match `whiteflow.mcpb.sha256`. The archive's hash changes on every pack, because `mcpb` 2.1.2 stamps zip entries with the current time. The contents hash stays the same for the same source. A checksum only helps if you got it from a channel you trust: the archive isn't signed yet, and nothing proves who built it (see "what production needs").

Optional setting, environment only: `WHITEFLOW_TRUSTED_ORIGINS`, comma-separated https origins of an approved custom checkout domain. The connector shows payment and review URLs only on the gateway's own origin and these.

### Other clients (manual stdio)

Build once (`npm run pack`), then point the client at the bundled server. For example, Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whiteflow": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/bundle/server/index.mjs"],
      "env": { "WHITEFLOW_MODE": "sandbox", "WHITEFLOW_TIMEZONE": "Asia/Kolkata" }
    }
  }
}
```

Claude Code: `claude mcp add whiteflow --env WHITEFLOW_TIMEZONE=Asia/Kolkata -- node /absolute/path/to/packages/mcp/dist/bundle/server/index.mjs`

For testnet, add `"WHITEFLOW_MODE": "testnet"` and `"WHITEFLOW_API_KEY": "sk_test_…"`. Keep the default `local` scope in Claude Code: `--scope project` would write the key into the repo's `.mcp.json`. From a checkout, `node src/index.ts` also works (Node 22.18 or newer runs the TypeScript directly). The bundle needs Node 20 or newer and no `node_modules`.

## Authentication

- **Testnet:** a merchant-scoped secret key (`sk_test_…`) from the dashboard's Developers screen. The server works out your business from the key; no tool takes a merchant or business id.
  - Revoke a key on the same screen; the connector then gets 401 and tells you so.
  - A publishable key (`pk_…`) is refused.
  - Testnet keys have **no scopes or expiry yet**: a key can do everything the merchant API allows, though this connector only calls the routes in [API-CONTRACT.md](API-CONTRACT.md). Use a key just for the assistant, so you can revoke it alone.
- **Sandbox:** no key needed. A local sandbox key is created next to the sandbox data, owner-only. Sandbox keys do have scopes and expiry, so you can try a narrower key.
- **Never** give the connector a wallet private key, a seed phrase or a payment-provider master secret. It never asks for one, and no tool can use one.
- **Where the key is stored.** In an `.mcpb` install, Claude Desktop keeps `sensitive` settings encrypted with Electron safeStorage, whose key is in the OS keychain ([mcpb #41](https://github.com/modelcontextprotocol/mcpb/issues/41); [help article](https://support.claude.com/en/articles/10949351)). An open report says the settings panel can show them in plain text ([mcpb #244](https://github.com/modelcontextprotocol/mcpb/issues/244)). A manual config file holds the key **in plain text**, so protect that file.

## Try the sandbox demo

In the assistant:
1. "Find Priya Sharma, or add her with priya@example.com."
2. "Draft an invoice for Priya: three consulting sessions at 20 USDT each, due next Friday." The assistant shows the totals and the resolved date and waits for your OK.
3. "Publish it." The assistant asks to publish this exact version. Nothing is published or emailed yet: the result gives an approval id (`apr_…`) for the business Owner.

In a terminal, act as the Owner on the review page, then as the customer paying. In the sandbox the review page is the `approve` command. The `pay` command sends signed provider events, and the sandbox processes them like webhooks:

```bash
cd packages/mcp
npm run sandbox -- approve apr_…      # the Owner approves: the invoice becomes WF-1001, with a payment URL
npm run sandbox -- pay WF-1001        # or: node dist/bundle/server/sandbox-cli.mjs pay WF-1001
npm run sandbox -- status
```

Back in the assistant:
4. "Has WF-1001 been paid?" It's paid, according to the processed payment record.
5. "Summarize collections this week." The summary shows the 60.00 USDT.

Scenarios for the simulator: `--scenario duplicate | out-of-order | bad-signature | fail`, and `--amount 25` for an underpayment. `npm run sandbox -- reconcile` rebuilds each invoice's paid total from verified payments. The sandbox lives in `%APPDATA%\whiteflow-mcp` (Windows) or `~/.config/whiteflow-mcp`, or in `WHITEFLOW_STATE_DIR`. Delete the folder to start over.

## Example prompts

| You say | What happens |
|---|---|
| "Create a ₹15,000 payment link for Acme's website redesign." | A single-use link priced in INR. Whiteflow converts it to USDT at a rate locked at checkout; the connector never converts. You get the URL to send yourself. |
| "Draft an invoice for Priya: three consulting sessions at ₹2,000 each, due next Friday." | Invoices are issued in USDT, the settlement asset. The assistant asks for the USDT amounts, or offers an INR-priced payment link. It never converts the price itself. |
| "Has invoice WF-1042 been paid?" | Status, amount paid and amount due, from verified payment records. |
| "Show overdue invoices and the total outstanding." | Overdue invoices with days overdue, plus outstanding and overdue totals per currency. |
| "Summarize collections this week." | Gross, fees, refunds and net per currency, the payment count, and receivables. Weeks start on Monday, in your time zone. |
| "Prepare a reminder for Acme's unpaid invoice." | A subject, body and intended recipient, with `sent: false`. You send it. |

There are also prompt templates: **Collect a payment**, **Create an invoice**, **Review overdue invoices** and **Summarize collections**.

## Tools

| Tool | Does | Testnet | Sandbox | Writes |
|---|---|---|---|---|
| `get_business_profile` | Business, mode, time zone and today's date there, currencies, payment methods and limits, permissions | ✓ | ✓ | |
| `search_customers` | Customers by name or email: stable ids, masked email | — | ✓ | |
| `create_customer` | Name (email optional). A likely duplicate is listed instead of created | — | ✓ | ✓ |
| `create_payment_link` | Amount, currency, description, optional customer, expiry and reference. Returns the URL and status; not sent | ✓ | ✓ | ✓ |
| `get_payment_link` | Status and verified payments | ✓ | ✓ | |
| `create_invoice_draft` | Customer id, line items, USDT, due date, explicit discount or tax. A private draft. Blocked if the server's total differs from the connector's own | — | ✓ | ✓ |
| `update_invoice_draft` | Change a draft. It becomes a new revision, which cancels a pending approval | — | ✓ | ✓ |
| `finalize_invoice` | **Asks** to publish: an approval request bound to this revision, total, currency and customer. An Owner approves it on the review page, and only then does the invoice get its number and payment URL. Not sent | — | ✓ | ✓ |
| `get_invoice` | Totals, paid and due, due date, status incl. overdue, payments | — | ✓ | |
| `list_invoices` | Filter by customer, status and due dates; cursor pages | — | ✓ | |
| `list_payments` | Verified payments, with invoice or link and evidence | ✓ | ✓ | |
| `get_collection_summary` | Collected (gross, fees, refunds, net) and outstanding or overdue, per currency | ✓ (collected only) | ✓ | |
| `prepare_invoice_reminder` | Reminder draft and recipient, `sent: false` | — | ✓ | |
| `get_operation_status` | Writes whose outcome is unknown or needs checking, plus what Whiteflow's records say about each | ✓ (local; lookup once PR #48 is live) | ✓ | |

How writes behave (production review F2/F3):
- **One operation identity.** Each write sends an `Idempotency-Key`, and the connector records it before sending. The server replays the same record for the same key and request, marked `replayed`, and refuses the same key with a different request.
- **Unknown outcomes are resumed, not repeated.** If there's no answer (a timeout, a 5xx, a malformed or oversized reply), retrying the same request resumes that operation with the same key for as long as the server keeps it: 24 hours, across restarts and key rotations for the same business. After that, the connector refuses to send it again and marks it `needs_reconciliation`: check the record, then use `create_another`.
- **Repeats vs new sales.** The same request repeated within 15 minutes of a success replays it. A deliberate second, identical record needs `create_another: true`.
- **Replies are checked.** Every reply is size-capped and schema-checked. A write's reply must match what was asked: amount, currency, text, reference, single-use, expiry, customer and totals, with URLs on a trusted origin. If it doesn't, the result is an error marked for reconciliation, never a success to share.
- **Never authorization.** A tool's annotations are hints for the client. What each key can do, and who may publish, is enforced on the server.

## How it's built

```
MCP client ──stdio── src/index.ts → src/server.ts (14 tools, 4 prompts)
                                     │  tools/* → context (profile, capability gate, journaled writes, redacting reply)
                                     ▼
                     src/client.ts  (Bearer key, timeouts, retries with the same key, no redirects, size caps, zod schemas)
                        ├── testnet: https://<gateway>/api/v1/…   (apps/web: links, account, payments, reports, operations)
                        └── sandbox: src/sandbox/backend.ts, the same HTTP contract served in-process
                                     ├── store.ts    (JSON file, lock and atomic write, owner-only)
                                     ├── records.ts  (customers, links, invoices + revisions, approvals, receivables, reports)
                                     └── provider.ts (signed provider events → processing → reconcile) ← cli.ts (a person)
```

The bundle is a thin client. Durable records, authorization, payment verification and audit belong to the backend. On testnet, payments are MerchantPay's on-chain records, read by the gateway. The sandbox stands in for the backend routes that don't exist yet, and [API-CONTRACT.md](API-CONTRACT.md) is the contract it implements.

## Security notes

- **Stored text is data.** Customer names, descriptions, memos and references are bounded and stripped of control, zero-width and bidi characters. They come back only as data, alongside a notice telling the model they are never instructions. They can't change a recipient, an amount, a scope or the tool set; the reminder's recipient is always the customer record's email.
- **The model can't mark anything paid.** Paid status comes only from verified payments: on testnet, the gateway's records; in the sandbox, signed events with a 5-minute window, applied once per event id, never moving a payment backwards. The payment simulator is a separate command that you run, not a tool.
- **Publishing is the Owner's decision.** `finalize_invoice` can only *ask*. The server binds the request to the invoice revision and its content hash, total, currency, customer and expiry. An Owner approves it once, and any edit cancels it. No tool approves, and no argument counts as approval (production review F4).
- **No money-moving tools.** There is no tool that sends, pays, refunds, voids, transfers, signs, fetches URLs or changes keys, wallets, webhooks or settlement.
- **Secrets stay out.** The API key and the sandbox's signing secret are redacted from every result and stderr line. stdout carries only JSON-RPC, and the tests check this against the packaged archive.
- **Money is exact.** Amounts are integers in minor units: 2 decimals for fiat, 6 for USDT. Zero, negative, malformed and over-precise amounts are refused, and so is a decimal comma. Discounts and taxes are rounded half up, once each. Different currencies are never added together.

## Not supported, and what production needs

Not built:
- customers, invoices, invoice numbers and PDFs, and reminders on the **testnet backend** (sandbox only);
- sending email or reminders;
- refunds, voids, partial payments or deposits beyond recording an underpayment, recurring invoices, CSV export through the connector, settlement reporting, disputes;
- a remote, OAuth-based server (planned as SRS FR-MCP-6/7);
- any rail other than USDT on Whitechain Testnet through the hosted checkout.

Before production (tracked in `.batches/052-PW5-merchant-mcpb/production-plan.md`):
- scoped, expiring, per-assistant credentials (Stage 2, on the Stage 3 workspace stack);
- customer and invoice tables with revisions, approvals, numbering and an audit trail on the backend (Stage 3);
- the Owner's authenticated review page, whose stand-in in the sandbox is the CLI;
- a durable payment-event ledger with reconciliation (Stage 4);
- distributed rate limits and cursor pagination;
- a signed, provenance-attested release from CI;
- mainnet contracts and their review;
- the business, legal and compliance gates in the Whiteflow plan.

Testnet mode needs the gateway routes from [PR #48](https://github.com/Vishal4742/whiteflow/pull/48) (`GET /api/v1/account`, secret-key links, `GET /api/v1/links/{id}`, `GET /api/v1/operations/{key}`), owned by claude-contracts. Until those are deployed, testnet mode answers "This Whiteflow backend doesn't offer that yet."

## Phase two (designed, not built)

- **Reminder delivery, refunds, voids and settlement changes.** The tool creates a *proposal*. The server binds it to the business, record version, amount and recipient, and returns a review URL. An authorized person approves it once, on an authenticated page. The server re-checks role, refundable amount and state before acting. A model-supplied `confirmed: true` is never approval.
- **Refunds.** The remaining refundable amount is `paid − refunded`, checked again at approval and at execution.
- **Partial payments and deposits.** Invoices already record `amount_paid` and `amount_due` from verified payments; allowing a partial state on purpose is an invoice-policy flag.
- **Recurring invoices.** A schedule that creates drafts, which keep the same review step.
- **Exports and settlement reconciliation.** Based on the gateway's existing `reports.csv` and settlements routes.
- **Disputes.** A status on a payment, with evidence attached.

## Development

```bash
npm ci
npm run typecheck && npm test   # 46 tests, offline; includes building and launching the .mcpb
npm run manifest                # rewrite manifest.json from the server (a test fails if you forget)
npm run pack                    # dist/whiteflow.mcpb + checksums (+ sbom.cdx.json inside)
node scripts/icon.mjs           # redraw icon.png
```

The licence is MIT (repo `LICENSE`). The bundle's `THIRD_PARTY_LICENSES` lists every package bundled into it.
