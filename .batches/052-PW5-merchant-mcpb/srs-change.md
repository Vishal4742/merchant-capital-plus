# SRS-CHANGE proposal (batch 052): needs the human's approval; claude-research applies it to docs/SRS.md

Context: the human chose (2026-11-07 00:4x) a stdio .mcpb as the developer adapter that v3.1 R2 allows, with the
brief's tool list, a small web backend change, and a labelled sandbox for what the backend doesn't have yet. New IDs
continue after v3.1's FR-MCP-11; no old ID is reused.

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-MCP-12 | **Merchant MCP bundle:** `whiteflow.mcpb` (MCPB manifest, Node stdio server bundled to one file, icon, licences, sha256) installs in MCPB clients. A manual stdio config covers the other clients. The tools are get_business_profile, search_customers, create_customer, create_payment_link, get_payment_link, create_invoice_draft, finalize_invoice, get_invoice, list_invoices, list_payments, get_collection_summary and prepare_invoice_reminder. The prompts are collect-payment, create-invoice, review-overdue and summarize-collections. The manifest's tools and prompts equal runtime discovery. Stdout carries JSON-RPC only. Every result names its environment (sandbox or testnet). | S | W5 |
| FR-MCP-13 | **Customers:** search returns stable ids with a masked email only. Create needs a name only (email optional), refuses a likely duplicate (same normalized name or email) unless the caller confirms it's new, and an invoice needs a customer id, never a name. | S | W5 (sandbox) / W3 (web) |
| FR-MCP-14 | **Invoice lifecycle:** a draft has line items (qty × unit price), USDT only, an explicit fixed or percent discount, an explicit named tax rate (never inferred), round-half-up once per step, and a due date that is a calendar date in the business timezone. Finalize allows draft → open only, assigns `WF-<n>` per merchant, returns the hosted URL (PDF null where unsupported) and sends nothing. Paid comes only from verified payment records. Overdue = open and the due date has passed in the business timezone. | S | W5 (sandbox) / W3 (web) |
| FR-MCP-15 | **Idempotent mutations:** every create or finalize carries an Idempotency-Key. The same key and request return the same record (`replayed`); the same key with a different request is 422; a new key creates a new record. The connector journals each key before sending, so a retry after a timeout reuses it, and it never mints a second key for a same-payload retry within 15 minutes. | M | W5 |
| FR-MCP-16 | **Sandbox adapter:** a local, clearly labelled simulator implements the same HTTP contract (auth, scopes, key expiry, tenancy, idempotency). Its payment provider emits MC-Signature-signed events. Processing verifies the signature and timestamp, dedupes event ids, never regresses a status on out-of-order delivery, records under- and overpayment, and supports reconcile. Payments are simulated only by a human-run CLI, never by a tool. | S | W5 |
| FR-MCP-17 | **Reminder drafts:** prepare_invoice_reminder returns the subject, body, intended recipient and payment URL, and states `sent: false`. Sending is a later, separately authorized capability (server-enforced approval, not a model flag). | S | W5 |
| FR-GW-16 | **Key access for the connector:** a merchant's sk_test_ key may create and read its links (POST with a durable Idempotency-Key), read one link with its paid checkouts, read its account profile (`GET /api/v1/account`) and read its report. pk_ keys get 403. Another merchant's id gives 404. | S | W5 |

Amend FR-MCP-3: "…the key never appears in tool output or logs" → add "or in the bundle's files". Amend R1's note:
packages/mcp did exist on main with FR-MCP-5; batch 052 removes it.
Production prerequisites (not requirements yet): scoped and expiring live keys (FR-GW-6 has neither), web customer and
invoice tables (W3), Owner review for publication (FR-MCP-9), remote OAuth (FR-MCP-6/7).
