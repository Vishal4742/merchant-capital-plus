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
| Contracts deployed + verified on 1874 | MerchantPay ⟨link⟩ · CapitalMarket ⟨link⟩ · ClaimToken ⟨link⟩ · InvestorRegistry ⟨link⟩ |
| USDT payment in the main flow | Shop sale ⟨tx⟩ · invoice payment ⟨tx⟩ · advance repayment split ⟨tx⟩ |
| **Operate:** drop-in in ≈20 lines | `apps/shop` integration: ⟨N⟩ lines (⟨file links⟩); merchant view ⟨screenshot⟩, customer view ⟨screenshot⟩; refund ⟨tx⟩; CSV export ⟨link⟩ |
| **Scale:** zero crypto steps for the payer | Customer pays with an email login and one "Confirm payment" (no WBT, no seed phrase, no chain name) ⟨screenshot⟩ |
| **Scale:** who pays gas / how the relayer gets WBT / what stops draining | The merchant pays a 0.10 USDT fee inside each payment; the relayer swaps fees to WBT on YetiTrade ⟨tx⟩; drain guard: allowlisted calls, simulate first, fee in the tx, gas caps, rate limits, daily WBT budget ⟨code⟩ ⟨tests⟩ |
| **Tokenize:** real transfer rules + lifecycle | ERC-1155 claim token with ERC-7943 rules (KYC allowlist via EAS, ≤8 holders, maturity lock, freeze on default) ⟨code⟩; blocked transfer ⟨revert tx⟩; advance funded → repaid → settled ⟨txs⟩ |
| Feedback | `WHITECHAIN_FEEDBACK.md` |

### Arkiv (Build on Arkiv)
Financing offers are Arkiv entities (`mcplus.offer.v1`) that expire at the offer deadline; the investor offer book and "my live offers" read them. Writer address: ⟨0x…⟩ · Runnable query: ⟨snippet⟩ · `arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.

### Ethereum Foundation (Anon-RPC · CROPS)
Every chain read the app makes in the browser goes through Anon-RPC by default (Nym, Tor fallback), including Arkiv reads: ⟨traffic share⟩ private. The customer pay and checkout pages make no browser chain reads at all (the amount and merchant come from our server), so they can't leak the payer's IP. Exclusions (disclosed): relayer writes over HTTPS, the one mainnet bootstrap read, explorer history lookups, the server-side read behind the pay and checkout pages.
**CROPS:** C: payment functions are permissionless, so anyone can submit a signed authorization if our relayer is down · O: ⟨license⟩ · P: private reads by default, no personal data on-chain or on Arkiv · S: non-custodial, keys stay on the user's device.

## Architecture
⟨diagram from ARCHITECTURE.md §1⟩ · Contracts: `contracts/` · Relayer: `apps/relayer/` · Apps: `apps/web/`, `apps/shop/`

## Setup
⟨commands: install, env vars from `.env.example`, `forge test`, run apps⟩

## Limitations (honest)
- Testnet only (official USD₮ isn't on Whitechain mainnet yet). Maturity lock 60 s and grace 120 s on testnet so the demo can show them; 1 day / 7 days in production.
- KYC is simulated by our compliance key issuing EAS attestations (stands in for WhiteBIT KYC).
- Demo wallets were funded by a one-off seed script from a team wallet (test USDT swapped from faucet WBT on YetiTrade). The app has no faucet button.
- ⟨Customer wallet: Privy email login, or a guest wallet in the browser if Privy failed the Phase 1 test⟩
- A merchant could take sales outside our checkout; default rules, recourse and public sales stats mitigate this, they don't prevent it.
- ⟨anything cut from the cut list⟩

## Team and AI usage
⟨team⟩ · AI usage per file and the full build trail: `AI_USAGE.md`, `.batches/`
