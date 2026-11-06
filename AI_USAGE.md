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
| gateway API follow-ups | claude-contracts | phase mode: ci + reviewer-security PASS (round 1) + human gate; full review at the G4 phase gate | 008-P4-gateway-followups |
| ⟨path⟩ | ⟨lane / agent⟩ | ⟨reviewers + human⟩ | ⟨NNN⟩ |
