# Merchant Capital+ : architecture (pre-event planning, no code)

> Locked by the human 2026-11-05 18:53 IST. Planning only until Thu 21:00 IST (Start Fresh). Disclose in the README as "pre-event planning notes". Full design with sources and numeric examples: `research_notes/Mumbai hackathon idea validation/build_H1_merchant_capital.md` (the "build plan").

**One line:** shops on Whitechain take gasless USDT payments and invoices, and can raise cash today, either by selling an invoice at a discount or with an **advance repaid automatically from a slice of every future sale**. The financed claim is a token whose rules the contract enforces.

**Prize tracks (3 partner prizes max):**
| Sponsor | Track | What earns it |
|---|---|---|
| Whitechain (one prize, judged in every track it fits) | **Operate** (3 places) | Invoices, payment links, a drop-in checkout a separate shop adds in about 20 lines, one-click refunds, CSV export |
| | **Scale** (2 places) | Customer and investor never hold WBT: they sign, our relayer pays gas; we show who pays, how the relayer gets WBT, and the drain guard |
| | **Tokenize** (2 places) | Invoice financing and revenue advances: an ERC-1155 claim token with ERC-7943 rules (allowlist, transfer lock at maturity, freeze on default), funded and settled in USDT |
| Arkiv | Build on Arkiv | Financing offers as entities that expire at their deadline; the investor offer book reads them |
| Ethereum Foundation | Anon-RPC (+ CROPS) | Every browser read goes through Anon-RPC by default; pay and checkout pages make none (tested 17:50: Nym 1.6 s, Tor 2.8 s per read on Whitechain via Ankr) |

**Whitechain's own words (workshop, 16:30):** "build what business actually needs", B2B2C, "Tokenize… could be borrowing and lending". Judging is a **2–3 minute pitch at their booth**; they read the repo and check the deployment.

**Our edge vs the rival** (`InvoiceRegistry` / `ReceivableMarket`, deployed on 1874 Oct 31): **advances repaid from checkout**, recourse from future sales, gasless parties, ERC-7943, Arkiv offers, private reads. Never claim "first"; never copy their code.

---

## 1. System overview

```
 Customer / debtor        Investor                   Merchant (Asha, "Bandra Beans")
 (signs only, 0 WBT)      (signs only, 0 WBT)        (dashboard; may hold WBT for own txs)
      │ EIP-3009               │ EIP-3009                  │ createInvoice / listAdvance / refund
      │ receiveWithAuthorization│                           │
      ▼                        ▼                           ▼
 ┌──────────────── apps/relayer (claude-contracts) ── only key with WBT ────────────────┐
 │ POST /relay  POST /schedule  GET /health     drain guard (§3)   fee-swap keeper       │
 └───────────────┬──────────────────────────────────────────────────────────────────────┘
                 ▼
  MerchantPay ──onPayment──► CapitalMarket ──mint/burn──► ClaimToken (ERC-1155 + ERC-7943)
      │  pulls USDT via         │ routes: invoice holders first,     │ rules in _update
      │  receiveWithAuth        │ then advance liens, rest → merchant│
      ▼                         ▼                                    ▲
  USDT 0xcedf…55a7         InvestorRegistry (owner list → EAS 0x4200…0021)
 Whitechain Sepolia 1874

 apps/web (claude-frontend): merchant · investor · customer pay pages · compliance desk · API (sessions, webhooks, CSV, Arkiv writer)
 apps/shop (claude-frontend): separate demo store, ≈20-line integration
 Reads: viem → Anon-RPC worker (Nym default, Tor fallback) → rpc.ankr.com/whitechain_testnet (+ Multicall3). History: Blockscout API.
 Offers: Arkiv Rabdi entities `mcplus.offer.v1`, expiry = offer deadline.
```

**Design rules:** the chain is the source of truth; no log scans (Ankr caps `eth_getLogs` at 1,000 blocks, the official RPC at 10,000), so state comes from Multicall and history from Blockscout's `/api?module=logs&action=getLogs` endpoint (used in `apps/web/lib/onchain.ts`, verified live; Ankr caps `eth_getLogs` below 2,000 blocks). Every payment function is permissionless, so anyone can submit a signed authorization if our relayer is down.

