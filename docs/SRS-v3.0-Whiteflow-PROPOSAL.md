# SRS change proposal v3.0 — Whiteflow

| | |
|---|---|
| Status | **ADOPTED 2026-11-06** into `docs/SRS.md` §8 (owner authorization). This file is the drafting record; SRS.md is authoritative. |
| Drafted | 2026-11-06 by the lead engineer acting in the claude-research role (no claude-research session, agentbus or HANDOFF.md exists in this workspace; see `notes/whiteflow-status.md`). Amended the same day after an independent read-only gap review against WF§3–§12 by the peer session whiteflow-b7 (13 misses, 4 tensions, invented-rule labels — all incorporated; mechanism choices moved to §H). |
| Sources, in precedence order | (1) the owner's build instruction of 2026-11-06; (2) `../Whiteflow-Final-Vision-and-Claude-Build-Plan.md` v1.0 (cited **WF§n**); (3) non-conflicting detail from `../Business-Payments-Final-PRD.md` v2.0 (cited **PRD§n**). Existing code shows what is built, not what the product must be. |
| Rule | No new business rule is invented here. Where the sources leave a rule open, the requirement says so and the dependent behaviour stays disabled. |
| Applies to | `docs/SRS.md` v2.2 (Whiteflow). On approval the sections below are merged into SRS.md as v3.0, PHASES.md gains the W0–W10 rows in §F, and the cut/supersede list in §B is applied. IDs are never reused. |

---

## A. Scope change

v3.0 turns the gateway into **Whiteflow**: a business payments workspace with business onboarding, a business-controlled Whitechain receiving wallet, invoices and payment links, account-free customer checkout, payment from explicitly supported networks/assets, exact designated USDT settlement on Whitechain, transaction evidence, reconciliation and recovery, and dashboard + MCP access to the same records (WF§1).

- Testnet only. Destination: Whitechain Sepolia 1874, designated test USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 dp; verified live 2026-11-06). First external corridor: Ethereum Sepolia 11155111 Circle test USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 dp; verified live 2026-11-06) → Whitechain USDT, **only after DEP-8 and the W6/W7 gates pass** (WF§3, §7).
- Direct collection and cross-chain collection are independently feature-flagged. If the corridor fails, an honestly labelled direct-only build ships and the blocker is recorded; a simulated bridge is never a substitute (WF§3).
- Whiteflow is the user-facing name. Internal tables, contracts and APIs are not renamed for branding (WF§2).
- Existing v2.2 requirements stay in force unless §B supersedes, scopes or cuts them.

## B. Conflict resolutions (applied on approval)

