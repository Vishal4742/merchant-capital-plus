# WhiteFlow — build plan in git (2026-11-06)

The one plan for taking WhiteFlow from the current build to a working testnet product, as stacked PRs to `main` (never a push to `main`). Requirements: `docs/SRS.md` v3.0 §8. Tracker of what is verified: `notes/whiteflow-status.md`. Each row is one pipeline batch (PIPELINE.md) and one PR, stacked on the previous one.

## Owner decisions this plan follows (2026-11-06, AskUserQuestion)
| # | Decision |
|---|---|
| O1 | Work only in git: branches + PRs; never push or merge to `main`. |
| O2 | Business sign-in = **Privy**, login methods **email + external wallet**; Privy embedded wallets **off** for businesses. Login identity ≠ receiving wallet: the receiving wallet is always proven by its own signature. Supersedes the interim SIWE login (D12) in FR-BIZ-6. |
| O3 | MCP = **remote OAuth MCP** (Streamable HTTP, OAuth 2.1 + PKCE S256) inside the web app; the stdio `pay_checkout` (agent signs payments with a key) is removed (CON-10). |
| O4 | Stacked PRs; keep going without waiting for each merge. |

## Workflow → stages → batches
| Workflow step (owner's list) | Stage | Batch / PR | SRS | Status |
|---|---|---|---|---|
| (foundation) webhooks, relayer, limits | 2 | 049-PW4-port-stage2 → **PR #43** | FR-GW-7, FR-PAY-10, FR-REL-5/6/10, FR-OPS-9 | closed; security PASS; lead-approved; GitHub CI green; needs the owner's relayer cutover + merge |
| 1 Business onboarding: sign in, workspace, roles, receiving wallet proof, policy | 3 | 050-PW2-identity-privy → **draft PR #44** (whiteflow-ef leads Stage 3, D15) + 051 v1 cutover/backfill (ef) | FR-BIZ-1..7, FR-AUTH-1..5, CON-11 | server, v2 API, UI built; PGlite 12/12 + token 8/8 + CSP scope 4/4; real-PG races 5/5; pending lead review, browser walk with the owner's Privy key |
| 2 Invoice: draft → owner approval → issue → payment link | 4 | 052-PW3-invoices (renumbered: 051 is ef's cutover) | FR-BILL-1..6, FR-RTE-1, FR-UX-1..4 | planned |
| 3 Customer opens link, connects funded wallet, sees total/fees/net, pays | 4 | 053-PW3-direct-checkout | FR-CHK-1..6, FR-RTE-2 (DirectWhitechain) | planned |
| 4A Direct Whitechain route (contract enforces approved terms; V1 obligations kept) | 4 | 052 (+ contract V2 only if V1 cannot bind terms) | FR-BILL-5, CON-11, FR-RTE-3 | planned |
| 5 Tracking + receipt (awaiting → detected → settling → settled; pending verification / recovery / failed) | 4–5 | 052 + 053-PW4-durable-ops | FR-CHK-3..5, FR-OPS-2..8, NFR-18 | planned |
| 6 Refund (owner approves, original payer, no duplicate/excess) | 4 | 054-PW3-refunds | FR-RFD-1, FR-RFD-3 | planned |
| 7 ChatGPT/Claude via MCP (drafts, unpaid list, status; human approves money) | 6 | 055-PW5-remote-mcp | FR-MCP-6..11, CON-10, NFR-17 | planned |
| 4B External route Sepolia USDC → Whitechain USDT | 7–8 | 056-PW1-corridor-proof, 057-PW6/7 | DEP-8, FR-XC-*, FR-RFD-2 | **externally blocked**: funded `SEPOLIA_MESSENGER_PRIVATE_KEY`, `WHITECHAIN_MESSENGER_PRIVATE_KEY`, prefunded test-USDT inventory; feature flag stays OFF until proven |
| Checklist run against the workflow | 9 | 058-PW9-verification | AT-19..56 | last |

## Per-batch loop
spec citing SRS IDs → failing tests → code → typecheck/lint/tests/build → reviewer-security (money) → commit small steps → push branch (pre-push hook runs CI checks) → PR stacked on the previous branch → next batch.

## What "production" can and cannot mean here
Reachable in code: a tested testnet build, feature flags OFF for unproven routes, honest labels. Not reachable by code alone (owner/external): audits, KYB/legal/jurisdiction, funded corridor inventory, Privy dashboard settings, MCP directory approval, mainnet decision (W10).

## Stage 4 design facts (read from contracts/src/MerchantPay.sol, V1, deployed)
- `createInvoice(customer, amount, dueDate, refHash)` is sent by the wallet that will be paid (msg.sender = invoice.merchant): issuance must be signed by the policy's receiving wallet; `refHash` (bytes32) can commit the approved terms hash (invoice version + policy hash), binding terms on chain without a V2 deployment.
- `payInvoice` (EIP-3009, relayed, gasless for the customer) pays invoice.merchant; WhiteFlow enforces one-off full payment (FR-BILL-5) before relaying.
- `refund(paymentId, amount)` is sent by the merchant wallet and the contract caps cumulative refunds at gross: the on-chain double-refund guard FR-RFD-3 needs for the direct route.
- Open: whether V1 is enough for FR-BILL-2 binding, or a V2 PaymentRouter is needed (WF§10) — decide in the Stage 4 spec with the lead.
