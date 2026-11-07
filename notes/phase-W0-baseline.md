# Whiteflow W0 — baseline and requirement matrix (2026-11-06)

Evidence rule: "fresh" = run in this workspace on 2026-11-06. Historical claims from notes/README/PHASES are labelled historical and are **not** evidence for Whiteflow.

## 1. Workspace and versions (fresh)
| Item | Value |
|---|---|
| Inputs present | `merchant-capital-plus-main/` (app base), `Pixa-main/` (reference only), `Whiteflow-Final-Vision-and-Claude-Build-Plan.md` (authoritative), `Business-Payments-Final-PRD.md` (supporting) |
| Repository HEAD | **None — not a git checkout** (`git rev-parse` fails). Upstream remote per README: github.com/Vishal4742/whiteflow. The authoritative doc cites reviewed commit label `3cd0dc96…`; it cannot be confirmed here. |
| Node / npm | v24.14.0 / 11.9.0 (CI and `apps/relayer`, `apps/shop` engines pin Node 26.x → `EBADENGINE` warnings) |
| Foundry | Initially **not installed** and `contracts/lib/*` **empty**. Restored 2026-11-06 with owner approval: Foundry v1.8.6 (official win32 release, SHA-256 `924d6395…dcfff` matched the published checksum; forge commit `6bad0a66`) in `~/tools/foundry-v1.8.6`; forge-std v1.17.0 at `f3dae6e6…` and OpenZeppelin v5.7.0 at `cab19933…` (both equal to `foundry.lock`) |
| Other | Python 3.13.14, psql 18.4 client, git 2.49, gh CLI present; no Docker |
| `.env` | none exists → no DB URL, no keys, no funded wallets: every live testnet transaction is blocked until the owner configures them |
| Key deps (lockfiles) | next 16.4.3, react 19.3.0, viem 2.57.13, @neondatabase/serverless 1.2.0, @electric-sql/pglite 0.5.11 (tests), typescript 5.9.3 (web/sdk) / 7.0.2 (relayer/shop), eslint 9.39.5 |

## 2. Baseline checks (fresh, before any Whiteflow change)
| Package | Command | Result |
|---|---|---|
| packages/sdk | `npm run typecheck` | exit 0 |
| packages/sdk | `npm test` (`node --test test/`) | **fails on Node 24** (directory arg → MODULE_NOT_FOUND). Same files via `node --test 'test/*.test.ts'`: **47/47 pass** |
| apps/relayer | `npm run typecheck` / `npm test` | exit 0 / **62/62 pass** |
| apps/shop | `npm run typecheck` / `npm test` | exit 0 / **5/5 pass** |
| apps/web | `npx next typegen && npx tsc --noEmit` | exit 0 |
| apps/web | `npm run lint` | exit 0 |
| apps/web | `npm test` (whole dir) | hangs locally (anon.test.mjs never finishes) |
| apps/web | per file, 61 files, 180 s timeout each | **562 pass · 14 fail · 2 skipped**. Failing files: `docs-reference` (5), `test-mode` (1) — Windows path handling (`app\api\…`, `P:\P:\…`); `anon` (2, + timeout), `guest-wallet` (1), `arkiv-probe` (3) — failures inside `node:test` module mocks on Node 24; `merchant-wallet` (2) — timing assertion. None touches money/auth paths, but they are **not passing** here and not re-verified on Node 26/Linux. |
| contracts | `forge build` / `forge test -vv -j 1` (CI form; fork tests on the official Whitechain RPC) | exit 0 (80 files, solc 0.8.38) / **154/154 pass, 11 suites** (fresh, 2026-11-06) |

Historical (not fresh): web 584 tests/582 pass (batch 030 ci.md), forge 154 tests (batch 009), coverage MerchantPay 97.78% (notes/phase-4-contracts.md).

