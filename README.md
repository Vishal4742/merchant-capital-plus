# Merchant Capital+

**A stablecoin payment gateway for merchants who sell internationally: payment links, payment pages, invoices, QR codes, discount vouchers, multi-currency prices, sales reports and instant settlement in USDT on Whitechain, with a one-line payment button and an SDK. Customers pay with zero gas. Plus Capital: get paid early from future sales.** Testnet only (Whitechain Sepolia).

> Status (Nov 6, 06:50 IST): gates G0–G3 passed and verified on-chain; Phase 4 (gateway screens) is being built. Slots marked `⟨…⟩` are filled as each acceptance test passes. Requirements: `docs/SRS.md`. Design: `ARCHITECTURE.md`. How we built it: `PIPELINE.md`, `AI_USAGE.md`.

## What makes it different
- **Zero gas for the payer:** the customer signs once; our relayer pays the gas.
- **Instant settlement (T+0):** money lands in the merchant's own wallet in the same transaction (included in about 1 s; Whitechain marks it finalized later); we never hold it.
- **Exact amounts:** the customer signs an authorization for an exact amount, so under- and overpayment (a common problem at crypto gateways) can't happen.
- **Every receipt is an on-chain transaction** anyone can check.
- **Easiest to integrate:** a one-line payment button or a small SDK, with signed webhooks.

