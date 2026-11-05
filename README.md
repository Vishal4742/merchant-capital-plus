# Merchant Capital+

**Shops on Whitechain take gasless USDT payments, and get cash today: sell an invoice at a discount, or take an advance that every future sale repays automatically.**

> Status: pre-event skeleton (written before hacking starts, Start Fresh). Slots marked `⟨…⟩` are filled with real links during the build. Requirements: `docs/SRS.md`. Design: `ARCHITECTURE.md`. How we built it: `PIPELINE.md`, `AI_USAGE.md`.

## Why this needs on-chain stablecoin settlement
Repayment is enforced where the money arrives. One customer payment is split, in the same transaction, between the merchant, the investors who financed it and the gas fee, under rules neither the merchant nor we can change. A card rail or bank transfer can't route one payment to three parties by code, and an investor would have to trust the merchant to forward the money. With USDT on Whitechain, any verified investor can fund a café at 3 a.m. and gets repaid in one second.

## Demo
- Live app: ⟨url⟩ · Demo shop: ⟨url⟩ · Video (2:45): ⟨url⟩
- Walkthrough = acceptance tests AT-1 to AT-10 (`docs/SRS.md` §6)

## Sponsor tracks
### Whitechain (Operate · Scale · Tokenize; one prize)
| Requirement | Evidence |
|---|---|
| Contracts deployed + verified on 1874 | MerchantPay [0x83b5…73b7](https://explorer.testnet.whitechain.io/address/0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7) (full match; redeployed once in Phase 3) · CapitalMarket ⟨link⟩ · ClaimToken ⟨link⟩ · InvestorRegistry ⟨link⟩ |
| USDT payment in the main flow | Sale split in one tx [0xae155c49…](https://explorer.testnet.whitechain.io/tx/0xae155c49b9e10c098ff3f6146dd29256c75a52acaac85a3367e0c8e30e3cfb1a) (2 USDT → 0.10 fee + 1.90 merchant; payer 0 WBT) · invoice payment ⟨tx⟩ · advance repayment split ⟨tx⟩ |
| **Operate:** drop-in in ≈20 lines | `apps/shop` integration: ⟨N⟩ lines (⟨file links⟩); merchant view ⟨screenshot⟩, customer view ⟨screenshot⟩; refund [0xbd91e67e…](https://explorer.testnet.whitechain.io/tx/0xbd91e67e672cf3a1c94e0fbf82335be719e2c77a4e0499328a9b767d3347f939); CSV export ⟨link⟩ |
| **Scale:** zero crypto steps for the payer | Customer pays with one "Confirm payment" from a wallet the page creates for them (no WBT, no seed phrase, no chain name) ⟨screenshot⟩ |
| **Scale:** who pays gas / how the relayer gets WBT / what stops draining | The merchant pays a 0.10 USDT fee inside each payment; the relayer swaps fees to WBT on YetiTrade ⟨tx⟩; drain guard: allowlisted calls, simulate first, fee in the tx, gas caps, rate limits, daily WBT budget ⟨code⟩ ⟨tests⟩ |
| **Tokenize:** real transfer rules + lifecycle | ERC-1155 claim token with ERC-7943 rules (KYC allowlist via EAS, ≤8 holders, maturity lock, freeze on default) ⟨code⟩; blocked transfer ⟨revert tx⟩; advance funded → repaid → settled ⟨txs⟩ |
| Rail proof (Phase 1) | A payer with **0 WBT and nonce 0** sends 1 USDT through our relayer: [tx](https://explorer.testnet.whitechain.io/tx/0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e) (94,034 gas, paid by the relayer) · stub [PullStub](https://explorer.testnet.whitechain.io/address/0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d) |
| Feedback | `WHITECHAIN_FEEDBACK.md` |

### Arkiv (Build on Arkiv)
Financing offers are Arkiv entities (`mcplus.offer.v1`) that expire at the offer deadline; the investor offer book and "my live offers" read them. Writer address: `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` · Live proof (Phase 1 probe): create tx [0x2d651b87…771e](https://rabdi.explorer.arkiv.network/tx/0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e) (block 258050; create 3.2 s, `ownedBy` query 285 ms) · Runnable query: [https://rabdi.explorer.arkiv.network/entity-explorer](https://rabdi.explorer.arkiv.network/entity-explorer) with `arkiv.schema = str('mcplus.probe.v1')`, or `node --env-file=../../.env scripts/arkiv-probe.ts` from `apps/web` (needs `ARKIV_PRIVATE_KEY` + `ARKIV_ACCESS_KEY`) · `arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.

### Ethereum Foundation (Anon-RPC · CROPS)
Every chain read the app makes in the browser goes through Anon-RPC by default (Nym, Tor fallback), including Arkiv reads: ⟨traffic share⟩ private. The customer pay and checkout pages make no browser chain reads at all (the amount and merchant come from our server), so they can't leak the payer's IP. Exclusions (disclosed): relayer writes over HTTPS, the two mainnet bootstrap reads (eth_call to ethereum-rpc.publicnode.com), explorer history lookups, the server-side read behind the pay and checkout pages, and the Nym worker's own plain traffic (directory lookups to validator.nymtech.net, one WSS to a Nym entry gateway, bundle fallbacks unpkg.com / raw.githubusercontent.com after jsDelivr). These carry no wallet data.
Private-read proof (Phase 1): the app read Whitechain blocks through Nym (e.g. block 12,298,671) with **0 direct RPC requests** in 12 browser test runs; a swapped worker bundle is refused (pinned hash).
**CROPS:** C: payment functions are permissionless, so anyone can submit a signed authorization if our relayer is down · O: ⟨license⟩ · P: private reads by default, no personal data on-chain or on Arkiv · S: non-custodial, keys stay on the user's device.

## Architecture
Full-stack: Next.js frontend, two TypeScript servers (relayer, web API), Postgres for sessions and rate limits only, and Solidity contracts on Whitechain that hold every money rule.

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
```
Test funds: claim WBT at faucet.testnet.whitechain.io, then swap some to the prize USDT (`0xcedfB561…f55a7`) on testnet.yetitrade.fi. CI runs the same checks on every push (`.github/workflows/ci.yml`).

## Limitations (honest)
- Testnet only (official USD₮ isn't on Whitechain mainnet yet). Maturity lock 60 s and grace 120 s on testnet so the demo can show them; 1 day / 7 days in production.
- KYC is simulated by our compliance key issuing EAS attestations (stands in for WhiteBIT KYC).
- Demo wallets were funded by a one-off seed script from a team wallet (test USDT swapped from faucet WBT on YetiTrade). The app has no faucet button.
- The customer's wallet is a guest key kept in the browser (no email recovery). We tested Privy's email login and dropped it: it always sends analytics with the wallet address to its servers, and we don't ship trackers.
- A merchant could take sales outside our checkout; default rules, recourse and public sales stats mitigate this, they don't prevent it.
- ⟨anything cut from the cut list⟩

## Team and AI usage
⟨team⟩ · AI usage per file and the full build trail: `AI_USAGE.md`, `.batches/`
