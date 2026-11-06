# Delivery phases: Merchant Capital+

How we deliver the requirements in `docs/SRS.md`. Each phase has a goal, the requirements it delivers, tasks by owner, and an **exit gate** made of acceptance tests (SRS §6). **Rule: a phase's gate must pass before the next phase's core work starts.** Tick boxes as you go and log each passed gate in HANDOFF_LOG.md. Design and ABI: ARCHITECTURE.md. Event deadlines: HANDOFF.md.

**Owners:** `C` claude-contracts · `L` claude-relayer · `F` claude-frontend · `S` claude-sdk · `R` claude-research · `O` opencode (review only) · `H` human.
**Order = unique part first.** Phase 2 qualifies Operate + Scale; **Phase 3 delivers the advance repaid from checkout (our differentiator, never cut)**; Phase 4 adds invoice financing, Arkiv and Anon-RPC. After any passed gate the product is complete enough to submit.

| Phase | Name | Delivers (SRS IDs) | Exit gate | Tracks secured |
|---|---|---|---|---|
| 0 | Preparation | none (setup only; CON-1) | G0: funds, keys, sessions, docs ready | none |
| 1 | Rail proofs | FR-REL-1 (stub), DEP-1, DEP-3, DEP-5, DEP-6 checks | G1: relayed gasless USDT pull + one private read | none |
| 2 | Payments core | FR-PAY-1–9, FR-PAY-11, FR-PAY-15, FR-REL-1–7, FR-REL-9 | G2: AT-1, AT-2, AT-10 | Operate, Scale |
| 3 | **Advance** (+ invoice contracts, human 00:34) | FR-PAY-16, FR-ADV-1–6, FR-INV-1, FR-INV-3–5 (contract side), FR-TOK-1–4, FR-TOK-6–7, FR-KYC-1 | G3: AT-3, AT-4, AT-5 · **ABI frozen** | **Tokenize** |
| 4 | **Payment gateway** (v2.0) | FR-GW-1–12, FR-GW-14, FR-ARK-1–5 (vouchers), FR-PRIV-1–3, FR-PAY-11; Capital on chain | G4: AT-11–AT-15, AT-6–AT-8 | Operate, Arkiv, EF, Tokenize |
| 5 | Capital tab, extras, integration | FR-ADV/FR-INV UI, FR-TOK-8, FR-GW-13 (C), FR-REL-8, FR-TOK-5 | G5: two clean full demo runs | polish |
| 6 | Proof and documentation | FR-PRIV-4, SR-* evidence, NFR-9 | G6: README review finds every SR item | all |
| 7 | Video and submission | SR-ETH-2, CON-6 | G7: submission confirmed | all |

---

## Phase 0: Preparation
**Goal:** everything that isn't code is ready, so the first hour of building is building.

**H**
- [ ] Claim faucet WBT from home (limited per wallet, IP and GitHub account): relayer hot wallet first, then demo customer and investor wallets; swap part to USDT on YetiTrade
- [ ] Keys: Ankr (code `Whitechain2026`), Arkiv access key + Rabdi funds, Vercel + Neon, an empty public GitHub repo (keys in `.env` only, CON-7)
- [x] Start the `claude-contracts` session: "You are claude-contracts. Read AGENTS.md, HANDOFF.md, docs/SRS.md, ARCHITECTURE.md, PHASES.md and the build plan. Planning only until hacking starts."
- [x] Tell the frontend session: the idea is Merchant Capital+, its name is `claude-frontend`, and it rewrites `docs/FRONTEND-PLAN.md` against the SRS
- [ ] Optional: product name and design direction

**R**
- [x] HANDOFF decision · ARCHITECTURE.md · docs/SRS.md · PHASES.md · old plans archived · sessions told on agentbus
- [x] README skeleton (one section per sponsor, SR-* evidence slots), `AI_USAGE.md`, `WHITECHAIN_FEEDBACK.md`, `arkiv/*.md` (5 files), `docs/PITCH.md` (booth pitch + video script)
- [x] PIPELINE.md + gate hook (proven live) + `.claude/agents/` reviewers; old ideas and practice builds removed; sessions briefed

**C / F:** read the SRS and ARCHITECTURE.md; plan tests and screens. No product code (CON-1).

✅ **Gate G0 (verified by claude-research 21:05):** WBT and USDT in the wallets · three Claude sessions named on agentbus · the documents above exist.

---

## Phase 1: Rail proofs
**Goal:** prove the risky assumptions before building on them.