### Compared with existing gateways
| | Whitepay (W Group) | Coinbase Commerce | Merchant Capital+ |
|---|---|---|---|
| Where the money lands | A WhiteBIT-side account: deposit addresses and off-chain settlement from WhiteBIT balances ([docs](https://docs.whitebit.com/guides/payments-overview)) | Escrow, then settled in USDC | The merchant's own wallet, in the same transaction |
| Customer pays gas | Not stated; "Pay with WhiteBIT" moves funds off-chain between WhiteBIT accounts | No (EIP-3009 USDC on Base) | No (EIP-3009 USDT on Whitechain) |
| Runs on Whitechain | Not mentioned on [whitepay.com](https://whitepay.com) | No | Yes |
| Fee | 0.4–1.5% of pay-ins ([whitepay.com](https://whitepay.com)) | About 1% (Shopify app listing) | A flat 0.10 USDT inside each payment, which covers the gas |
| Merchant financing | None listed | None | Revenue advances and invoice claims, repaid from the payment split |
| Where they're ahead | 200+ coins, POS terminals, fiat payouts | Shopify, scale | — |

We'd sit next to Whitepay, not replace it: Whitepay covers custodial, many-coin, fiat-settled processing; we're the non-custodial rail on Whitechain itself, with financing that only works when the payment is split on chain.

## Why this needs on-chain stablecoin settlement
Repayment is enforced where the money arrives. One customer payment is split, in the same transaction, between the merchant, the investors who financed it and the gas fee, under rules neither the merchant nor we can change. A card rail or bank transfer can't route one payment to three parties by code, and an investor would have to trust the merchant to forward the money. With USDT on Whitechain, any verified investor can fund a café at 3 a.m. and gets repaid in one second.

## Demo
- Live app: [merchant-capital.vercel.app](https://merchant-capital.vercel.app) (Whitechain testnet; test mode) · Demo shop: [merchant-capital-shop.vercel.app](https://merchant-capital-shop.vercel.app) · Video (2:45): ⟨url⟩
- Walkthrough = acceptance tests AT-1 to AT-15 (`docs/SRS.md` §6)

## Sponsor tracks
### Whitechain (Operate · Scale · Tokenize; one prize)
| Requirement | Evidence |
|---|---|
| Contracts deployed + verified on 1874 (all full Blockscout matches) | MerchantPay [0xab81…4251](https://explorer.testnet.whitechain.io/address/0xab817593253a0a37de723072827d88fe0ca54251) · CapitalMarket [0xecd6…0abe](https://explorer.testnet.whitechain.io/address/0xecd63a369d23dfddc6bfac921e41a86760c20abe) · ClaimToken [0xce9b…c388](https://explorer.testnet.whitechain.io/address/0xce9b171a5c485a41dced9d7f043733bddc26c388) · InvestorRegistry [0x2934…3e74](https://explorer.testnet.whitechain.io/address/0x293430fae87ca79844c6e3a64e8044078c4d3e74) · the app uses only these; an earlier Phase 2 MerchantPay (0x83b5…73b7) is paused and unused |
| USDT payment in the main flow | Sale split in one tx [0xae155c49…](https://explorer.testnet.whitechain.io/tx/0xae155c49b9e10c098ff3f6146dd29256c75a52acaac85a3367e0c8e30e3cfb1a) (2 USDT → 0.10 fee + 1.90 merchant; payer 0 WBT) · invoice payment [AT-7](https://explorer.testnet.whitechain.io/tx/0xd9172e76c1f19d2152d10283a84732ac0ef14680698f7279cfc2c10dd71003b1) (100.10 → 60 + 40 to two investors) · advance repayment split [AT-4](https://explorer.testnet.whitechain.io/tx/0x9fc06d890b53dde51e469e348fc9b9bdaadfc541f82e9fbb2a833a74edba5ec8) (a 5 USDT sale sends 1 to the investor in the same tx) · gasless 25 USDT checkout [AT-1](https://explorer.testnet.whitechain.io/tx/0x7e03b5d0c52b6b7d941845b364f78875719c481fc7d4b353187038b504b37a11) · refund [AT-2](https://explorer.testnet.whitechain.io/tx/0x8334c4ba867131e999d1d371b1d1a7f13904ae3312eea7373cc53a4c5a04bbeb) · 4.40 s sign-to-receipt sale [NFR-4](https://explorer.testnet.whitechain.io/tx/0xd1a71cb5e05968f25dcaafd3d84fffe976937286fdc09c4ed0e323308e4b987a), and 4.32 s through the production relayer on Vercel [tx](https://explorer.testnet.whitechain.io/tx/0xae8b017188d47bc17db535a9cc395a1663a76931c4765cd55f212c73c794a24a) (relayer share 2.44 s: checks 0.30, pre-send 0.26, send 0.51, receipt 1.37) |
| **Operate:** drop-in in ≈20 lines | `apps/shop` integration: **20 lines** ([`api/checkout.ts`](apps/shop/api/checkout.ts) 9: `sessions.create` + redirect; [`api/webhook.ts`](apps/shop/api/webhook.ts) 11: `constructEvent` verifies `MC-Signature`, forged or unsigned → 400); live shop [merchant-capital-shop.vercel.app](https://merchant-capital-shop.vercel.app): a 2.00 USDT espresso paid by a 0-WBT guest in 4.98 s [AT-14](https://explorer.testnet.whitechain.io/tx/0x29c9ef20eb208091290df43aa9875e06889134ce323a71f69fe79c35b5606ebd), `payment.succeeded` delivered once and verified; merchant view [payments](docs/screens/merchant-payments-1440.png), customer view [payment link](docs/screens/customer-link-375.png) · [payment page](docs/screens/customer-page-375.png); refund [0xbd91e67e…](https://explorer.testnet.whitechain.io/tx/0xbd91e67e672cf3a1c94e0fbf82335be719e2c77a4e0499328a9b767d3347f939); CSV export ([reports screen](docs/screens/merchant-reports-1440.png), `GET /api/v1/reports.csv`) |
| **Operate (gateway):** what a merchant gets | Payment links + QR ([screen](docs/screens/merchant-links-qr-1440.png)): a 25 USD pays-once link paid by a 0-WBT guest in 3.81 s [AT-11](https://explorer.testnet.whitechain.io/tx/0x26139ab94216a8e954c977dedc2edda7ccfa921c210cd920ea7f5f2ab6bcf6db) (25 → 0.10 fee + 24.90 merchant) · payment pages ([live page](https://merchant-capital.vercel.app/p/egAwjNvIhu), [screenshot](docs/screens/customer-page-375.png)) · invoices with line items (paid on chain, financed in the Capital tab: [AT-7](https://explorer.testnet.whitechain.io/tx/0xd9172e76c1f19d2152d10283a84732ac0ef14680698f7279cfc2c10dd71003b1)) · discount vouchers stored on Arkiv ([entity](https://rabdi.explorer.arkiv.network/entity/0xf51f4594de604c3b44ce0238dbd5344ff8313bbac5dcf79ab73c555e8479482c), used in [AT-12](https://explorer.testnet.whitechain.io/tx/0xb3e7154028bac909bfd49b4c5da5d261de3482ae93187f2d942267b744020e81)) · multi-currency prices (USD = USDT 1:1; EUR/GBP/INR/SGD at the ECB rate, AED via its peg; quote locked 10 min): 20.00 EUR at 0.88873 EUR/USD (Frankfurter, 6 Nov) charged exactly 22.51 USDT, rounded up [AT-13](https://explorer.testnet.whitechain.io/tx/0x6350de188f6c5cc344793b03b70aa6e0184650a3f45d3d5ba81a1811cfee90e9) · reports + CSV [screen](docs/screens/merchant-reports-1440.png) (6 Nov IST: 12 payments, 238.61 USDT gross, 1.20 fees, equal to the sum of MerchantPay's on-chain `Paid` events for the merchant, AT-15) · instant T+0 settlements (each row links its on-chain tx; the merchant-only "Network fee we covered" column: [screen](docs/screens/merchant-payments-1440.png)) · signed webhooks (`MC-Signature`) · test-mode API keys · [`/docs`](https://merchant-capital.vercel.app/docs): quickstart, curl next to the SDK, every endpoint, test scenarios |
| **Scale:** zero crypto steps for the payer | Customer pays with one "Confirm payment" from a wallet the page creates for them (no WBT, no seed phrase, no chain name) [link at 375 px](docs/screens/customer-link-375.png) → [paid at 375 px](docs/screens/customer-checkout-paid-375.png) |
| **Scale:** who pays gas / how the relayer gets WBT / what stops draining | The merchant pays a 0.10 USDT fee inside each payment, sent to the relayer in the same tx; at the 6 gwei cap a ≈208k-gas sale costs ≈0.00104 WBT, so the fee covers gas up to ≈6.2 gwei. The relayer is topped up with faucet WBT; turning collected USDT fees back into WBT is a manual YetiTrade swap (the automatic swap was cut for time). Drain guard ([`apps/relayer/src/relayer.ts`](apps/relayer/src/relayer.ts), tests in [`apps/relayer/test/`](apps/relayer/test/)): only MerchantPay `paySale`/`payInvoice`, payers with code refused (incl. EIP-7702), simulate first, gas cap 6 gwei, a payer is banned after one mined revert and sending stops after 3 per hour, shared-secret header, Postgres send lock, per-IP and per-payer rate limits, daily WBT budget. Live relayer: [merchant-capital-relayer.vercel.app/health](https://merchant-capital-relayer.vercel.app/health); bad calls rejected with the relayer nonce unchanged (AT-10), /health p95 280 ms, rejects p95 ≤ 363 ms (NFR-14) |
| **Tokenize:** real transfer rules + lifecycle | ERC-1155 claim token with ERC-7943 rules (investor allowlist (simulated KYC), ≤8 holders, maturity lock, admin freeze) in [`ClaimToken.sol`](contracts/src/ClaimToken.sol) and [`InvestorRegistry.sol`](contracts/src/InvestorRegistry.sol); a transfer to a non-eligible wallet reverts on chain with `ERC7943CannotReceive` [AT-8](https://explorer.testnet.whitechain.io/tx/0x08f45d4bf2826b350cc065a09888ff5ecf2a064ed12ae662c914b10f889a56f8); advance funded [AT-3](https://explorer.testnet.whitechain.io/tx/0x8d4958ebb6c20d1a1e4a269bfd6736c641f62ca02d6521e94b92934c8f3f6810) → a 5 USDT sale repays 1 USDT to the investor in the same tx [AT-4](https://explorer.testnet.whitechain.io/tx/0x9fc06d890b53dde51e469e348fc9b9bdaadfc541f82e9fbb2a833a74edba5ec8) → after the cap the investor gets 0 [AT-5](https://explorer.testnet.whitechain.io/tx/0x0269606d7668b50e5c0b8d6dca43449def7b660e92371ff4090fbff199df4360) · invoice financing: two investors buy a 100 USDT invoice [A 58.84](https://explorer.testnet.whitechain.io/tx/0x6b346413c77effb7f2084103caf93236a47349681729816bb0a850aa95a9ab3c) + [B 39.23](https://explorer.testnet.whitechain.io/tx/0xab395b1dd7c452229661dfab86f7efee79700d87bc00aaa7957390c7627d9744) → the debtor pays 100.10 and both are repaid 60 + 40 in one tx [AT-7](https://explorer.testnet.whitechain.io/tx/0xd9172e76c1f19d2152d10283a84732ac0ef14680698f7279cfc2c10dd71003b1) · `canTransfer` returns false for it before anyone signs (AT-8) |
| Rail proof (Phase 1) | A payer with **0 WBT and nonce 0** sends 1 USDT through our relayer: [tx](https://explorer.testnet.whitechain.io/tx/0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e) (94,034 gas, paid by the relayer) · stub [PullStub](https://explorer.testnet.whitechain.io/address/0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d) |
| Feedback | `WHITECHAIN_FEEDBACK.md` |

### Arkiv (Build on Arkiv)
Financing offers are read from Arkiv: the investor offer book queries `mcplus.offer.v1` entities live (`capital-arkiv.ts`), and an offer drops out when its entity expires at the deadline. Discount codes are Arkiv entities (`mcplus.voucher.v1`) that expire with the code, and the checkout reads the live entity before applying a code: a missing or expired entity refuses the code, and if Arkiv can't be reached the code is refused while the sale can still be paid without it (`applyVoucher`, FR-ARK-7): code G4AT12 (10% off) is entity [0xf51f…482c](https://rabdi.explorer.arkiv.network/entity/0xf51f4594de604c3b44ce0238dbd5344ff8313bbac5dcf79ab73c555e8479482c), created in tx [0x3e21…1fa2](https://rabdi.explorer.arkiv.network/tx/0x3e215e9579b569847274589e0df6b6b10b3fae6c7baa9cfe13aa8ddc553a1fa2) and expiring 7 Nov 06:30 UTC; the code is stored only as a keyed hash. A customer used it on a 6 + 5 USD page and paid 9.90 USDT on Whitechain [AT-12](https://explorer.testnet.whitechain.io/tx/0xb3e7154028bac909bfd49b4c5da5d261de3482ae93187f2d942267b744020e81). Financing offers are Arkiv entities (`mcplus.offer.v1`) that expire at the offer deadline; the investor offer book reads them (Capital tab). Writer address: `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` · Live proof (Phase 1 probe): create tx [0x2d651b87…771e](https://rabdi.explorer.arkiv.network/tx/0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e) (block 258050; create 3.2 s, `ownedBy` query 285 ms) · Runnable query: [https://rabdi.explorer.arkiv.network/entity-explorer](https://rabdi.explorer.arkiv.network/entity-explorer) with `arkiv.schema = str('mcplus.probe.v1')`, or `node --env-file=../../.env scripts/arkiv-probe.ts` from `apps/web` (needs `ARKIV_PRIVATE_KEY` + `ARKIV_ACCESS_KEY`) · `arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.

### Ethereum Foundation (Anon-RPC · CROPS)
Every chain read the app makes in the browser goes through Anon-RPC by default (Nym, Tor fallback), including Arkiv reads; a meter on the dashboard counts them (a production run showed **Private reads 4 of 4**, no CSP violations). The customer pay and checkout pages make no browser chain reads at all (the amount and merchant come from our server), so they can't leak the payer's IP. Exclusions (disclosed): relayer writes over HTTPS, the two mainnet bootstrap reads (eth_call to ethereum-rpc.publicnode.com), explorer history lookups, the server-side read behind the pay and checkout pages, the server's balance check behind "Pay with your wallet" (it answers only enough or not enough), the customer's own wallet's RPC traffic when they choose that option (their wallet, not ours), and the Nym worker's own plain traffic (directory lookups to validator.nymtech.net, one WSS to a Nym entry gateway, bundle fallbacks unpkg.com / raw.githubusercontent.com after jsDelivr). These carry no wallet data. The dashboard's Content-Security-Policy allows exactly these hosts on `/merchant` pages (not on `/merchant/developers`, which shows a new API secret); the customer pay, checkout, link and page routes allow no third-party hosts at all.
Private-read proof (Phase 1): the app read Whitechain blocks through Nym (e.g. block 12,298,671) with **0 direct RPC requests** in 12 browser test runs; a swapped worker bundle is refused (pinned hash).
**CROPS:** C: payment functions are permissionless, so anyone can submit a signed authorization if our relayer is down · O: MIT ([`LICENSE`](LICENSE)) · P: private reads by default, no personal data on-chain or on Arkiv · S: non-custodial, keys stay on the user's device.

## AI assistant (MCP)
`packages/mcp` is a local MCP server for Claude Code or Claude Desktop. Merchant tools (`create_checkout`, `get_checkout`, `list_payments`, `sales_summary`) use the merchant's own `sk_test_` key and can't move money. An optional payer tool (`pay_checkout`, only with `MCP_PAYER_KEY`) lets an agent pay a checkout without gas, capped at 10 USDT per payment and 25 per day, with `spending_report` listing every payment.
```
cd packages/mcp && npm ci
claude mcp add merchant-capital --transport stdio --env MCP_SECRET_KEY=sk_test_YOUR_KEY -- node "$PWD/src/index.ts"
```
Parts of it are adapted from [Pixa](https://github.com/soumyacodes007/Pixa) (MIT; licence in `packages/mcp/THIRD_PARTY_LICENSES`; ETHGlobal mentors confirmed this reuse is within Start Fresh).

## Architecture
Full-stack: Next.js frontend, two TypeScript servers (relayer, web API incl. the gateway API: links, pages, vouchers, quotes, reports, settlements, keys, webhooks), a zero-dependency SDK + one-line pay button (`packages/sdk`), Postgres for sessions and rate limits only, and Solidity contracts on Whitechain that hold every money rule.

```
Shop server ──POST /api/v1/sessions──► Web API (apps/web) ──► checkout link
Customer /pay (no chain reads in the browser) ── signs a USDT authorization, no gas
        ▼
Relayer (apps/relayer): allowlist · payer has no code · signature, balance, window, replay
        · rate limits · daily gas budget · simulate first ── pays the WBT gas
        ▼
MerchantPay (one tx): pull USDT ─► 0.10 fee to relayer ─► advance holdback to investors ─► rest to merchant
        ▼
receipt → signed webhook to the shop
Dashboards read the chain privately via Anon-RPC (Nym), one Multicall per screen; offers live on Arkiv.
```
Contracts: `contracts/` (Solidity 0.8.38, Foundry) · Relayer: `apps/relayer/` (Node, viem) · Apps: `apps/web/`, `apps/shop/` (Next.js 16) · Details: `ARCHITECTURE.md`

## Setup
Requirements: Node 26, Foundry 1.8.6, git. Everything runs on Whitechain Sepolia (chain 1874); no mainnet funds are needed.

```bash
git clone --recursive https://github.com/Vishal4742/merchant-capital-plus && cd merchant-capital-plus
cp .env.example .env          # fill in the values; never commit .env

# Contracts (Foundry; fork tests run against Whitechain Sepolia with the real USDT)
cd contracts && forge build && forge test -vv && cd ..

# Relayer: http://127.0.0.1:8787 locally; production https://merchant-capital-relayer.vercel.app
cd apps/relayer && npm ci && npm test && npm run dev        # GET /health, POST /relay

# Web app (merchant, investor, customer pages): http://localhost:3000
cd apps/web && npm ci && npm run typecheck && npm test && npm run dev

# SDK + pay button (zero dependencies)
cd packages/sdk && npm ci && npm test

# Demo shop on the SDK (20 integration lines)
cd apps/shop && npm ci && npm run dev
```
Test funds: claim WBT at faucet.testnet.whitechain.io, then swap some to the prize USDT (`0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7`) on testnet.yetitrade.fi. CI runs the same checks on every push (`.github/workflows/ci.yml`).

## Limitations (honest)
- Testnet only (official USD₮ isn't on Whitechain mainnet yet). Maturity lock 60 s and grace 120 s on testnet so the demo can show them; 1 day / 7 days in production.
- KYC is simulated: our compliance key keeps an investor allowlist (stands in for WhiteBIT KYC). EAS attestations, debtor acknowledgement, pay-on-due-date and default/recourse were cut for time.
- Demo wallets were funded by a one-off seed script from a team wallet (test USDT swapped from faucet WBT on YetiTrade). The app has no faucet button.
- The customer's wallet is a guest key kept in the browser (no email recovery). We tested Privy's email login and dropped it: it always sends analytics with the wallet address to its servers, and we don't ship trackers.
- A merchant could take sales outside our checkout; default rules, recourse and public sales stats mitigate this, they don't prevent it.
- **Admin trust (testnet):** one deployer key (`0xb4E7…714D`) is the compliance admin and the contract owner. It can force-transfer claims between eligible investors, freeze claim units and revoke investor eligibility (ERC-7943 rules, simulated KYC), and it can pause MerchantPay. Ownership uses `Ownable2Step`; production would put these roles behind a multisig.
- Cut for time: default and recourse handling (a claim that is never repaid stays outstanding; no freeze-and-recourse lien).
- Relayed repayments are capped at 2 investors per invoice and 1 per advance. A full invoice repayment costs about 34k gas per holder (363.7k with 2, 397.6k with 3, measured on a fork), plus 17.1k for each holder or fee recipient that holds 0 USDT, so 3 holders can exceed the relayer's fixed 400k gas limit. The relayer estimates gas before sending and refuses anything above its limit rather than paying for a failing transaction, and the funding route refuses a second advance holder or a third invoice holder. An investor who takes a claim's last free slot must buy all the units left, so a small purchase can't lock the claim. Two first fundings of the same advance sent within a few seconds of each other can still both pass this check (the cap isn't re-checked inside the relayer's lock yet), so the demo funds one investor at a time. The contract itself allows up to 8 holders.
- Cut for time: the automatic fee-to-WBT swap for the relayer (FR-REL-8; refilled by hand).
- Invoice repayments have no per-merchant rate limit, only 10 per payer per hour. A merchant who also controls an invoice's investors could spend the relayer's 0.1 WBT daily gas budget in about 40 heavy repayments, paying about 4 USDT in fees to do it. No funds are at risk; relaying pauses until the next day.
- The relayer's send lock, daily gas budget and per-payer limits live in Postgres (a lease row with a fencing write, FR-REL-10), so they hold across server instances and redeploys. A mined revert bans that payer until the owner lifts it, and 3 reverts in an hour pause all relaying.

## What's next (after Mumbai)
- Pay from another chain: one tested corridor (Ethereum Sepolia USDC into Whitechain USDT) with an exact destination amount and a refund path, before any "any chain" claim.
- An assistant connector (MCP) that drafts invoices and answers "has Acme paid?" from chain evidence. It can't move money.
- Business accounts with roles, and settlement-address changes that need a second approval.

## Team and AI usage
⟨team⟩ · AI usage per file and the full build trail: `AI_USAGE.md`, `.batches/`