## 3. Implementation matrix
Status vocabulary: Implemented and verified (fresh check) · Implemented but unverified · Missing · Blocked by external dependency · Deferred by the authoritative scope. SRS IDs for new work are the **proposed** v3.0 IDs (`docs/SRS-v3.0-Whiteflow-PROPOSAL.md`), not yet approved.

| Requirement | Source | Existing code | Status | Missing work | Verification |
|---|---|---|---|---|---|
| Whiteflow branding, no unverified claims | WF§1, §12 | "Whiteflow" throughout; landing hard-codes "1.4 s median", "0 gas", "T+0" (`components/landing/Sections.tsx:88`, `HeroSheet.tsx:64`); dashboard "Settled: T+0" constant (`app/merchant/page.tsx:108`) | Missing | Rebrand user-facing copy; remove unmeasured claims (FR-UX-1) | Copy grep + screenshots (AT-19) |
| 5-item navigation | WF§4 | Many separate merchant pages (links, pages, vouchers, reports, settlements, developers) | Missing (partial) | Re-home under Overview/Invoices/Payments/Connections/Settings (FR-UX-2) | Screens at 1440/360 |
| Business workspace, memberships, roles | WF§4, §9 | Tenant = lowercase wallet address; no businesses/memberships/roles tables (`db/001…050`); single-merchant env model `MERCHANT_ADDRESS`/`SHOP_API_KEY`, `isShopInvoice` (`lib/settle.ts:94`) | Missing (partial) | FR-BIZ-1/2, FR-AUTH-1 | Role × route matrix tests (AT-27/28) |
| Wallet-scoped tenant isolation (existing) | WF§6 | Every dashboard/API query scoped by server-derived merchant; foreign ids → 404 | Implemented and verified (fresh: cross-merchant tests in gw-keys, gw-links, gw-pages, gw-refunds, sessions-v2, gw-webhooks, capital-routes pass) | Re-key to business id preserving the pattern | Same tests after re-key |
| Sign-in | WF§4.1 | SIWE + stateless HMAC cookie `{a,e}`, 8 h (`lib/auth.ts:31-47`) | Implemented but unverified (partial) | Server-side revocable sessions (FR-AUTH-2); recovery mechanism undecided (FR-BIZ-6) | Revocation tests |
| Receiving-wallet proof + immutable policy versions | WF§4, §9 | Sign-in signature only; no policy table | Missing | FR-BIZ-3/4 | AT-21, policy-change invalidation test |
| Activation checklist & honest labels | WF§4.4, §9 | Onboarding 3-step checklist (batch 029) for the configured shop | Missing (partial) | FR-BIZ-5 incl. V1-obligation check (CON-11) | AT-20 |
| Idempotency | WF§8 | Only `POST /api/v1/sessions`: slot `merchant:key`, raw-body hash, not atomic with domain write (`app/api/v1/sessions/route.ts:43-87`) | Implemented and verified for that route (fresh: sessions-v2/sessions-db) · Missing elsewhere | Generic business+operation+key, canonical hash, same transaction (FR-AUTH-4) | AT-31 + concurrency/crash tests |
| Audit log | WF§11 W2 | None | Missing | FR-AUTH-5 | Mutation → audit row tests |
| Invoice draft → approve → issue → publish | WF§4.5, §6 | V1 on-chain invoices created from the merchant wallet; customer name/label only in browser localStorage (`components/merchant/Invoices.tsx:56`); no drafts/versions | Missing (partial) | FR-BILL-1…6 | AT-20/21, real testnet payment |
| Customer checkout with existing wallet | WF§4, §10 | Default signer = raw private key generated into localStorage `mcplus.guestKey` (`lib/guest-wallet.ts`); no injected/deep-link path | Missing (HIGH defect) | FR-CHK-1; guest wallet → labelled demo fixture | AT-22, AT-25, mobile test |
| Pre-sign disclosure, exceptional states | WF§4 | Clear copy for some states; every relayer 422 shows "start the checkout again" incl. `replay` while a tx may be pending (`lib/relay.ts:87-89`) → can invite a second payment | Implemented but unverified (partial) | FR-CHK-2/3 | AT-23/24/25 |
| Money math | WF§8 | BIGINT 6-dp units server-side; fee read at execution (contract) | Implemented but unverified (partial) | Reject excess precision everywhere; freeze rounding in quote schema (NFR-15) | Property tests |
| Receipt | WF§8 | `/r/[id]` shows one gross figure and "Network fee: None" even when invoice payer paid the fee on top (`app/r/[id]/page.tsx:145`) | Implemented but unverified (partial) | FR-CHK-5 fields; fix fee display | AT-26 |
| Direct refund | WF§6–7 | Contract: merchant-only, payer beneficiary, cumulative ≤ gross (`MerchantPay.refund`); UI one-click from wallet | Implemented but unverified | Proposal/approval binding (FR-RFD-1) | Live testnet refund trace |
| Metrics distinct, no fabricated balance | WF§4 | Fees tile = current fee × count (`app/merchant/page.tsx:104`); gross includes invoice fee (`lib/dashboard.ts:12`); balance card = merchant wallet USDT | Implemented but unverified (partial) | FR-UX-3 | Reconciliation vs chain |
| Accessibility / 360 px | WF§4 | Some labels/focus; G4 review left 375 px merchant pages unverified | Implemented but unverified (partial) | FR-UX-4 | Keyboard + 360 px audit |
| Durable state, versioned migrations | WF§8 | 13 idempotent SQL files, forward-only runner, no version table (`db/migrate.mjs:16`) | Implemented but unverified (partial) | FR-OPS-1 | Migration tests |
| Separate status machines | WF§8 | Session pending/paid + chain reads; no separate funding/settlement/finality/recovery states | Missing (partial) | FR-CHK-4 | State-machine tests |
| Event indexer, reorg handling | WF§8 | None (Blockscout API + Multicall reads; NFR-5 forbids log scans) | Missing | FR-OPS-3 | Reorg simulation (AT-44) |
| Nonce coordinator, write-ahead attempts | WF§7–8 | Relayer: in-memory nonce/lock/replay set; tx hash computed but not persisted (`apps/relayer/src/relayer.ts:141,189,444`) | Missing (HIGH defect) | FR-REL-10 (batch 031 Part B), FR-OPS-4 | Two-instance tests, crash tests (AT-48) |
| Durable jobs / scheduler | WF§8 | `dispatchSoon` after reads; dispatch route needs an external cron; `vercel.json` has none | Missing (partial) | FR-OPS-2 | Idle-app retry test |
| Journal + reconciliation | WF§8 | None (reports computed from chain logs) | Missing | FR-OPS-5 | AT-49 |
| Webhook outbox, retries, SSRF | WF§8 | Signed `MC-Signature` t/v1 HMAC, stable event ids, retries 1/5/30 m, replay, SSRF blocklist + no redirects; **dedupe key committed before deliveries** (`lib/server/events.ts:91`, HIGH); replay without lease; DNS-rebinding window | Implemented but unverified (partial) | Atomic key+deliveries + lease (**batch 031 Part A, built**); full outbox (FR-OPS-6) | gw-outbox tests; AT-50 |
| Feature flags, route health, env separation | WF§11 | Test-mode badge; relayer `/health` hard-codes `paused:false` (`relayer.ts:516`) | Missing (partial) | FR-OPS-7/8 | AT-56 precursor tests |
| Relayer budgets/limits/breaker across instances | WF§9 | Per process despite PHASES.md:62 claiming a Postgres lock (doc drift) | Missing (HIGH) | Batch 031 Part B (FR-REL-10) | Two-instance PGlite tests |
| MerchantPay V1 preserved | WF§10 | Deployed `0xab81…4251` (verified source, `contracts/src/MerchantPay.sol`) | Implemented and verified (fresh forge 154/154 incl. MerchantPay/Edges suites; deployed bytecode match not re-checked) | Keep; V2 separate | forge test once toolchain restored |
| Legacy obligations not bypassable | WF§10 | `CapitalMarket.onPayment` accepts only V1 MerchantPay (`CapitalMarket.sol:212`); liens keyed per address, `paySale` merchant is caller-chosen (`MerchantPay.sol:177`); financed invoice payable via `paySale` (`MerchantPay.sol:186`) | Implemented but unverified (partial; HIGH bypass risks) | CON-11: refuse wallets with V1 claims/liens at activation and in V2; no migration without review | AT-47 |
| PaymentRouterV2, escrow, vault, refund vault | WF§7 | None | Missing | FR-XC-1…4 (W6) after DEP-8 | AT-35…45 |
| RouteProvider + registry | WF§7 | Single-chain constants in `packages/shared/contracts.ts` (generated by `forge inspect` from source, not from deployed artifacts) | Missing (partial) | FR-RTE-1/2 | Registry tests |
| Remote OAuth MCP + tools | WF§6 | None (`packages/mcp` absent; SRS FR-MCP-1…5 describe a local stdio server; FR-MCP-5 agent pays — conflicts) | Missing | FR-MCP-6…11 (W5) after W2/W4 | AT-29…34 |
| World verification | WF§9 | None | Deferred by the authoritative scope (optional W8) | FR-WLD-1 | AT-54 |
| Cross-chain corridor proof | WF§7, §11 W1 | None; live read-only checks done (below) | Blocked by external dependency (funded Sepolia + Whitechain keys; Foundry) | W1 experiment | Tx evidence (DEP-8) |
| Setup/runbooks/evidence | WF§14 | README partial; `.env.example` omits many names the code reads | Implemented but unverified (partial) | W9 docs | Cold-read review |