- [x] `H` Create the repo (`main` 6b0ccd4 at 20:26, public on GitHub: Vishal4742/merchant-capital-plus); first commit = AGENTS.md, CLAUDE.md, PIPELINE.md, docs/SRS.md, ARCHITECTURE.md, PHASES.md, `tools/{pipeline-gate,batch-start,batch-close}.sh`, `.claude/agents/*`, `.claude/settings.json` (gate hook)
- [x] `R` Run `bash ~/.claude/skills/three-techniques/scripts/setup.sh typescript` in the repo (ECC + Ponytail, commands, agents); merge the gate hook back if the merge touched it; restart sessions; **prove the gate fires** (an edit under `apps/` with no batch is denied) — PIPELINE.md §9
- [x] From here on, every task in this file runs as a PIPELINE.md batch (`bash tools/batch-start.sh <phase> <slug>`)
- [x] `C` Foundry project (`prague`); a stub contract pulls USDT with `receiveWithAuthorization`, submitted by a relayer key (DEP-1); measure the gas of a routed payment · batch 001-P1-rail-proof, verified 21:55: PullStub `0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d` (explorer-verified), relayed pull tx `0xc4629df1…c847e` 94,034 gas, payer nonce 0 / 0 WBT
- [x] `F` Next.js skeleton passing tsc, lint and build; one Anon-RPC read inside our app (DEP-6); guest wallet for the customer (DEP-3 decided: Privy failed the tracker check); one Arkiv write + read (DEP-5) · batch 001-P1-web-rail-proofs verified 22:05; Arkiv write + read proven live in batch 003-P1-arkiv-probe (tx `0x2d651b87…771e`, checked by claude-research 23:47)
- [x] `L` FR-REL-1 stub: `POST /relay` + `GET /health` (localhost only) · batch 001-P1-relay-stub verified 22:14: 18/18 tests, tsc 0, live `/health` shows the real WBT balance, replay rejected with 422 and no nonce change, relayed pull `0x9f5efc75…e000`
- [x] `H`+`F` Vercel projects (`apps/web`, `apps/relayer`, `apps/shop`) and Neon connected · Neon done 01:00 (`DATABASE_URL`, pooled, tested); Vercel projects created 03:14 (merchant-capital-web, -relayer, -shop; empty, no deploy yet)

✅ **Gate G1 (verified by claude-research 22:05):** an explorer link of a relayed USDT pull where the payer holds 0 WBT, plus one private read in our app.
**If blocked:** same error three times → post on agentbus and ask Whitechain's dev Telegram (stuck rule).

---

## Phase 2: Payments core (Operate + Scale)
**Goal:** a merchant gets paid gaslessly and can refund; a separate shop integrates in about 20 lines.

- [x] `C` `MerchantPay` (FR-PAY-1–3, 5, 6, 8; FR-REL-4, 7, 9); tests M1–M3; deploy and verify · batch 002-P2-merchantpay verified 23:58: `0x83b5…73b7` full match, 39/39 tests, MerchantPay 96.97% lines / 100% branches; Phase 3 redeploy planned
- [x] `L` *(batch 002 drain guard verified 02:55: 36/36 tests, 5/5 checks, AT-10 PullStub half; MerchantPay relay batch 007 verified 05:57: 42 tests, only MerchantPay paySale/payInvoice, reject p95 266 ms; Postgres lock + rel_sent + breaker + rate limits + daily budget + shared secret verified 06:22, batch 006)* Relayer: submit, health, drain guards (FR-REL-1–3, 5, 6); uses the MerchantPay ABI from `packages/shared`
- [x] `C` Demo seed script (CON-8; batch 004-P2-seed verified 00:36: 54/54 tests; on-chain investor A 69, investor B 40, debtor 100, merchant 1 USDT, team keeps 25.93 for the AT-1 customer): funds the demo customer, investor and debtor wallets from the team wallet in `.env`; no faucet button in the app. `H` collects test USDT first (faucet WBT → YetiTrade swap)
- [x] `F` *(batch 004 verified 01:48: pages, wallet sign-in FR-PAY-15, checkout + receipt on the final MerchantPay, /checkout 184.5 KB JS and LCP 0.62 s; invoices + refunds in batch 005 verified 03:16: 133 tests, fork E2E on the final MerchantPay: fee on top, part payments, exact-approval refunds)* Customer pay and checkout pages, receipt (FR-PAY-3, 5, 7, 9); merchant invoices, payments table, refund (FR-PAY-1, 2, 8); checkout session API (FR-PAY-4)
- [x] ~~`S` `apps/shop` with the ≈20-line integration (FR-PAY-11)~~ tracked once, in Phase 4 (AT-14); G2's AT-1 ran on the web app's built-in demo checkout (human 05:58)
- [x] `O` Review the relayer guards: can anyone make us pay gas for nothing? · done 00:42 by claude-review: yes, 3 ways once public (R1, R2, R3); fixes with claude-relayer; human chose Postgres lock + 6 gwei cap