| # | Existing item | Resolution | Source |
|---|---|---|---|
| R1 | FR-MCP-5 (agent signs and pays a checkout with `MCP_PAYER_KEY`) | **Cut.** Not implemented (`packages/mcp` does not exist), so no code is removed. | Owner instruction §7; WF§3 ("Autonomous agent spending/x402 buying: not included"), WF§6 |
| R2 | FR-MCP-1, FR-MCP-2, FR-MCP-4, AT-16 (local stdio server with an env `sk_test_` key) | **Superseded** by FR-MCP-6…11 (remote OAuth MCP). A stdio adapter may exist later only as an optional developer adapter over the same services. FR-MCP-3 (no tool moves money, signs, refunds or changes keys/wallets/webhooks) is kept and strengthened by FR-MCP-8. | WF§5 (`src/index.ts` row), WF§6 |
| R3 | FR-GW-15 + AT-18 (Settlements withdraw) | **Deferred** (not in the Whiteflow testnet scope table). The balance card may remain only labelled "Wallet balance — not revenue, not held by Whiteflow". | WF§3, §4 ("never fabricate a dashboard custodial balance"), §6 (no withdrawal tool) |
| R4 | FR-PAY-7, NFR-6, SR-SC-1 (no chain names, gas or signatures on the pay page) | **Superseded** by FR-CHK-2 and FR-UX-1: plain business language first, but the network, token, required approvals/signatures and source-gas requirement are always disclosed, with technical evidence expandable. | WF§1, §4 |
| R5 | CON-4 (payers never pay gas) | **Scoped** to the direct Whitechain route (destination WBT is sponsored by the relayer). On an external route the payer pays source gas and any approval, disclosed before signing. The whole flow is never labelled gasless. | WF§1 |
| R6 | DEP-3 result and ARCHITECTURE §4 (customer guest wallet = key in localStorage) | **Replaced** by FR-CHK-1: an existing funded wallet is the default; the guest wallet is a clearly labelled demo fixture, off in production configuration. | WF§4, §10 (`guest-wallet.ts` row); PRD§6 |
| R7 | FR-GW-10 "showing that settlement is instant (T+0)"; SRS §1.2 "instant settlements" | **Wording removed** (FR-UX-1). Settlement views show observed inclusion and finality with timestamps. | WF§1, §12 first box |
| R8 | FR-GW-11 "USD converts 1:1 to USDT" | Whiteflow invoices are denominated in settlement USDT atomic units (FR-BILL-1). Legacy multi-currency links/pages keep working, but the 1:1 rule is displayed as the operator's pricing rule, never as a parity claim. | WF§2 ("do not promise stablecoin parity"), PRD§7.2 |
| R9 | NFR-5 ("no event-log scans"); ARCHITECTURE §6 ("Neon holds only sessions…; the chain is the truth") | **Superseded for server workers** by FR-OPS-3/FR-OPS-5: chain events prove execution; Postgres owns drafts, grants, workflows and reconciliation projections; workers use checkpointed, bounded log queries. Browser pages still make no log scans. | WF§8 |
| R10 | SRS §1.2 / §7 "strictly on Whitechain Sepolia"; FR-GW-14 "no mainnet path exists" | **Extended:** Ethereum Sepolia is added as a source **testnet**. Still testnet only (CON-9); mainnet stays disabled behind W10. | WF§3, §11 |
| R11 | FR-PAY-15 (wallet = merchant identity); single-merchant env model (`MERCHANT_ADDRESS`, `SHOP_API_KEY`, `isShopInvoice`) | **Extended** by FR-BIZ-1, FR-BIZ-6 and FR-AUTH-1: identity is principal → membership → business, behind one AuthContext adapter. WF§4.1 asks for a vetted sign-in with a recovery path and passkey enrollment kept separate from wallet signing; the mechanism is a **pending human decision** (FR-BIZ-6). Until it is decided, wallet SIWE remains an adapter so W2 service work is not blocked. Demo-only eligibility checks are replaced by registered-business eligibility, not deleted. | WF§4.1, §6, §10; PRD§6, §14 |
| R12 | Duplicate ID FR-PAY-16 (SRS.md lines 110 and 111) | The owner sweep (v1.1, deployed) keeps **FR-PAY-16**. "Pay with your own wallet" becomes **FR-PAY-17** and is subsumed by FR-CHK-1. | SRS change control ("IDs are never reused") |
| R13 | PHASES "Never cut: the advance"; Phase 5 Capital tab screens | Deployed Capital contracts, server reads and existing positions stay. **No new Capital/lending screens** in Whiteflow scope. Legacy obligations are protected by CON-11. | WF§3 ("Lending/revenue advances: maintain legacy obligations only"), WF§10 |
| R14 | FR-PRIV-1…4, FR-ARK-* (sponsor tracks) | Kept where implemented; not extended; not part of Whiteflow acceptance. Cross-chain checkout reads made through the payer's own wallet provider are added to the FR-PRIV-4 exclusions (W7). | Owner instruction §4 ("preserve working integrations") |
| R15 | CON-5, CON-6, SR-* (hackathon submission) | Unchanged; not Whiteflow acceptance criteria. | — |
| R16 | FR-GW-14 badge vs FR-PAY-7 | The "Test mode · testnet" badge stays on every page (supports CON-9). | WF§11 (testnet/prod separation) |

## C. New requirements

Priority: M must / S should / C could. **W** = Whiteflow roadmap batch (WF§11).

