# 052-PW5-merchant-mcpb
Phase: 5 / W5 (MCP)   Round: 1   Owner lane: claude (agent, worktree P:/wf-mcpb, branch wf/merchant-mcpb)
Mode: phase
Money: yes (payment-link creation by API key, idempotency, payment status, webhook processing)
Request (verbatim, summarized; the full brief is in the session): "Build 'Whiteflow Merchant MCP': an installable
whiteflow.mcpb bundle that lets merchants manage payment collection through natural-language prompts in compatible MCP
clients." The tools: get_business_profile, search_customers, create_customer, create_payment_link, get_payment_link,
create_invoice_draft, finalize_invoice, get_invoice, list_invoices, list_payments, get_collection_summary and
prepare_invoice_reminder, plus four prompt templates.
Human decisions (2026-11-07 00:4x, AskUserQuestion):
- MCP shape: "Stdio MCPB as dev adapter". whiteflow.mcpb is the optional stdio developer adapter that SRS v3.1 R2
  allows; the tool logic stays transport-free so the remote OAuth server (FR-MCP-6–11) can reuse it. The SRS-CHANGE for
  the new tools is in srs-change.md and needs the human's approval.
- Backend: "Small backend + sandbox". On main: sk_test_ keys can use the link routes (with a durable Idempotency-Key)
  and reports, plus a key-scoped account profile and a single-link read. Customers, invoice drafts/finalize and
  reminders run in a clearly labelled local sandbox adapter that implements the written API contract.
- Package: "Evolve packages/mcp". pay_checkout, spending_report and MCP_PAYER_KEY are removed (SRS v3.0 R1).
- Security: redacted the Privy app secret from the uncommitted .batches/050-P5-privy-onboarding/batch.md in P:/WhiteFlow
  (human approved). The human must still rotate it.
Agent ids (builders, for SendMessage resumes): claude (this session)
Log:
- 00:50 batch started in its own worktree from origin/main e7e41bf (P:/WhiteFlow holds another lane's uncommitted batch 050).
