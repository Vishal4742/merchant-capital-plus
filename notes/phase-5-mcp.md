# Phase 5 / W5: WhiteFlow Merchant MCP bundle (batch 052)

**Built** (branch `wf/merchant-mcpb`, worktree `P:/wf-mcpb`, lane claude):
- `packages/mcp` is now the WhiteFlow merchant connector, packaged as `whiteflow.mcpb`.
  - 12 tools: business profile, customers, payment links, invoice draft/finalize/get/list, payments, collection summary, reminder drafts. 4 prompts.
  - One client serves two backends: the testnet gateway, or a clearly labelled in-process sandbox that implements `API-CONTRACT.md`.
  - pay_checkout and MCP_PAYER_KEY are removed (SRS v3.0 R1).
- `apps/web` changes:
  - `lib/server/idempotency.ts`: the sessions route's durable slots, moved unchanged.
  - `callerMerchant()`: a session or an sk_test_ key; pk_ gets 403.
  - Links: an sk key can create (with an Idempotency-Key) and list them; new `GET /api/v1/links/{id}` returns one link with its paid checkouts.
  - New `GET /api/v1/account`; reports accept an sk key.
  - No schema change: links reuse `app_web_idempotency`.

**Verified:** see `.batches/052-PW5-merchant-mcpb/round-1/ci.md` for the outputs (web suites, MCP suite including the packaged-archive launch, pack and validate, checksums).

**Decisions** (human, 2026-11-07 00:4x):
- The stdio .mcpb is the developer adapter that v3.1 R2 allows.
- Small backend plus sandbox.
- Evolve packages/mcp.
- Invoices are USDT only (FR-BILL-1); the connector never converts.
- Links are single-use by default in the tool.
- Sandbox is the default mode.

**Open:**
- The SRS-CHANGE (FR-MCP-12..17, FR-GW-16) needs the human's approval; claude-research or whiteflow-ef applies it.
- The R2-1 role-map amendment for 051 (secret keys drafting and reading links) needs the human's OK. whiteflow-ef ports the key paths onto `legacyAccess` when 051 rebases.
- Root README §AI assistant is stale after merge (docs lane).
- Testnet mode needs this PR deployed (the account route and sk-key links).
- Live customers and invoices are W3.