## 2. Contracts: the interface between lanes (**ABI FROZEN at gate G3**, 2026-11-06, batch 005-P3-advance; changes only via agentbus + the human)

**Live on Whitechain Sepolia 1874, all four fully verified on Blockscout, deployed from commit `ef5fee4`:** InvestorRegistry `0x293430fae87ca79844c6e3a64e8044078c4d3e74` · ClaimToken `0xce9b171a5c485a41dced9d7f043733bddc26c388` · MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251` · CapitalMarket `0xecd63a369d23dfddc6bfac921e41a86760c20abe`. **Source of truth for consumers: `packages/shared/contracts.ts`** (generated: all four ABIs, these addresses, constants, the USDT EIP-712 domain and types, the nonce parameters). Retired and paused: MerchantPay `0x83b5…73b7` (Phase 2) and `0x8eff…248f` (Phase 3 round 1, replaced after a ClaimToken fix).
Deploy order: `InvestorRegistry(owner)` → `ClaimToken(registry, admin, LOCK_WINDOW)` → `MerchantPay(usdt, feeRecipient)` → `CapitalMarket(merchantPay, claimToken, usdt)` → `ClaimToken.setMarket` + `MerchantPay.setMarket` (both one-time). `LOCK_WINDOW` = 60 s on testnet (1 day in production). `evm_version = "prague"`, `via_ir = true`. Owners: the deployer/compliance admin `0xb4E7…714D` (all `Ownable2Step`). `feeRecipient` = relayer hot wallet `0xdd02…a651`, `relayFee` 0.10 USDT (cap 0.25).
**Not in this ABI (cut list #5 / Phase 5):** `acknowledge`, `markDefault`, `repay`, recourse liens, `GRACE`, EAS `register`. Adding any of them means redeploying the market, the token and MerchantPay.

### `MerchantPay.sol` (Operate + Scale)
| Function | Caller | Does |
|---|---|---|
| `createInvoice(address customer, uint128 amount, uint64 dueDate, bytes32 refHash) → id` | merchant | `1 USDT ≤ amount ≤ uint96.max − MAX_FEE`, due date in the future; `customer` is informational; `refHash` = keccak of a random id (never PII) |
| `cancelInvoice(uint256 id)` | that merchant | Only untouched: open, nothing paid, not financed (`InvoiceFinanced`) |
| `payInvoice(uint256 id, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) → paymentId` | anyone (relayer) | Credits `amount` (≥ 1 USDT, or exactly what is still owed; partial payments allowed). **Fee on top:** the payer signs `value = amount + relayFee`, nonce `invoiceNonce(id, amount, salt)` |
| `paySale(address merchant, bytes32 orderRef, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) → paymentId` | anyone (relayer) | Fee inside the price; each `(merchant, orderRef)` paid once (`OrderPaid`); refuses merchant = 0 / MerchantPay / market / USDT and `orderRef` 0 (`InvalidOrder`) |
| `refund(uint256 paymentId, uint256 amount)` | that payment's merchant | `transferFrom(merchant → payer)`, cumulative ≤ gross, works while paused; never touches investors |
| `setRelayFee(fee, recipient)` (≤ `MAX_FEE` 0.25 USDT), `setMarket(market)` (once), `sweep(to)` (stray USDT), `pause`/`unpause` | owner | |
Money flow: pull gross → fee to `feeRecipient` → if `market.hasClaimsOn(merchant, invoiceId)` send net to the market and call `onPayment` (holdback base = the sale price, or an invoice's credited amount), else pay the merchant directly. Nonce = `keccak256(abi.encode(chainid, address(this), uint8 kind, uint256 ref, bytes32 orderRef, uint256 amount, bytes32 salt))`, kind `INVOICE=1`/`SALE=2`, sale `ref = uint256(uint160(merchant))`, invoice `ref = id`, `orderRef = 0`. Views: `invoices(id)` → `(merchant, uint64 dueDate, uint8 status 0 None/1 Open/2 Paid/3 Cancelled, customer, uint128 amount, uint128 paid)` · `payments(id)` → `(merchant, uint96 gross, payer, uint96 refunded)` · `saleOf(merchant, orderRef)` · `saleNonce` · `invoiceNonce` · `market` · `relayFee` · `feeRecipient`. Ids start at 1 (`Paid.invoiceId == 0` = a sale).
Events: `InvoiceCreated` · `InvoiceCancelled` · `Paid(paymentId, merchant, payer, invoiceId, orderRef, gross, fee, toInvestors, toMerchant)` · `Refunded(paymentId, amount, totalRefunded)` · `RelayFeeSet(fee, recipient)` · `MarketSet(market)` · `Swept(to, amount)`. Errors: `ZeroAddress, WrongAmount, InvalidDueDate, InvoiceNotOpen, NotMerchant, InvalidOrder, OrderPaid, FeeTooHigh, RefundTooLarge, MarketAlreadySet, InvoiceFinanced` (+ OZ `EnforcedPause`). Consumer rule: count an order as paid only if `payments(saleOf(...))` has `gross == session amount && payer == from`; `orderRef` = 32 random bytes per session.

### `CapitalMarket.sol` (Tokenize)
| Function | Caller | Does |
|---|---|---|
| `listAdvance(uint128 principal, uint128 cap, uint16 holdbackBps, uint64 term, uint64 offerDeadline) → claimId` | merchant | `0 < principal ≤ cap`, `0 < holdbackBps ≤ 3000`, `term > 0`, deadline in the future; one listed-or-running advance per merchant (`AdvanceActive`) |
| `listInvoice(uint256 invoiceId, uint128 price, uint64 offerDeadline, uint16 recourseBps) → claimId` | the invoice's merchant | Open, nothing paid, not listed; `0 < price < amount`; `offerDeadline ≤ dueDate − LOCK_WINDOW`; `recourseBps` stored for Phase 5 |
| `cancelOffer(uint256 claimId)` | that merchant | Before any funding (`AlreadyFunded`) |
| `fund(uint256 claimId, uint256 units)` | investor (approve first) | DvP: USDT investor → merchant, mint `units` |
| `fundWithAuthorization(uint256 claimId, address investor, uint256 units, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s)` | anyone (relayer) | Investor signs `ReceiveWithAuthorization(to = CapitalMarket, value = quote(claimId, units), nonce = fundingNonce(claimId, investor, units, salt))`. Funding stops after the deadline, at face, or once the invoice has been (part-)paid (`OfferClosed`); the offer's merchant can't fund it (`MerchantCannotFund`) |
| `onPayment(merchant, invoiceId, gross, net, paymentId) → toInvestors` | **MerchantPay only** | Financed invoice holders first (`min(net, owed)`), then the advance lien (`min(gross × bps / 10_000, owed, rest)`), rest → merchant. **Invoice financing is senior to a running advance** (human, G3 gate); merchant wallets are never added to the investor list |
| `withdrawOwed()` | holder | Pull fallback for a push that failed (USDT blocklist) |
Cost = `ceil(units × price / face)` for both kinds (advance: price = principal, face = cap). Payouts: pro-rata rounded down, the leftover (< holders) goes one unit at a time to holders with spare balance; burns before pushes; market USDT always equals `totalOwed`. Views: `offers(claimId)` → `(uint8 kind 1 invoice/2 advance, merchant, uint64 offerDeadline, uint16 bps, bool cancelled, bool settled, uint256 invoiceId, uint128 face, uint128 price, uint64 maturity, uint128 sold)` · `quote` · `fundingNonce` · `outstanding(claimId)` · `liensOf(merchant)` · `advanceOf(merchant)` · `claimOfInvoice(invoiceId)` · `hasClaimsOn` · `isFinanced` · `owed(holder)` · `totalOwed`.
Events: `OfferListed(claimId, merchant, kind, invoiceId, face, price, bps, offerDeadline, maturity)` · `OfferCancelled` · `Funded(claimId, investor, units, cost)` · `Distributed(claimId, paymentId, amount, outstanding)` · `LienAdded(merchant, claimId, bps)` · `Settled(claimId)` · `PushFailed(claimId, holder, amount)` · `OwedWithdrawn(holder, amount)`. Errors: `NotMerchantPay, NotMerchant, BadTerms, AdvanceActive, InvoiceNotListable, OfferClosed, AlreadyFunded, WrongUnits, NothingOwed, MerchantCannotFund`.

### `ClaimToken.sol` (OZ v5 `ERC1155Supply` + ERC-7943 multi-token, interface id `0x41c4fbad`)
Rules in `_update`, in order: mint/burn **only by the market** (burn never blocked; it lowers frozen units first) → `!claimFrozen[id]` → `lockFrom[id] == 0 || now < lockFrom[id]` (set to dueDate − LOCK_WINDOW at an invoice's first funding) → `canSend(from) && canReceive(to)` (= `registry.isEligible`) → partial freeze, checked on **each id's running total across a batch** → **at most 8 holders** per id (`TooManyHolders`). `canTransfer(from, to, id, amount)` never reverts (for a batch, `amount` = that id's batch total). Also: `forcedTransfer`, `setFrozenTokens` (compliance admin), `setClaimState(id, lockFrom, frozen)` (market), `holdersOf(id)`, `claimState(id)`, `getFrozenTokens`, `MAX_HOLDERS`. Events: ERC-7943 `ForcedTransfer`, `Frozen`; `ClaimStateSet(id, lockFrom, frozen)`; `MarketSet`. A revoked investor can't trade but **still receives payouts** (pushes + burns, not transfers). **Admin trust (README):** the compliance admin can force-transfer and freeze claims and revoke investors.

### `InvestorRegistry.sol`
`isEligible(address) view` (expiry > now, never reverts) · `setEligible(address, uint64 expiry)` (owner; 0 = remove) · `expiryOf(address)`. EAS eligibility (FR-KYC-2/3) is Phase 5 and not in this ABI.

### Foundry tests (claude-contracts; coverage before the gate G6 freeze)
M1 pay invoice + nonce binding + direct `transferWithAuthorization` can't bypass · M2 paySale, fee cap, minimum · M3 refund cap, merchant only, never touches holders · C5 advance lien (bps on gross, capped, one per merchant, removed at cap) · C1 list rules · C2 fund DvP + ineligible investor reverts · C3 pro-rata push, remainder to last holder, Settled · C4 partial payments burn units · C6 default after GRACE, recourse lien · T1 transfer rules (ineligible, after lock, frozen, 9th holder; revoked still gets payouts) · T2 admin-only force/freeze · I1 EAS fork test · F1 fuzz `Σ payouts + merchant + fee == gross`, market USDT == Σ owed · E1 event ABI snapshot.

## 3. Relayer (`apps/relayer`, claude-relayer)

- `POST /relay {action, args, sig}`, `action ∈ {paySale, payInvoice, fund, acknowledge, register}` → `{txHash, paymentId?}` or 4xx with a reason. Content is released only after the receipt (1–2 s).
- `POST /schedule`: stores a debtor's pre-signed authorization with `validAfter = dueDate` (it can only pay that one invoice to MerchantPay); a keeper submits it when due.
- `GET /health` → `{relayer, wbt, gasSpentToday, budgetLeft, usdtFeesUnswapped, paused}` (`relayer` = the hot wallet address), shown on the merchant dashboard (Scale asks who pays gas).
- **Drain guard:** (1) target + selector allowlist; (2) simulate before sending, never send a revert; (3) x402-style pre-checks (signature, balance, window, `authorizationState`); (4) fee inside the tx, minimum payment 1 USDT; (5) `maxFeePerGas ≤ 6 gwei` (human 00:45: break-even ≈6.2 gwei at 217k gas and a 0.10 USDT fee), gas limit 400k; (6) `validBefore ≤ now + 15 min`; (7) rate limits per payer, merchant and IP in SQL; (8) daily WBT budget, 503 when exhausted; (9) hot wallet ≤ 0.5 WBT, topped up by the swap job; (10) pause switch + alert on any failed tx; (11) **reject payers that have code (incl. EIP-7702)**: the prize USDT accepts ERC-1271 signers and forwards all gas to `isValidSignature`, so a contract payer could burn ≈0.175 WBT per request (found by claude-relayer, human decision 22:01). One hot key, serialized sends (Postgres advisory lock), key only in `.env` / Vercel env.
- **Latency (NFR-4 target 5 s):** measured 7.86 s from POST to receipt at the venue (Ankr round trip 0.65–1.15 s × ~8 RPC calls). Phase 2 fix: Ankr supports `eth_sendRawTransactionSync` (one call returns the receipt).
- **Where the WBT comes from:** faucet 2 WBT/day ≈ 1,600–2,000 payments. Measured on 1874 (batch 001-P1-rail-proof): relayed EIP-3009 pull + forward of 1 USDT = **94,034 gas** live (5 gwei, L1 fee ≈ 6k wei) = 0.00047 WBT ≈ 0.035 USDT; PullStub deploy 230,639. Measured in batch 005 (Phase 3): a routed sale costs **256–278k gas with one investor** (≈0.096–0.104 USDT at 5 gwei, about the 0.10 fee) and **≈537k with 8 holders** (≈0.20 USDT, a loss at a 0.10 fee). Fee-swap keeper: `SwapRouter02.exactInputSingle(USDT → WWBT, fee 3000, minOut = QuoterV2 − 1%)` then `WWBT.withdraw` to the relayer EOA. Pool is shallow (≈99k USDT): swap small amounts. Mainnet story: same swap, or a merchant gas deposit (README only).

## 4. Apps (claude-frontend)

| App / route | What |
|---|---|
| `apps/web` merchant | Invoices + payment links, payments table with split columns (gross / fee / to investors / to merchant), one-click refund, "Get paid today" (list invoice with an APR slider showing the price), "Cash advance" (principal, cap, holdback), liens, relayer `/health`, shop API keys, **CSV export** |
| `apps/web` investor | Offer book from Arkiv → each offer checked on-chain → buy (sign once, gasless) → portfolio (claims, payouts) → transfer with live `canTransfer` reason |
| `apps/web` customer | `/pay/[invoiceId]` (acknowledge, pay now, or schedule on due date), `/checkout/[sessionId]`, receipt + refund status |
| `apps/web` compliance desk | Add/remove eligible investors (owner list in Phase 3, EAS attest/revoke in Phase 5) |
| `apps/web` API | `POST /api/v1/sessions` (merchant secret) → checkout URL; webhooks `payment.succeeded` / `payment.refunded` (HMAC-SHA256, sent after the relayer's receipt); Arkiv writer (server-only key); CSV route |
| `apps/shop` | Separate demo café store; **≈20-line integration**: `POST /api/buy` (≈8 lines) + button (≈4) + webhook handler (≈8). Count the lines in the README |
| Wallets | Customer: **guest wallet** (a key kept in the browser; human 20:31, Privy failed DEP-3 because it always sends analytics with the wallet address to auth.privy.io). Merchant/investor: injected wallet. UI never says "sign", "gas" or "Whitechain" to the customer |
| Reads | `lib/anon.ts`: viem `http(ANKR, { fetchFn: worker.fetch, timeout: 60_000, retryCount: 1 })` (Anon-RPC 0.4.0; Nym worker hash `0xf13a448a…1fceb8` pinned in code, because the specifier owner can call `setWorker`), `batch: { multicall: true }`, Nym default, Tor fallback, a "Private reads · 100%" meter chip. `/pay` and `/checkout` make no browser chain reads (SRS 1.1 FR-PRIV-1). Needs a mainnet bootstrap RPC for one specifier read, a sandboxed iframe (CSP), lazy-load the 18 MB Nym bundle |
| Design | HANDOFF.md "Design system lock v8" (Mercury reference, Instrument Sans/Serif + Geist Mono, one blue `#3b4fd9`, glass over a dithered Marine Drive night scene) + references in `design-refs/`; confirm with the human in Phase 2 |