### C.1 Business workspace, roles and receiving policy — FR-BIZ
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-BIZ-1 | A business workspace has a display name and an IANA timezone. A principal (signed-in account) can belong to several businesses through memberships; the active business is resolved on the server, never from a client-supplied id. | M | W2 | WF§4.1, §8 |
| FR-BIZ-2 | Membership roles Owner, Operator, Viewer with exactly the permissions of WF§9: Owner manages team/settings, approves receiving policies, publishes, authorizes refunds (subject to wallet authority); Operator drafts invoices, inspects payments, prepares links and refund proposals, but cannot change destinations or move treasury funds; Viewer reads only. Enforced in the shared services for dashboard, API and MCP. | M | W2 | WF§9 |
| FR-BIZ-3 | Receiving-wallet proof of control: a fresh, single-use, short-lived, domain-bound challenge (EIP-4361 format) signed by the receiving wallet. EOA signatures only; EIP-1271 contract wallets stay unsupported until an actual compatibility test passes. The status is labelled "wallet control confirmed", never business legitimacy. | M | W2 | WF§4.2–4.3, §9 |
| FR-BIZ-4 | Settlement policy versions are immutable rows: business, version, chain id, token address, recipient, policy hash, approver, approval evidence (wallet proof id), created time. The confirmation screen shows the full address with copy and explorer options, the network and the exact token, and requires an explicit confirm action. Only an Owner approves. A new version requires step-up authentication (engineering choice: a sign-in within the last 10 minutes, testnet value, labelled) and a fresh proof for the new address, notifies the other Owners and writes an audit event. Approved or published invoices keep their original policy version; changing settings or recovering an account can never redirect them. | M | W2 | WF§4.3, §4, §9; PRD§6 (settlement address changes) |
| FR-BIZ-5 | Activation: Whiteflow collection starts only when an approved policy exists. A new workspace can draft and preview invoices before activation. A receiving wallet with outstanding V1 Capital claims or liens stays on the V1 liability-aware payment path (V1 MerchantPay, which repays investors) and is refused for V2 and any new route (CON-11). Verification statuses are shown separately and only when actually checked: account authenticated · wallet control confirmed · domain confirmed (not implemented) · human verified (optional, W8) · business verified (not implemented). | M | W3 | WF§4.4, §9, §10; PRD§11.1 |
| FR-BIZ-6 | Verified workspace sign-in with a recovery path and passkey enrollment, using a vetted authentication implementation; login is kept separate from wallet signing (a passkey is not an EVM signer). **Owner decision 2026-11-06 (testnet):** wallet-only SIWE behind the shared AuthContext, with memberships and server-revocable sessions, kept separate from receiving-wallet proof; the absence of Whiteflow-side recovery is disclosed as a testnet limitation; email/passkey sign-in with reviewed recovery is required before broader pilots. No recovery path may change a policy or a published invoice. | M | W2 (testnet form) / before pilots (recovery) | WF§4.1, §6; PRD§19 |
| FR-BIZ-7 | Platform roles are separate from workspace roles: Platform support has redacted, scoped, audited diagnostic access with no payouts and no impersonation. Treasury administration is separate: tested multisig with distinct operators before production, least privilege, change delays where appropriate, explicit break-glass. A worker executes allowed intents only, never arbitrary vault withdrawals. Independent Approver / dual control is **deferred** to the team release. | M | W6/W9 | WF§9 |

### C.2 Authorization, idempotency and audit — FR-AUTH
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-AUTH-1 | One `AuthContext` {principal, business, role, scopes, grant or key id, request id, source} is produced by the cookie-session, API-key and OAuth adapters. Every shared service takes it and checks role/scope. Guessed or foreign ids return 404 with no disclosure. | M | W2 | WF§6, §8 |
| FR-AUTH-2 | Sessions are server-side and revocable (logout, membership removal, suspension). | M | W2 | WF§9 (stolen login); PRD§13 |
| FR-AUTH-3 | API keys belong to a business, carry scopes, show only a prefix after creation, and can be revoked. The env `SHOP_API_KEY` credential is confined to the labelled demo fixture. | M | W2 | WF§8; PRD§14 |
| FR-AUTH-4 | Every write takes business + operation + idempotency key and a canonical request hash (engineering choice: sorted-key JSON, SHA-256). Same key + same hash returns the original operation; same key + different hash returns 409. The idempotency record and the domain write commit in one transaction; uniqueness is enforced by the database under concurrency. | M | W2 | WF§8; PRD§12.3 |
| FR-AUTH-5 | Append-only audit events for every mutation: actor, source, role, grant/key id, request id, operation, target, version/hash, result. | M | W2 | WF§11 (W2 row) |

### C.3 Invoices and payment links — FR-BILL
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-BILL-1 | Invoice drafts are editable and private (off-chain): customer reference, description, optional line items, amount in settlement-USDT atomic units, concrete due date stored in UTC plus the business timezone. | M | W3 | WF§4.5, §8 |
| FR-BILL-2 | Approval creates an immutable invoice version binding business, invoice id/version, settlement policy version and hash, chain id, token, recipient, amount, fee policy and expiry, with a terms hash shown on the review page. Any change creates a new version and invalidates earlier approvals. | M | W3 | WF§6; PRD§7.1 |
| FR-BILL-3 | Draft, approval, on-chain issuance and link publication are distinct operations with distinct statuses. Publication never claims issuance before issuance is confirmed on chain. | M | W3 | WF§6 |
| FR-BILL-4 | A published invoice has a public payment link showing business display name, amount, token, network and due date; the customer needs no Whiteflow account. | M | W3 | WF§1, §4 |
| FR-BILL-5 | Capacity: credited amount plus active reservations never exceeds the approved amount. Testnet release supports one-off full payment only. | M | W3/W6 | WF§3; PRD§15 invariants |
| FR-BILL-6 | An unpaid published invoice can be cancelled; cancellation and payment resolve to exactly one terminal outcome. | S | W3 | WF§7 (races) |