**Gate G2:** AT-1 (gasless sale), AT-2 (refund), AT-10 (relayer rejects a bad call), and the speed budgets NFR-4, NFR-12, NFR-14 measured.
- [x] ✅ **Gate G2 passed 06:42** (verified on-chain by claude-research): AT-1 `0x7e03…7a11`, AT-2 refund `0x8334…bbeb`, AT-10 all rejected from the deployed relayer (relayer nonce unchanged), NFR-4 4.40 s sale `0xd1a7…987a`, NFR-12 /checkout 191 KB JS, NFR-14 /health p95 280 ms and rejects p95 ≤ 363 ms from https://merchant-capital-relayer.vercel.app
**If blocked here:** this is the stuck rule's most important point. Ask for help immediately; every later phase depends on it.

---

## Phase 3: Advance (our differentiator)
**Goal:** a merchant raises cash today and every later sale repays investors automatically.

- [x] `C` `InvestorRegistry` owner list (FR-KYC-1) · batch 005 checked 02:40
- [x] `C` `ClaimToken` rules (FR-TOK-1–4, 6, 7) and `CapitalMarket` advance path (FR-ADV-1–5); tests C2, C5, T1 (basic); deploy and verify · batch 005 checked 02:40: 150/150 tests, 81.6% line coverage, all four contracts fully verified; **G3 live evidence must be re-run on the final addresses**
- [x] `C` **Freeze the ABI** in `packages/shared` and ARCHITECTURE.md §2; later changes go through agentbus · frozen 03:05 (human "Approve and freeze"), final addresses in `packages/shared/contracts.ts`
- [x] ~~`F` Merchant "Cash advance" with the total cost shown before signing (FR-ADV-1, 6); investor funding flow (FR-ADV-3); payments table shows the split; compliance desk with the owner list (FR-KYC-1)~~ moved to the Phase 5 Capital tab (v2.0)

✅ **Gate G3 (verified by claude-research 02:47 on the final contracts):** AT-3 (advance funded), AT-4 (a sale repays 20% in the same tx), AT-5 (cap reached, lien ends). The UI half of Phase 3 moves to the Phase 5 Capital tab.
**If blocked here:** cut invoice financing (Phase 4) before touching the advance.

---

## Phase 4: Payment gateway (v2.0, human 2026-11-06 02:35)
**Goal:** the features merchants expect from a payment gateway (like Razorpay or Stripe), in stablecoins, strictly on Whitechain testnet. Reference: the human's Razorpay test-mode screen recording (functional reference only, nothing copied).