## 5. Arkiv (`@arkiv-network/sdk` **1.0.1**, Rabdi testnet 7794095)

The SDK changed in 1.0 (payloads and `buildQuery` are gone): read the source, use the Arkiv agent skill, never write from memory.
Entity **`mcplus.offer.v1`** (owner = our publisher key; one per open offer): `kind` (invoice/advance), `chainId`, `market`, `claimId`, `merchant`, `faceUsdt`, `priceUsdt`, `remainingUsdt`, `aprBps`, `holdbackBps`, `maturity`, `deadline`, `status`, `sector` (all indexed) + `terms` bytes (merchant's EIP-712 signature over the terms, debtor **hashed**, 30-day sales snapshot). **Expiry = offer deadline** (`ExpirationTime.atDate`); the contract also rejects funding after the deadline. The buy button stays disabled until the offer matches `CapitalMarket.offers(claimId)`.
Required files: `/arkiv/schema.md`, `friction.md` (log problems as they happen), `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` (25% each); README has the writer address and one runnable query.

## 6. Hosting and data
Vercel projects: `apps/web`, `apps/relayer`, `apps/shop` (push to deploy) + Neon Postgres (`rel_*` tables owned by the relayer, `app_*` by the web app; lanes never read each other's tables). Neon holds only sessions, API keys, webhook endpoints and rate-limit counters; the chain is the truth. Keepers (due-date settlement, fee swap) run as a cron route or a local loop during the demo. Each secret lives in one place: relayer key (relayer only), Arkiv writer key + webhook secrets (web only), deployer key (`.env` only).

## 7. Constants (verified 2026-11-05)

| Item | Value | Verified |
|---|---|---|
| Chain | Whitechain Sepolia **1874** (0x752), OP Stack, 1 s blocks, 5 gwei floor, gas limit 40M. **Set `evm_version = "prague"` explicitly:** Foundry 1.8.6 defaults to `osaka`, and Osaka is not active on 1874 (CLZ → `NotActivated`); PUSH0, MCOPY, TSTORE/TLOAD, BLS and EIP-2935 work | on-chain probes (`research_notes/build_prep/contracts_prep.md`) |
| RPC | `https://rpc.ankr.com/whitechain_testnet` (code **Whitechain2026**, CORS `*`, no Cloudflare); backup `https://rpc.testnet.whitechain.io` (Cloudflare) | curl |
| Explorer | `https://explorer.testnet.whitechain.io` (Blockscout); verify (no API key): `forge verify-contract --verifier blockscout …` **fails with forge 1.8.6** ("Missing solc version: 0.8.38"). Working path: `forge verify-contract <addr> <path:Name> --show-standard-json-input > in.json`, then `curl -X POST https://explorer.testnet.whitechain.io/api/v2/smart-contracts/<addr>/verification/via/standard-input -F compiler_version=v0.8.38+commit.1835d247 -F contract_name=<Name> -F license_type=mit -F constructor_args=<hex> -F files[0]=@in.json`; set `auto_detect_remappings = false` for a full match | used by claude-contracts on PullStub (batch 001-P1-rail-proof) |
| USDT | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 dp, EIP-1967 proxy; EIP-712 name **"Tether USD"**, version **"1"**; `receiveWithAuthorization` enforces `to == msg.sender`; `validAfter` enforced ("auth early"); `transferWithAuthorization` ≈ 84.4k gas | cast / eth_call |
| EAS / SchemaRegistry | `0x4200000000000000000000000000000000000021` / `0x4200000000000000000000000000000000000020` (OP predeploys, live) | eth_call |
| Multicall3 / Permit2 | `0xcA11bde05977b3631167028862bE2a173976CA11` / `0x000000000022D473030F116dDEE9F6B43aC78BA3` | eth_getCode |
| YetiTrade | WWBT/USDT pool `0x5645101Ca8d2F7BaBC27b10359555767a1BdF999` (≈74.6 USDT/WBT); SwapRouter02 `0xe208cC685cD95D56E8ec6DEC9816476567fc6962`; QuoterV2 `0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191`; WWBT `0x4200000000000000000000000000000000000006` | eth_call |
| Arkiv | Rabdi 7794095, `https://rpc.rabdi.db-chain.testnet.arkiv.network`, faucet hub.arkiv.network | docs |
| Anon-RPC specifiers (mainnet) | Nym `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0`, tor-js `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` | adopters.json5, live test |
| Toolchain | solc **0.8.38** (pin `solc_version`; 0.8.35/0.8.37 downloads returned HTTP 500 today) · OpenZeppelin **v5.7.0** (`forge install OpenZeppelin/openzeppelin-contracts@tag=v5.7.0`; npm `latest` still says 5.6.1) · `_update(from, to, ids, values)` unchanged · `ReentrancyGuardTransient` available · EIP712 name and version must be ≤31 bytes in 5.7 | GitHub API, compile + `cast call --create` on 1874 (2.16M gas for an ERC1155Supply test) |
| ERC-7943 | **Final** (2026-05-05); ERC-1155 interface id `0x41c4fbad` (recomputed). Reference `uRWA1155.sol` (unaudited): its `forcedTransfer` calls `super._update`, which would skip our holder-count bookkeeping; a forced burn above the unfrozen amount must lower frozen first and emit `Frozen` before the transfer event | ethereum/ERCs @46745bdc |
| Gas baseline | USDT `transfer` 61,748 gas (new recipient) / 44,201 (existing); L1 data fee ≈ 6k wei, negligible | cast estimate |

## 8. Lanes (human, 18:46: zcode is out)

| Lane | Owner (agentbus name) | Folders |
|---|---|---|
| Contracts, tests, deploy/verify, seed script, shared ABI; **after the G4 contract freeze: the gateway backend API** (v2.0: links, pages, vouchers, FX quotes, reports, settlements, API keys, webhooks; Neon `app_gw_*` tables) | **claude-contracts** (worktree `~/ethglobal-contracts`, branch `contracts`) | `contracts/`, `packages/shared/`; after the freeze `apps/web/app/api/v1/{links,pages,vouchers,quotes,reports,settlements,keys,webhooks}/`, `apps/web/lib/server/`, `apps/web/db/` |
| Relayer service: `/relay`, `/schedule`, `/health`, drain guard, rate limits (`rel_*` tables), keepers (fee swap, due-date settlement) | **claude-relayer** (human 20:57; worktree `~/ethglobal-relayer`, branch `relayer`); then the fee-swap keeper | `apps/relayer/` |
| SDK, one-line payment button, demo shop on the SDK (v2.0) | **claude-sdk** (human 02:40 "use all"; worktree `~/ethglobal-sdk`, branch `sdk`; prompt `docs/prompts/claude-sdk.md`) | `packages/sdk/`, `apps/shop/` |
| Web app UI: gateway dashboard screens (links, pages, QR, vouchers incl. the Arkiv writer, FX display, reports, settlements, API keys, webhooks, /docs, test-mode badge), checkout, Capital tab, Anon-RPC transport; existing API routes (sessions, invoices, auth) | **claude-frontend** (`~/ethglobal`, branch `main`) | `apps/web/` except the backend lane's API folders |
| Research, README sections, `arkiv/*.md`, `WHITECHAIN_FEEDBACK.md`, `AI_USAGE.md`, pitch + video script | **claude-research** (this session) drafts, human edits | root docs |
| Review, screenshots | opencode | none |
| Accounts, faucet, Arkiv key, Ankr key, decisions, booth pitch, narrated video | **human** | none |

Claim files on agentbus before editing (`CLAIM <path>` / `DONE <path>`); two sessions never edit the same file. Requirements: docs/SRS.md. Phases and gates: PHASES.md.

## 9. Open items (resolve in Phase 1)
1. ~~Privy embedded wallet signing on 1874~~ decided: guest wallet.
2. Full gas of one routed payment: the pull alone is measured at 94k; the routed payment (180–260k estimate) is measured with `forge --gas-report` in Phase 2 before the 0.10 USDT fee is fixed.
3. Does the Ankr hacker key raise the `eth_getLogs` range? (We don't depend on it.)
4. ~~Does Privy send telemetry?~~ Yes, to auth.privy.io with no off switch, so it was dropped.