### C.4 Customer checkout and receipt — FR-CHK
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-CHK-1 | The default customer path connects an existing EIP-1193 wallet; mobile deep links only where tested. No customer registration, World ID or AI subscription. The localStorage guest wallet is a labelled demo fixture disabled in production configuration. | M | W3 | WF§1, §4, §10 |
| FR-CHK-2 | Before any signature: total paid, business net, each fee and who pays it, network and exact token, the approvals/signatures required, source-gas requirement, expiry and recovery expectations. | M | W3 | WF§4 |
| FR-CHK-3 | Exceptional states — unsupported network/token; insufficient funds or gas; rejected signature; expired quote; insufficient destination liquidity; deposited but destination delayed; action required; cancellation requested; refund pending; refunded — each show one clear next action and a support reference. State survives refresh and wallet switching. The UI never invites a second payment while one is unresolved. | M | W3/W7 | WF§4 |
| FR-CHK-4 | Separate state machines for invoice, source funding, destination settlement, finality and recovery (vocabulary PRD§7.3); no single `paid` boolean decides the workflow. | M | W3/W4 | WF§8; PRD§7.3 |
| FR-CHK-5 | Public receipt: invoice/version, business display name, policy hash, exact source/destination assets and amounts, fees, original payer, funding vault (external route), chain evidence links, finality observed-at, refund totals. No customer PII or secrets. It proves the recorded payment, not service delivery. | M | W3 | WF§8; PRD§12.4 |
| FR-CHK-6 | Only routes that can execute (asset, liquidity, amount, wallet capability) are offered. Unsupported network/token/wallet and exchange-send cases are explained before any deposit; no escrow address is exposed as a universal payment address. | M | W3/W7 | WF§1, §4 |

### C.5 Refunds — FR-RFD
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-RFD-1 | Direct Whitechain refund: beneficiary is the original payer only; cumulative refunds ≤ gross; proposal → Owner approval bound to the exact terms → wallet-signed execution → verified on chain. Status is never "Refunded" before the chain shows it. | M | W3 | WF§6, §7; PRD§9 |
| FR-RFD-2 | Cross-chain full refund after settlement: business-funded USDT returns to a restricted refund vault; only after that is verified does the source refund treasury pay the original source principal under the locked terms. Two legs tracked separately; liquidity shortage shows "Refund pending". Original source-escrow proceeds are never refunded again after Paid. Required before the corridor is enabled. | M | W7 | WF§7; PRD§9 |
| FR-RFD-3 | Double-payment protection for refunds is on-chain, not only in the database: each refund payout binds the original payment and beneficiary, the approved exact amount and a unique refund id, and executes idempotently (V1 direct refunds already enforce cumulative ≤ gross in MerchantPay). | M | W3/W6 | WF§7 ("do not leave 'database said paid' as the only double-payment protection") |

### C.6 Durable financial operations — FR-OPS
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-OPS-1 | Versioned migrations: a `schema_migrations` record (file, checksum, applied time), an advisory lock, each file applied once in a transaction, checksum-drift refusal, a documented rollback per migration. | M | W4 | WF§8, §11 |
| FR-OPS-2 | Durable jobs (run-at, lease, attempts, dedupe key) driven by a scheduler independent of user traffic; request handlers only enqueue. | M | W4 | WF§8 |
| FR-OPS-3 | Chain event indexer: unique (chain id, contract, tx hash, log index); block number and hash stored; checkpointed bounded ranges with a supported fallback; confirmation depth; reorg detection and rewind. | M | W4 | WF§8 |
| FR-OPS-4 | One durable nonce coordinator per signer; execution attempts (nonce, raw-tx hash) written before broadcast; uncertain results become Unknown and are reconciled before any replacement with economic effect. | M | W4 | WF§7, §8 |
| FR-OPS-5 | Per-asset, per-chain, append-only balanced journal in integer atomic units with explicit clearing accounts; corrections by reversal; a reconciliation job compares journal, invoice totals and chain facts and reports every difference. USDC and USDT never balance each other. | M | W4 | WF§8 |
| FR-OPS-6 | Transactional outbox: business events commit with the state change; a dispatcher creates at most one delivery per (endpoint, event); retries with bounded backoff run without user traffic; manual replay takes the same lease; signed, timestamped payloads with stable event ids and published receiver idempotency instructions; SSRF guard rejects private targets, redirects and DNS rebinding (connects to the vetted address). Never marked delivered before durably queued. | M | W4 | WF§8 |
| FR-OPS-7 | Feature flags default OFF for cross-chain, MCP writes, World sponsorship and mainnet; a flag can never switch an existing intent's route. Route health (RPC freshness, relayer state, inventory) with observed-at timestamps and explicit stale/unknown indicators. | M | W4 | WF§11, §13 |
| FR-OPS-8 | Environment separation: each deployment pins its chain ids and registry and uses separate test/production data, keys, RPCs and deployments; a mismatch is refused in UI, API, contracts and verification. | M | W4 | WF§11; PRD A36 |
| FR-OPS-9 | Every rate limit and sponsorship budget (web per-IP limits, relayer limits, sponsored allowances) is durable across restarts and instances; no in-memory-only limiter on a money or abuse path. | M | W4 | WF§9 ("rate limits and sponsorship budgets must survive restarts") |
| FR-OPS-10 | Pause and change control: pausing new quotes/deposits is separate from existing entitlements; outcome recording and safe claims keep working while paused; disabling a route never loses an in-flight payment; contract upgrades or counterpart changes need a versioned migration plan and active intents keep their original version. | M | W6/W7 | WF§9; PRD§13 |

