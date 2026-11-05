# Whitechain inventory: what exists, what's missing (2026-11-05, ~17:30 IST)

Read-only research. On-chain checks: `eth_getCode` / `eth_call` against `https://rpc.testnet.whitechain.io` (1874) and `https://rpc.whitechain.io` (1875), and the Blockscout REST v2 API on both explorers. No code downloaded and run. "Unverified" = I couldn't confirm it.

Abbreviations: TN = Whitechain Sepolia 1874, MN = Whitechain mainnet 1875. "txs" = Blockscout `/api/v2/addresses/{a}/counters` `transactions_count` (direct txs to the address only, not internal calls).

---

## 0. Headline findings (things the team didn't know yet)

1. **Someone already runs an x402 facilitator on TN.** The canonical `x402ExactPermit2Proxy` sits at `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` (verified 2026-10-19) and has **59 `settle` txs** between 2026-10-26 and 2026-11-04, sent by two EOAs (`0x59Ca3DA1…14A3` ×36, `0xF3e1F2e6…8169` ×14). They settled 0.01 prize USDT (`0xcedf…55a7`) and 0.01 USDC.e. Nobody has published it as a public facilitator (a web search for "x402 facilitator Whitechain" finds nothing). So "first x402 facilitator on Whitechain" is **not a safe pitch line**. Sources: https://explorer.testnet.whitechain.io/api/v2/addresses/0x402085c248EeA27D92E8b30b2C58ed07f9E20001/transactions , tx 0x0f6347a7b33c019d87e9fc1a318b51ece72b7ec87d411237899166f1c8d46b35 token-transfers.
2. **The Uniswap v3 deployment on TN is not official; it's YetiTrade.** The YetiTrade testnet frontend (https://testnet.yetitrade.fi, "© 2026 NEXODE SOLUTIONS DAO LLC") embeds UniswapV3Factory `0x94aFa2aB80E44163362D2952bdf1E95b81900738` and UniversalRouter `0xbCB198083504E31293bC3765b3c791cF2B2202d8` in its JS. Uniswap's official deployments page has 0 mentions of Whitechain (https://developers.uniswap.org/contracts/v4/deployments). There is also a Uniswap **v4** PoolManager `0x2717A6EcB743d3eFb6b66c7eA7759717d38d3c21` (verified 2026-11-01, 0 txs), probably a rival team preparing for the Uniswap prize.
3. **P256VERIFY (RIP-7212) works on both chains.** I signed a fresh secp256r1 signature with openssl and sent `eth_call` to `0x…0100`; both RPCs returned `0x…01`. Passkey wallets can verify signatures cheaply, yet no passkey smart-wallet provider runs here.
4. **A third party wrote "no oracle" into verified source.** Cotejo `AttestationSource` (`0x78cce8C167583bf358B3EA1c9C409e13A7Da691a`, TN) says in its NatSpec: *"Whitechain has no deployed oracle, no testnet DEX with usable liquidity, and no native stablecoin, so there is nothing on-chain to read a price from."* Cotejo itself pushes signed price attestations (5 sources, ~10k `submit` txs, plus a Chainlink-shaped `CotejoAggregatorAdapter` `0xc7624150…aE16`). https://explorer.testnet.whitechain.io/address/0x78cce8C167583bf358B3EA1c9C409e13A7Da691a?tab=contract
5. **The KYC identity (WB Soul) exists on MN only.** System contracts `0x…1001` (SoulDrop), `0x…2000` (SoulRegistry) and `0x…2002` (SoulAttributeRegistry) have code on MN and **no code on TN** (eth_getCode). The hackathon requires TN, so a compliance-gated RWA can't read real WhiteBIT KYC there.
6. **There is no USDT on mainnet yet.** The MN `TetherToken` `0xAf5DB5f3315c3Dd821a82EEd603C82B080d6fe47` has 0 supply and 0 holders. MN stablecoin = USDC.e `0xF97B9Bf62916f1EB42Dd906a7254603e7b9FC4a7` (3,037 holders). The docs say: "ETH and the official USD₮ come to Mainnet in later releases, each after its audit." https://docs.whitechain.io/build/bridge/portal-bridge
7. **Mainnet is nearly empty.** Daily MN txs run at ~86,430–86,620 (Blockscout chart), and 86,400 of those are the one-per-block L1-info deposit. So users send roughly 30–220 txs/day (estimate). On TN, user txs run ~3,500–4,900/day. https://explorer.whitechain.io/api/v2/stats/charts/transactions , https://explorer.testnet.whitechain.io/api/v2/stats/charts/transactions

---

## 1. Prize tracks: full text (verbatim from https://ethglobal.com/events/mumbai/prizes, fetched 17:06 IST)

**About:** "Whitechain is The Onchain Economy Layer: the core for onchain business to launch, operate and scale on. An EVM Layer 2 built on the OP Stack, supported by developer tooling and a partner ecosystem, with mainnet arriving in November. At ETHGlobal Mumbai together with Optimism." Total $15,000.

### 💳 Operate · Stablecoin Payments for Business ⸺ $5,000 (1st $2,500 / 2nd $1,500 / 3rd $1,000)
"Give a business everything it needs to get paid in USDT on Whitechain, from the first checkout to what happens after it. Build a payment flow a real merchant could plug into their app or store, and show it working end to end with test stablecoins on Whitechain. It is plain EVM, so use any tooling you like."

Ideas to start from:
- A drop in checkout for online stores with order webhooks and an onchain receipt
- Payment links and invoices for remote studios, contractors and cross-border teams billing global clients, with due dates and reminders
- Subscriptions and recurring billing with permit based pulls and cancel anytime
- Refunds and partial refunds a merchant issues in one click, with a record the customer can check

What we want to see:
- A drop in piece, widget, SDK, payment link API or plugin that a separate demo app adds in about 20 lines
- Both views in the demo, the merchant and the paying customer
- Extra credit if your flow goes past the first payment, like a refund, a renewal or an export the accountant can use

"Won't place. A pay button that sends a plain transfer, tipping jars, bill splitters, or custodial bridges into a local currency token. Payroll, escrow and revenue splits on their own."

### 🏦 Tokenize · Real World Finance on Whitechain ⸺ $4,000 (1st $2,500 / 2nd $1,500)
"Model real-world asset (RWA) lifecycles and compliance logic onchain. Build an issuance, settlement or lifecycle flow for a real world asset on Whitechain, where every payment happens in USDT, and show it working end to end with test stablecoins."

Ideas to start from:
- Tokenized bonds or notes with an investor allowlist, coupon payments in USDT and repayment at maturity
- Invoice financing where a business tokenizes an invoice, a buyer funds it at a discount and settlement happens automatically on the due date
- Repo or short term lending agreements with delivery versus payment, where the asset and the stablecoin move in one transaction
- Trade finance flows where importer, exporter and bank each confirm their step before funds are released

What we want to see:
- Real transfer rules enforced in the contract, such as allowlists, transfer restrictions, maturity or settlement conditions, not just a token with a UI on top
- A clear issuer, investor or business user and at least one full lifecycle step in the demo, from issuance to payment or settlement

"Won't place. A token with a mint button and no rules, or ownership NFTs where nothing is enforced onchain."
"Paying an invoice belongs in Operate. Financing or selling an invoice belongs in Tokenize."

### ⚡ Scale · Payments Nobody Notices ⸺ $3,000 (1st $2,000 / 2nd $1,000)
"Businesses scale when their customers never have to learn crypto, and when software can pay software. Build a payment flow on Whitechain where the payer, a person or an AI agent, pays in stablecoins without holding WBT for gas, writing down a seed phrase or knowing what chain they are on."

Ideas to start from:
- Gasless checkout where the merchant covers gas, using permit or transferWithAuthorization (EIP 3009) and your own relayer
- Checkout with an embedded wallet or smart account from any provider that supports Whitechain Sepolia (chain ID 1874)
- Pay per request APIs where an AI agent pays a business in USDT over x402, settled on Whitechain through a facilitator you run

What we want to see:
- A payer flow with zero crypto steps visible, shown in the demo
- How the business side pays for the gas, how your relayer gets its WBT, and what stops someone from draining it

"Won't place. Flows where the payer still signs a transaction that costs them gas, or AI chats that never actually pay anyone."

### 🔁 Continuity · Bring Your Product to Whitechain ⸺ $3,000 (1st $1,500 / 2nd $1,500)
"Already have a product with users? Add Whitechain to it during the hackathon. Accept USDT payments, move a feature onchain or deploy your contracts on Whitechain. It can be a live product or an open source repo, either works."

What we want to see:
- Real progress made this weekend, like a new feature or a new payment flow. A nicer UI on what you already had is not enough
- Real users or a real business behind the product count in your favour

"Won't place. Projects that only repackage something built before the hackathon."

### Qualification Requirements (identical text in Operate, Tokenize and Scale; Continuity adds the two items marked †)
- Contracts deployed on Whitechain Sepolia (chain ID 1874) and verified on the Whitechain explorer
- At least one payment in USDT (0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7) settled on Whitechain in your main flow, with the explorer link in your README. Payments in a test token you minted yourself won't count
- A line in your README on why this flow needs onchain stablecoin settlement on Whitechain and what a regular payment rail couldn't do here
- † Proof of your starting point, for example a dated commit from before the hackathon or the page of your earlier submission
- † A short "before and during" part in your README so judges can tell the old code from the Whitechain work added at this hackathon
- A public GitHub repo that shows steady progress through the hackathon rather than one big upload at the end, with a README that explains setup, architecture and current limitations
- A demo video of 2 to 4 minutes that shows each party involved
- A WHITECHAIN_FEEDBACK.md in your repo, a few honest lines on what worked, where you got stuck and what our docs were missing

Good to know (every track): "Test tokens (WBT, USDT) have no monetary value. Prizes are paid by ETHGlobal in USDC under standard event eligibility rules." / "Free Ankr RPC for hackers, 1,500 requests per second for 7 days. Activate it here when you start building." (https://www.ankr.com/rpc/?utm_referral=Whitechain2026)
Links: docs.whitechain.io, faucet.testnet.whitechain.io, explorer.testnet.whitechain.io, optimism.io, docs.optimism.io, Ankr.

Note: the docs say "Third-party public endpoints are not live yet" (https://docs.whitechain.io/learn/network/reference). The prize page offers Ankr anyway. Worth a WHITECHAIN_FEEDBACK.md line.

---

## 2. Whitechain's own products and features

### Chain basics
| Item | Value | Source |
|---|---|---|
| Type | OP Stack L2, settles on Ethereum via blobs; WBT = custom gas token (CGT mode), 18 decimals | https://docs.whitechain.io/learn/network/reference |
| MN | chain 1875, live since 26 Oct 2026, genesis block 50961390, RPC rpc.whitechain.io, explorer explorer.whitechain.io | https://docs.whitechain.io/learn/network/mainnet |
| TN | chain 1874, L1 = Ethereum Sepolia, live RPC head ~12.28M blocks | https://docs.whitechain.io/learn/network/testnet ; eth_blockNumber |
| Block time | 1 s; Flashblocks **not enabled** on either network ("prepared but not live") | https://docs.whitechain.io/learn/network/transaction-finality |
| Finality | soft ~1 s → safe ≤~30 min → finalized ~13 min later; withdrawals ≥7 days MN, ~1 h TN | same |
| Fees | EIP-1559, 5 gwei base-fee floor, elasticity 6, denominator 100, 40M block gas, **no operator fee**, plus L1 data fee; plain transfer ≈0.000105 WBT | https://docs.whitechain.io/learn/network/network-fees |
| EVM / upgrades | MN: Prague via **Isthmus** plus an Osaka subset via **Karst** (CLZ EIP-7939, 16,777,216 per-tx gas cap EIP-7825, MODEXP EIP-7883/7823, higher P256VERIFY cost EIP-7951). TN: Prague via Isthmus, all upgrades through **Jovian**, **Karst NOT active** (no CLZ, no per-tx cap). Use `evmVersion = prague`. | https://docs.whitechain.io/learn/network/reference |
| EIP-7702 | active (Prague); the docs warn that `tx.origin == msg.sender` no longer proves a human | https://docs.whitechain.io/learn/general/migration |
| Sequencer | single sequencer run by "a designated infrastructure operator"; roadmap "targets progressive transition to permissionless, decentralized sequencing"; forced inclusion via OptimismPortal | https://docs.whitechain.io/learn/general/faq |
| Fault proofs | permissioned: only the configured challenger can dispute; a Guardian can pause | https://docs.whitechain.io/learn/network/transaction-finality |
| Staking / validators | No L2 validator staking found. whitechain.io says WBT "secures the chain through validator staking" and lists "SoulDrop rewards", but SoulDrop is a WhiteBIT holder-loyalty reward, not validator yield (unverified for L2) | https://whitechain.io/ ; https://help.whitebit.com/hc/en-gb/articles/14826284940061 |
| Fee revenue | all fee vaults → treasury Safe `0x81a60e10996B30356361865a8A00B43231320C31` (L1) | https://docs.whitechain.io/learn/network/reference |
| RPC limits | 50 req/s per IP, burst 500, 100 calls per batch, 429 + Retry-After 1; WS `newHeads`/`logs` (TN also `newPendingTransactions`) | https://docs.whitechain.io/learn/general/faq |
| Legacy L1 | PoA Clique, 1 validator, 2 s blocks, 10 gwei fixed; stopped 26 Oct 02:00 UTC; read-only at legacy.explorer / legacy.rpc; old testnet 2625 shut down | https://docs.whitechain.io/legacy/overview.md |

### Portal bridge (centralized, operated by Whitechain)
- Assets USDC, USDT, WBT, ETH between Ethereum, Tron and Whitechain. "It is the only route that connects Tron to Whitechain." No direct Ethereum↔Tron route.
- Routes (testnet): Ethereum↔Whitechain: USDC (arrives as USDC.e), WBT, **UAHe** (Ukrainian hryvnia stablecoin), ETH. Tron↔Whitechain: **USDT**, WBT. Daily testnet limits: USDC 10k, WBT 200, UAHe 1M, USDT 10k.
- No bridging fee. On Whitechain→Ethereum the Portal pays ETH gas and charges the user the WBT equivalent "using WhiteBIT market rates". A relayer signs every release; the Portal can be paused.
- TN contracts: Bridge `0x8F4D5bC9379beF9c209C895a1d6e7c26F64fE14F` (873 txs), Mapper `0x8f3FF368cd820910cB1A62acee5548BC354599Bf`. Bridged USDT on TN = `0xaa7962…8f46` (symbol USDT.e, 33 holders). This is **not** the prize USDT.
- MN: bridge.whitechain.io from 27 Oct 2026; "ETH and the official USD₮ come to Mainnet in later releases, each after its audit."
- Source: https://docs.whitechain.io/build/bridge/portal-bridge
- The Portal connect list shows "WhiteWallet marked Coming soon": https://docs.whitechain.io/build/bridge/use-the-portal

### OP Stack canonical bridge
ERC-20s and L1-origin NFTs only. Native ETH deposits revert (`OptimismPortal_NotAllowedOnCGTMode`), and native WBT can't use it. `L2CrossDomainMessenger.sendMessage` handles arbitrary messages. https://docs.whitechain.io/build/bridge/bridge-assets

### WhiteBIT / W Group integrations
- WhiteBIT users withdraw WBT straight to Whitechain from the exchange UI; buy via Convert or fiat. ERC-20 WBT on Ethereum is `0x925206b8a707096ed26ae47c84747fe0bb734f59`. Third-party on-ramps (MoonPay, Transak, Ramp) are "listed here" only once they integrate, so there are none today. https://docs.whitechain.io/learn/general/get-wbt
- Listing pathway on WhiteBIT, co-marketing, **Builders Program up to $300K** per team in milestone tranches, Strategic Ecosystem Deals, Chain Expansion Support. https://docs.whitechain.io/build/ecosystem/for-partners
- W Group: WhiteBIT, **Whitepay** (crypto merchant processing), Whitechain, PayUniCard, HashBank, white.market and others. https://www.theblock.co/press-releases/whitebit-marks-7-years-of-growth-introduces-w-group-as-a-global-fintech-powerhouse-379628
- **WB Soul**: an on-chain identity for KYC'd WhiteBIT users with attributes such as IsVerified and HoldAmount. On MN only (see §0.5). https://whitebit.com/wb-soul , https://help.whitebit.com/hc/en-gb/articles/11905736649885

### Roadmap / "coming" items (company-stated)
- whitechain.io roadmap: Q4 2026 "Unified distribution platform spanning WhiteBIT and W Group", "Genesis dApp ecosystem, targeted for day one", "Rails and a simplified UX". 2027+: Distribution Platform, Ecosystem & DeFi Scale, Institutional & B2B Rails, RWA & Asset Tokenization. https://whitechain.io/
- Press release (18 Aug 2026): "Whitechain plans to introduce Day 1 primitives intended to include a native DEX, oracle and bridge." https://www.theblock.co/press-releases/412097/whitechain-relaunches-as-w-groups-distribution-first-ethereum-layer-2
- The docs list: official USD₮ + ETH on MN "in later releases"; Flashblocks "planned network update"; third-party RPC "under evaluation"; WS limits "published once finalized"; on-ramps "when they integrate"; indexers "documented as providers integrate"; Safe on MN fee recipient "once Safe is deployed on Whitechain Mainnet".
- Blog has no mainnet-launch post. Latest post: "Whitechain Bridge Is Live on Public Testnet" (Sep 8). https://whitechain.io/blog

### Developer tooling Whitechain ships
- viem has built-in `whitechainSepolia` / `whitechain` chains (OP Stack addresses from viem 2.57). https://docs.whitechain.io/build/dapps/use-viem
- Templates (Foundry, Hardhat, Next, Vite dapps, 3 Blockscout indexer examples, token-lists): https://github.com/whitechain-labs/templates
- `whitechain-dev` Agent Skill plus skills-mcp; llms.txt / llms-full.txt. https://docs.whitechain.io/build-with-ai/claude-skills , https://github.com/whitechain-labs
- Token list v3.0.0 (2026-10-28) **now includes the prize USDT** `0xcedf…55a7` on 1874, plus ETH, USDC, WWBT (1874) and USDC.e, WWBT (1875). The docs page still describes v1.1.0 and omits it, a stale-docs bug worth noting in feedback. https://whitechain.io/tokens/whitechain.tokenlist.json vs https://docs.whitechain.io/build/block-explorer/token-list

---

## 3. Infrastructure inventory (TN / MN)

Code check = `eth_getCode` at the canonical address (my batch call, 17:10 IST).

| Building block | TN 1874 | MN 1875 | Evidence |
|---|---|---|---|
| Multicall3 `0xcA11…CA11` | ✅ predeploy | ✅ | code check; docs reference |
| Permit2 `0x0000…78BA3` | ✅ 113 txs | ✅ 0 txs | code check + counters |
| CREATE2 (Arachnid), Safe singleton factory, CreateX | ✅ | ✅ | code check |
| EAS + SchemaRegistry (OP predeploys `0x4200…21/20`) | ✅ EAS 92 txs | ✅ 0 txs | counters |
| ERC-4337 EntryPoint v0.6 / v0.7 | ✅ / ✅ (v0.7: 28 txs, last 2026-10-27) | ✅ / ✅ (0 txs) | code check + counters |
| EntryPoint v0.8 / v0.9 | ✅ / ✅ | ❌ / ❌ | code check |
| Public bundler service | ❌ none listed | ❌ | Not on Pimlico, Alchemy or ZeroDev chain lists (curl grep: 0 hits for whitechain/1874/1875): https://docs.pimlico.io/guides/supported-chains , https://www.alchemy.com/docs/reference/bundler-api-endpoints , https://docs.zerodev.app/sdk/faqs/chains |
| Paymaster | 1 third party (SolvanePaymaster `0xE6DC…bdb7` and V07 `0xc34a…96f7`, 0 txs) | ❌ | Blockscout |
| Safe 1.3.0 + 1.4.1 singletons/factories | ✅ | ✅ | code check |
| Safe UI / tx service | ✅ `wch-sepolia` | ✅ `wch` (recommended version 1.5.0) | https://safe-config.safe.global/api/v1/chains/1874 , /1875 |
| Safe4337Module v0.3 `0x75cf…c226` | ✅ (0 txs) | ❌ | code check |
| Coinbase Smart Wallet factory `0x0BA5ED0c…428a` | ❌ | ❌ | code check |
| Alchemy LightAccount v2 factory, eth-infinitism SimpleAccountFactory v0.6/v0.7 | ❌ | ❌ | code check |
| Passkey (P256VERIFY precompile 0x100) | ✅ returns 1 for a valid sig | ✅ | my eth_call test |
| Passkey wallet contracts | only unused third-party deploys (SafeWebAuthnSharedSigner `0x94a4…55c2`, ERC7913WebAuthnVerifier `0x7B91…63cC`, 0 txs) | ❌ | Blockscout |
| Embedded wallets (email/social) | ❌ Reown embedded wallet "Login completes, transactions may fail" | ❌ | https://docs.whitechain.io/build/dapps/connect-wallet-with-reown |
| Reown Blockchain API (swaps, ENS, history, on-ramp) | ❌ "Reown does not add new chains" | ❌ | same; https://rpc.walletconnect.org/v1/supported-chains (0 hits) |
| Wallets | MetaMask, Rabby, Reown (connect/sign), Safe | same | https://docs.whitechain.io/build/wallet/wallets |
| Chainlist entry | ✅ (rpc, explorer, faucet, parent eip155-11155111) | ✅ (rpc, explorer; no L2 parent field) | https://chainid.network/chains.json |
| DEX | YetiTrade = Uniswap v3 copy (factory `0x94aF…0738`, NPM `0x3330…45b8` 795 txs, SwapRouter02 `0xe208…6962` 629 txs, UniversalRouter `0xbCB1…02d8` 234 txs, QuoterV2, TickLens, Staker, V3Migrator). Also Umbrae LB (Trader Joe Liquidity Book fork, factory 8 txs), Uniswap v4 PoolManager (0 txs) | WhiteSwap (Uniswap v2 fork from legacy L1: WSFactory/WSRouter/WSPair, `WSProxyRouter 0xE39E…430f` 15 txs since L2) | Blockscout; YetiTrade JS; https://help.whitebit.com/hc/en-gb/articles/25080868543517-What-is-WhiteSwap |
| Official Uniswap Labs deployment | ❌ | ❌ | https://developers.uniswap.org/contracts/v4/deployments (0 mentions) |
| WWBT/USDT liquidity | pool `0x5645…F999` (known) | none for USDT | |
| Oracles: Chainlink, Pyth, RedStone, Chronicle, API3, DIA | ❌ Pyth absent at all 3 canonical EVM addresses; API3 Api3ServerV1 absent; no Chainlink/RedStone/Chronicle-named verified contracts among 380; Pyth docs 0 hits | ❌ same | code check; https://docs.pyth.network/price-feeds/contract-addresses/evm ; Blockscout verified list |
| Oracle-like third parties | Cotejo signed-attestation router (active); a team's `PriceOracle` `0xf60e…057B` ("Signed-relay oracle for exchange prices, USD/INR…", 0 txs) | ❌ | Blockscout source |
| Indexers: The Graph, Goldsky, Envio HyperSync | ❌ (0 hits on each list) | ❌ | https://thegraph.com/docs/en/supported-networks/ , https://docs.goldsky.com/chains/supported-networks , https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks ; docs: "Whitechain indexer support is documented as providers integrate." https://docs.whitechain.io/build/block-explorer/overview |
| Blockscout API | REST v2, GraphQL (complexity cap 100), Etherscan-compatible (no gas-oracle action), public, IP-rate-limited | same | https://docs.whitechain.io/build/block-explorer/indexer-gas-tracker |
| Cross-chain messaging: LayerZero, Hyperlane, CCIP, Wormhole, Across, Relay | ❌ (LayerZero metadata: no Whitechain; Relay and Across chain APIs: 0 hits; Hyperlane registry `chains/whitechain` 404) | ❌ | https://metadata.layerzero-api.com/v1/metadata/deployments , https://api.relay.link/chains , https://across.to/api/swap/chains |
| Superchain interop predeploys `0x4200…23/28` | proxy code present (2059 B, same as every predeploy slot); interop active? **unverified, likely not** | same | code check |
| Name service / ENS | ❌ (Blockscout `ens_domain_name: null`; docs say resolve ENS on Ethereum mainnet) | legacy `UserNameService 0xEE09…5DDd`, 0 txs since L2 | Blockscout; Reown doc |
| Faucet | official: 0.5 WBT / rolling 24 h, GitHub ≥30 days, captcha; no USDT faucet | none | https://docs.whitechain.io/learn/get-started/get-testnet-wbt |
| RPC providers | official only; Ankr hacker offer on the prize page | official only | docs reference + prize page |
| Status page | status.whitechain.io | | docs |

---

## 4. Ecosystem: listed dApps and actual activity

**Officially listed:** whitechain.io names partners (Safe, WhiteBIT, W Group, hashbank, Whitewallet, WB Soul) but **no third-party dApps** ("Genesis dApp ecosystem… targeted for day one"). https://whitechain.io/ . DappRadar blocked my fetch (403). A search snippet says "No dapps found on this chain yet" (unverified).

**Mainnet (legacy L1 carry-overs, 435 contracts migrated; 346 verified):** https://docs.whitechain.io/learn/general/migration
- USDC.e (3,037 holders). DrakeWars game tokens (SFT 2,714 holders, SHRD 1,081, HRD 155). WhiteSwap v2 fork. SoulDrop/SoulRegistry system contracts (SoulDrop 110 txs since L2, the most active non-system contract). HoldAmountOperator (52). BLSMarketplace (NFT), PocketRocket game, ChessNode, Trembita, VNT bridge/presale, WhitechainLaunchBoxes ×33, UserNameService, BridgedUAHEStable / TestBridgedEUAH. Nearly all have **0 txs since the L2 cut-over**. Source: https://explorer.whitechain.io/api/v2/smart-contracts plus per-address counters (my pull, 17:08 IST).

**Testnet (5,288 contracts, 380 verified, 82k addresses):** https://explorer.testnet.whitechain.io/api/v2/stats , /smart-contracts/counters
Real activity, by direct txs:
- H2BatchV2 `0x5DE0…1629`: ERC-1155 green-hydrogen batches, 13,433 txs (`setIntegrityHash`, one operator).
- Cotejo oracle: ~10k `submit` txs (one reporter).
- Unverified Ostium-style perps ("Whitespace"): `ostiumLP 0x0aC5…44F0` 8,245 txs, 246 holders, active today. "Whitespace USD" faucet `0x2E65…D2B7`: 1,701 claims, 461 holders. Project identity is unverified (web search finds nothing).
- YetiTrade Uniswap v3: NPM 795, SwapRouter02 629, UniversalRouter 234.
- Portal Bridge 873. USDWToken 372. MarketEscrow ×3 (~115, `depositWithAuthorization`/`settle`). x402 proxy 59. WhiteDataRegistry 48 (snapshot publisher, Sept). TerritoryWars game ~84.
- "TestToken" with 30,011 holders = load-test spray (3 senders, transfers only), not users.

**Rival / pre-hackathon contracts (verified Oct 16 to Nov 4, almost all 0 txs).** These show which ideas are already crowded:
- Checkout/subscriptions: SubscriptionManager ×3, SubscriptionContract, SimpleCheckout, SolvaneCheckout, PaymentEscrow ×2, RefundRouter, MerchantRegistry ×3, ReceiptRegistry, Cashout, PayoutBatcher, SplitRouter, TreasuryScheduler, ChargeSpender. Coinbase commerce-payments clones (AuthCaptureEscrow, Permit2PaymentCollector, PreApprovalPaymentCollector), SpendPermissionCore / SafeSpendPermissionModule, plus the known DeliveryCheckout and GraphPayCheckout.
- Gasless/AA: GasTank ×2, SponsoredApprover, AgentTopUp, SessionKeyValidator ×2, Solvane accounts/factories/7702/paymasters, OpenBoxAccountFactory, GolAccountFactory, ReinFactory, RecoveryExecutor, x402 proxy.
- RWA: ERC-3643 T-REX stack (TREXFactory `0xe221…e875`, TREXGateway, IdentityRegistry, ModularCompliance, ClaimTopicsRegistry, CountryRestrict/MaxBalance/MaxInvestors modules), ReceivableMarket, InvoiceRegistry, BondVault, LienController, LocalLoanVault, WarehouseInventory1155, DppPassportNft, IssuerRegistry, ComplianceRegistry ×2, AmlRegistry ×3, plus the known OpenShare and CollateralLock.
- Other: ConfidentialToken/Transfers + PoseidonT3 + Tidex6Pool (privacy), PredictionMarket ×2, casino (Coinflip/Dice/Roulette/Crash), PotatoPad launchpad.

---

## 5. Missing on Whitechain (exists on most L2s, absent or unusable here)

| # | Missing building block | Evidence | Hackathon angle |
|---|---|---|---|
| 1 | **Price oracle** (Chainlink / Pyth / RedStone / Chronicle / API3) | code check (Pyth ×3, API3); 0 named contracts; Pyth docs 0 hits; Cotejo NatSpec "Whitechain has no deployed oracle"; press release "plans… oracle" | WBT/USD or USD/INR feed for checkout FX; Cotejo already pushes prices, so check it before building one |
| 2 | **Public ERC-4337 bundler + paymaster service** | not on Pimlico/Alchemy/ZeroDev lists; EntryPoint v0.7 has 28 txs total; one unused third-party paymaster | Scale track: a merchant-funded paymaster with drain caps |
| 3 | **Passkey / embedded smart wallet that works** | Coinbase SW, LightAccount, SimpleAccount factories absent; Reown email/social "transactions may fail"; P256 precompile works (tested) | Biggest Scale gap: "pay with Face ID, no seed phrase" on 1874 |
| 4 | **Hosted indexer / subgraphs** | The Graph, Goldsky, Envio: 0 hits; docs "documented as providers integrate" | merchant dashboard / accountant export must index via Blockscout API or WS logs |
| 5 | **Name service** | no ENS; Blockscout `ens_domain_name` null; legacy UNS dead | pay-to-name for merchants (Operate) |
| 6 | **Cross-chain messaging / third-party bridges** | LayerZero, Relay, Across, Hyperlane: no entry; only canonical + centralized Portal | Portal is the only Tron↔Whitechain path; USDT-on-Tron users exist |
| 7 | **Official USDT on mainnet** | MN TetherToken supply 0; docs "official USD₮ … in later releases" | demo must stay on TN; say so honestly |
| 8 | **KYC / identity attestations on testnet** | WB Soul contracts have no code on TN; EAS predeploy present (92 txs) | Tokenize: EAS-based allowlist that mirrors the WB Soul schema |
| 9 | **Lending market / money market** | no live lending (testnet `Pool` 0 txs; only hackathon vaults) | repo / short-term lending with DvP (Tokenize idea #3) |
| 10 | **NFT marketplace** | TN: none active; MN BLSMarketplace 0 txs since L2 | low prize fit; skip |
| 11 | **Fiat on-ramp other than WhiteBIT** | docs: providers "will be listed here" when they integrate | out of scope; the prize bans INR custodial ramps |
| 12 | **Flashblocks / preconfirmations** | "not enabled" on both | n/a |
| 13 | **Third-party public RPC** | docs: "not live yet" (Ankr offered on the prize page) | batch calls; one WS connection |
| 14 | **Reown value-added APIs** (swaps, history, on-ramp, ENS) | docs table | read history from Blockscout |
| 15 | **Testnet USDT faucet** | faucet = WBT only; swap via YetiTrade pool | include the "how to get USDT" step in the README |
| 16 | **Official Uniswap Labs deployment** | Uniswap deployments page has 0 mentions; TN v3 is YetiTrade's copy | YetiTrade pool is the only USDT liquidity |
| 17 | **Launchpad (live)** | PotatoPad 0 txs; MN LaunchBoxes legacy | low prize fit |

Not missing (don't pitch these as "first"): Multicall3, Permit2, Safe (UI too), EAS, EntryPoints, Uniswap-v3-style DEX on TN, x402 settlement (someone is doing it), T-REX/ERC-3643 contracts, Coinbase commerce-payments clones.

---

## 6. Open / unverified
- Identity of the "Whitespace" / ostiumLP perps deployer `0xDa13C59838D9edDBD313b9B32FC47F5F2D65D113`.
- Who runs the x402 facilitator EOAs `0x59Ca3DA1771d19d27724a713F3363eFbF0a714A3` / `0xF3e1F2e6dbD85535ef0260Da21D5bc5c2C758169`, and whether it's public.
- Whether YetiTrade or WhiteSwap runs a live mainnet app (yetitrade.fi returned a Cloudflare 403; whiteswap.org did not resolve from here).
- Superchain interop status (predeploy proxies exist; activation unknown).
- L2-era validator staking claim on whitechain.io (no technical doc found).
