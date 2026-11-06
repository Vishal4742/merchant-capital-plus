# Merchant Capital+

**A stablecoin payment gateway for merchants who sell internationally: payment links, payment pages, invoices, QR codes, discount vouchers, multi-currency prices, sales reports and instant settlement in USDT on Whitechain, with a one-line payment button and an SDK. Customers pay with zero gas. Plus Capital: get paid early from future sales.** Testnet only (Whitechain Sepolia).

> Status: pre-event skeleton (written before hacking starts, Start Fresh). Slots marked `⟨…⟩` are filled with real links during the build. Requirements: `docs/SRS.md`. Design: `ARCHITECTURE.md`. How we built it: `PIPELINE.md`, `AI_USAGE.md`.

## What makes it different
- **Zero gas for the payer:** the customer signs once; our relayer pays the gas.
- **Instant settlement (T+0):** money lands in the merchant's own wallet in the same transaction; we never hold it.
- **Exact amounts:** the customer signs an authorization for an exact amount, so under- and overpayment (a common problem at crypto gateways) can't happen.
- **Every receipt is an on-chain transaction** anyone can check.
- **Easiest to integrate:** a one-line payment button or a small SDK, with signed webhooks.

## Why this needs on-chain stablecoin settlement
Repayment is enforced where the money arrives. One customer payment is split, in the same transaction, between the merchant, the investors who financed it and the gas fee, under rules neither the merchant nor we can change. A card rail or bank transfer can't route one payment to three parties by code, and an investor would have to trust the merchant to forward the money. With USDT on Whitechain, any verified investor can fund a café at 3 a.m. and gets repaid in one second.

## Demo
- Live app: ⟨url⟩ · Demo shop: ⟨url⟩ · Video (2:45): ⟨url⟩
- Walkthrough = acceptance tests AT-1 to AT-10 (`docs/SRS.md` §6)