### C.7 Routes, registry and corridor — FR-RTE, FR-XC
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-RTE-1 | Versioned chain/token registry: chain id, token address, decimals, display symbol, verification evidence (bytecode, decimals, token behaviour, EIP-712 domain / permit / EIP-3009 support, proxy and issuer/admin controls, check date). Symbols never identify a token. Testnet entries cannot load in a mainnet configuration. | M | W3 | WF§7; PRD§2.2 |
| FR-RTE-2 | `RouteProvider` interface (capabilities, quote, prepare funding, observe funding, observe settlement, request recovery, recovery status). A route records source/destination chain and token addresses, amount bounds, fees, quote/deposit/destination deadlines, finality policy, liquidity/reservation state, refund method, provider trust model and health. Providers: `DirectWhitechain` (enabled) and `CanonicalInventorySepolia` (disabled until DEP-8 and the W6/W7 gates). A third-party provider is added only after an executable quote and success/failure/refund tests for the exact pair. The capability version is stored with every intent; a new route never changes an existing deposit's terms. | M | W3 | WF§7 |
| FR-RTE-3 | Versioned contracts and APIs: ABIs and addresses generated per version from tested artifacts; V1 consumers keep working; V1/V2 contract versions appear in receipts and route configs; webhook payloads and the SDK are versioned; `packages/sdk` and `apps/shop` are updated and their existing integrations tested. | M | W3/W6 | WF§10; PRD§14 |
| FR-XC-1 | `SourcePaymentEscrow` (Ethereum Sepolia): exact registry-token deposit bound to a signed quote, immutable payer/refund recipient, destination/domain, intent id and deadline; balance-delta check; transfer and zero-value canonical message dispatch in one transaction; terminal-claim bookkeeping. | M | W6 | WF§7; PRD§8.4, §8.6 |
| FR-XC-2 | `DestinationSettlementVault` (Whitechain): bounded prefunded inventory, on-chain reservations, intake only when `msg.sender` is the local messenger **and** `xDomainMessageSender()` is the paired escrow, idempotent duplicates, immutable mutually exclusive Paid/Cancelled with tombstones, outcome dispatch, permissionless retry of the stored outcome only. No arbitrary-calldata execution. | M | W6 | WF§7; PRD§8.4–8.7 |
| FR-XC-3 | `PaymentRouterV2`: approved invoice terms, remaining-capacity enforcement, designated vault funding path, exact net accounting, origin attribution (source payer ≠ funding vault). Public calls cannot bypass funding or authorization. Recipients with outstanding V1 obligations are refused (CON-11). Final ABI reviewed before implementation. | M | W6 | WF§7, §10 |
| FR-XC-4 | Source entitlement after authenticated outcome: Paid → fixed treasury claim; Cancelled → original refund beneficiary claim; withdrawals separate from outcome recording; a missing acknowledgement never triggers a unilateral refund. | M | W6 | WF§7 |
| FR-XC-5 | Quote only after the reservation is confirmed (UI shows "Preparing quote" meanwhile); the signed quote binds every PRD§7.2 term under a globally domain-separated intent id. Deadlines are experimental values from PRD§8.6 (10 min deposit, 60 min fulfilment), tuned from measurements. **Source expiry permits a cancellation request, not an immediate refund; a destination reservation is never released on an off-chain timer alone** — expiry terminally cancels on the destination (tombstone) or keeps the liability. Multiple source attempts never exceed the invoice's authoritative capacity. | M | W7 | WF§7 |
| FR-XC-6 | Keeper drives outcome prove/finalize/replay; failed inner relays are detected (outer success is not application success) and replayed without double execution. Nonce/hash stored before broadcast; uncertain results are Unknown and reconciled before any replacement with economic effect. | M | W7 | WF§7; PRD§8.6 |
| FR-XC-7 | Treasury controls: inventory and reservation monitoring, refund reserve, gas, replenishment. Usable destination inventory = confirmed balance − active reservations − unpaid liabilities − refund reserves − safety buffer; pending source deposits and assets elsewhere never count as Whitechain liquidity. Insufficient inventory disables new quotes without abandoning existing obligations. Production requires a proven replenishment route for the exact USDT (W10). | M | W7 | WF§7, §12 |
| FR-XC-8 | Settlement is requested only after the worker has enforced the documented source finality policy on the authenticated deposit evidence; the policy is disclosed as an operational trust assumption, not a cryptographic proof. Settlement atomically consumes the reservation, settles through RouterV2 and records Paid — no partial success (inventory debited but invoice unpaid). | M | W6/W7 | WF§7 steps 4–5 |