## 4. Process infrastructure (repo controls vs this workspace)
| Control | State here | What I do instead (documented alternative where one exists) |
|---|---|---|
| `tools/pipeline-gate.sh` hook | Script works when invoked (fresh: denies `apps/` edit with no batch); **not loaded** by these sessions because the settings live in the sub-repo | Run it manually before product edits; batches + SRS-cited specs as required |
| agentbus | `tools/agentbus.py` imports POSIX `fcntl` → crashes on Windows | Claims/DONE recorded in batch.md and reported to the owner (batch-close.sh's own fallback: "post DONE by hand") |
| claude-research lane, HANDOFF.md, supermemory, `~/ethglobal` | absent | Lead engineer drafts SRS changes for **human approval**; decisions logged in `notes/whiteflow-status.md` |
| Outside opinions (codex/cmdc) | not installed | Independent reviewer subagents; outside opinion recorded as skipped |
| GitHub CI, pre-push hook, commits | no git checkout | Phase-mode local checks (PIPELINE §3b) written to ci.md; **no commits** |
| Node 26 / Foundry | Node 24 only (CI pins 26); Foundry 1.8.6 installed with owner approval | Record Node discrepancies; forge runs locally from ~/tools/foundry-v1.8.6/bin |

## 5. External facts verified read-only on 2026-11-06 (live RPC + official docs)
| Item | Fact | Method |
|---|---|---|
| Whitechain Sepolia | chain 1874 (0x752), official RPC `https://rpc.testnet.whitechain.io`; Ankr URL used by the code is unofficial (works) | eth_chainId; docs.whitechain.io/learn/network/testnet |
| Legacy 2625 | stopped 2026-10-26; viem `whitechainTestnet` is the legacy chain — use `whitechainSepolia` | docs migration page |
| Settlement USDT `0xcedfB561…55a7` | EIP-1967 proxy → TetherTokenV2; decimals 6; name "Tether USD"; EIP-3009 + permit selectors present; DOMAIN_SEPARATOR matches {Tether USD, 1, 1874}; upgradeable by its admin | eth_getCode/eth_call/storage |
| Sepolia USDC `0x1c7D4B19…7238` | Circle-listed; decimals 6; symbol USDC; version "2" | Circle docs + eth_call |
| L1 messenger `0x547967f4…8a88` (Sepolia) | v2.11.0, OTHER_MESSENGER = 0x4200…0007, not paused | eth_call |
| L2 messenger `0x4200…0007` (1874) | v2.2.0, OTHER_MESSENGER = 0x5479…8a88, not paused | eth_call |
| Custom gas token mode | ON (SystemConfig + L1Block); Portal/L2ToL1MessagePasser revert on msg.value > 0 → **zero-value messages only** | eth_call + bytecode error selectors |
| Testnet withdrawal timing | proofMaturity 900 s, dispute finality 300 s, permissioned game type 1, proposer live; docs: ~1 h typical, ~3 h worst | eth_call + docs |
| L2 state history on public RPC | eth_getProof works ~60k blocks back, not 100k (~17–28 h) | eth_getProof probes |
| MCP SDK | `@modelcontextprotocol/sdk` 1.32.2 (2026-10-23), Streamable HTTP + bearer/PRM helpers; latest negotiated protocol 2025-11-25; current spec 2026-07-28 (DCR deprecated) | npm registry tarball + spec |
| Claude connector | callback `https://claude.ai/api/mcp/auth_callback`; supports DCR, CIMD; needs 401 + `WWW-Authenticate resource_metadata`; PKCE S256 | claude.com/docs/connectors |

**Unproven (needs funded keys):** actual L1→L2 message delivery and latency, L2→L1 prove/finalize on this deployment, failed-relay replay on these versions.

## 6. Contract / chain / token registry (testnet only)
| Role | Chain | Address | Status |
|---|---|---|---|
| Settlement USDT | 1874 | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | verified live (above) |
| MerchantPay V1 (current) | 1874 | `0xab817593253a0a37de723072827d88fe0ca54251` | deployed (broadcast DeployPhase3, commit ef5fee4) |
| CapitalMarket V1 | 1874 | `0xecd63a369d23dfddc6bfac921e41a86760c20abe` | deployed; `merchantPay()` = V1 above |
| ClaimToken V1 | 1874 | `0xce9b171a5c485a41dced9d7f043733bddc26c388` | deployed |
| InvestorRegistry V1 | 1874 | `0x293430fae87ca79844c6e3a64e8044078c4d3e74` | deployed |
| Retired MerchantPay | 1874 | `0x83b53cc0…73b7` (paused), `0x8effc3e2…248f` (paused; not in broadcast records) | keep paused |
| PullStub (rail proof) | 1874 | `0x51e2e2a5…325d` | not used by Whiteflow |
| Sepolia USDC (proposed source) | 11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | verified live; corridor disabled |
| L1CrossDomainMessenger | 11155111 | `0x547967f45d19dc4ca0a056ba525afe99bda18a88` | verified live |
| L2CrossDomainMessenger | 1874 | `0x4200000000000000000000000000000000000007` | verified live |
| OptimismPortal / DisputeGameFactory | 11155111 | `0xff9b597b0781457ae6aa7256ca5ed5839bf7d0c3` / `0xfaa2faa8912c069c01abc169c33713c79027c833` | verified live |

## 7. Pixa (reference only — no code copied, CON-1/CON-13)
Adopt: one `register<Tool>(server, deps)` function per tool, zod input schemas, uniform `{content, isError}` result shaping, small tool surface. Reject: local private keys/wallet store, process-memory float budgets, signed payment headers returned to the model (`src/tools/pay.ts:121`), arbitrary URL fetch with auto-pay (`src/tools/x402-fetch.ts`), transfer/swap/token tools, hub dedupe by global correlation id without tenant/body comparison (`pixa-hub/src/api/pay.ts:153`), unconsumed request nonces (`src/core/auth.ts:102`), connection leak on early return. Pixa pins `@modelcontextprotocol/sdk ^1.26.0` (resolved 1.27.1); Whiteflow pins 1.32.2.
