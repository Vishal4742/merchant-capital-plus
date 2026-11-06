# AI usage

ETHGlobal asks teams to say where AI was used, down to files, and to commit spec files, prompts and planning artifacts. This file is that record. It is updated at every batch close.

## How we worked
- **Human:** chose the idea and every product decision, approved each spec that was a product decision, saw every batch working before it shipped (the "human gate" in `PIPELINE.md`), answered the "grill me" questions, narrated the video and gives the pitch.
- **AI coding agents (Claude Code):** four sessions with fixed lanes: claude-contracts (`contracts/`, `packages/shared/`), claude-relayer (`apps/relayer/`), claude-frontend (`apps/web/`, `apps/shop/`), claude-research (docs). Subagents test and review each batch (tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci). Outside models (Codex, Kimi K3) gave read-only second opinions on contract diffs.
- **The process is enforced:** a hook blocks product-code edits unless a batch spec cites a requirement from `docs/SRS.md` (`tools/pipeline-gate.sh`).

## Planning artifacts (committed)
| File | What | Written |
|---|---|---|
| `docs/SRS.md` | Requirements, acceptance tests | Before the event (planning), approved by the human |
| `ARCHITECTURE.md`, `PHASES.md`, `PIPELINE.md`, `AGENTS.md` | Design, delivery plan, process, rules | Before the event (planning) |
| `research_notes/`, `research/`, `HANDOFF_LOG.md` | Prize research, Whitechain inventory, build-plan research, the agents' running log | Before and during the event; kept local, not in the public repo (competitive strategy) |
| `.batches/NNN-*/` | Every change: spec, build reports, test and review verdicts | During the event |