### C.8 Remote MCP — FR-MCP (continued)
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-MCP-6 | Remote MCP at an HTTPS Streamable HTTP endpoint using the official `@modelcontextprotocol/sdk`, pinned at W5 after re-verification (1.32.2 was current on 2026-11-06 and negotiates up to 2025-11-25). Supported protocol versions are those the target clients actually support, chosen and tested at W5. A thin adapter over the shared services; no second payments backend. Read/draft tools ship first; publication only when client eligibility permits. | M | W5 | WF§3, §6, §8 |
| FR-MCP-7 | OAuth: authorization-code with PKCE S256, RFC 9728 protected-resource metadata, RFC 8707 resource/audience validation, issuer and expiry checks, short-lived access tokens, refresh rotation, revocation; registration compatible with the target clients (pre-registration/CIMD/DCR); no token passthrough, no shared superuser key. | M | W5 | WF§6; S3 |
| FR-MCP-8 | Tools and scopes exactly as WF§6 (`get_business_account`, `draft_invoice`, `get_invoice`, `list_invoices`, `prepare_payment_link`, `publish_payment_link` (optional), `list_payments`, `get_payment_status`, `get_settlement_summary`, `propose_refund`, `get_refund_status`). No transfer, withdrawal, calldata, SQL, URL-fetch or key tools. Responses return ids and observed status — never keys, bearer tokens, signatures, payment authorization headers, World proofs or unnecessary PII. Accurate annotations. | M | W5 | WF§6 |
| FR-MCP-9 | Publication and refund proposals bind business, immutable version, policy hash, ids, token, amount, recipient, deadline and an operation hash; approval happens only on an authenticated review page by an authorized role, is consumed once and re-checks balance/refundable amount and role. Model-supplied approval flags and conversation text are never authorization. | M | W5 | WF§6; PRD§10.4 |
| FR-MCP-10 | Customer names, descriptions, memos and webhook payloads are untrusted: bounded, escaped, never fetched, and unable to change scopes, recipients or available tools. | M | W5 | WF§6; PRD§10.4 |
| FR-MCP-11 | Connections page: setup instructions, active grants, revoke; public-directory status stated accurately. Creating a link never implies sending it (invoice email is a separate, later scope). The dashboard never depends on an AI client's availability or subscription. | S | W5 | WF§4, §6 |

### C.9 Optional human verification — FR-WLD
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-WLD-1 | Optional World IDKit operator check under Settings → Security: server-generated short-lived signed request, server verification, atomic nonce + scoped nullifier consumption, environment binding (staging rejected in production), one sponsored onboarding allowance per human. Labelled "human verified — not business verification". Never required for checkout or ordinary invoicing. | C | W8 | WF§9; PRD§11 |

### C.10 Experience — FR-UX
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-UX-1 | User-facing brand Whiteflow. No unverified "any chain", "instant", "safe", "audited", "insured", "institutional-grade" or blanket "gasless" claims; no hard-coded performance figures. | M | W3 | WF§1, §12 |
| FR-UX-2 | Dashboard navigation: Overview, Invoices, Payments, Connections, Settings. Existing gateway features (links, pages, vouchers, QR, reports, developers) live inside these; checkout and receipt stay separate public pages; Capital stays legacy/beta outside main navigation with existing positions visible. | M | W3 | WF§4 |
| FR-UX-3 | Receivables, settled collections, fees and refunds are distinct metrics computed from records; a wallet balance is labelled as not revenue. | M | W3 | WF§4 |
| FR-UX-4 | Keyboard operation, visible focus, readable contrast, labelled controls, inline validation, wallet return path, no horizontal overflow at 360 px, no colour-only status. | M | W3 | WF§4 |

### C.11 Non-functional
| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-15 | Money | Integer atomic units with explicit decimals; reject zero, negative, malformed and excess-precision input; no floating-point money; rounding rules frozen in the quote schema. | Unit + property tests |
| NFR-16 | Privacy | Invoice descriptions, names, emails and line items stay off-chain; on-chain data is limited to commitments (salted where guessable) and payment references; no person-to-wallet links are published on-chain (e.g. for a verification badge). | Review + receipt/log/model-output scan (AT-26 public receipts; AT-32 MCP output) |
| NFR-17 | Secrets | No private keys, tokens or raw signatures in model context, production browser storage, logs or receipts; treasury/relayer keys unreachable from browser and MCP. | Grep + MCP output tests |
| NFR-18 | Freshness | Every status shows observed-at and an explicit stale/unknown indicator. | RPC/worker interruption test |
| NFR-19 | Integrity | Zero duplicate economic executions in the adversarial suite; every event accounted for in reconciliation. | Invariant + fault-injection tests |

