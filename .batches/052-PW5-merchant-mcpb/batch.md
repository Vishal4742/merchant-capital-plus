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
Round 2 request (human, 2026-11-07, after the external production review of afd5a07): extend into a
production-capable merchant collection product per "Whiteflow Merchant MCP — production implementation prompt" and the
"production readiness" review (findings F1–F8). It changes no deploy, merge, credential or policy state.
Human decisions (2026-11-07, round 2, AskUserQuestion):
- Invoice currency: "USDT-only invoices" for a narrow USDT-native pilot. INR pricing stays on links.
- Publication: "Owner approves on review page". finalize creates a proposal bound to the invoice revision hash, total,
  currency, customer and expiry; an Owner approves it once; the server enforces this.
- Backend base: "Stack on Stage 3, coordinate". Stage 2–4 (scoped credentials, customer/invoice tables, event ledger)
  get an interface contract plus a handoff to whiteflow-ef now, and are built later on wf/stage3-v1-cutover with ef's
  agreement.
- Change control: "Approve SRS, hand routes over". The SRS-CHANGE (FR-MCP-12..17, FR-GW-16) is approved. The
  apps/web route changes leave PR #45 for a handoff branch that claude-contracts owns (with the F1 fix);
  PR #45 keeps packages/mcp only.
Agent ids (builders, for SendMessage resumes): claude (this session)
Log:
- 00:50 batch started in its own worktree from origin/main e7e41bf (P:/WhiteFlow holds another lane's uncommitted batch 050).
- round 1 closed with security PASS, code PASS and CI PASS (afd5a07).
- round 2: production review findings, decisions above.
