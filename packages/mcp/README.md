# WhiteFlow Merchant MCP

Manage payment collection by asking your AI assistant: create payment links and invoices, check whether they're paid, see what's outstanding, and draft reminders. It's a local MCP server (stdio), packaged as **`whiteflow.mcpb`** for MCPB clients such as Claude Desktop, with a manual config for other clients.

> **Not production.** It runs in one of two modes, and every result says which:
> - **Sandbox** (the default): a simulator on your computer. No account, no network, no real money. URLs on `sandbox.whiteflow.invalid` don't open.
> - **Testnet**: the WhiteFlow gateway on Whitechain Testnet with your `sk_test_` key. Test USDT only. Payment links, payments and collection summaries are live. Customers, invoices and reminders are **not on the testnet backend yet**, and those tools say so.

## Install

### Claude Desktop (.mcpb)

```bash
cd packages/mcp && npm ci && npm run pack
```

This builds `dist/whiteflow.mcpb`, plus `whiteflow.mcpb.sha256` (the archive) and `whiteflow.mcpb.contents.sha256` (its files). Open the `.mcpb` with Claude Desktop, or use Settings → Extensions → Install extension. Then fill in the settings:

| Setting | Default | Notes |
|---|---|---|
| Mode | `sandbox` | `testnet` to use the real gateway |
| WhiteFlow secret key | empty | testnet only: your `sk_test_` key. Marked sensitive |
| Gateway URL | `https://merchant-capital.vercel.app` | testnet only |
| Business time zone | `UTC` | e.g. `Asia/Kolkata`. Used for due dates and "this week" |

Check the archive before installing: `sha256sum dist/whiteflow.mcpb` (PowerShell: `Get-FileHash dist\whiteflow.mcpb`) must match `whiteflow.mcpb.sha256`. The archive's hash changes on every pack, because `mcpb` 2.1.2 stamps zip entries with the current time. The contents hash stays the same for the same source.

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
3. "Finalize it." You get `WF-1001` and its payment URL. Nothing is emailed.

In a terminal, play the customer paying. The `pay` command sends signed provider events to the sandbox, and the sandbox processes them like webhooks:

```bash
cd packages/mcp
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
| "Create a ₹15,000 payment link for Acme's website redesign." | A single-use link priced in INR. WhiteFlow converts it to USDT at a rate locked at checkout; the connector never converts. You get the URL to send yourself. |
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
| `create_invoice_draft` | Customer id, line items, USDT, due date, explicit discount or tax. A private draft | — | ✓ | ✓ |
| `finalize_invoice` | Draft → open: number, payment URL, PDF URL (none yet). Not sent | — | ✓ | ✓ |
| `get_invoice` | Totals, paid and due, due date, status incl. overdue, payments | — | ✓ | |
| `list_invoices` | Filter by customer, status and due dates; cursor pages | — | ✓ | |
| `list_payments` | Verified payments, with invoice or link and evidence | ✓ | ✓ | |
| `get_collection_summary` | Collected (gross, fees, refunds, net) and outstanding or overdue, per currency | ✓ (collected only) | ✓ | |
| `prepare_invoice_reminder` | Reminder draft and recipient, `sent: false` | — | ✓ | |

How writes behave:
- **Idempotent.** Each write sends an `Idempotency-Key`. Retrying the same request returns the same record, marked `replayed`. Reusing a key with a different request fails. Pass a new `idempotency_key` to create a second identical record on purpose.
- **Safe after a timeout.** The connector records each key before it sends. A retry of the same request, even after a restart, reuses that key, so it can't create a duplicate.
- **Never authorization.** A tool's annotations are hints for the client. What each key can do is enforced on the server.

## How it's built

```
MCP client ──stdio── src/index.ts → src/server.ts (12 tools, 4 prompts)
                                     │  tools/* → context (profile, capability gate, journaled writes, redacting reply)
                                     ▼
                     src/client.ts  (Bearer key, timeouts, retries with the same key, no redirects)
                        ├── testnet: https://<gateway>/api/v1/…   (apps/web: links, account, payments, reports)
                        └── sandbox: src/sandbox/backend.ts, the same HTTP contract served in-process
                                     ├── store.ts    (JSON file, lock and atomic write, owner-only)
                                     ├── records.ts  (customers, links, invoices, receivables, reports)
                                     └── provider.ts (signed provider events → processing → reconcile) ← cli.ts (a person)
```

The bundle is a thin client. Durable records, authorization, payment verification and audit belong to the backend. On testnet, payments are MerchantPay's on-chain records, read by the gateway. The sandbox stands in for the backend routes that don't exist yet, and [API-CONTRACT.md](API-CONTRACT.md) is the contract it implements.

## Security notes

- **Stored text is data.** Customer names, descriptions, memos and references are bounded and stripped of control, zero-width and bidi characters. They come back only as data, alongside a notice telling the model they are never instructions. They can't change a recipient, an amount, a scope or the tool set; the reminder's recipient is always the customer record's email.
- **The model can't mark anything paid.** Paid status comes only from verified payments: on testnet, the gateway's records; in the sandbox, signed events with a 5-minute window, applied once per event id, never moving a payment backwards. The payment simulator is a separate command that you run, not a tool.
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

Before production:
- scoped, expiring, per-assistant keys or OAuth grants;
- customer and invoice tables with audit history on the backend (W3);
- an owner review and approval page for publishing and for every sensitive action;
- mainnet contracts and their review;
- the business, legal and compliance gates in the WhiteFlow plan.

Testnet mode needs the gateway to have the routes added in batch 052 (`GET /api/v1/account`, secret-key links, `GET /api/v1/links/{id}`). Until that is deployed, testnet mode answers "This WhiteFlow backend doesn't offer that yet."

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
npm run typecheck && npm test   # 29 tests, offline; includes building and launching the .mcpb
npm run manifest                # rewrite manifest.json from the server (a test fails if you forget)
npm run pack                    # dist/whiteflow.mcpb + checksums
node scripts/icon.mjs           # redraw icon.png
```

The licence is MIT (repo `LICENSE`). The bundle's `THIRD_PARTY_LICENSES` lists every package bundled into it.