## Sponsor tracks
### Whitechain (Operate · Scale · Tokenize; one prize)
| Requirement | Evidence |
|---|---|
| Contracts deployed + verified on 1874 (all full Blockscout matches) | MerchantPay [0xab81…4251](https://explorer.testnet.whitechain.io/address/0xab817593253a0a37de723072827d88fe0ca54251) · CapitalMarket [0xecd6…0abe](https://explorer.testnet.whitechain.io/address/0xecd63a369d23dfddc6bfac921e41a86760c20abe) · ClaimToken [0xce9b…c388](https://explorer.testnet.whitechain.io/address/0xce9b171a5c485a41dced9d7f043733bddc26c388) · InvestorRegistry [0x2934…3e74](https://explorer.testnet.whitechain.io/address/0x293430fae87ca79844c6e3a64e8044078c4d3e74) · (Phase 2 preview MerchantPay 0x83b5…73b7 is paused) |
| USDT payment in the main flow | Sale split in one tx [0xae155c49…](https://explorer.testnet.whitechain.io/tx/0xae155c49b9e10c098ff3f6146dd29256c75a52acaac85a3367e0c8e30e3cfb1a) (2 USDT → 0.10 fee + 1.90 merchant; payer 0 WBT) · invoice payment ⟨tx⟩ · advance repayment split ⟨tx⟩ |
| **Operate:** drop-in in ≈20 lines | `apps/shop` integration: ⟨N⟩ lines (⟨file links⟩); merchant view ⟨screenshot⟩, customer view ⟨screenshot⟩; refund [0xbd91e67e…](https://explorer.testnet.whitechain.io/tx/0xbd91e67e672cf3a1c94e0fbf82335be719e2c77a4e0499328a9b767d3347f939); CSV export ⟨link⟩ |
| **Operate (gateway):** what a merchant gets | Payment links + QR ⟨link⟩ · payment pages ⟨link⟩ · invoices with line items ⟨link⟩ · discount vouchers ⟨link⟩ · multi-currency prices (USD = USDT 1:1; EUR/GBP/INR/SGD at the ECB rate, AED via its peg; quote locked 10 min) ⟨screenshot⟩ · reports + CSV ⟨link⟩ · instant T+0 settlements ⟨link⟩ · signed webhooks (`MC-Signature`) · test-mode API keys · `/docs` with 3 steps ⟨link⟩ |
| **Scale:** zero crypto steps for the payer | Customer pays with one "Confirm payment" from a wallet the page creates for them (no WBT, no seed phrase, no chain name) ⟨screenshot⟩ |
| **Scale:** who pays gas / how the relayer gets WBT / what stops draining | The merchant pays a 0.10 USDT fee inside each payment; the relayer swaps fees to WBT on YetiTrade ⟨tx⟩; drain guard: allowlisted calls, simulate first, fee in the tx, gas caps, rate limits, daily WBT budget ⟨code⟩ ⟨tests⟩ |
| **Tokenize:** real transfer rules + lifecycle | ERC-1155 claim token with ERC-7943 rules (investor allowlist (simulated KYC), ≤8 holders, maturity lock, admin freeze) ⟨code⟩; blocked transfer ⟨revert tx⟩; advance funded [AT-3](https://explorer.testnet.whitechain.io/tx/0x8d4958ebb6c20d1a1e4a269bfd6736c641f62ca02d6521e94b92934c8f3f6810) → a 5 USDT sale repays 1 USDT to the investor in the same tx [AT-4](https://explorer.testnet.whitechain.io/tx/0x9fc06d890b53dde51e469e348fc9b9bdaadfc541f82e9fbb2a833a74edba5ec8) → after the cap the investor gets 0 [AT-5](https://explorer.testnet.whitechain.io/tx/0x0269606d7668b50e5c0b8d6dca43449def7b660e92371ff4090fbff199df4360) · invoice financing: two investors buy a 100 USDT invoice [A 58.84](https://explorer.testnet.whitechain.io/tx/0x6b346413c77effb7f2084103caf93236a47349681729816bb0a850aa95a9ab3c) + [B 39.23](https://explorer.testnet.whitechain.io/tx/0xab395b1dd7c452229661dfab86f7efee79700d87bc00aaa7957390c7627d9744) → the debtor pays 100.10 and both are repaid 60 + 40 in one tx [AT-7](https://explorer.testnet.whitechain.io/tx/0xd9172e76c1f19d2152d10283a84732ac0ef14680698f7279cfc2c10dd71003b1) · transfer to a non-eligible wallet blocked (`canTransfer` = false, AT-8) |
| Rail proof (Phase 1) | A payer with **0 WBT and nonce 0** sends 1 USDT through our relayer: [tx](https://explorer.testnet.whitechain.io/tx/0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e) (94,034 gas, paid by the relayer) · stub [PullStub](https://explorer.testnet.whitechain.io/address/0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d) |
| Feedback | `WHITECHAIN_FEEDBACK.md` |

### Arkiv (Build on Arkiv)
Financing offers are Arkiv entities (`mcplus.offer.v1`) that expire at the offer deadline; the investor offer book and "my live offers" read them. Writer address: `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` · Live proof (Phase 1 probe): create tx [0x2d651b87…771e](https://rabdi.explorer.arkiv.network/tx/0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e) (block 258050; create 3.2 s, `ownedBy` query 285 ms) · Runnable query: [https://rabdi.explorer.arkiv.network/entity-explorer](https://rabdi.explorer.arkiv.network/entity-explorer) with `arkiv.schema = str('mcplus.probe.v1')`, or `node --env-file=../../.env scripts/arkiv-probe.ts` from `apps/web` (needs `ARKIV_PRIVATE_KEY` + `ARKIV_ACCESS_KEY`) · `arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.

### Ethereum Foundation (Anon-RPC · CROPS)
Every chain read the app makes in the browser goes through Anon-RPC by default (Nym, Tor fallback), including Arkiv reads: ⟨traffic share⟩ private. The customer pay and checkout pages make no browser chain reads at all (the amount and merchant come from our server), so they can't leak the payer's IP. Exclusions (disclosed): relayer writes over HTTPS, the two mainnet bootstrap reads (eth_call to ethereum-rpc.publicnode.com), explorer history lookups, the server-side read behind the pay and checkout pages, and the Nym worker's own plain traffic (directory lookups to validator.nymtech.net, one WSS to a Nym entry gateway, bundle fallbacks unpkg.com / raw.githubusercontent.com after jsDelivr). These carry no wallet data.
Private-read proof (Phase 1): the app read Whitechain blocks through Nym (e.g. block 12,298,671) with **0 direct RPC requests** in 12 browser test runs; a swapped worker bundle is refused (pinned hash).
**CROPS:** C: payment functions are permissionless, so anyone can submit a signed authorization if our relayer is down · O: ⟨license⟩ · P: private reads by default, no personal data on-chain or on Arkiv · S: non-custodial, keys stay on the user's device.

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

# Relayer (localhost only until its drain guard ships): http://127.0.0.1:8787
cd apps/relayer && npm ci && npm test && npm run dev        # GET /health, POST /relay

# Web app (merchant, investor, customer pages): http://localhost:3000
cd apps/web && npm ci && npm run typecheck && npm test && npm run dev

# SDK + pay button (zero dependencies)
cd packages/sdk && npm ci && npm test

# Demo shop on the SDK (≤ 20 integration lines)
cd apps/shop && npm ci && npm run dev
```
Test funds: claim WBT at faucet.testnet.whitechain.io, then swap some to the prize USDT (`0xcedfB561…f55a7`) on testnet.yetitrade.fi. CI runs the same checks on every push (`.github/workflows/ci.yml`).

## Limitations (honest)
- Testnet only (official USD₮ isn't on Whitechain mainnet yet). Maturity lock 60 s and grace 120 s on testnet so the demo can show them; 1 day / 7 days in production.
- KYC is simulated: our compliance key keeps an investor allowlist (stands in for WhiteBIT KYC). EAS attestations, debtor acknowledgement, pay-on-due-date and default/recourse were cut for time.
- Demo wallets were funded by a one-off seed script from a team wallet (test USDT swapped from faucet WBT on YetiTrade). The app has no faucet button.
- The customer's wallet is a guest key kept in the browser (no email recovery). We tested Privy's email login and dropped it: it always sends analytics with the wallet address to its servers, and we don't ship trackers.
- A merchant could take sales outside our checkout; default rules, recourse and public sales stats mitigate this, they don't prevent it.
- **Admin trust (testnet):** one deployer key (`0xb4E7…714D`) is the compliance admin and the contract owner. It can force-transfer claims between eligible investors, freeze claim units and revoke investor eligibility (ERC-7943 rules, simulated KYC), and it can pause MerchantPay. Ownership uses `Ownable2Step`; production would put these roles behind a multisig.
- Cut for time: default and recourse handling (a claim that is never repaid stays outstanding; no freeze-and-recourse lien).
- ⟨anything else cut from the cut list⟩

## Team and AI usage
⟨team⟩ · AI usage per file and the full build trail: `AI_USAGE.md`, `.batches/`