## D. Constraints and dependencies
| ID | Item |
|---|---|
| CON-9 | Testnet only. Mainnet stays disabled until a written W10 launch decision; never reuse testnet addresses on mainnet. (WF§11, §14) |
| CON-10 | No autonomous agent spending, x402 buying, chat-held keys or model-triggered money movement. (WF§3, §6) |
| CON-11 | Legacy V1 obligations are preserved: businesses and wallets with outstanding CapitalMarket claims or liens keep collecting on the V1 liability-aware path (V1 MerchantPay repays investors) and are refused by V2 and every new route until a reviewed migration preserves the obligations. Removing Capital from navigation never erases entitlements. **Before mainnet**, liability checks must not be defeatable merely by opening a second workspace or using a fresh wallet (W10 gate). (WF§10) |
| CON-12 | No simulated bridge or mock settlement in any real payment path; mocks only in isolated tests or labelled demo fixtures. (Owner instruction §6, §9; WF§3) |
| CON-13 | Pixa is a pattern reference only; no code copied. This deliberately tightens WF§5 (which allows copying with license notices) because CON-1 Start Fresh still applies to this repository. (WF§5) |
| CON-14 | Out of scope for this release: fiat conversion and bank payouts, new lending/revenue-advance features, autonomous agent spending/x402 buying, token creation, DEX trading, public liquidity pools or yield (treasury funding never via public LP pools or yield promises), partial or recurring payments. (WF§3, §7) |
| DEP-8 | Canonical zero-value message round trip on the deployed Ethereum Sepolia L1CrossDomainMessenger `0x547967f45d19dc4ca0a056ba525afe99bda18a88` ↔ Whitechain L2 messenger `0x4200…0007`, including authenticated origin and failed-relay replay (W1). Pairing and CGT mode verified read-only 2026-11-06; delivery unproven. Fallback: corridor stays disabled; direct-only release. |
| DEP-9 | Circle Sepolia USDC test funds and Sepolia ETH for the payer and operator test wallets. |
| DEP-10 | Real MCP client connectivity (Claude custom connector; any ChatGPT surface separately). Public-directory approval is a separate external gate. |
| DEP-11 | World developer app registration (only if W8 is enabled). |
| DEP-12 | Owner-provided `.env` values (names listed in `notes/whiteflow-status.md`): Postgres URL, funded testnet keys, RPC URLs. |

## E. Acceptance tests AT-19 … AT-56 (WF§12, the 38-item minimum checklist)

All start unchecked; a box is checked only with reproducible evidence.

**Product and onboarding**
AT-19 Whiteflow branding consistent; no unverified "any chain", "instant", "safe", "audited" or "institutional-grade" claims. ·
AT-20 A new business can create a draft before completing collection activation. ·
AT-21 Receiving-wallet proof and immutable policy are enforced; a changed policy cannot redirect an existing invoice. ·
AT-22 A customer pays without a Whiteflow account, World ID or AI subscription. ·
AT-23 Unsupported network/token/wallet/exchange-send cases are explained before a deposit. ·
AT-24 Exact fees/net receipt and recovery limitations are visible before approval. ·
AT-25 Mobile wallet return, refresh and expired-quote flows preserve correct state. ·
AT-26 Public receipts avoid private invoice/customer information.

**Authorization and MCP**
AT-27 Tenant spoofing and guessed ids fail for every session/API/MCP entry point. ·
AT-28 Viewer/Operator cannot elevate permissions or modify the receiving policy. ·
AT-29 OAuth expiry, wrong audience, wrong issuer, revoked grants and insufficient scopes fail. ·
AT-30 Prompt injection in invoice descriptions cannot cause privileged tools or recipient changes. ·
AT-31 Duplicate requests are idempotent; a changed payload under the same key conflicts. ·
AT-32 MCP never returns private keys, bearer credentials or payment authorization headers. ·
AT-33 Independent review invalidates changed invoice/refund terms; conversation text cannot authorize funds. ·
AT-34 Real client connectivity is demonstrated and public-directory status is stated accurately.

**Contracts and cross-chain correctness**
AT-35 Wrong token/amount/chain/domain/recipient/nonce/expired quote is rejected. ·
AT-36 Concurrent quotes/deposits cannot overspend inventory or invoice capacity. ·
AT-37 Only authenticated canonical counterpart messages are accepted. ·
AT-38 Destination Paid and Cancelled cannot both occur for an intent. ·
AT-39 Cancel-before-deposit and deposit-before-cancel produce correct immutable outcomes. ·
AT-40 A missing acknowledgement cannot trigger a unilateral source refund. ·
AT-41 Replayed outcomes cannot create a second treasury/refund entitlement. ·
AT-42 A failed inner message relay is detected and recoverable without double execution. ·
AT-43 Source payer is distinguished from destination vault in receipts/refunds. ·
AT-44 Reorg/RPC disagreement fails closed under the documented finality policy. ·
AT-45 Token pause/blocklist failures preserve recorded entitlement and accurate pending state. ·
AT-46 Full external success, cancellation, claim and post-settlement refund are demonstrated on deployed testnet contracts. ·
AT-47 Legacy claims cannot be bypassed by migration or a new route.

