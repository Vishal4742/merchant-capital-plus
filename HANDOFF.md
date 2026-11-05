# ETHGlobal Mumbai — shared context (all sessions)

All agents read AGENTS.md (rules) and this file (facts, decisions) first, and append to HANDOFF_LOG.md. Don't overwrite another agent's section. Keep decisions here, not in chat.

**Live messaging** (works from any folder; bus is ~/.agentbus). Use your lane name:
- `agentbus read --as <lane>` — your unread messages
- `agentbus send --as <lane> --to <lane|all> "..."`
- `agentbus watch --as <lane>` — block until a message arrives · `agentbus log` — full history
(If `agentbus` isn't on PATH: `python3 /Users/vg890/ethglobal/tools/agentbus.py ...`)
Names: `claude-contracts`, `claude-frontend`, `claude-research`, `opencode`, `human`.

**Shared memory** (self-hosted supermemory lite, 2026-11-05): runs on http://localhost:6767 and starts automatically (SessionStart hook `tools/memory-up.sh`, detached so it outlives the session). Start Claude sessions with `bash tools/claude.sh` (passes only the supermemory key; `tools/supermemory.sh` loads only its own keys). Data lives in `.supermemory/`; keys (`SUPERMEMORY_API_KEY`, DeepSeek as `OPENAI_*`) live in `.env`, and both are git-ignored. Namespace `ethglobal`. Save: `POST /ns/ethglobal/document {"content":"..."}`. Search: `POST /ns/ethglobal/search {"query":"..."}` with `Authorization: Bearer $SUPERMEMORY_API_KEY`. Everything you save is sent to DeepSeek for extraction, so never save secrets. The plugins are installed for this folder only: Claude Code (`.claude/settings.json`, project scope) and opencode (`opencode.json`, pinned 2.1.1). Both share the `ethglobal` space through `.claude/.supermemory-claude/config.json`. Load `.env` before launching: `set -a && . ./.env && set +a && claude` (or `opencode`).

## Event facts (verified from ethglobal.com, Oct 24 2026)
- Venue: Jio World Convention Centre, BKC, Mumbai (Devcon week)
- **Apply deadline: Fri Oct 30, 23:59 IST**
- Workshops: Thu Nov 5, 15:30–18:00 IST (Whitechain 16:30, ENSv2 16:00, World 17:30)
- **Hacking: Thu Nov 5 21:00 → submissions due Sat Nov 7 09:00 IST** (36h)
- Judging Sat 09:30–12:30 (finalist + partner in parallel); closing 15:30
- Up to 3 partner prizes. Finalist criteria: Technicality, Originality, Practicality, Usability, WOW
- "Start Fresh" rules: no pre-event code/designs/assets (templates/checklists/docs research OK). Steady git commits; document AI usage and commit spec/prompt files.
- Demo video: 2–4 min, ≥720p, desktop recording, no TTS/AI voice, no speed-up, ≤20s backstory.

## Decision so far (human locked 2026-11-05 18:53 IST)
**Build: Merchant Capital+.** Shops on Whitechain take gasless USDT payments and invoices, and raise cash today by selling an invoice at a discount or with an **advance repaid automatically from a slice of every future sale**. The financed claim is an ERC-1155 + ERC-7943 token with on-chain rules. Requirements: docs/SRS.md. Interface: ARCHITECTURE.md. Delivery: PHASES.md (gates G0–G7). Full design: research_notes/Mumbai hackathon idea validation/build_H1_merchant_capital.md.
- **Tracks:** Whitechain (one prize; judged in Operate + Scale + Tokenize) · Arkiv Build · EF Anon-RPC (+ CROPS).
- **Why:** best odds of the shortlist (53–88%, research/odds.py), fits all three Whitechain tracks, and matches the Whitechain workshop's asks (B2B2C, "Tokenize… borrowing and lending", "build what business actually needs"). Anon-RPC tested on Whitechain.
- **Build order (human approved): unique part first.** P2 Operate + Scale core → **P3 the advance repaid from checkout** → P4 invoice financing + Arkiv + Anon-RPC → P5 extras. The advance is on the never-cut list.
- **Lanes:** claude-contracts (contracts, seed script, shared ABI) · claude-relayer (apps/relayer, keepers; added by the human 20:57) · claude-frontend (apps/web, apps/shop) · claude-research (docs, README, pitch) · opencode review · human. zcode is out.
- **Rival:** an invoice-financing stack (InvoiceRegistry / ReceivableMarket) is already on testnet. Never claim "first"; lead with advances repaid from checkout.
- **Superseded and deleted:** PayKit and agent pocket money (old docs moved to the Trash 2026-11-05 19:13). Don't revive them.
- **Commit rule (human approved):** small commits per lane, pushed every 1–2 hours from 21:00 (AGENTS.md).
- **Goal (human):** sponsor track prizes, not a finalist slot.
- **Frontend batch 002 gate decisions (human 23:30, via claude-frontend):** (1) `three` 0.186.1 + `@types/three` 0.186.0 approved; (2) the hold button keeps the instant keyboard / assistive-tech confirm on the pay page, with all framing blocked (X-Frame-Options DENY, batch 004); (3) a repeat payment per order must be refused on-chain too: `MerchantPay.paySale` already does it (`OrderPaid`, MerchantPay.sol:161), no contract change.
- **Relayer gate decisions (human 22:01, via claude-relayer):** (1) no `RELAYER_PRIVATE_KEY` in any Vercel project until the Phase 2 drain guard passes; (2) only `/relay` sends from the relayer key (scripts and keepers use the deployer key or `POST /relay`); (3) Phase 2 rejects payers that have code, including EIP-7702 delegated accounts; (4) a scoped `apps/relayer/.env` first in Phase 2.
- **G1 gate decisions (human 21:52, via claude-contracts):** (1) PullStub stays live; `apps/relayer` stays localhost-only, no Vercel deploy until the FR-REL-4/5/6 guards exist; (2) a partial Blockscout match is OK for the throwaway stub, a **full match is required for every Phase 2+ contract**; (3) `RELAYER_PRIVATE_KEY` is used only by claude-relayer from now on (claude-contracts uses the deployer key only).
- **Customer wallet = guest wallet (human 20:31):** Privy failed DEP-3 (always posts analytics with the wallet address to auth.privy.io; pins a second viem). No email login.
- **Test wallets (generated 2026-11-05 20:13, keys in `.env` only):** deployer + team wallet + compliance admin `0xb4E7eDe967E108858DDb5d88B25FDc70723B714D` (receives everyone's test USDT, funds demo wallets, CON-8) · relayer hot wallet `0xdd02FE971Ad9e21365673E701693e7ab7bF9a651` (WBT for gas, ≤0.5 WBT) · Arkiv writer `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` (Rabdi test funds from hub.arkiv.network). Merchant, investor and debtor demo wallets = the human's own browser-wallet accounts. G1 scripted payer `0xE53fBc545e9b72f315699e3295a8A300c192309b` (`PAYER_PRIVATE_KEY`; holds USDT, never WBT; human approved 20:44). Balances verified 20:52: team 2.00 WBT / 109.72 USDT, relayer 0.499 WBT, payer 0 WBT / 2.00 USDT (swap 1.5 WBT → 111.72 USDT, tx `0x86efc97bf85212fca00c40e4e62e337e94ddf98ce607ce280ffe5c84ed0af27a`). Faucet collectors (sweep their WBT to the team wallet): `0xF735C35F30ca66A6d65D99406a9Dc91DFEE6a35F`, `0x86f4C02fDD2F5380dbC8Eb3652E85749407E91f3`, `0x08cd73382321F3C0847748374D4D1B573C708ab9`.
- **SRS 1.1 (human approved 19:50):** FR-TOK-8 (transfer reason in the UI) moves to Phase 4 as a must, because AT-8 needs it at G4 · demo wallets funded by a one-off seed script from the team wallet (claude-contracts, CON-8); no faucet button in the app · `/pay` and `/checkout` make no browser chain reads; FR-PRIV-1 now covers every browser read (disclosed) · Privy only if it passes the Phase 1 test (signs on 1874, no trackers, about an hour), otherwise the guest wallet.
- **Demo amounts ÷10 (human approved 19:56):** invoice 1,000 USDT, advance 100 USDT (cap 110), SRS AT-3–AT-7. Float needed ≈1,100 test USDT if demo wallets pass money back, about 8 faucet claims (2 WBT ≈ 149 USDT each, one per teammate per day). If the team wallet holds less than ≈1,100 USDT by Phase 2, drop to ÷100 (invoice 100, advance 10): only the seed script and the AT numbers change, no contract change.
- **How to get test USDT (no real money):** faucet.testnet.whitechain.io (GitHub ≥30 days + captcha, from home) → 2 WBT; swap on testnet.yetitrade.fi to USDT `0xcedfB561…f55a7`, keep ~0.1 WBT for gas; each teammate sends their USDT to the team wallet.

### Whitechain hard requirements
- Contracts deployed + verified on Whitechain Sepolia, chain ID 1874
- ≥1 payment in their USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` in main flow; explorer link in README (self-minted tokens don't count)
- README line: why this needs onchain stablecoin settlement vs a normal rail
- Public repo, steady progress; README with setup, architecture, limitations
- 2–4 min demo showing merchant AND customer
- `WHITECHAIN_FEEDBACK.md`
- Want: drop-in widget/SDK/payment-link API a separate demo app adds in ~20 lines; extra credit past first payment (refund, renewal, accountant export)
- Won't place: plain transfer button, tipping, bill split, custodial bridge to local-currency token (so NO INR off-ramp), payroll/escrow/splits alone

### Open questions (ask at Whitechain booth/Discord)
- ~~Can one project enter both Operate and Scale?~~ **Answered: yes** — ETHGlobal rule: "If a partner has multiple tracks, you can be eligible for all of them while only counting as 1 Partner Prize" (per ETHOnline details page; select prizes carefully at submission).
- ~~How to obtain test USDT~~ **Answered (2026-11-05):** swap faucet WBT → USDT on YetiTrade testnet (https://testnet.yetitrade.fi). See "Updates 2026-11-05" below.

## Updates 2026-11-05 (Claude Code, verified on-chain + docs.whitechain.io + ethglobal.com prizes/details pages)
- **Whitechain Mainnet is LIVE since 26 Oct 2026, chain ID 1875** (OP Stack L2, settles on Ethereum, gas = WBT). Sepolia stays 1874. Pitch line "Live on day one of mainnet (Nov)" is stale → human to reword. Official USD₮ on mainnet comes "in later releases" (docs portal-bridge page), so demo stays on Sepolia.
- **Test USDT source found:** Uniswap-v3-style pool WWBT/USDT 0.3% at `0x5645101Ca8d2F7BaBC27b10359555767a1BdF999` (token0 WWBT `0x4200…0006`, token1 = prize USDT `0xcedf…55a7`), holds ~102,742 USDT, price ~75 USDT per WBT. Swap via YetiTrade testnet UI. USDT supply grew 945,270 → 1,945,270 since Oct 25.
- **Faucet changed:** GitHub sign-in (account ≥30 days old) + captcha, **0.5 WBT per rolling 24h**, limited per wallet AND per IP AND per GitHub account. Claim from home before the venue (shared venue IP = one claim). 0.5 WBT ≈ 37 USDT after swap.
- **Prize USDT supports EIP-3009** (`TRANSFER_WITH_AUTHORIZATION_TYPEHASH` matches the standard keccak, `authorizationState()` exists) on top of EIP-2612 permit. Scale track names `transferWithAuthorization` + relayer explicitly.
- **Second USDT on Sepolia — don't confuse:** `0xaa7962d073935D387e8d442DA1D7149C81388f46` = "Bridged USDT (Whitechain)", symbol USDT.e (Portal bridge from Tron Nile). Prize page names `0xcedf…55a7`; use that one.
- **RPC limits:** public RPC = 50 req/s per client IP, burst 500, `429` + `Retry-After: 1`. Batches of up to 100 calls count as 1 request. A shared venue IP can hit this → indexer must batch / use `wss://rpc.testnet.whitechain.io/ws` `newHeads`. Whitechain prize page offers free Ankr RPC for hackers (1,500 req/s for 7 days): https://www.ankr.com/rpc/?utm_referral=Whitechain2026
- **EVM version:** docs say set `evmVersion = prague` (Sepolia has no Karst/Osaka opcodes). Put `evm_version = "prague"` in foundry.toml.
- **Whitechain tracks now listed: 4, $15k total:** Operate $5k (2.5/1.5/1), Tokenize $4k (2.5/1.5), Scale $3k (2/1), Continuity $3k. Scale wants: zero visible crypto steps for payer, explain who pays gas, how relayer gets WBT, what stops draining it. Won't place: payer still signs a gas-costing tx.
- **World now has 4 prizes ($12.5k):** Agent Pass $5k, Agent Pass Continuity $2.5k, IDKit $2.5k (up to 2 × $1,250), IDKit Continuity $2.5k. IDKit needs: server-side or onchain verify, README on why that credential is the *minimum sufficient assurance*, success + alternative path in demo, integration debrief.
- **ENS:** Best Use of ENSv2 $7k (3k/2k/1k/1k), ENSv2 on mainnet or Sepolia, must be central, not hard-coded, live demo link.
- **Judging (details page):** finalist slot = 7 min (4 demo + 3 Q&A). Partner judging uses submission materials; booth visits optional. Slides ≤4 bullets. Video auto-rejected if <2 or >4 min; no phone recording. AI: commit all spec files/prompts/planning artifacts.
- **Seen on testnet (FYI):** verified `DeliveryCheckout` contract `0xF2eeBe4d4B7D54ac85932AbaEE9883Edf8F4f19c` deployed Nov 4, using `createOrderWithAuthorization` + courier attestations (escrow-style checkout). Someone else is circling Operate.
- **Not re-verified today:** workshop times (event page returns HTTP 500, schedule URL 404). Check Hacker Dashboard / Discord.

## Whitechain flyer facts (photo from the venue, 2026-11-05 17:12; supersedes older notes where they differ)
- Tagline: "The Onchain Economy Layer, the core for onchain business to launch, operate and scale on." Whitechain × Optimism. $15k, **9 winners, 4 tracks**.
- Tracks as printed: **Operate** $5k "Stablecoin payments: checkout, invoices, subscriptions and refunds in USDT" · **Tokenize** $4k "Real world finance: RWA lifecycles with rules enforced onchain" · **Scale** $3k "Payments nobody notices: **Gasless and AI agent payments in USDT**" · **Continuity** $3k "Bring your product".
- **"One Whitechain prize per project."** Submit by Nov 7 09:00 IST, selecting Whitechain in the ETHGlobal dashboard.
- **Faucet: 2 WBT a day** (GitHub account older than 30 days), not 0.5 as noted earlier. Swap some for USDT on YetiTrade.
- RPC: `rpc.ankr.com/whitechain_testnet` (free Ankr RPC code **Whitechain2026**); backup `rpc.testnet.whitechain.io`. Chain ID 1874 (0x752). Explorer explorer.testnet.whitechain.io. Gas token WBT, not ETH.
- USDT `0xcedf…55a7` is "the only one that counts", 6 decimals, permit + EIP-3009.
- **AI agent docs and skills:** docs.whitechain.io/build-with-ai (give them to every Claude session).
- Workshop Thu Nov 5, 16:30 IST, Room 2; booth on the venue map. Help: Telegram t.me/Whitechaindevs. Builders Program after Mumbai: whitechain.io/builders.

## Whitechain inventory (research agent, 2026-11-05 17:20; full notes: research_notes/Mumbai hackathon idea validation/whitechain_inventory.md)
- **x402 is already being settled on testnet:** the standard x402 Permit2 contract `0x402085…0001` has 59 `settle` txs from two wallets (Oct 26 – Nov 4, 0.01 prize USDT each). "First x402 facilitator on Whitechain" is no longer a safe pitch line.
- **Missing:** price oracle (only third-party Cotejo signed prices), public bundler/paymaster service, passkey/smart wallet (P-256 precompile works, verified), hosted indexer, name service, third-party bridges, USDT on mainnet, KYC identity on testnet (EAS available).
- **Pre-hackathon rivals on testnet (mostly unused):** about 20 checkout/subscription/refund contracts, Coinbase payment contract copies, gas tanks, smart-account factories; ERC-3643 stack, ReceivableMarket, InvoiceRegistry, BondVault.
- Present on both chains: Multicall3, Permit2, CREATE2/CreateX, EAS, Safe 1.3/1.4.1, EntryPoint v0.6/v0.7 (v0.8/v0.9 testnet only). **EIP-7702 active on both.** 1s blocks, 5 gwei floor. Testnet Uniswap v3 is YetiTrade's copy, not official.

## Verified 2026-11-05 17:50 (notes: research_notes/Mumbai hackathon idea validation/whitechain_workshop_and_anonrpc_test.md)
- **Anon-RPC reaches Whitechain:** tested in the live demo through tor-js (2.8 s) and Nym (1.6 s) against `rpc.ankr.com/whitechain_testnet`; correct balance returned. Use Ankr, not the Cloudflare-fronted public RPC. Keep Nym as the fallback (the tor-js gateway is demo-only).
- **Workshop takeaways:** build what real businesses need; Tokenize also covers DeFi and lending/borrowing; they want **B2B2C**; oracle infra counts for Operate; judging is a **2–3 minute pitch at their booth**; hackathon placers get Builders Program priority (up to $300k).

## Tooling findings (2026-10-25, verified on-chain / live)
- **RPC** `https://rpc.testnet.whitechain.io` — chain ID 1874 confirmed via `cast chain-id`, live at block ~11.3M. Foundry 1.8.6 installed, read calls verified against 1874.
- **Explorer** `https://explorer.testnet.whitechain.io` — **Blockscout**. Verify: `forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ …`. API docs at `/api-docs` (REST + JSON-RPC + GraphQL + Etherscan-compatible endpoints).
- **Faucet** `https://faucet.testnet.whitechain.io/` — test WBT only (no real value, can't bridge).
- **Test USDT `0xcedf…55a7` DOES implement EIP-2612 permit** (OpenZeppelin ERC20Permit style): `DOMAIN_SEPARATOR()` = `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25`, `nonces(address)` works, `permit()` sim reverts with OZ's "ERC20Permit: expired deadline" (function exists). name "Tether USD", symbol USDT, decimals 6. Read `DOMAIN_SEPARATOR()` on-chain at runtime; don't reconstruct it.
- **Toolchain note:** old-Tether-style ABI probes mislead here — this is an OZ-flavored token behind what looks like a proxy; always probe with `cast call "sig"` not hand-rolled hex.
- **Figma MCP quota:** Starter plan + View seat = **20 tool calls per month for the account**, not per agent. Exhausted 2026-10-25 during the rehearsal; every tool (including read-only `get_metadata`) returns the paywall error. Professional + Full/Dev seat gives 200/day, 10/min. Do not plan Figma rounds unless the plan changes or the quota resets.

## Research findings (data: research/ethglobal_winners_11_events.json — 1,557 prize winners, 11 events)
- 61% of winners took 2+ prizes → one product, 3 load-bearing sponsors (e.g. VEIL VPN: Arc+World+ENS, 3× 1st + finalist)
- 30% of finalists won zero sponsor prizes → main stage rewards one sharp idea + live WOW
- 2026 finalists skew to security/agent-safety; prediction markets and ERC-8004 hot at NY 2026
- Merchant payments: 133 winners, 10 finalists (AutoPay "Stripe for crypto subs", Primer, Swap Pay SDK, Kyma Pay, ETHPark-QR). Winning pattern: familiar framing, SDK form, past-first-payment features, real-world moment.
- Whitechain never sponsored ETHGlobal before → judged strictly against its brief.
- Partner prizes are judged by sponsor teams (same people who run workshops) → pitch idea to them Thu before 21:00.

## Design system lock v8 (LOCKED by the human 2026-11-05 21:30, via claude-frontend)
- **Reference:** Mercury. The human rejected the cream, white and dark mocks.
- **System:** https://claude.ai/artifact/1FqWSDshf1hweQ6k7wLixx (private to the human until shared). Instrument Sans 420/500 + Instrument Serif italic + Geist Mono; one blue `#3b4fd9`; glass panels over a dithered Marine Drive night scene.
- **Spec:** clickable demo `design-refs/merchant-capital-demo.html` (local, git-ignored with the other references) + the system page above.
- **Code:** claude-frontend copies `tokens.css` into `apps/web` in the first Phase 2 UI batch.

## ~~Design system lock v7~~ (superseded by v8 above; kept for history)
Supersedes v6. Built from the `refrence design` board (`pinterest.com/vg8904937/refrence-design`, 30 captures in `~/.agents/taste/pins/board/`) plus the profile in `~/.agents/taste/TASTE.md`.
- **Register:** cream editorial / print. The board's centre of gravity is type-led editorial and warm neutral, not dark UI.
- **Ground:** cream `#F3ECDF`; a 4px halftone dot grain is printed into the `body` background. Surface `#FBF7EF`, raised `#E9DFCD`.
- **Ink:** `#16120E`; muted `#5A5148`; faint `#8B7F72`. Hairlines `rgba(22,18,14,.14)` / `.30`.
- **Accent:** one cobalt `#1B3A8F` at 10% — second headline line, primary CTA, settle progress. No second hue.
- **Type:** Clash Display 600 for display (hero 128px, `-0.045em`, line-height .86) and section heads; Satoshi for body; Geist Mono for spec labels, captions and section indices (`01 /`, `Fig. 01`).
- **Structure:** meta row + hairline rules top and bottom; asymmetric hero grid (lede left, 2×2 spec grid right); flat "printed plate" product window with caption; paper settle card; ink ticker band; numbered sections; 2-col ruled feature list; **one cinematic dark band** (`#16120E` + halftone, 4-column stat rule); giant ghosted `Operate` footer wordmark at 7% ink.
- **Verification:** REA browser scenario (see `TASTE.md` for the exact JSON contract) — 0 console errors, 0 page errors, all requests 2xx, a11y tree clean, checkout drag settles.

## Log
Moved to HANDOFF_LOG.md (2026-10-27) to keep this file short; every agent loads it each session. Append there, not here.
