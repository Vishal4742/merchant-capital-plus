# WhiteFlow Merchant MCP: production baseline, threat model and staged plan (batch 052 round 2)

Written 2026-11-07 for the owner, whiteflow-ef (Stage 3 lead) and claude-contracts. Inputs: the external production
review of `afd5a07` (findings F1–F8) and the human's round-2 decisions (batch.md). This is an engineering plan, not a
compliance assessment.

## 0. Baseline
| Item | Value |
|---|---|
| Connector | `wf/merchant-mcpb` (PR #45, draft), packages/mcp 0.3.0, 14 tools, 4 prompts, 41 tests |
| Gateway routes | `wf/gateway-secret-key-routes` (PR #48, draft, owner claude-contracts), batch 054 |
| Reviewed artifact | review's archive sha256 `8301ad13…6d44` (afd5a07). The new artifact is rebuilt from the round-2 head; its digest is in round-2/ci.md |
| Runtimes tested | Node 26.13.0 (Windows, local) and Node 26 (Linux, CI); the review ran the archive on Node 24.14.0. The manifest declares node ≥ 20 |
| Clients tested | in-memory MCP client and raw stdio JSON-RPC against the unpacked archive. **Not yet:** Claude Desktop install UI, other MCPB clients |

## 1. Capability matrix
| Capability | Sandbox (simulated) | Testnet (working) | Implemented, not verified end to end | Production-ready | Unsupported |
|---|---|---|---|---|---|
| Business profile | ✓ | ✓ (needs PR #48 deployed) | | | |
| Payment links: create, read, verify reply | ✓ | ✓ (PR #48) | live create through the deployed gateway | ✗ | |
| Durable link idempotency (F1) | ✓ | ✓ (PR #48, PGlite fault tests) | Neon behaviour under real faults | ✗ | |
| Operation status / resume (F2) | ✓ (server lookup) | local journal; server lookup with PR #48 | | ✗ | |
| Reply validation, URL trust (F3) | ✓ | ✓ (scripted gateway) | | ✗ | |
| Customers | ✓ | ✗ | | ✗ | live: until Stage 3 |
| Invoices: draft, edit, publish request, Owner approval (F4) | ✓ (CLI stands in for the review page) | ✗ | | ✗ | live: until Stage 3 |
| Payments list (verified) | ✓ (signed simulated events) | ✓ (MerchantPay on-chain records) | | ✗ | |
| Collection summary | ✓ | collected only (reports) | | ✗ | receivables live |
| Reminder drafts | ✓ | ✗ | | | sending: phase 2 |
| Scoped, expiring credentials | sandbox keys only | ✗ (sk_test_ is full access) | | ✗ | live: Stage 2 |
| Signed or attested release | ✗ | ✗ | SBOM + checksums | ✗ | signing, provenance: Stage 6 |
| Refunds, voids, partial payments, recurring, disputes | | | | | ✗ (phase 2) |

## 2. Trust boundaries and threats
| Boundary | Threats | Control now | Gap → stage |
|---|---|---|---|
| Model ↔ connector | prompt injection via stored text; the model claiming approval or payment | data notice, sanitising, no approve or pay tool, approval needs the Owner, paid only from verified records | real-client adversarial evals → Stage 5 |
| Connector ↔ local disk | stolen sandbox key or journal; a corrupted journal | 0600 files, lock + atomic write, journal holds no secrets | OS ACLs on Windows; journal integrity → Stage 6 |
| Connector ↔ API (network) | a stolen or rotated key; tenant confusion; malicious or faulty replies; redirects; uncertain outcomes | merchant from the key; scope bound to the authenticated merchant; schemas, size caps, semantic checks, trusted origins; redirects refused; durable keys | scoped, expiring keys → Stage 2 |
| API ↔ database | duplicate effects on failure; concurrency | atomic slot + link (PR #48); slot `status IS NULL` guard | sessions atomic; distributed limits → Stage 2/4 |
| Checkout ↔ wallet/chain | wrong token, network or amount; finality; reorgs | MerchantPay on-chain records; payments read on chain | indexer checkpoints, finality, reorg → Stage 4 |
| Provider events / webhooks | forged, duplicate, stale or out-of-order events | MC-Signature + 5-min window + dedupe + sequence (sandbox) | durable inbox, DLQ, replay; outbound DNS-rebinding → Stage 4 |
| Release channel | a tampered archive | sha256 + contents digest, SBOM | signing + CI provenance → Stage 6 |

## 3. Decisions (human, 2026-11-07)
- USDT-only invoices for a narrow USDT-native pilot. INR pricing stays on links (converted at checkout, disclosed).
- Publication needs an Owner's approval on the review page, enforced by the server.
- Stages 2–4 are built on the Stage 3 stack (`wf/stage3-v1-cutover`), coordinated with whiteflow-ef.
- SRS-CHANGE FR-MCP-12..17 and FR-GW-16 approved. Gateway routes owned by claude-contracts (PR #48).
- Still open, for the owner: the pilot segment (proposed: service businesses already collecting USDT), the approved
  regions and rails, the custody and settlement model, and the compliance owner. Stage 3 has no invoice legal fields
  until the market is chosen.

## 4. Interface contract for Stages 2–4 (for whiteflow-ef: these map onto 053_identity's wf_* model)
**Stage 2: delegated credentials.** Table `wf_api_credentials`:

| Column | Notes |
|---|---|
| `id` | |
| `business_id` | FK to wf_businesses |
| `environment` | test or live |
| `label` | per assistant, e.g. "Claude Desktop, Priya's laptop" |
| `key_hash` | sha256, unique |
| `prefix` | |
| `scopes` | text[] |
| `created_by` | a principal |
| `created_at`, `expires_at`, `last_used_at`, `revoked_at` | `expires_at` is required, at most 90 days |

- **Scopes:** account:read, customers:read, customers:write, links:read, links:write, invoices:read, invoices:draft, invoices:request_publication, payments:read, reports:read. **There is deliberately no publish, send, refund or settlement scope**: those actions take an Owner session.
- **Authorization:** the AuthContext resolves `(business, environment, scopes, credential_id)` from the key. Every route checks scope plus object ownership. Cursors, operation ids and approval ids are business-bound.
- **Audit:** every write by a key gets an `wf_audit_events` row with `credential_id`.
- **Rate limits:** per credential and per business, in Postgres (a token bucket row) or Redis. The reply carries `Retry-After`, and the connector already honours it.

**Stage 3: merchant records.** Tables:
- `wf_customers` (business_id, name, email, normalized_name; unique per business on normalized email when present);
- `wf_invoices` (business_id, number unique per business when issued, status draft/open/paid/void, current_revision);
- `wf_invoice_revisions`, immutable: invoice_id, revision, content JSON, content_hash, subtotal/discount/tax/total in minor units, currency, due_date, timezone, and the supplier and customer snapshots at issue;
- `wf_invoice_approvals` (invoice_id, revision, content_hash, total, currency, customer_id, requested_by credential, requested_at, expires_at, status, decided_by principal (Owner), decided_at, consumed_at);
- `wf_payment_allocations` (payment_id → invoice_id, amount).

- **Finalize = an approval row.** The Owner's review page (an authenticated Owner session, a fresh step-up like FR-BIZ-4) sets `decided_by`. It re-checks the revision, hash and total in one transaction, then issues the number. The approval is consumed once.
- **Numbering:** a per-business counter row, incremented in the same transaction (no gaps on rollback; gaps on void are visible).
- **Routes:** exactly API-CONTRACT.md's proposed shapes, which the sandbox already serves and the connector's schemas already parse.

**Operations (all writes).** Reuse `app_web_idempotency`, or move it to `wf_operations`:

| Column | Notes |
|---|---|
| `business_id`, `environment`, `route`, `key` | unique together |
| `request_hash` | path + canonical body |
| `state` | pending, succeeded, failed, needs_reconciliation |
| `http_status`, `body`, `result_id` | |
| `created_at`, `settled_at` | |

The business write and the operation's result commit in one transaction (PR #48's pattern). A pending row older than the function's maximum duration becomes `needs_reconciliation`, **not** freed, for non-atomic routes. `GET /api/v1/operations/{key}`.

**Stage 4: payment events and the ledger.**
- **Chain facts:** `wf_chain_events`, keyed by (chain_id, contract, tx_hash, log_index), with block hash, block number, confirmations and finality state. An incremental indexer keeps a checkpoint per contract, detects reorgs by block hash, and requires a finality depth before `confirmed`.
- **Payments:** `wf_payments`, a lifecycle of submitted → pending → confirmed → (reversed), allocated to invoices through allocations.
- **Queueing:** inbox and outbox tables, a worker with bounded retry and a dead-letter state, operator replay, and alerts on lag.
- **Reports:** come from the payments and allocations projection, with an `as_of` and freshness on every number, `provisional` vs `final`, and gross, fees, refunds, investor allocations, merchant proceeds and settled amounts as separate fields. A truncated history is reported as incomplete, never as zero.
- **Reconciliation:** a scheduled job, chain ↔ payments ↔ allocations ↔ reports. Drift creates a repair task with an audit trail.

## 5. Evidence matrix (round 2)
| Requirement | Implementation | Test | Result | Owner | Blocker |
|---|---|---|---|---|---|
| F1 at most one link per operation | PR #48 `createLinkOnce` (atomic) | apps/web `gw-links-atomic` 7 | sandbox/PGlite pass; staging not run | claude-contracts | PR #48 review, staging on Neon |
| F2 unresolved writes recoverable or blocked | `journal.ts` v2, `get_operation_status` | `production.test.ts` F2 ×4, units | pass (offline) | claude | live lookup needs PR #48 |
| F3 reply validated before success | `contract.ts` zod, `client.ts` caps, `context.ts` verify/trustedUrl | F3 ×2, testnet | pass (offline) | claude | |
| F4 Owner-approved publication | sandbox approvals, `finalize_invoice` request-only | F4 ×3 | sandbox pass | claude (sandbox) / ef (live) | Stage 3 review page |
| F5 scoped expiring credentials | sandbox keys only | security (sandbox) | sandbox pass | whiteflow-ef | Stage 2 |
| F6 real customers and invoices | sandbox only | sandbox-flow | sandbox pass | whiteflow-ef | Stage 3 |
| F7 limits, pagination, reorg, DNS rebinding | not yet | — | open | claude-contracts / ef | Stage 2/4 |
| F8 signed, attested release | SBOM + digests | package test | partial | CI owner | a signing key and CI provenance need the owner |
| Privy secret rotation | — | — | **unverified** | the owner | the owner confirms by credential id and time |

Verification-matrix items from the prompt that remain **staging-only** and unrun:
- #1–#3 on Neon under real concurrency and restarts;
- #8 concurrent workers and DLQ;
- #9 wrong token or network on chain;
- #10 more than 200 links and more than 50 payments, paged;
- #11 distributed limits;
- #12 the installed bundle → the deployed staging API → the hosted checkout → a testnet payment → verified → paid → the dashboard agrees;
- #14 restore and rollback drills.

None of these is claimed.