- [ ] `F` Payment Links with QR codes (FR-GW-1, FR-GW-3); Payment Pages (FR-GW-2)
- [ ] `F` Discount vouchers: codes as Arkiv entities that expire, redemptions counted on our server (FR-GW-12, FR-ARK-1–5 now apply to voucher entities)
- [ ] `F` Multi-currency prices with a locked FX quote at checkout (FR-GW-11) · *batch 006 (06:20): sessions v2 with FX quotes on checkout; switch to the backend quotes module pending*
- [ ] `F` Reports with a sales chart and CSV, and a Settlements page (FR-GW-9, FR-GW-10)
- [ ] `F` API keys, webhooks, a `/docs` page and the test-mode badge (FR-GW-6, 7, 8, 14) · *batch 006 (06:20): test-mode strip, /docs, dashboard shell, payments API done; keys + webhooks screens pending*
- [x] `S` *(SDK core verified 03:21, batch 005-P4-sdk-core: Gateway sessions/payments/webhooks, zero deps; pay button batch 007 verified 05:57 incl. a DOM-clobbering fix proven in Chrome; PR #8, #9)* SDK + payment-button script in `packages/sdk` (FR-GW-4, FR-GW-5)
- [x] `C` Capital on chain: AT-6, AT-7, AT-8 live, the E1 event-ABI snapshot and the NFR-10 coverage report (batch 006); then **contracts freeze** · batch 006 verified 03:13: AT-6 investors paid 58.8393 + 39.2262, AT-7 debtor 100.10 → 60 + 40 in one tx, AT-8 canTransfer(A, non-eligible) = false; contracts FROZEN
- [ ] `S` Rebuild `apps/shop` on the SDK or button in ≤ 20 lines (FR-PAY-11, AT-14)
- [x] `C` After the freeze: the gateway backend API in `apps/web/app/api/v1/{links,pages,vouchers,quotes,reports,settlements,keys,webhooks}` + Neon `app_gw_*` tables (FR-GW-1, 2, 6, 7, 9, 10, 11, 12 server side); claude-frontend builds the screens against it · batch 007 verified 05:57: 101 tests on real SQL, 10 `app_gw_*` tables on Neon, voucher oversell fixed; PR #11
- [ ] `F` Private reads by default on dashboard pages, with the meter (FR-PRIV-1–3)
- [ ] `F` Record every Arkiv problem (post it to claude-research)

**Gate G4:** AT-11 to AT-15 (gateway) and AT-6 to AT-8 (Capital on chain). AT-8 counts its **contract half** here (the transfer reverts and `canTransfer` returns the reason); the UI "shows the reason first" half is checked at G5 with the Capital tab (human 03:02).
**If Arkiv fails three times:** store voucher codes in Postgres only and drop the Arkiv track (DEP-5).

---

## Phase 5: Capital tab, extras and integration
**Goal:** "Get paid early" as one tab of the gateway, and a demo that runs twice cleanly.

- [ ] `C` *(moved from `F` 06:47 to unload the frontend; claude-contracts builds it in new files under apps/web, the frontend adds the nav link)* Capital tab: advance with its total cost shown before signing (FR-ADV-1, 6), investor funding (FR-ADV-3), invoice financing price (FR-INV-2), offer book on Arkiv (FR-ARK-1–5), the transfer reason (FR-TOK-8); AT-3 to AT-9 through the UI
- [ ] `F` Gift vouchers (FR-GW-13), only if time is left
- [x] ~~`L` Fee-swap keeper (FR-REL-8)~~ CUT 06:47 (claude-research, delegated by the human 06:43): the relayer's 0.496 WBT covers ≈475 relayed sales at ≈0.00104 WBT each; recorded in the cut list
- [x] `C` Admin freeze (FR-TOK-5) and test F1 · already on chain in the frozen ClaimToken (`setFrozenTokens`, `forcedTransfer`, ERC-7943) with tests `test_PartialFreezeBlocksOnlyFrozenUnits`, `test_ForcedTransfer*`, `test_RevertWhen_NotAdminFreezesOrForces`, and F1 in CapitalMarket.t.sol (checked 06:47)
- [ ] `O` Screenshot every screen state
- *Cut (human 02:02): EAS KYC, debtor acknowledgement, pay-on-due-date, default and recourse.*

**Gate G5:** the whole demo (AT-1 to AT-15) runs twice in a row with no manual fixes.

---

## Phase 6: Proof and documentation
**Goal:** every sponsor requirement is findable in one click (SRS §5).

- [ ] `R` README: one section per sponsor with evidence for each SR item (contract and tx links, the "why on-chain" line, gas and drain explanation, the 20-line count, roles and lifecycle, Arkiv writer + query, Anon-RPC share and exclusions, CROPS section, setup, architecture, limitations incl. NFR-9)
- [ ] `R` `WHITECHAIN_FEEDBACK.md`, `arkiv/*.md` (five files), `AI_USAGE.md`
- [ ] `H` Edit and approve; grep the repo for secrets (NFR-3)
- [ ] `O` Read the README cold and tick every SR item

**Gate G6:** the reviewer finds every SR-* item; after this, bug fixes only (freeze).

---

## Phase 7: Video and submission
**Goal:** submitted, with a pitch ready for the booth.

- [ ] `H` Record the narrated video, 2:30–2:55, following the acceptance scenarios (CON-6)
- [ ] `H` Rehearse the 2–3 minute booth pitch (problem → gasless sale split → advance → invoice → why on-chain)
- [ ] `R` Showcase text and per-sponsor "how we used it"
- [ ] `H` Submit, selecting Whitechain, Arkiv and EF (Anon-RPC + CROPS); open the live link on a phone afterwards

**Gate G7:** submission confirmed.

---

## Cut list (cut from the top when a gate is at risk)
1. FR-ARK-6 merchant stats entity
2. FR-PAY-10 webhooks → shop polls the receipt
3. FR-REL-8 fee swap → one manual swap linked in the README
~~4. FR-PAY-14 due-date payment → debtor pays by hand~~ **CUT (human 02:02)**
5. ~~FR-ADV-7 / FR-INV-6 default and recourse~~ **CUT (human 00:34)**
~~6. FR-PAY-13 debtor acknowledgement~~ **CUT (human 02:02)**
7. FR-INV-3 several investors per invoice → one investor
~~8. FR-KYC-2–3 EAS → owner list~~ **CUT (human 02:02)**
9. ~~DEP-3 Privy → guest wallet~~ (done: guest wallet chosen at Phase 1)
10. FR-INV-* invoice financing → advance only (Tokenize still qualifies)

**Never cut:** real USDT in the main flow · verified contracts · gasless payment · refund · **the advance (FR-ADV-1–6)** · at least one transfer rule and the settlement rule shown live · the separate demo shop · a user-facing Arkiv read · private reads by default · all required files.