**Operations and business readiness**
AT-48 Worker crash/restart and uncertain broadcast do not duplicate financial actions. ·
AT-49 On-chain records, invoice totals and the per-asset ledger reconcile. ·
AT-50 Webhook loss/retry/replay and consumer idempotency are exercised. ·
AT-51 Inventory shortage disables quotes without abandoning existing obligations. ·
AT-52 Treasury reservation, refund coverage, gas and replenishment are monitored. ·
AT-53 Backup restore, key recovery, route pause and incident escalation are rehearsed. ·
AT-54 Optional World proof replay/environment controls pass; the label says human, not legitimate business. ·
AT-55 Runtime versions, dependencies, source history, license notices and reproducible build instructions are recorded. ·
AT-56 Mainnet exact asset, route, security, operational, economic and eligibility gates are approved before real funds.

## F. Proposed PHASES.md rows (WF§11; gates = exit evidence)

| Phase | Delivers | Gate |
|---|---|---|
| W0 Baseline | Inventory, matrix, this proposal | Baseline report with fresh check output (`notes/phase-W0-baseline.md`) |
| W1 Route experiment | DEP-8 | Source/destination/outcome tx evidence; failed-inner-call handling; measured timing; economics note |
| W2 Identity & service boundary | FR-BIZ-1–4, 6; FR-AUTH-1–5 | AT-27, AT-28, AT-31 (service level); policy-change invalidation; migration/backfill plan |
| W3 Direct collection | FR-BIZ-5; FR-BILL-*; FR-CHK-*; FR-RFD-1, FR-RFD-3; FR-RTE-*; FR-UX-* | Real testnet direct payment and refund end to end; AT-19–AT-26; desktop/mobile checks |
| W4 Durable operations | FR-OPS-1–9; FR-REL-10 | AT-48, AT-49, AT-50; crash/restart, duplicate, RPC-uncertainty, reorg evidence |
| W5 MCP | FR-MCP-6–11 | AT-29, AT-30, AT-32, AT-33, AT-34 |
| W6 Corridor contracts | FR-XC-1–4, FR-XC-8; FR-OPS-10; FR-BIZ-7 (treasury separation) | AT-35–AT-45, AT-47 in unit/fuzz/invariant/fork tests; no fake bridge |
| W7 Cross-chain UX | FR-XC-5–7; FR-RFD-2 | AT-46, AT-51, AT-52; reconciled balances |
| W8 Optional World | FR-WLD-1 | AT-54; checkout unaffected |
| W9 Pilot readiness | runbooks, evidence | AT-53, AT-55; all applicable boxes evidenced; documented limitations |
| W10 Mainnet decision | CON-9 | AT-56 (human/external) |

Feature flags default off for cross-chain, MCP writes, World sponsorship and mainnet (WF§11). Dependencies (WF§11): W1 and W2 run independently after W0; W3 needs W2 and does not wait for W1; W4 needs W2 and integrates W3; **W5 needs W2–W4 and cannot bypass missing durable services**; W6 needs W1 and frozen W2/W4 interfaces; W7 needs W4 and W6; W8 needs W2 and is optional; **W9's gate also requires no critical unresolved money/auth defects**; W10 needs pilot evidence. If W1 fails, W6/W7 stay disabled and the direct path continues.

## G. Per-batch gate artifacts (WF§11)
Every Whiteflow batch records in its spec/build files: problem and acceptance criteria, SRS mapping, affected interfaces, migrations, tests with real output, residual risks, rollback plan and evidence links. (Adding these headings to `tools/batch-start.sh`'s template is a pipeline change and needs the human, PIPELINE §11; until then batches include them by hand.)

## H. Engineering choices (reversible, not requirements)
Labelled so they are not mistaken for owner rules: EIP-4361 format for wallet proofs (FR-BIZ-3); 10-minute step-up window (FR-BIZ-4); sorted-key JSON + SHA-256 canonical hash (FR-AUTH-4); 404 for foreign ids (FR-AUTH-1); "insured" added to the banned-claims list and "no colour-only status" (FR-UX-1/4); 10/60-minute corridor deadlines come from PRD§8.6, not WF. External facts used here (SDK version, messenger addresses, token metadata) carry their verification date and are re-checked at the batch that relies on them.