## Per-file record (filled at each batch close)
| File / folder | Written by | Reviewed by | Batch |
|---|---|---|---|
| `contracts/` (foundry.toml, src/PullStub.sol, test/, script/), `.gitmodules` | claude-contracts (tests first: RED 7ab43b5 → GREEN 8710439) | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 1) + human gate | 001-P1-rail-proof |
| `apps/web/` (Next.js skeleton, `lib/anon.ts` Nym transport with pinned worker hash, `lib/guest-wallet.ts`) | claude-frontend | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 3, after 2 rounds of fixes) + human gate | 001-P1-web-rail-proofs |
| `apps/relayer/` (`POST /relay` stub, `GET /health`, dev server) | claude-relayer | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 3, after 2 rounds of fixes) + human gate | 001-P1-relay-stub |
| `apps/web/` design foundation (tokens.css, fonts, DitherScene, Button, HoldButton) | claude-frontend | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 3) + human gate | 002-P2-web-design-foundation |
| `apps/web/lib/arkiv.ts`, `apps/web/scripts/arkiv-probe.ts` | claude-frontend | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 2) + human gate | 003-P1-arkiv-probe |
| `contracts/src/MerchantPay.sol`, its tests and deploy/smoke scripts, `packages/shared/merchantPay.ts` | claude-contracts (tests first) | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 1) + outside opinion + human gate | 002-P2-merchantpay |
| `contracts/script/` demo seed (fund + reclaim) | claude-contracts | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 1) + human gate | 004-P2-seed |
| `apps/web/` pages (home, checkout, receipt, merchant), SIWE sign-in, sessions API | claude-frontend (+ plan-reviewer, which caught a SIWE replay blocker) | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 2) + human gate | 004-P2-web-pages-and-sign-in |
| `contracts/src/` CapitalMarket, ClaimToken (ERC-1155 + ERC-7943), InvestorRegistry, final MerchantPay; `packages/shared/contracts.ts` | claude-contracts (tests first) | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 2) + Codex outside opinion + human gate | 005-P3-advance |
| `apps/relayer/` drain guard (allowlist, simulate-before-send, caps, windows, payer-has-code refusal, 6 gwei cap) | claude-relayer | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 3) + claude-review drain review + human gate | 002-P2-drain-guard |
| `contracts/script/LiveInvoice.s.sol`, `contracts/test/EventAbi.t.sol`, seed fee top-up | claude-contracts | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 2) + human gate | 006-P4-g4-live |
| `apps/web/` invoices (fee on top, part payments), refunds (exact approval), payments table | claude-frontend | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 2) + human gate | 005-P2-web-invoices-refunds |
| `packages/sdk/` (Gateway client: sessions, payments, webhook verify/sign; zero dependencies) | claude-sdk (tests first) | tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci (all PASS round 2) + human gate | 005-P4-sdk-core |
| `apps/relayer/` MerchantPay paySale/payInvoice relay | claude-relayer | 5 checks PASS + human gate | 007-P2-merchantpay-relay |
| `packages/sdk/` pay button (`button.js`, DOM-clobbering guard) | claude-sdk | 5 checks PASS (round 2, after a HIGH) + human gate | 007-P4-sdk-button |
| `apps/web/app/api/v1/{links,pages,vouchers,quotes,reports,settlements,keys,webhooks}`, `apps/web/lib/server`, `apps/web/db` | claude-contracts + 3 developer subagents | 5 checks PASS (round 2, after a voucher-oversell HIGH) + human gate | 007-P4-gateway-api |
| `apps/web/` gateway shell: test-mode strip, sessions v2 + FX, payments API, checkout upgrades, dashboard shell, `/docs` | claude-frontend | 5 checks PASS (round 2) + human gate | 006-P4-web-gateway-shell |
| `apps/relayer/` NFR-4: plain send + 300 ms receipt polling + batched reads | claude-relayer | phase mode: ci + reviewer-security PASS + human gate | 008-P2-nfr4-async-send |
| `apps/web/` gateway review fixes (FX band, relay secret header, auth, sessions) | claude-frontend | phase mode checks PASS + human gate | 008-P4-web-review-fixes |
| `apps/web/` landing page (gateway story, design v8) | claude-frontend | phase mode: ci PASS + human gate | 009-P4-web-landing |
| gateway API follow-ups | claude-contracts | phase mode: ci + reviewer-security PASS (round 1) + human gate; full review at the G4 phase gate | 008-P4-gateway-followups |
| `apps/relayer/` Postgres send lock, `rel_sent`, breaker, rate limits, daily WBT budget, shared secret | claude-relayer | 5 checks PASS + human gate | 006-P2-neon-limits |
| `apps/relayer/` Vercel production deploy (keys as Sensitive, Production only; human yes 06:10) | claude-relayer | phase mode: ci + reviewer-security PASS + human gate | 009-P2-vercel-deploy |
| `apps/web/` payment links, payment pages, QR codes, gateway API client | claude-frontend | phase mode: ci + reviewer-security PASS; full review at the G4 phase gate | 010-P4-web-links-pages-qr |
| `apps/web/lib/server/` FX-priced link and page sessions, voucher hold freeze and release, ±15% bands | claude-contracts | phase mode: ci + reviewer-security PASS; full review at the G4 phase gate | 009-P4-gateway-s1-fx-priced |
| `apps/web/` merchant-only network-fee column (gas × price + L1 fee from the receipt) | claude-frontend | phase mode: ci PASS (Money: no) | 011-P4-web-network-fee |
| `apps/web/lib/server/` releaseHold guard, paid price passed through, fiat checkout age cap | claude-contracts | phase mode: ci + reviewer-security PASS; full review at the G4 phase gate | 012-P4-gateway-pay-integration |
| `apps/web/` developers screen: API keys (hash only), webhook endpoints, /docs link | claude-frontend | phase mode: ci + reviewer-security PASS; full review at the G4 phase gate | 012-P4-web-developers |
| `apps/web/` Vouchers, Reports + CSV, Settlements screens | claude-frontend | phase mode: ci PASS (Money: no); full review at the G4 phase gate | 013-P4-web-money-screens |
| `apps/web/` G4 UX fixes: closed-link summary, retry on can't-open notices, plain empty states | claude-frontend | phase mode: ci PASS; findings from the G4 phase review part 1 (reviewer-ux-ui) | 014-P4-web-ux-fixes |
| `apps/web/lib/server/` paid price required, paid checkouts refused in the voucher upsert | claude-contracts | phase mode: ci + reviewer-security PASS; full review at the G4 phase gate | 013-P4-gateway-pay-hardening |
| `apps/relayer/` gasless investor funding through CapitalMarket.fundWithAuthorization (human yes 08:20) | claude-relayer | phase mode: ci + reviewer-security PASS; tests written first | 010-P5-fund-relay |
| `apps/web/` checkout voucher field + pay-route claim, FX switch to the backend quotes module (lib/fx.ts removed), rate on the FX line | claude-frontend | phase mode: ci + reviewer-security PASS; G4 review M2 closed | 015-P4-web-voucher-pay |
| `apps/web/` hosted /l and /p pages read lib/server directly (self-call over HTTP and preview client removed) | claude-frontend | phase mode: ci + reviewer-security PASS; G4 review M4 closed | 016-P4-web-direct-server-reads |
| `apps/web/` /docs rebuilt as a full developer guide (quickstart, button preview, SDK, webhooks, API reference, test mode, go-live list) + a drift test pinning it to the code | claude-frontend | phase mode: ci PASS (Money: no); human request 08:40 | 017-P4-web-docs |
| `apps/web/lib/server/` G4 review fixes: fiat cart total converted once (H1), single-use link paid once under a per-link lock (M3), frozen-hold expiry, FX back-off, unpayable prices refused | claude-contracts | phase mode: ci + reviewer-security PASS; findings from the G4 phase review part 1 (reviewer-code) | 015-P4-g4-review-fixes |
| `apps/web/` dashboard reads through Anon-RPC by default + the private-reads meter + the per-route CSP for Nym | claude-frontend | phase mode: ci + reviewer-security PASS; human decision 08:52 | 018-P4-web-private-reads |
| `apps/web/` G4 UX part-2 fixes: checkout sheet stays on a 375 px screen with the code field open; payment page total updates live and pay stays disabled at 0 items | claude-frontend | phase mode: ci PASS; findings from the G4 phase review part 2 (reviewer-ux-ui) | 019-P4-web-g4-ux-blockers |
| `apps/web/` G4 code follow-ups: announcePaid retries + re-announce on paid pages, relayer warm-up on checkout open, paid_at on paid links | claude-frontend | phase mode: ci + reviewer-security PASS | 020-P4-web-g4-code-followups |
| `apps/web/lib/server/` Arkiv voucher mirror: every attempt's outcome stored, /publish retry | claude-contracts | phase mode: ci + reviewer-security PASS | 018-P4-arkiv-voucher-mirror |
| `apps/web/` voucher pay path: one fewer round trip before signing | claude-frontend | phase mode: ci + reviewer-security PASS | 021-P4-web-voucher-speed |
| `apps/relayer/` deployed NFR-4: per-step timings, /health in the relay function, Fluid compute, 250 ms receipt poll (7.31 s → 4.32 s) | claude-relayer | phase mode: ci + reviewer-security PASS; human 'Ship it' 09:58 | 018-P2-deployed-nfr4 |
| `apps/web/lib/server/` refund sync (payment.refunded from the chain's Refunded log), stable webhook event ids, publish lease | claude-contracts | phase mode: ci + reviewer-security PASS | 021-P4-refund-sync-webhook-ids |
| `apps/web/lib/server/` Arkiv mirror hardening: createdBy filter, adopt only matching terms, never overwrite a stored key | claude-contracts | phase mode: ci + reviewer-security PASS (tests first) | 022-P4-arkiv-mirror-hardening |
| `apps/web/lib/server/` webhook retries in production (dispatch on the next request) | claude-contracts | phase mode: ci PASS (tests first) | 025-P4-webhook-retries-prod |
| `apps/web/` Vercel deploy config + docs research (curl, how a payment works, endpoint pages) | claude-frontend | phase mode: ci + reviewer-security PASS / ci PASS | 022-P4-web-vercel-deploy, 023-P4-web-docs-research |
| `apps/web/app/api/v1/capital/**`, `apps/web/lib/server/capital*.ts` Capital tab server: offers (Arkiv × chain, terms match), publish, quote, transfer-check, merchant, gasless fund | claude-relayer (API shape by claude-contracts) | phase mode: ci + reviewer-security PASS, round 2; claude-contracts reviewed the shape | 023-P5-capital-server |
| `apps/relayer/` + `apps/web/lib/server/capital-fund.ts` send-path hardening: receipt poll survives 429/5xx, refuse before signing after 20 s, eth_estimateGas guard (422 too_much_gas, no tx), 2-investor invoice cap | claude-relayer | phase mode: ci + reviewer-security PASS (tests first) | 022-P2-relayer-resilience |
| `contracts/script/Seed.s.sol` UI-run targets + holder-gas fork test (caps: 2 invoice holders, 1 advance holder) | claude-contracts | phase mode: ci (154 forge tests) + reviewer-security PASS | 009-P5-holder-gas-seed-ui |
| `apps/web/` checkout sessions, in-flight lock, idempotency and used nonces in Neon (works across Vercel instances) | claude-frontend | phase mode: ci (558 tests) + reviewer-security PASS | 026-P4-web-sessions-neon |
| `apps/web/` dashboard Refund button calls refunds/sync after the receipt (payment.refunded) | claude-frontend | phase mode: ci (568 tests) + reviewer-security PASS | 027-P4-web-refund-sync |
| `apps/web/` Vouchers screen: Arkiv status + 'Publish to Arkiv' retry | claude-frontend | phase mode: ci PASS (Money: no) | 028-P4-web-voucher-publish |
| `apps/web/` merchant onboarding: 3-step setup when signed out (wallet, add Whitechain Testnet, sign in) + Get started checklist (human request) | claude-frontend | phase mode: ci (578 tests, 122 Playwright) + reviewer-security PASS | 029-P4-web-onboarding |
| ⟨path⟩ | ⟨lane / agent⟩ | ⟨reviewers + human⟩ | ⟨NNN⟩ |
