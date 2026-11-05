# Build plan H1: Merchant Capital+ (ETHGlobal Mumbai, 2026-11-05 ~19:00 IST)

Planning only. No product code before Thu 21:00 IST (Start Fresh). Disclose this file in the README as pre-event planning.
Research: read-only web + read-only `eth_call` / Blockscout API on chain 1874. Nothing installed or run beyond curl reads.
"Unverified" = I could not confirm it from a primary source. Every external claim has a URL. Section 9 lists all sources.

**One line:** your checkout is your credit line. Customers pay a merchant in USDT without gas; investors who passed KYC buy the merchant's invoices or a share of its future sales at a discount; the same payment transaction that settles a sale pays the investor, enforced on-chain.

**Tracks (max 3 partner prizes):** Whitechain (Operate + Scale + Tokenize; "one Whitechain prize per project", eligible for all) · Arkiv Build · EF (submit Anon-RPC and CROPS; "placed in at most one").

---

## 0. Decisions on one screen

| Question | Decision | Why (short) |
|---|---|---|
| Token standard | **One OZ v5 `ERC1155` + `ERC1155Supply` contract `ClaimToken`**, one id per financed claim, implementing the **ERC-7943 (uRWA) multi-token interface**. All rules in one `_update` override | ERC-7943 is Final and minimal, with no identity framework ([EIP-7943](https://eips.ethereum.org/EIPS/eip-7943)). ERC-3643 needs 6+ contracts plus ONCHAINID ([EIP-3643](https://eips.ethereum.org/EIPS/eip-3643)), and a rival already deployed a T-REX stack on 1874 |
| Units | 1 unit = 0.000001 USDT of claim (6 dp). `totalSupply(id)` = USDT still owed to holders | Balances read like USDT; "outstanding" needs no extra counter |
| Rules in the contract | (1) both sides KYC-attested; (2) max 8 holders per claim; (3) invoice claims locked from due date minus lock window until settled; (4) frozen on default; (5) mint/burn only by the market; (6) admin freeze + `forcedTransfer` (ERC-7943) | Meets "allowlists, transfer restrictions, maturity or settlement conditions" ([prize text](https://ethglobal.com/events/mumbai/prizes)) |
| Allowlist | **EAS attestation on 1874** (predeploys verified today), checked live on every transfer; owner list as the fallback behind the same `isEligible()` | Mirrors WhiteBIT's WB Soul KYC, which exists only on mainnet |
| Settlement | **Push**: each customer payment pays the claim holders pro-rata in the same tx and burns the units it covers | "settlement happens automatically" ([prize ideas](https://ethglobal.com/events/mumbai/prizes)). One-tx demo moment |
| Revenue advance | A **lien** on the merchant's payment stream: X% of each gross sale goes to holders until the cap. Max one active advance per merchant (no stacking). A defaulted invoice becomes a recourse lien | Stripe Capital "withholds a fixed percentage of each transaction until the complete balance is repaid" ([Stripe](https://docs.stripe.com/capital/how-capital-for-platforms-works)) |
| Refunds vs advance | The merchant pays refunds 100% from its own wallet. Holdback already paid stays paid and counts toward the cap | Investor can't be drained; merchant total stays capped |
| Gasless pay | **EIP-3009 `receiveWithAuthorization`**, nonce = hash of the invoice/sale parameters, recomputed on-chain | Front-run safe ([EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)); same pattern as Base commerce-payments ([ERC3009PaymentCollector](https://raw.githubusercontent.com/base/commerce-payments/main/src/collectors/ERC3009PaymentCollector.sol)) |
| Due-date settlement | The debtor pre-signs a 3009 authorization with `validAfter = dueDate`; our keeper submits it on the due date | Verified today: USDT reverts `"TetherToken: auth early"` before `validAfter` |
| Gas | The merchant pays: a flat 0.10 USDT relay fee inside each payment (contract-capped at 0.25), swapped to WBT on YetiTrade | Gas per payment is about 0.001 WBT ≈ 0.075 USDT at the pool price (§4.4) |

---

## 1. Verified today (new facts, ~18:30 IST, read-only)

| Fact | Evidence |
|---|---|
| EAS predeploy `0x4200…0021` live on 1874, `version()` = "1.4.1-beta.3", 146 txs; SchemaRegistry `0x4200…0020` = "1.3.1-beta.2"; `EAS.getSchemaRegistry()` = `0x4200…0020` | `eth_call` to https://rpc.testnet.whitechain.io; Blockscout counters. Addresses = OP predeploys ([OP specs](https://specs.optimism.io/protocol/predeploys.html)) |
| USDT `receiveWithAuthorization` exists and enforces payee == caller: reverts `"TetherToken: to != msg.sender"` when caller ≠ `to`, and reaches `"invalid signature"` when caller == `to` | `eth_call` probe, selector `0xef55bec6` |
| USDT enforces the 3009 window: `"TetherToken: auth early"` (validAfter in future), `"TetherToken: auth expired"` | `eth_call` probe |
| USDT has `cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)` (reaches signature check) and a `bytes`-signature variant | `eth_call` probe, selectors `0x5a049a70`, `0xb7b72899` |
| USDT is an EIP-1967 proxy (upgradeable) | research agent, [tx page](https://explorer.testnet.whitechain.io/api/v2/transactions/0x23c28fd3557b1125f705c4499218327b9d894e715ac4d8e4ba8bdb7eee29d376) |
| Measured gas on 1874: `transferWithAuthorization` 84,417–84,449; `permit` 72,081; `transferFrom` 44,174; L1 data fee ~9,772 wei | [USDT txs](https://explorer.testnet.whitechain.io/api/v2/addresses/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7/transactions) |
| `eth_gasPrice` = 5.001 gwei | `eth_call` |
| YetiTrade pool `0x5645…F999`: token0 WWBT, token1 USDT, fee 3000 (0.3%), price ≈ **74.6 USDT/WBT**, holds 99,481 USDT + 1,733 WWBT | `slot0`, `balanceOf` via `eth_call` |
| SwapRouter02 `0xe208cC685cD95D56E8ec6DEC9816476567fc6962` (verified): `WETH9()` = `0x4200…0006`, `factory()` = `0x94aF…0738`. QuoterV2 `0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191` | `eth_call`; [YetiTrade contracts](https://docs.yetitrade.fi/reference/contracts.md) |
| WWBT `0x4200…0006` = "Wrapped WhiteBIT Coin" / WWBT, has `withdraw` | `eth_call`; [explorer](https://explorer.testnet.whitechain.io/api/v2/smart-contracts/0x4200000000000000000000000000000000000006) |
| **`eth_getLogs` range caps:** keyless Ankr `rpc.ankr.com/whitechain_testnet` rejects 3,000 blocks ("Block range is too large"; 1,000 works); official RPC max 10,000 | curl probes. At 1s blocks, 36h = ~130k blocks → **don't build dashboards on log scans** |
| Ankr and Blockscout both send `access-control-allow-origin: *`; Blockscout `/api/v2/addresses/{a}/logs` returns 50 decoded logs per page | curl |
| **Rival invoice-financing stack on 1874** (verified 2026-10-31, 0–1 txs): `InvoiceRegistry` `0x5997429835570A11cfD0aD70bF152154fb803ef9`, `ReceivableMarket` `0x85d5403e247826C3d69CdafedBbC3575738D4ED6` (+ `ReceivableToken` clones, admin `ComplianceRegistry`). Design: payer EIP-712 acknowledgement, ERC-20 clone per invoice (6 dp, face units), admin allowlist with expiry + region, transfer lock 1 day before due, 5% late fee, 7-day grace, default → freeze + merchant recourse, max 32 holders, push distribution | [ReceivableMarket source](https://explorer.testnet.whitechain.io/address/0x85d5403e247826C3d69CdafedBbC3575738D4ED6?tab=contract) |

**Consequence:** we are not the only invoice-financing entry. Don't claim "first", and don't copy their code (Start Fresh plus fairness). What we have that they don't: revenue advances repaid from checkout, recourse enforced from future sales, gasless customers and investors, EAS-based KYC, a standard interface (ERC-7943), Arkiv offers and private reads.

---

## 2. A. Tokenization: how exactly

### 2.1 Standards compared

| Option | What it needs | How rules are enforced | 36h effort | Fit |
|---|---|---|---|---|
| **ERC-3643 (T-REX)** | Token, IdentityRegistry, IdentityRegistryStorage, ClaimTopicsRegistry, TrustedIssuersRegistry, ModularCompliance, ONCHAINID per investor with signed claims ([EIP-3643](https://eips.ethereum.org/EIPS/eip-3643)). Repo moved to [ERC-3643/ERC-3643](https://github.com/ERC-3643/ERC-3643) (Hardhat, GPL-3.0); [Tokeny repo archived](https://github.com/TokenySolutions/T-REX) | `transfer` checks paused, frozen wallets, `isVerified(to)`, `compliance.canTransfer` | High; one ERC-20 deploy per invoice | Strong for shares, clumsy per invoice; **rival already deployed it on 1874** (TREXFactory `0xe221…e875`, inventory §4) |
| **ERC-1400 family** (1410 partitions, 1594 reason codes, 1643 docs, 1644 controller) | Never finalized ([issue #1411](https://github.com/ethereum/EIPs/issues/1411)); reference [UniversalToken](https://github.com/Consensys/UniversalToken) archived Mar 2025, Truffle, ERC-1820 | Validator extension (allow/block lists, certificates) | High, old tooling | No |
| **ERC-7540** async vaults | Extends ERC-4626 with `requestDeposit/requestRedeem` ([EIP-7540](https://eips.ethereum.org/EIPS/eip-7540)); OZ community has variants ([OZ community](https://github.com/OpenZeppelin/openzeppelin-community-contracts/tree/master/contracts/token/ERC20/extensions)) | None of its own | Medium-high | v2 idea only: a pooled "merchant credit fund" for passive investors (Centrifuge uses 7540 for async vaults, [Centrifuge vaults](https://developer.centrifuge.io/user/concepts/vaults/)) |
| **ERC-1155, id per claim** | OZ `ERC1155` + `ERC1155Supply`; override `_update(from,to,ids,values)` ([OZ ERC1155](https://docs.openzeppelin.com/contracts/5.x/api/token/erc1155)) | Our `_update` | **Low** | **Both products in one contract, no factory**; contract recipients must implement `onERC1155Received` |
| **Minimal ERC-20/721 + `_update`** | OZ v5: "All customizations to transfers, mints, and burns should be done by overriding this function" ([OZ ERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20)). OZ community has `ERC20Restricted`, `ERC20Freezable`, `ERC20uRWA` (unaudited, unversioned, [repo](https://github.com/OpenZeppelin/openzeppelin-community-contracts)) | Our `_update` | Low per token, but ERC-20 needs a clone per claim; ERC-721 can't hold fractions | Second choice (ERC-20 clones, the rival's pattern) |
| **ERC-7943 (uRWA)**, the interface layer | Final, 2025-06-10. ERC-1155 variant: `canSend`, `canReceive`, `canTransfer`, `getFrozenTokens`, `setFrozenTokens`, `forcedTransfer`; events `ForcedTransfer`, `Frozen`; interface id `0x41c4fbad`; "no identity framework is required" ([EIP-7943](https://eips.ethereum.org/EIPS/eip-7943)). Reference impl (unaudited): [xaler5/uRWA](https://github.com/xaler5/uRWA) | Implementer's choice | +40 lines | **Use as the public face of ClaimToken** |

**Recommendation:** `ClaimToken is ERC1155Supply, IERC7943MultiToken`. That gives one contract to verify and one ABI, and judges can read every rule in one `_update` function.

### 2.2 ClaimToken rules (in `_update`, in this order)

```
mint  (from == 0): only market; canReceive(to); holder cap
burn  (to == 0):   only market; no other checks (settlement must never be blocked)
transfer:          !claimFrozen[id]
                   lockFrom[id] == 0 || block.timestamp < lockFrom[id]      // maturity / record-date lock
                   canSend(from) && canReceive(to)                          // = registry.isEligible(...)
                   balanceOf(from,id) - value >= frozenTokens[from][id]     // ERC-7943 partial freeze
                   holder cap: at most MAX_HOLDERS = 8 non-zero holders per id
```
- `canSend(a) = canReceive(a) = registry.isEligible(a) && !frozenAccount[a]`. A revoked investor can't trade, but **still receives payouts**, because payouts are USDT pushes plus burns, not token transfers.
- `forcedTransfer(from,to,id,amt)`: compliance admin only. Requires `canReceive(to)`, ignores lock and freeze. Use case: lost keys or a court order. Emits `ForcedTransfer`.
- `setFrozenTokens(account,id,amt)`: compliance admin only. Emits `Frozen`.
- The market sets `lockFrom[id]` (invoice: `dueDate − LOCK_WINDOW`; advance: 0) and `claimFrozen[id]` (on default).
- `LOCK_WINDOW` and `GRACE` are **constructor parameters**: 60 s / 120 s on testnet so the demo can show maturity and default live; 1 day / 7 days in production (say so in the README). The rival uses 1 day and 7 days (source above).
- Holder tracking: `_holders[id]` (≤ 8). Add on the first receipt; when full, reuse a slot whose balance is 0. ponytail: bounded push loop, switch to a per-unit accumulator with pull claims if claims need more than 8 holders.

### 2.3 Investor allowlist: EAS on 1874

- **Schema** (register once via `SchemaRegistry.register(schema, resolver=0, revocable=true)`; UID = `keccak256(abi.encodePacked(schema, resolver, revocable))`, [SchemaRegistry.sol](https://raw.githubusercontent.com/ethereum-attestation-service/eas-contracts/master/contracts/SchemaRegistry.sol)): `bool kycPassed, bytes2 country, uint8 tier`. This mirrors the WB Soul attributes such as `IsVerified` ([WB Soul](https://whitebit.com/wb-soul)); WB Soul itself has no code on 1874 (inventory §0.5).
- **Attester:** a "Compliance desk" key (in the demo, our admin key standing in for WhiteBIT KYC). Attest with `EAS.attest(...)` from a small admin page (Claude Code) or a `cast` script (zcode). No easscan for 1874 was found (unverified), and self-hosting the indexer isn't worth it ([eas-indexing-service](https://github.com/ethereum-attestation-service/eas-indexing-service)).
- **Lookup:** EAS keeps no on-chain index by recipient ([IEAS.sol](https://raw.githubusercontent.com/ethereum-attestation-service/eas-contracts/master/contracts/IEAS.sol)). So `InvestorRegistry.register(uid)` stores `uidOf[recipient] = uid` after checking it. The investor's dashboard calls it through the relayer, so it's gasless.
- **`isEligible(a)` re-reads EAS every time**, so revocation applies immediately. It checks `att.schema == KYC_SCHEMA`, `trustedAttester[att.attester]`, `att.recipient == a`, `att.revocationTime == 0`, `att.expirationTime == 0 || > now`, and that the decoded `kycPassed` is true. **Do not use `isAttestationValid`**: it only checks that the UID exists, not revocation or expiry ([EAS.sol](https://raw.githubusercontent.com/ethereum-attestation-service/eas-contracts/master/contracts/EAS.sol); struct fields in [Common.sol](https://raw.githubusercontent.com/ethereum-attestation-service/eas-contracts/master/contracts/Common.sol)).
- **Fallback (cut line):** `setEligible(addr, expiry)` owner mapping inside the same contract. Decide by H10: the fork test reads a real attestation or we switch. Same pattern as Centrifuge's memberlist with a `uint64` valid-until (search snippet only, unverified: [Centrifuge compliance](https://developer.centrifuge.io/developer/protocol/features/token-compliance/)).

### 2.4 Lifecycle: what is minted when

**Invoice claim**

| Step | Who / call | On-chain effect |
|---|---|---|
| 1 Create | merchant → `MerchantPay.createInvoice(customer, amount, dueDate, refHash)` | `InvoiceCreated`. No token |
| 2 Acknowledge | debtor signs EIP-712 `Acknowledge(invoiceId, amount, dueDate)`; relayer → `acknowledge(id, sig)` | `InvoiceAcknowledged`. Required before listing ("verified receivable") |
| 3 List | merchant → `CapitalMarket.listInvoice(invoiceId, price, offerDeadline, recourseBps)` | Offer stored; **still no tokens**. Rules: acknowledged, unpaid, not financed, `price < amount`, `offerDeadline ≤ dueDate − LOCK_WINDOW`. Our server writes the Arkiv offer with expiry = `offerDeadline` |
| 4 Fund | investor signs 3009 → relayer → `fundWithAuthorization(claimId, investor, units, …)` | Delivery versus payment in one tx: USDT investor → market → merchant (`cost = ceil(units × price / amount)`), **mint `units`** to the investor. The first funding sets `invoice.financed = true`; routing is locked to holders and can't be undone |
| 5 Pay | debtor's 3009 → `MerchantPay.payInvoice` (now, or on the due date via the pre-signed `validAfter = dueDate` authorization) | Holders first: `toHolders = min(net, totalSupply(id))`, pushed pro-rata, **burning the units it covers**. The remainder (the unfunded part, or overpayment) goes to the merchant |
| 6 Maturity | — | From `dueDate − LOCK_WINDOW` transfers revert. `totalSupply == 0` → `Settled` |
| 7 Default | anyone → `markDefault(claimId)` after `dueDate + GRACE` with supply > 0 | Claim frozen. A **recourse lien** is added on the merchant's stream (`recourseBps` of each future sale, agreed at listing) until the supply is 0. The debtor can still pay late, and that goes to holders first. The merchant can also `repay(claimId, amount)` directly |

**Revenue-advance claim**

| Step | Who / call | Effect |
|---|---|---|
| 1 List | merchant → `listAdvance(principal, cap, holdbackBps, term, offerDeadline)` | Rules: `cap ≥ principal`, `holdbackBps ≤ 3000`, no other active advance for this merchant. Arkiv offer |
| 2 Fund | investor 3009 → `fundWithAuthorization` | Mint `units` of cap; `cost = units × principal / cap`; USDT → merchant now. The lien is active from the first funding |
| 3 Each sale | `MerchantPay.paySale` → market | `take = min(gross × bps / 10_000, totalSupply(id), net)` pushed to holders and burned (§3) |
| 4 Term end | `term` passed with supply > 0 | Status "late" (shown, no new rule). After `term + GRACE`, anyone can `markDefault` → freeze; the lien keeps taking |
| 5 Settled | supply hits 0 | Lien removed; future sales go 100% to the merchant |

**Partial payments:** allowed on any invoice. Every payment goes to holders first and burns the units it covers, so balances always show what is still owed.
**Late fee:** none in the MVP (stated limitation). v2: `lateFeeBps` accrues to holders after the due date (the rival charges 5%).
**Default without recourse:** out of scope. We model with-recourse factoring, the common SMB form. Real recovery beyond the merchant's stream is legal/off-chain.

### 2.5 Pricing math (numeric example)

Market practice: receivables are "sold at a discount" with an advance or price below face ([CFI factoring](https://corporatefinanceinstitute.com/resources/accounting/accounts-receivable-factoring/)). Two quote conventions: bank discount `P = F × (1 − d × days/360)` ([TreasuryDirect](https://treasurydirect.gov/marketable-securities/understanding-pricing/)) and yield basis `P = F / (1 + r × days/basis)` ([iotafinance](https://www.iotafinance.com/en/Formula-Price-of-a-Discount-Security.html)). **The contract stores only `price`**; the UI computes it from a target APR (yield basis, 365) and shows both numbers.

Invoice: face F = **10,000 USDT**, due in **60 days**, investor target **12% APR**:
- `P = 10,000 / (1 + 0.12 × 60/365) = 9,806.56 USDT` → discount 193.44 (1.93%). Check: `(10,000/9,806.56 − 1) × 365/60 = 12.0%`.
- (Bank-discount convention at 12%: 9,800.00.)
- Investor A buys 6,000 units for **5,883.93**; investor B buys 4,000 units for **3,922.62**. The merchant receives 9,806.56 today.
- Day 60, the debtor pays 10,000 in one tx: A gets 6,000 (+116.07), B gets 4,000 (+77.38); all units burned; Settled.
- **Partial:** on day 58 the debtor pays 4,000 → A 2,400, B 1,600; remaining units A 3,600, B 2,400.
- **Default:** nothing more by day 60 + GRACE → `markDefault` → claim frozen, recourse lien at 50%. The merchant's next 1,000 USDT sale → 500 to holders (A 300, B 200), 500 to the merchant, until 6,000 is recovered.

Rounding: `cost` rounds up (merchant-favourable by at most 1 micro-USDT); pro-rata payouts round down and **the last holder gets the remainder** (no dust left in the contract). Fuzz-test both.

---

## 3. B. Revenue advance: the payment router

Stripe Capital: principal plus a fixed premium, withheld as "a fixed percentage of each transaction until the complete balance is repaid" ([Stripe](https://docs.stripe.com/capital/how-capital-for-platforms-works)). Shopify calls it the remittance rate ([Shopify glossary](https://help.shopify.com/en/manual/finance/shopify-capital/shopify-capital-glossary)). Typical factor rates are 1.1–1.5 and holdbacks 5–20% ([NerdWallet factor rate](https://www.nerdwallet.com/business/loans/learn/factor-rate), [NerdWallet MCA](https://www.nerdwallet.com/business/loans/learn/merchant-cash-advance)). So the contract needs two numbers: `cap = principal × factor` and `holdbackBps`.

**Split for each payment of gross `S` (inside `CapitalMarket.onPayment`, called only by MerchantPay):**
```
fee     = relayFee                                    // taken first by MerchantPay → feeRecipient
net     = S - fee
if invoiceId != 0 && invoice financed:                // claim-specific routing first
    t = min(net, supply(invoiceClaim)); push(invoiceClaim, t); net -= t
for lien in liens[merchant]  (oldest first, max 3):   // seniority = creation order
    take = min(S * lien.bps / 10_000, supply(lien.claimId), net)   // bps on GROSS, capped by what's left
    push(lien.claimId, take); net -= take
    if supply(lien.claimId) == 0: remove lien, emit Settled
transfer(merchant, net)
```
- Liens apply to **every** payment the merchant receives through MerchantPay: checkout sales and unfinanced invoices. On a financed invoice they apply only to the merchant's remainder.
- **Refunds:** `MerchantPay.refund(paymentId, amount)` pulls from the merchant's wallet (`transferFrom`, one-time approve) to the original payer, with `refunded ≤ gross`. Refunds **never claw back** from investors. Reason: the holdback is debt repayment and the refund is the merchant's cost; the investor's total stays capped at `cap`; and a merchant can't use refunds to cut what investors are owed. (Stripe withholds from payouts, which are net of refunds; we choose per-transaction simplicity and say so.)
- **Abuse cases:** a merchant self-buying and then refunding only prepays its own advance (harmless to investors). The real risk is **diversion**: taking sales outside MerchantPay. The chain can't stop that. We mitigate with the term + default rule, the recourse lien, and public sales velocity in the offer's stats so investors can see it. Wash sales to inflate history before raising cost the merchant the relay fee and the holdback. The investor view counts unique payers and excludes merchant-owned addresses (heuristic; stated limitation).

**Numeric example:** principal **1,000 USDT**, factor 1.10 → cap **1,100**, holdback **20%**, term 90 days, relay fee 0.10.

| Event | Gross | Fee | To investor | To merchant | Repaid / 1,100 |
|---|---|---|---|---|---|
| Funding (investor pays 1,000 for 1,100 units) | — | — | −1,000 | +1,000 | 0 |
| Sale 1 | 50.00 | 0.10 | 10.00 | 39.90 | 10.00 |
| Sale 2 | 200.00 | 0.10 | 40.00 | 159.90 | 50.00 |
| Refund of sale 2 (merchant wallet → customer) | — | — | 0 | −200.00 | 50.00 (unchanged) |
| … sales … | | | | | 1,090.00 |
| Last sale | 100.00 | 0.10 | **10.00** (capped) | 89.90 | 1,100 → Settled, lien removed |
| Next sale | 100.00 | 0.10 | 0 | 99.90 | — |

The effective cost depends on sales speed: repaid in 45/60/90 days → 81% / 61% / 41% simple APR. MCAs are expensive, and that's normal for the product; the UI must show it before the merchant signs.

---

## 4. C. Gasless checkout and the relayer

### 4.1 Which signature

| | EIP-3009 `transferWithAuthorization` | **EIP-3009 `receiveWithAuthorization`** | EIP-2612 `permit` + `transferFrom` |
|---|---|---|---|
| Into a contract | Unsafe: "an attacker watching the transaction pool [can] extract the transfer authorization and front-run… without invoking the wrapper function… unprocessed, locked up deposits" ([EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)) | Safe: the token checks the caller is the payee (Circle: `require(to == msg.sender, "…caller must be the payee")`, [EIP3009.sol](https://raw.githubusercontent.com/circlefin/stablecoin-evm/master/contracts/v2/EIP3009.sol)); **on 1874: `"TetherToken: to != msg.sender"`** (verified) | Permits "can be frontrun… allow a `permit` call to fail" → `try permit catch` ([IERC20Permit](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/token/ERC20/extensions/IERC20Permit.sol)) |
| Binds the invoice | Via nonce | **Via nonce** (contract recomputes it) | No: the permit signs only owner/spender/value/deadline, so a front-runner could spend the allowance on its own invoice unless we add a second signature or a Permit2 witness |
| Signatures / gas | 1 / ~84k measured | 1 / ~84k + routing | 1–2 / ~95k estimate (unverified) |
| Due-date scheduling | `validAfter` | **`validAfter`** (verified "auth early") | deadline only |

**Decision:** `receiveWithAuthorization` everywhere money is pulled (customer pay, investor fund).
`nonce = keccak256(abi.encode(block.chainid, address(this), kind, invoiceIdOrMerchant, orderRef, amount, salt))`, computed inside the contract. The spec allows deterministic nonces ([EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)). Base commerce-payments does the same with `nonce = _getHashPayerAgnostic(paymentInfo)` ([ERC3009PaymentCollector](https://raw.githubusercontent.com/base/commerce-payments/main/src/collectors/ERC3009PaymentCollector.sol), [TokenCollectors.md](https://raw.githubusercontent.com/base/commerce-payments/main/docs/TokenCollectors.md)). A front-runner can only submit the exact same `pay()`, which helps us. `payInvoice/paySale/fund*` are permissionless, so a customer can self-submit if our relayer is down. That is the censorship-resistance line for CROPS.
EIP-712 domain for USDT: name "Tether USD", version "1", chainId 1874; read `DOMAIN_SEPARATOR()` at runtime (ARCHITECTURE.md §7).

### 4.2 Customer wallet (zero crypto steps)
- **Primary:** Privy embedded wallet, email login. Privy says embedded wallets "can support any EVM-compatible chain" via viem `defineChain` / `supportedChains` ([Privy EVM networks](https://docs.privy.io/basics/react/advanced/configuring-evm-networks.md)); viem ships `whitechainSepolia` ([Whitechain viem](https://docs.whitechain.io/build/dapps/use-viem)). We only need `signTypedData`, never a transaction. **Unverified on 1874; test at H0–2.** The button says "Confirm payment", never "sign" or "Whitechain".
- **Fallback:** a guest wallet whose key is generated and kept in the browser. Weaker recovery, stated as a limitation.
- Demo funding: the customer wallet is pre-funded with test USDT (story: "withdrawn from WhiteBIT"). Not a step in the payer flow.
- CROPS watch-out: "No third-party trackers or analytics in the client" ([prizes](https://ethglobal.com/events/mumbai/prizes)). Check Privy's network calls; if it sends telemetry, the CROPS section says so or the investor app (the CROPS surface) uses only an injected wallet.

### 4.3 Relayer (zcode, `apps/relayer`)
- `POST /relay {action, args, sig}` with `action ∈ {payInvoice, paySale, fund, acknowledge, register}` → `{txHash, paymentId?}` or 4xx + reason.
- `POST /schedule` stores a pre-signed due-date authorization (it can only pay that one invoice to MerchantPay, so holding it is safe). A keeper loop submits when `now ≥ validAfter`. A failure (debtor moved its funds) → invoice "overdue".
- `GET /health` → `{wbt, gasSpentToday, budgetLeft, usdtFeesUnswapped, paused}`, shown on the merchant dashboard because Scale asks who pays gas.
- One hot key, sends serialized (single in-flight nonce, as in ARCHITECTURE.md §4b), key only in the git-ignored `.env`.

**Drain guard (what stops someone draining it):**
1. **Target + selector allowlist:** only `MerchantPay.{payInvoice, paySale, acknowledge}`, `CapitalMarket.fundWithAuthorization`, `InvestorRegistry.register`. Same idea as OZ Relayer `whitelist_receivers` ([OZ Relayer config](https://docs.openzeppelin.com/relayer/1.8.x/configuration)).
2. **Simulate first** (`eth_call` + `estimateGas`); never send a tx that would revert. "A failed transaction still pays for the gas it used" ([Whitechain fees](https://docs.whitechain.io/learn/network/network-fees)).
3. **Pre-checks** like the x402 facilitator: signature recovers to `from`, payer balance ≥ value, window valid, `authorizationState(from, nonce) == false` ([x402 exact EVM](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)).
4. **The fee is in the tx:** 0.10 USDT per payment to `feeRecipient`, contract-capped at `MAX_FEE = 0.25 USDT`, plus a **minimum payment of 1 USDT**. So every relayed payment pays for its own gas. Same idea as Gelato's capped `callWithSyncFee` ([Gelato](https://docs.gelato.cloud/relay/non-erc2771/callwithsyncfee/relay-context-contract), page TLS-broken, from snippet).
5. **Gas caps:** `maxFeePerGas ≤ 10 gwei` (2× the floor), fixed gas limit 400k ([OZ `gas_price_cap`](https://docs.openzeppelin.com/relayer/1.8.x/configuration)).
6. **Short windows:** `validBefore ≤ now + 15 min` (scheduled payments: ≤ dueDate + 7 days).
7. **Rate limits:** per payer, per merchant, per IP (SQL counters, so they survive cold starts), like Pimlico's per-user policies ([Pimlico](https://docs.pimlico.io/references/platform/api/sponsorship-policies/object)).
8. **Daily WBT budget** as a hard stop (503 + reason) and a `min_balance` alert.
9. **Low hot-wallet balance** (≤ 0.5 WBT), topped up by the swap job; treasury key separate.
10. **Pause switch** on MerchantPay (owner) and an alert on any failed relayed tx.

Non-fee actions (`acknowledge`, `register`) cost gas without a fee. They are covered by limits 7 and 8 and allowed only for known invoices and investors.

### 4.4 How the relayer gets WBT
- **Gas per payment:** the 3009 pull is ~84k measured; our full route (pull + fee + market + 1–3 holder pushes + merchant) is ~200–250k (**estimate, unverified**). At 5 gwei that's 0.0010–0.00125 WBT ≈ **0.075–0.093 USDT** at 74.6 USDT/WBT (or ≈$0.055–0.069 at a stale ~$55/WBT, [BingX](https://bingx.com/en/price/whitebit), dated July 2026). Docs: a plain transfer "costs about 0.000105 WBT" ([Whitechain fees](https://docs.whitechain.io/learn/network/network-fees)). Hence a **0.10 USDT** fee.
- **Testnet:** the faucet gives 2 WBT/day (venue flyer, HANDOFF.md) ≈ 1,600–2,000 payments/day. Plenty for the demo.
- **Self-funding loop (built, P1):** a keeper swaps accumulated fees when WBT < 0.5:
  `SwapRouter02.exactInputSingle({tokenIn: USDT, tokenOut: WWBT, fee: 3000, recipient: relayer, amountIn, amountOutMinimum: QuoterV2 quote − 1%, sqrtPriceLimitX96: 0})` (struct has no deadline; use `multicall(deadline, data)`: [IV3SwapRouter](https://raw.githubusercontent.com/Uniswap/swap-router-contracts/main/contracts/interfaces/IV3SwapRouter.sol), [YetiTrade guide](https://docs.yetitrade.fi/guides/swap-from-a-contract.md)), then `WWBT.withdraw(amount)` from the relayer EOA. WETH98 sends with a 2300-gas stipend, so don't unwrap into a contract ([WETH98.sol](https://raw.githubusercontent.com/ethereum-optimism/optimism/develop/packages/contracts-bedrock/src/universal/WETH98.sol)). On CGT chains `0x4200…0006` wraps the gas token ([OP CGT spec](https://specs.optimism.io/experimental/custom-gas-token.html)). The pool is shallow (99k USDT), so swap small amounts.
- **Mainnet story (README only):** the same fee swap through YetiTrade or WhiteBIT, or a merchant prepaid gas deposit. Official USDT isn't on mainnet yet (inventory §0.6).

---

## 5. D. Contracts, services, lanes, Arkiv, Anon-RPC

### 5.1 Contracts (zcode). Interfaces are frozen at H14 in ARCHITECTURE.md §2

Deploy order: InvestorRegistry → ClaimToken(registry, admin, LOCK_WINDOW) → MerchantPay(usdt) → CapitalMarket(merchantPay, claimToken, usdt, GRACE) → `ClaimToken.setMarket` + `MerchantPay.setMarket` (one-time setters). `evm_version = "prague"`. Verify all four on Blockscout.

**`MerchantPay.sol`** (Operate + Scale)
- `createInvoice(address customer, uint128 amount, uint64 dueDate, bytes32 refHash) returns (uint256 id)`: merchant direct tx (the merchant may hold WBT; the payer never does)
- `cancelInvoice(uint256 id)`: merchant; unpaid and not financed
- `acknowledge(uint256 id, uint256 deadline, bytes sig)`: anyone; EIP-712 signature by `customer`
- `payInvoice(uint256 id, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) returns (uint256 paymentId)`
- `paySale(address merchant, bytes32 orderRef, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) returns (uint256 paymentId)`
- `refund(uint256 paymentId, uint256 amount)`: merchant; `transferFrom(merchant → payer)`; `refunded ≤ gross`
- `setRelayFee(uint256 fee, address recipient)` (≤ `MAX_FEE`), `pause/unpause`: owner
- views: `invoices(id)`, `payments(id)`, `nextInvoiceId`, `nextPaymentId`, `nonceFor(...)`
- events: `InvoiceCreated(uint256 indexed id, address indexed merchant, address indexed customer, uint256 amount, uint64 dueDate, bytes32 refHash)` · `InvoiceAcknowledged(uint256 indexed id)` · `InvoiceCancelled(uint256 indexed id)` · `Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)` · `Refunded(uint256 indexed paymentId, uint256 amount, uint256 totalRefunded)` · `RelayFeeSet(uint256 fee, address recipient)`

**`CapitalMarket.sol`** (Tokenize)
- `listInvoice(uint256 invoiceId, uint128 price, uint64 offerDeadline, uint16 recourseBps) returns (uint256 claimId)`: merchant
- `listAdvance(uint128 principal, uint128 cap, uint16 holdbackBps, uint64 term, uint64 offerDeadline) returns (uint256 claimId)`: merchant
- `cancelOffer(uint256 claimId)`: merchant, before the first funding
- `fund(uint256 claimId, uint256 units)` (investor direct, `transferFrom`) and `fundWithAuthorization(uint256 claimId, address investor, uint256 units, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s)` (relayed)
- `onPayment(address merchant, uint256 invoiceId, uint256 gross, uint256 net, uint256 paymentId) returns (uint256 toInvestors)`: **only MerchantPay**; does §3 and pays the merchant the rest
- `markDefault(uint256 claimId)`: anyone after maturity + GRACE · `repay(uint256 claimId, uint256 amount)`: merchant direct
- `withdrawOwed()`: pull fallback when a push to a holder fails (low-level call returns false); emits `PushFailed`
- views: `offers(claimId)`, `outstanding(claimId)` (= `ClaimToken.totalSupply`), `liensOf(merchant)`, `quote(claimId, units)`
- events: `OfferListed(uint256 indexed claimId, address indexed merchant, uint8 kind, uint256 invoiceId, uint256 face, uint256 price, uint16 bps, uint64 offerDeadline, uint64 maturity)` · `OfferCancelled(uint256 indexed claimId)` · `Funded(uint256 indexed claimId, address indexed investor, uint256 units, uint256 cost)` · `Distributed(uint256 indexed claimId, uint256 indexed paymentId, uint256 amount, uint256 outstanding)` · `LienAdded(address indexed merchant, uint256 indexed claimId, uint16 bps)` · `Defaulted(uint256 indexed claimId, uint256 outstanding)` · `Settled(uint256 indexed claimId)` · `PushFailed(uint256 indexed claimId, address indexed holder, uint256 amount)`

**`ClaimToken.sol`**: §2.2. Extra: `mint/burn` (onlyMarket), `setClaimState(id, lockFrom, frozen)` (onlyMarket), `holdersOf(id)`, ERC-7943 functions + events, `ClaimStateSet(uint256 indexed id, uint64 lockFrom, bool frozen)`, `supportsInterface(0x41c4fbad)`.

**`InvestorRegistry.sol`**: `register(bytes32 uid)`, `isEligible(address) view`, `setAttester(address,bool)`, `setEligible(address,uint64)` (fallback); events `InvestorRegistered(address indexed investor, bytes32 uid)`, `AttesterSet(address attester, bool trusted)`. Constructor: `EAS = 0x4200…0021`, `KYC_SCHEMA`.

**Foundry tests (zcode; coverage on these before the H28 freeze):**
- M1 pay invoice happy path / wrong nonce binding (other invoice, other amount) reverts / direct `transferWithAuthorization` front-run can't hit the router
- M2 paySale + fee cap + minimum amount
- M3 refund cap / only merchant / never touches holders
- C1 list rules (unacknowledged, past deadline, price ≥ face)
- C2 fund DvP: USDT to merchant and mint in one tx; ineligible investor reverts; units > remaining reverts
- C3 settlement push pro-rata, last holder gets remainder, supply → 0 → Settled
- C4 partial payments burn units
- C5 advance lien: bps on gross, capped at outstanding, one active advance per merchant, removed at cap
- C6 default after GRACE: freeze, recourse lien, late debtor payment goes to holders first
- T1 transfer rules: eligible → eligible ok; to non-eligible reverts; after `lockFrom` reverts; frozen reverts; 9th holder reverts; revoked EAS attestation → `canSend` false but payouts still arrive
- T2 forcedTransfer / setFrozenTokens admin-only
- I1 EAS fork test against the real predeploy: attest → register → eligible; revoke → not eligible; expired → not eligible
- F1 fuzz: `Σ payouts + merchant + fee == gross`; `totalSupply` never increases after funding closes; market USDT balance == Σ owed
- E1 event ABI snapshot (dashboards depend on it)

### 5.2 Off-chain services

| Piece | Lane | Notes |
|---|---|---|
| `apps/relayer` | Z | §4.3, own Neon tables `rel_*`; scheduled-payment keeper; fee-swap keeper |
| `packages/shared` | Z writes, C reads | ABI JSON, addresses, EIP-712 types, chain constants |
| `apps/web` merchant | C | invoices + links + reminders (copy-link, "overdue" badge; email is a cut), payments with split columns, one-click refund, financing (list invoice / request advance), liens, relayer `/health`, API keys, **CSV export** |
| `apps/web` investor | C | Arkiv offer book → on-chain check of each offer → buy (sign 3009) → portfolio (claims, payouts) → transfer with live `canTransfer` reason |
| `apps/web` customer | C | `/pay/[invoiceId]`, `/checkout/[sessionId]`, receipt + refund status, acknowledge + "schedule on due date" |
| `apps/web` compliance desk | C | attest / revoke EAS KYC (admin wallet) |
| `apps/web` API | C | `POST /api/v1/sessions` (merchant secret key) → checkout URL; webhooks `payment.succeeded` / `payment.refunded` signed HMAC-SHA256, sent after the relayer's receipt; Arkiv writer (publisher key, server-only); CSV route |
| `apps/shop` demo store | C | **Separate app; ≈20-line integration** (below) |
| Data | — | Chain = truth. Neon only for sessions, API keys, webhook endpoints, customer contact details (off-chain, not public). Dashboards read state by Multicall, not log scans (log range caps, §1) |

**The ≈20-line shop integration** (count in the README): server route `POST /api/buy` (≈8 lines: look up price, `fetch(MC + "/api/v1/sessions", {Authorization: Bearer MC_SECRET, body: {amount, orderRef, successUrl}})`, return `{url}`) · client (≈4 lines: button → POST → `location = url`) · webhook (≈8 lines: verify HMAC, check `gross ≥ order.amount`, mark paid).

**CSV columns:** `date, type (sale|invoice|financing|refund|payout), payment_id, invoice_id, order_ref, counterparty, gross_usdt, relay_fee_usdt, to_investors_usdt, to_merchant_usdt, refunded_usdt, claim_id, tx_hash, explorer_url`. Financing proceeds get their own rows, so an accountant can book holdbacks as debt repayment, not lost revenue. Tx hashes come from Blockscout `/logs` (CORS ok).

### 5.3 Arkiv (SDK `@arkiv-network/sdk` **1.0.1**, Rabdi testnet)

API facts (from source, 1.0.1, published 2026-11-02, [npm](https://registry.npmjs.org/@arkiv-network/sdk)):
- **Breaking in 1.0.0:** payload/content-type removed; `buildQuery()` gone since 0.8 ([CHANGELOG](https://raw.githubusercontent.com/Arkiv-Network/arkiv-sdk-js/main/CHANGELOG.md)). Docs still show old helpers. **Treat the source as truth; install the Arkiv agent skill (`Arkiv-Network/skills`, written for `>=1.0.0 <2`)** ([skills](https://github.com/Arkiv-Network/skills)).
- Clients: `createPublicClient/createWalletClient` + `rabdi({ accessKey })` from `@arkiv-network/sdk/chains`; RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network` ([rabdi.ts](https://raw.githubusercontent.com/Arkiv-Network/arkiv-sdk-js/main/src/chains/rabdi.ts), [access keys](https://docs.arkiv.network/start-here/access-keys/)). Browser CORS: implied by the React guide, not stated (unverified) ([React guide](https://docs.arkiv.network/guides/react/)).
- Schema: `defineSchema(name, { col: u64().indexed(), … })` (`bool i32 u64 u256 dec str addr key bytes`; only indexed columns are filterable; `bytes` can't be indexed) ([schema.ts](https://raw.githubusercontent.com/Arkiv-Network/arkiv-sdk-js/main/src/schema/schema.ts)).
- Write: `createEntity(schema, values, { expiration })`, `patchEntity(schema, key, { set })`, `extendEntity({ entityKey, expiration })`, `deleteEntity({ entityKey })` ([arkivWallet.ts](https://raw.githubusercontent.com/Arkiv-Network/arkiv-sdk-js/main/src/clients/decorators/arkivWallet.ts)). Expiry: `ExpirationTime.atDate(date)` (rounds up to a block). Expired entities drop out of queries ([expiration](https://docs.arkiv.network/writing/expiration/)).
- Read: `select({...}).from(Offer, {onMismatch:"skip"}).where(and(eq(...), gt(...))).ownedBy(PUBLISHER).orderBy(...).limit(100).fetch()`; predicates from `@arkiv-network/sdk/query`; wrap numbers in `u64()` ([queryBuilder.ts](https://raw.githubusercontent.com/Arkiv-Network/arkiv-sdk-js/main/src/query/queryBuilder.ts)).
- Limits: 32 attributes (31 with a named schema), `str` ≤ 128 B, `bytes` ≤ 128 KiB, max lifetime ≈ 182.5 days, page size 100 ([limits](https://docs.arkiv.network/reference/limits/)). Known issues: 429 hangs, the batch limit (inventory and gas_and_aqua_demand.md §Q4).

**Entity `mcplus.offer.v1`** (owner = our publisher key; one per open offer)

| Column | Type | Filter use |
|---|---|---|
| `kind` | `str().indexed()` | "invoice" \| "advance" |
| `chainId` | `u64().indexed()` | 1874 |
| `market` | `addr().indexed()` | CapitalMarket address (verify on-chain) |
| `claimId` | `u64().indexed()` | |
| `merchant` | `addr().indexed()` | merchant's page |
| `faceUsdt` / `priceUsdt` / `remainingUsdt` | `u64().indexed()` | micro-USDT; ticket size filter |
| `aprBps` | `u64().indexed()` | `gt("aprBps", u64(1000))`, sort |
| `holdbackBps` | `u64().indexed()` | advances |
| `maturity` | `u64().indexed()` | due date / term end |
| `deadline` | `u64().indexed()` | exact seconds (expiry is block-rounded) |
| `status` | `str().indexed()` | "open" \| "funded"; `patchEntity` on funding |
| `sector` | `str().indexed()` | "cafe", "studio" |
| `terms` | `bytes().optional()` | JSON: merchant's EIP-712 signature over the terms, invoice summary (debtor **hashed**, no PII), 30-day sales stats snapshot, explorer links |

- **Expiry = `ExpirationTime.atDate(offerDeadline)`.** The contract also rejects `fund` after `offerDeadline`, so Arkiv and the chain agree, and a stale price can't be shown. Reject deadlines under 1 minute or over 182 days away.
- **Who can edit:** only the publisher (owner); `permissionlessExtension` off. Integrity doesn't depend on our key: the merchant's signature is in `terms`, and every offer is checked against `CapitalMarket.offers(claimId)` before the Buy button turns on.
- **User-facing reads** (the Arkiv rule: "Not counted: the SDK installed but never used to read…"): the investor offer book, the merchant's "my live offers" panel, and the offer detail page.
- **P2 entity `mcplus.merchant.v1`** (sales30d, uniquePayers30d, refundRateBps, activeLiens): rewritten hourly, expiry 2 h → "fresh or gone".
- **README:** writer address, one runnable query, `/arkiv/schema.md`, `/arkiv/friction.md` (log every problem as it happens), `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` (25% each) ([prizes](https://ethglobal.com/events/mumbai/prizes)).
- **why-arkiv.md thesis:** with Postgres, investors would lose (1) the guarantee that a listed offer is still live (expiry is enforced by the store, with no cron to forget), (2) open access: any investor app or exchange can read the offer book without our API, which is distribution, the thing Whitechain says it sells ([The Block](https://www.theblock.co/press-releases/412097/whitechain-relaunches-as-w-groups-distribution-first-ethereum-layer-2)), and (3) a provenance trail tied to a writer key. Putting offers on Whitechain instead would cost gas per listing and still need an indexer, which doesn't exist there (inventory §5).

### 5.4 Anon-RPC integration points

- **Harness:** `@anon-rpc/browser-harness` 0.4.0 ([npm](https://registry.npmjs.org/@anon-rpc/browser-harness)). `new AnonRpcWorker({ address, config, preExisting: { rpcProvider } })`, `await w.ready`, `w.fetch(url, init)` ([README](https://raw.githubusercontent.com/ethereum/anon-rpc/main/impl/browser-harness/README.md), [spec-types](https://raw.githubusercontent.com/ethereum/anon-rpc/main/impl/harness-core/src/spec-types.ts)). Network specifiers live on mainnet (tor-js `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e`, Nym `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0`, per [adopters.json5](https://raw.githubusercontent.com/ethereum/anon-rpc/main/adopters.json5); re-read at build time), so a **mainnet bootstrap RPC** is needed for one trusted read ([integrate-wallet.md](https://raw.githubusercontent.com/ethereum/anon-rpc/main/docs/integrate-wallet.md)).
- **Runtime needs:** a sandboxed null-origin iframe + worker, WebRTC, IndexedDB. The `srcdoc` boot needs `'unsafe-inline'` in `script-src`, or serve `iframe-boot.js` and pass `iframeUrl` ([impl README](https://raw.githubusercontent.com/ethereum/anon-rpc/main/impl/README.md)). Nym bundle ≈ 18 MB → load lazily, show a "Connecting privately…" chip.
- **viem transport** (one file, `lib/anon.ts`, Claude Code):
  ```ts
  const anon = (url: string) => custom({ async request({ method, params }) {
    const r = await worker.fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })
    const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), j.error)
    return j.result }})
  createPublicClient({ chain: whitechainSepolia, transport: anon("https://rpc.ankr.com/whitechain_testnet"),
                       batch: { multicall: true } })   // Multicall3 0xcA11…CA11 predeploy: 1 anon request per screen
  ```
- **Where it's used (default on):** investor offer book checks, portfolio balances and payouts, the merchant dashboard (invoices, payments, liens, `/health` reads that are on-chain), customer receipts, `canTransfer` previews. **Arkiv reads through the same worker** (the Arkiv SDK takes any viem transport), so ~100% of app reads go through Anon-RPC. That matters because judging counts "how much of the app's traffic goes through Anon-RPC" ([prizes](https://ethglobal.com/events/mumbai/prizes)).
- **Why it matters here:** an investor's IP plus the claims it inspects reveals its portfolio and its interest in a merchant; a merchant's reads reveal its cash position. RPC providers see both.
- **Disclosed exclusions** (EF says intentional tradeoffs are fine "just let us know"): signing is local; writes go to our relayer over HTTPS; CSV tx-hash lookups use Blockscout `/logs` (route via `w.fetch` if GET to a non-RPC host works, unverified); the one mainnet bootstrap read; server-side relayer/webhook reads.
- **Traffic meter:** wrap the transport to count requests; footer chip "Private reads: Nym · 100% (412/412)". Toggle "Direct RPC" for latency comparison, off by default.
- **Latency budget:** tested 1.6 s (Nym) / 2.8 s + 17 s bootstrap (tor-js) per read (workshop notes). Hence Nym by default and one multicall per screen. The tor-js gateway is "demonstration only" → Nym stays the default.
- **CROPS section** (one or two lines per letter): C = payments and funding are permissionless functions, so anyone can submit a signed authorization if our relayer is down; R = settlement rules can't be bypassed by us (only market-only mint/burn and a bounded admin freeze; say so); O = MIT repo; P = Anon-RPC by default, no PII on Arkiv or on-chain (hashed refs); S = non-custodial, keys on the user's device (Privy note §4.2).

### 5.5 Lanes

| Lane | Owner | Files |
|---|---|---|
| Contracts + tests + deploy/verify scripts | **zcode** | `contracts/` |
| Relayer, schedule keeper, fee-swap keeper | **zcode** | `apps/relayer/` |
| Shared ABI/addresses | zcode writes | `packages/shared/` |
| Web app (merchant, investor, customer, compliance, API, Arkiv writer, CSV, webhooks), Anon-RPC transport | **Claude Code** | `apps/web/` |
| Demo shop + checkout embed | **Claude Code** | `apps/shop/` |
| README sections, `arkiv/*.md`, CROPS section, `WHITECHAIN_FEEDBACK.md`, `AI_USAGE.md` | Claude Code drafts, human edits | root |
| Review, screenshots | opencode | — |
| Accounts (Privy app id, Arkiv access key + Rabdi funds, Ankr key, faucet from home, USDT swap), video, booth pitch | **human** | — |

---

## 6. E. User flows, booth pitch, demo video

### 6.1 Flows
**Merchant (Asha, "Bandra Beans": café checkout plus B2B catering invoices)**
1. Connects a wallet → dashboard. Creates a shop API key and pastes it into the shop.
2. Creates an invoice: Lumen Studio, 10,000 USDT, due in 60 days → link sent. Lumen acknowledges → badge "Verified receivable".
3. "Get paid today" → slider at 12% APR → price 9,806.56 → Publish → live offer with a countdown (Arkiv).
4. Investors fund → 9,806.56 USDT in her wallet within minutes; the invoice row shows "Financed – repays investors".
5. "Cash advance": 1,000 now, repay 1,100 from 20% of sales → funded.
6. Each sale row shows gross / fee / to investors / to you. One-click refund. CSV export for the accountant.

**Customer (Rahul, a WhiteBIT user)**: shop → "Pay with USDT" → email code → "Confirm 25 USDT" → paid; receipt with refund status. No WBT, no seed phrase, no chain name.
**Business debtor (Lumen Studio)**: opens the invoice link → "Confirm invoice" (signature, gasless) → "Pay now" or "Pay automatically on due date".

**Investor (Meera, KYC'd)**: compliance desk attests → dashboard registers her attestation (gasless) → offer book (Arkiv, read privately via Nym) → buys 6,000 units for 5,883.93 (signs once, gasless) → portfolio → tries to send a claim to a wallet without KYC: the UI shows "receiver not verified" and an explorer revert. Then a send to verified Kiran succeeds → on the due date USDT arrives in her wallet, nothing to claim.

**Compliance desk**: attest / revoke; revoke Kiran and show his claims are now non-transferable while payouts still arrive.

### 6.2 Booth pitch (Whitechain: "strict timelines within two, three minutes", workshop notes)
- **0:00–0:20 Problem.** "Bandra Beans waits 60 days for a 10,000 USDT catering invoice, and no bank lends against fifty-dollar card sales. Stripe and Shopify solve this with capital repaid from sales, but only inside their walls."
- **0:20–1:10 Operate + Scale, live.** Demo shop: Rahul pays 25 USDT with an email code. The explorer shows one tx: 20% to the investor, 0.10 fee for gas, the rest to the merchant. "The customer never touched gas; the merchant paid 0.10 USDT, and our relayer swaps that to WBT on YetiTrade. Here are the drain limits."
- **1:10–2:10 Tokenize, live.** Invoice → offer on Arkiv with a countdown → Meera (KYC'd via EAS) buys at 1.9% off → transfer to a non-KYC wallet reverts → due date → Lumen's pre-signed payment settles and the USDT lands at Meera in the same tx. A default turns into a 50% holdback on future sales.
- **2:10–2:40 Why on-chain.** "Repayment is enforced where the money arrives. Investors don't trust the merchant to forward funds, any KYC'd WhiteBIT user can fund a café in USDT at 3 a.m., and settlement takes one second. A regular rail can't route one card payment to three parties under rules that neither the merchant nor we can change."
- **2:40–3:00 Ask.** "We'd ship this on mainnet as soon as official USDT is live there (Builders Program)."

### 6.3 Demo video (target 2:45: Whitechain wants 2–4 min, CROPS ≤ 3 min; own voice, ≤20 s backstory)
0:00 problem (15 s) → 0:15 merchant creates an invoice + debtor acknowledges (25 s) → 0:40 lists it, Arkiv offer, private reads chip (20 s) → 1:00 investor buys gaslessly; blocked transfer (30 s) → 1:30 customer checkout in the separate shop, split on the explorer (30 s) → 2:00 due-date settlement lands at the investor, refund, CSV (30 s) → 2:30 gas `/health` + drain guard + close (15 s).

---

## 7. F. 36h plan, cut lines, risks, prior art

### 7.1 Phases (H0 = Thu 21:00 IST; freeze H28 = Sat 01:00; submit by 08:00, deadline 09:00)

| Phase | Clock (IST) | zcode | Claude Code | Exit check (with proof) |
|---|---|---|---|---|
| **P1 Rail proofs** H0–2 | Thu 21:00–23:00 | Foundry init (`prague`); a stub contract calls `receiveWithAuthorization` on real USDT, relayed → **explorer link**; register the EAS schema; attest once | Next skeleton (tsc/lint/build green); **Anon-RPC worker reads `eth_blockNumber` from Ankr through Nym in the browser**; Arkiv 1.0.1 create + query one entity; Privy `signTypedData` on 1874 | 4 links/screenshots, or fallbacks chosen (guest wallet, owner list) |
| **P2 Operate core** H2–8 | Thu 23:00–Fri 05:00 | MerchantPay + M1–M3; relayer v1 (guards 1–3, 5, 6); deploy v0 | customer `/pay/[id]`, merchant invoice create + payments + refund, receipt | Real gasless invoice payment + refund from the UI on the explorer |
| **P3 Tokenize core** H8–14 | Fri 05:00–11:00 | InvestorRegistry + ClaimToken + CapitalMarket (invoice path) + C1–C4, T1, I1; **ABI freeze H14** | compliance desk, investor offer book (Arkiv), buy flow, portfolio, publish offer → Arkiv | Invoice funded by 2 investors and paid by the debtor; USDT reaches both in the pay tx |
| **P4 Advance + lifecycle** H14–20 | Fri 11:00–17:00 | liens/advance (C5), default + recourse (C6), schedule keeper, fee-swap keeper, guards 4, 7–10; deploy v1 + **verify all 4** | advance UI, `apps/shop` 20-line integration + webhooks, CSV, transfer-rule demo, Anon-RPC default everywhere + meter | Shop sale splits to an advance investor; a blocked transfer on the explorer; 100% private-read meter |
| **P5 Integrate + seed** H20–24 | Fri 17:00–21:00 | F1, E1, coverage; fix | seed merchant history and offers; full demo run ×2 | Two clean runs with no manual fixes |
| **P6 Paperwork** H24–28 | Fri 21:00–Sat 01:00 | README contracts/tests section | README per sponsor (tx links), `WHITECHAIN_FEEDBACK.md`, `arkiv/*.md`, CROPS section, `AI_USAGE.md`, 20-line count | opencode reads the README cold and finds every requirement |
| **Freeze** H28 → video H28–35 | Sat 01:00–08:00 | bug fixes only | showcase text | Submitted by 08:00 (Whitechain + Arkiv + EF Anon-RPC & CROPS) |

**Go/no-go checkpoints:** H8 (no gasless payment → stuck rule, ask Whitechain TG), H14 (no funded invoice → cut lines 6–8), H20 (Arkiv 3 failures or ~4h lost → drop the Arkiv track, keep the offer book in the DB, per ARCHITECTURE.md's rule).

### 7.2 Cut lines (cut from the top)
1. P2 Arkiv `merchant` stats entity
2. Email reminders (keep the "overdue" badge + copy-link)
3. Fee-swap automation → one manual swap tx linked in the README
4. Scheduled due-date payment → the debtor pays on the day by hand
5. Default → recourse lien → `markDefault` only freezes and flags
6. Debtor acknowledgement → the merchant's own listing only (weaker; say so)
7. Multiple investors per claim → one investor buys a whole claim (holder cap code stays)
8. EAS → owner list (same `isEligible`)
9. Privy → guest wallet
10. Revenue advance → invoice financing only (last resort: it's our edge over the rival)

**Never cut:** real USDT in the main flow, verified contracts, gasless customer payment, refund, at least one transfer restriction + the maturity/settlement rule shown in the demo, the separate demo shop, a user-facing Arkiv read, Anon-RPC-by-default reads, all required files.

### 7.3 Top risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | A rival invoice-financing stack is on 1874 (§1), plus a T-REX stack | Lead with what they lack: checkout-repaid advances, recourse from sales, gasless parties, EAS KYC, ERC-7943, Arkiv, private reads. Never claim "first" |
| 2 | Scope: 4 contracts + relayer + 2 apps + Arkiv + Anon-RPC | Checkpoints + cut list; ABI freeze H14; one agent per lane (AGENTS.md) |
| 3 | Anon-RPC: latency, 18 MB Nym bundle, demo-only tor gateway, CSP | Multicall per screen, lazy load, Nym default, disclose exclusions; test H0–2 |
| 4 | Log range caps (Ankr <3k blocks, official 10k) | Multicall state reads; Blockscout `/logs` for history; no log scans |
| 5 | Arkiv 1.0.1 drift, 429 hangs, testnet resets | Pin 1.0.1, use the Arkiv skill, timeouts, `friction.md` as we go, drop rule |
| 6 | Embedded wallet on 1874 unverified | H0–2 test; guest-wallet fallback |
| 7 | EAS misuse (`isAttestationValid` ≠ valid) | Explicit field checks + I1 fork test; owner-list fallback |
| 8 | Push payouts DoS (a holder that can't receive), loop gas | Holder cap 8; low-level transfer + `owed` pull fallback; F1 fuzz |
| 9 | Relayer drained or nonce races on serverless | §4.3 guards; serialized sends; separate key; daily budget |
| 10 | USDT is an upgradeable proxy | Fork tests against live USDT before demo; read `DOMAIN_SEPARATOR` at runtime |
| 11 | "Won't place" traps: Operate "revenue splits on their own", Tokenize "a token with a mint button" | Pitch the checkout + lifecycle, not "splits"; show reverts and maturity live |
| 12 | Due dates too long to demo | `LOCK_WINDOW`/`GRACE` as constructor params (60 s/120 s on testnet) |
| 13 | Securities/legal reading of tokenized receivables | Testnet only; README disclaimer; KYC gate is the design, not decoration |
| 14 | One Whitechain prize per project; EF places in one track | Select all three Whitechain tracks; EF: Anon-RPC first, CROPS second |

### 7.4 Prior art and how we differ

| Project | What it is | Difference |
|---|---|---|
| Centrifuge | Tinlake pooled invoice NFTs into DROP/TIN tranches ([docs](https://docs.centrifuge.io/build/tinlake)); V3 vaults use ERC-4626/7540/7575 with share-token transfer hooks ([vaults](https://developer.centrifuge.io/user/concepts/vaults/)) | Institutional pools, off-chain servicing. Ours: repayment captured at the merchant's checkout, per merchant |
| Huma | PayFi financing of settlements, card payments, payroll advances ([docs](https://docs.huma.finance/about-huma/what-is-huma.md)); 2022 RequestNFT receivables with 80% upfront ([Request](https://request.network/blog/request-and-huma-to-make-web3-invoice-factoring-a-reality)) | Closest in spirit. We bundle the payment rail, so collection isn't trusted |
| Credix | Solana credit marketplace, junior/senior tranches, receivables managed off-chain ([docs](https://credix.gitbook.io/tokens/example-deal-senior-junior)) | Lender-level, not merchant-level |
| Goldfinch | Senior pool + backers; KYC "UID" checked as `IERC1155.balanceOf(user, 0) > 0` ([docs](https://docs.goldfinch.finance/goldfinch/goldfinch-v1/unique-identity-uid/for-developers)) | Same allowlist idea; we use EAS on the chain's predeploy |
| Stripe Capital / Shopify Capital | Fixed premium, % of each transaction withheld until repaid ([Stripe](https://docs.stripe.com/capital/how-capital-for-platforms-works), [Shopify](https://help.shopify.com/en/manual/finance/shopify-capital/shopify-capital-glossary)) | Same mechanic, open to any investor, with the rules on-chain |
| ETHGlobal winners | **Finvoice** (Cannes 2026, Hedera Tokenization): private factoring, TEE risk grade ([showcase](https://ethglobal.com/showcase/finvoice-xu0sz)) · **cashmeifyoucan** (NY 2026, Hedera Tokenization): AI agents bid on invoices, World ID ([showcase](https://ethglobal.com/showcase/cashmeifyoucan-qzyzw)) · **Flashflow** (New Delhi, Integra): basketized future income ([showcase](https://ethglobal.com/showcase/flashflow-nd9kx)) · **InnoFi** (Bangkok): lending against invoices ([showcase](https://ethglobal.com/showcase/innofi-wgkvc)) · **DAZU** (SF 2024, ENS 2nd): invoice NFTs sold to LPs ([showcase](https://ethglobal.com/showcase/dazu-jnuds)) | Our local winners dataset (`research/ethglobal_winners_11_events.json`) shows none repaying from a checkout stream or settling in the payment tx. Common weak points in such entries: NFTs with nothing enforced, mock stablecoins, logic in a backend (research agent's reading; no judge comments found) |
| Rival on 1874 | §1 | Covered in risk 1 |

---

## 8. Open questions and unverified items (resolve in P1)
1. Privy `signTypedData` on chain 1874 (docs say any EVM chain).
2. Whether `w.fetch` carries a GET to a non-RPC host (Blockscout), and Arkiv RPC browser CORS.
3. Full pay-path gas (estimate 200–250k) → set the fee from a fork measurement, not this estimate.
4. EAS `getAttestation` gas per transfer check (×2 per transfer).
5. Does the Ankr hacker key (Whitechain2026) raise the `eth_getLogs` cap?
6. Whitechain booth: is one product spanning Operate + Scale + Tokenize judged on its primary track, or on all? Is a customer embedded wallet expected for Scale?
7. Privy client telemetry, for CROPS.
8. Exact README line for "why onchain": *"One customer payment is split, in the same second, between the merchant, the investors who own its invoices or its revenue advance, and the gas relayer, under rules (KYC-only holders, maturity locks, a repayment cap) that neither the merchant nor we can override. A card rail can't route one payment to three parties under rules nobody controls, and it can't let anyone with USDT fund a café at 3 a.m."*

## 9. Sources
- Prize text: https://ethglobal.com/events/mumbai/prizes (verbatim copies: `whitechain_inventory.md` §1; Arkiv/EF text quoted by the research agent from the same page)
- Whitechain: https://docs.whitechain.io/learn/network/network-fees · https://docs.whitechain.io/build/dapps/use-viem · https://www.theblock.co/press-releases/412097/whitechain-relaunches-as-w-groups-distribution-first-ethereum-layer-2 · workshop https://www.youtube.com/live/Xj2H-j1joP8 (notes: `whitechain_workshop_and_anonrpc_test.md`)
- On-chain (read today): https://rpc.testnet.whitechain.io · https://rpc.ankr.com/whitechain_testnet · https://explorer.testnet.whitechain.io/api/v2 (contracts above)
- Standards: https://eips.ethereum.org/EIPS/eip-3643 · https://github.com/ERC-3643/ERC-3643 · https://github.com/TokenySolutions/T-REX · https://github.com/ethereum/EIPs/issues/1411 · https://github.com/Consensys/UniversalToken · https://eips.ethereum.org/EIPS/eip-7540 · https://eips.ethereum.org/EIPS/eip-7943 · https://github.com/xaler5/uRWA · https://docs.openzeppelin.com/contracts/5.x/api/token/erc1155 · https://docs.openzeppelin.com/contracts/5.x/api/token/erc20 · https://github.com/OpenZeppelin/openzeppelin-community-contracts
- EAS: https://raw.githubusercontent.com/ethereum-attestation-service/eas-contracts/master/contracts/IEAS.sol · …/EAS.sol · …/Common.sol · …/SchemaRegistry.sol · https://specs.optimism.io/protocol/predeploys.html · https://github.com/ethereum-attestation-service/eas-indexing-service
- Payments: https://eips.ethereum.org/EIPS/eip-3009 · https://raw.githubusercontent.com/circlefin/stablecoin-evm/master/contracts/v2/EIP3009.sol · https://raw.githubusercontent.com/base/commerce-payments/main/src/collectors/ERC3009PaymentCollector.sol · https://raw.githubusercontent.com/base/commerce-payments/main/docs/TokenCollectors.md · https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/token/ERC20/extensions/IERC20Permit.sol · https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md
- Relayers: https://docs.openzeppelin.com/relayer/1.8.x/configuration · https://docs.gelato.cloud/web3-services/relay/subscriptions-and-payments · https://developers.circle.com/paymaster · https://docs.pimlico.io/references/platform/api/sponsorship-policies/object
- DEX: https://docs.yetitrade.fi/reference/contracts.md · https://docs.yetitrade.fi/guides/swap-from-a-contract.md · https://raw.githubusercontent.com/Uniswap/swap-router-contracts/main/contracts/interfaces/IV3SwapRouter.sol · https://raw.githubusercontent.com/ethereum-optimism/optimism/develop/packages/contracts-bedrock/src/universal/WETH98.sol · https://specs.optimism.io/experimental/custom-gas-token.html
- Wallet: https://docs.privy.io/basics/react/advanced/configuring-evm-networks.md
- Finance: https://corporatefinanceinstitute.com/resources/accounting/accounts-receivable-factoring/ · https://treasurydirect.gov/marketable-securities/understanding-pricing/ · https://www.iotafinance.com/en/Formula-Price-of-a-Discount-Security.html · https://docs.stripe.com/capital/how-capital-for-platforms-works · https://help.shopify.com/en/manual/finance/shopify-capital/shopify-capital-glossary · https://www.nerdwallet.com/business/loans/learn/factor-rate · https://www.nerdwallet.com/business/loans/learn/merchant-cash-advance
- Arkiv: https://registry.npmjs.org/@arkiv-network/sdk · https://raw.githubusercontent.com/Arkiv-Network/arkiv-sdk-js/main/CHANGELOG.md · https://github.com/Arkiv-Network/arkiv-sdk-js · https://github.com/Arkiv-Network/skills · https://docs.arkiv.network/reference/limits/ · https://docs.arkiv.network/writing/expiration/ · https://docs.arkiv.network/guides/react/ · https://docs.arkiv.network/start-here/access-keys/
- Anon-RPC: https://github.com/ethereum/anon-rpc · https://registry.npmjs.org/@anon-rpc/browser-harness · https://raw.githubusercontent.com/ethereum/anon-rpc/main/impl/browser-harness/README.md · https://raw.githubusercontent.com/ethereum/anon-rpc/main/impl/harness-core/src/spec-types.ts · https://raw.githubusercontent.com/ethereum/anon-rpc/main/adopters.json5 · https://raw.githubusercontent.com/ethereum/anon-rpc/main/docs/integrate-wallet.md · https://raw.githubusercontent.com/ethereum/anon-rpc/main/impl/README.md
- Prior art: https://docs.centrifuge.io/build/tinlake · https://developer.centrifuge.io/user/concepts/vaults/ · https://docs.huma.finance/about-huma/what-is-huma.md · https://request.network/blog/request-and-huma-to-make-web3-invoice-factoring-a-reality · https://credix.gitbook.io/tokens/example-deal-senior-junior · https://docs.goldfinch.finance/goldfinch/goldfinch-v1/unique-identity-uid/for-developers · ETHGlobal showcase links in §7.4
