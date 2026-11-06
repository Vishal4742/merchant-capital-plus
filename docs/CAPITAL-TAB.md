# Capital tab build pack (P5)

Written by claude-research's build-pack workflow; every on-chain fact is cited path:line; contracts are frozen.

Code citations point to the snapshot `/Users/vg890/ethglobal-docs` at `2a85902`, which is origin/main and contains `df0e1d4` (PR #20 and PR #21, the voucher Arkiv mirror). "Chain" means a read-only `eth_call` / receipt read against `https://rpc.testnet.whitechain.io` on 2026-11-06 at about 10:28 IST. "agentbus" lines are `~/.agentbus/messages.jsonl` (local). Arkiv SDK citations are `@arkiv-network/sdk` 1.0.1 source (`apps/web/node_modules/@arkiv-network/sdk/src/…`, not in git). OpenZeppelin citations are the pinned submodule commit `cab19933` (not checked out in the snapshot; read from GitHub at that commit).

Anything marked **proposed** is not part of the 08:53 API agreement (agentbus :522). claude-contracts accepts or rejects each proposed item, and each conflict in §3.0, before anyone builds it.

---

## 0. Purpose, owners, status

**Purpose.** One reference that three lanes build the Capital tab from. It runs AT-3 to AT-9 through the UI (`PHASES.md:110`). The G5 gate is the whole demo, AT-1 to AT-15, run twice in a row with no manual fixes (`PHASES.md:117`). §0.1 maps every requirement in scope to a screen, a route and a click-path step.

**Owners.** Two agents never edit the same file; send `CLAIM <path>` on agentbus first (AGENTS.md).

| Lane | Owns | Also claims (small edits) |
|---|---|---|
| claude-frontend | `apps/web/app/capital/**`, `apps/web/components/capital/**`, `apps/web/lib/capital-wallet.ts` (released to it by claude-contracts, agentbus :521); tests in `apps/web/test/ui-capital.test.mjs` | `components/dashboard/Nav.tsx:21` (capital item has no href), `app/merchant/page.tsx:263` ("Capital · Soon"), `lib/merchant-wallet.ts` (listing txs), `next.config.ts` (CSP rule, G10), `components/merchant/Invoices.tsx:271` (Cancel rule, §4 M2) |
| claude-relayer | `apps/web/app/api/v1/capital/**`, `apps/web/lib/server/capital*.ts`, `apps/web/test/capital-*.test.mjs` (new files only; agentbus :586) | **proposed:** `apps/web/lib/capital.ts` (shared pure module, G1). It sits outside both claimed globs and both lanes import it, so it needs its own CLAIM with one owner. |
| claude-contracts | The API shape (agentbus :522, :586). Reviews both lanes against the frozen ABI. Tests in `apps/web/test/abi-capital.test.mjs` (outside the relayer's glob). | `contracts/script/Seed.s.sol` (demo funding, §6 and §8 Q5) |

- The server build already sits with claude-relayer: `PHASES.md:110` records "server moved C→L 09:52", with claude-contracts reviewing the shape.
- **`lib/relay.ts` has two claimants.** This pack's G9 gave `relayFund` to claude-relayer. claude-frontend told claude-research at 10:27 (agentbus) that its batch 024 adds `relayFund` in `lib/relay.ts`. One CLAIM decides (§8 Q21). Whoever adds it also adds the `code` field (G9).
- Test file names: claude-relayer's glob `capital-*.test.mjs` covers any file starting with `capital-`, so the other two lanes use `ui-capital.test.mjs` and `abi-capital.test.mjs`.

**Status:**
- **Contracts are frozen.** "contracts freeze after G4 (human 02:02)" (`docs/SRS.md:6`), and the ABI is frozen (`ARCHITECTURE.md:49`). Use only functions that exist.
- **The relayer's `fund` action is on main.** The allowlist names it (`apps/relayer/src/relayer.ts:51-55`, `:242-247`). `parseFunding` is at `:283-302` and `prepareFunding` at `:305-313`. Not checked here: whether the deployed relayer at `https://merchant-capital-relayer.vercel.app` (`PHASES.md:69`) runs this commit (§8 Q16).
- **No Capital code exists in apps/web yet:**
  - no `app/capital/**`, `components/capital/**`, `api/v1/capital/**`, `lib/server/capital*.ts` or `lib/capital-wallet.ts`
  - no `mcplus.offer.v1` code; the schema exists only in `arkiv/schema.md:23-43`
  - no `isEligible` read, and no CapitalMarket address or ABI in apps/web
  - no injected-wallet typed-data signing: the only `signTypedData` calls use the guest key (`lib/sign-sale.ts:26,43`, `lib/guest-wallet.ts:46`); merchant sign-in uses `signMessage` (`components/merchant/SignIn.tsx:48`)
  - the only Arkiv writes are the voucher mirror (`lib/server/vouchers.ts:151-171`)
- **Live chain state:**
  - `offerCount` = 2, and both offers are settled. Claim 1 is the AT-3 advance, claim 2 the AT-6 invoice (chain `offers(1)`, `offers(2)`).
  - `invoiceCount` = 1. Invoice 1 is Paid, customer `0x518b945A5f16a86065e792A0e5FFec4a27B56D9D` (the script debtor named by `LiveInvoice.s.sol:36-37`), and `claimOfInvoice(1)` = 2 (chain).
  - `advanceOf(merchant)` = 0 (chain), so a new advance can be listed.
  - Demo investors A `0xC2362c3693E185388E5745BadaffAC38184C6752` and B `0xaf747912b20D4fE6df1B88D4993FccBc7002771B` are eligible: chain `isEligible` = true, `expiryOf` = 1796500938 (about 2026-12-05). Set at `contracts/script/DeployPhase3.s.sol:41-42` (addresses `:24-25`, KYC_VALIDITY 30 days `:20`). Both hold 0 USDT and 0 WBT, nonce 0 (chain).
  - Not eligible (chain `isEligible` = false): the script debtor `0x518b…6D9D` and the production guest wallet `0x4f59F7487e8c262530946bcA1e337BFc1FfD8e12` (the payer decoded from the AT-11 tx `0x26139ab9…cf6db`, `README.md:28`).

### 0.1 Coverage

| ID | Screen | Route | Click path | Notes |
|---|---|---|---|---|
| FR-ADV-1 list an advance; cap ≥ principal, holdback ≤ 30% | M1 | POST /publish | AT-3 step 1 | M1 validation mirrors `BadTerms` (`CapitalMarket.sol:107-111`) |
| FR-ADV-2 one active advance | M1 shows the running advance instead of the form | GET /merchant `advance.status` | AT-3 in run 2 (form returns only after Repaid) | contract: `AdvanceActive` (`CapitalMarket.sol:113`) |
| FR-ADV-3 fund by one signature | I1, I2 | POST /fund | AT-3 steps 4-5 | |
| FR-ADV-4 holdback of the gross on later payments | existing checkout; M1 "repaying" | none new | AT-4 | contract: `CapitalMarket.sol:223-231` |
| FR-ADV-5 lien ends at the cap | M1 "repaid" | GET /merchant | AT-5 | contract: `CapitalMarket.sol:349,364-368` |
| FR-ADV-6 total cost before signing | M1 cost line | none | AT-3 step 2 | |
| FR-INV-1 list an invoice below face, deadline before the lock | M2 | POST /publish | AT-6 step 2 | |
| FR-INV-2 price from target APR, both shown | M2 | none (`priceFromApr`, G3) | AT-6 step 2 | |
| FR-INV-3 several investors fund parts | I2 | POST /fund | AT-6 steps 3-4 | |
| FR-INV-4 debtor pays; pro-rata payout and burn; partial payments | existing `/pay/[invoiceId]` | none new | AT-7 | **Partial payments: contract only.** The pay route always pays the whole remainder (`app/api/v1/invoices/[id]/pay/route.ts:58`); the contract allows parts (`MerchantPay.sol:133-134,149`). |
| FR-INV-5 transfers blocked from the lock | I4 `claim_locked` | GET /transfer-check | none (60 s lock, §8 Q14) | contract: `ClaimToken.sol:250-254` |
| FR-TOK-2 both sides eligible | I4 `sender_not_eligible` / `receiver_not_eligible` | GET /transfer-check | AT-8 | |
| FR-TOK-3 at most 8 holders | I2 blocker; I4 `holder_cap` | POST /fund pre-check | none | Relayed repayment gas lowers the practical cap (§8 Q19) |
| FR-TOK-4 frozen claims and amounts can't move | I4 `claim_frozen` / `units_frozen` | GET /transfer-check | none | Contract only: no admin UI sets a freeze |
| FR-TOK-5 admin force and freeze (C) | none | none | none | Done on chain (`PHASES.md:113`); no admin screen |
| FR-TOK-6 ERC-7943 views | none | none | AT-8 verification uses `canTransfer` | Contract only (`ClaimToken.sol:133-159`) |
| FR-TOK-7 revoked investor still repaid | I3 keeps showing holdings and payouts; I4 shows `sender_not_eligible`; I2 blocks buying | none | none | Burns are never blocked (`ClaimToken.sol:178-181`) |
| FR-TOK-8 reason before trying | I4 | GET /transfer-check | AT-8 | |
| FR-ARK-1 open offers on Arkiv, expiring at the deadline | M1, M2, M3 "Publish again" | POST /publish | AT-3 step 3, AT-6 step 2 | |
| FR-ARK-2 offer book and "my live offers" read Arkiv | I1, M3 | GET /offers, GET /merchant | AT-9 | |
| FR-ARK-3 Buy only if Arkiv matches chain | I1 Buy rule | GET /offers `arkiv` | AT-3 step 4, AT-6 step 3 | |
| FR-ARK-4 no personal data | none | POST /publish (§5.1) | AT-9 verify | Debtor wording needs a change request (§8 Q9) |
| FR-ARK-5 status updated on funding | none | POST /fund step 6 | AT-3 step 5, AT-6 step 4 | |
| AT-3 … AT-9 pass criteria | | | §6, each AT's **Verify** list | AT-8 is blocked on §8 Q4 |

---

## 1. Addresses and contract calls per user action

**Chain:** chainId 1874 (`packages/shared/contracts.ts:5`).

**Addresses** (`packages/shared/contracts.ts:5-13`):

| Contract | Address |
|---|---|
| USDT | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |
| MerchantPay | `0xab817593253a0a37de723072827d88fe0ca54251` |
| CapitalMarket | `0xecd63a369d23dfddc6bfac921e41a86760c20abe` |
| ClaimToken | `0xce9b171a5c485a41dced9d7f043733bddc26c388` |
| InvestorRegistry | `0x293430fae87ca79844c6e3a64e8044078c4d3e74` |

**ABIs** (`packages/shared/contracts.ts`): `merchantPayAbi` `:64`, `capitalMarketAbi` `:1066`, `claimTokenAbi` `:1962`, `investorRegistryAbi` `:3094`. apps/web can't import `packages/shared`, so copy the fragments with `parseAbi` (`apps/web/lib/onchain.ts:16-17`).

**Roles:**
- Compliance admin (owner of ClaimToken, InvestorRegistry and MerchantPay): `0xb4E7eDe967E108858DDb5d88B25FDc70723B714D` (chain; short form at `ARCHITECTURE.md:52`).
- Demo merchant: `0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1` (chain `offers(1).merchant`).

**Units and constants:**
- USDT has 6 decimals (`ARCHITECTURE.md:157`).
- 1 claim unit = 0.000001 USDT owed to its holder (`CapitalMarket.sol:24`, `ClaimToken.sol:32`).
- bps are out of 10000 (`CapitalMarket.sol:34`). Times on chain are unix seconds.
- `LOCK_WINDOW` = 60 s (`contracts.ts:21`; `DeployPhase3.s.sol:19`). `relayFee` = 100000, i.e. 0.10 USDT (chain; `MerchantPay.sol:55`). `MAX_HOLDERS` = 8 (`ClaimToken.sol:38`).

Modifiers run before the function body, so `whenNotPaused` and `onlyOwner` errors come first in the lists below.

| Action | Sender | Function + args (units) | Events (in order) | Errors + selectors (in check order) | Cite |
|---|---|---|---|---|---|
| Merchant creates an invoice | Merchant wallet (WBT) | `MerchantPay.createInvoice(address customer, uint128 amount /*6dp, 1e6 ≤ amount ≤ uint96.max−250000*/, uint64 dueDate /*future*/, bytes32 refHash)` → `id`, sel `0x974fee8b`. The UI always passes `customer` = zero address (`lib/merchant-wallet.ts:150`); `customer` is informational (`MerchantPay.sol:41`). | `InvoiceCreated(id, merchant, customer, amount, dueDate, refHash)` | 1. `WrongAmount` 0x49986e73 2. `InvalidDueDate` 0xa1ff8dcd | `MerchantPay.sol:109-119` |
| Merchant lists an advance | Merchant wallet (WBT); `msg.sender` becomes the merchant | `CapitalMarket.listAdvance(uint128 principal /*6dp, = price*/, uint128 cap /*6dp, = face = units*/, uint16 holdbackBps /*1..3000*/, uint64 term /*s; maturity = now+term, not enforced*/, uint64 offerDeadline /*unix s*/)` → `claimId`, sel `0x9f259ed4`. Moves no USDT. | `OfferListed(claimId, merchant, kind=2, invoiceId=0, face=cap, price=principal, bps, offerDeadline, maturity)` | 1. `BadTerms` 0x8dc59921 (principal 0, cap < principal, bps 0 or > 3000, term 0, deadline ≤ now) 2. `AdvanceActive` 0x2e6ac31e (`advanceOf != 0`, which includes an expired unfunded advance) 3. `SafeCastOverflowedUintDowncast` 0x6dfcc650 | `CapitalMarket.sol:33,62-72,103-120,160,367` |
| Merchant lists an invoice | Merchant wallet (WBT) | `CapitalMarket.listInvoice(uint256 invoiceId, uint128 price /*6dp, 0 < price < amount*/, uint64 offerDeadline /*≤ dueDate − 60*/, uint16 recourseBps /*pass 0*/)` → `claimId`, sel `0x35dd6945`; face = invoice amount, maturity = dueDate | `OfferListed(claimId, merchant, kind=1, invoiceId, face=amount, price, bps=recourseBps, offerDeadline, maturity=dueDate)` | 1. `NotMerchant` 0x3b6405f4 (also for a nonexistent invoice) 2. `InvoiceNotListable` 0x91bba2fd (not Open, paid ≠ 0, or already listed) 3. `BadTerms` 0x8dc59921 | `CapitalMarket.sol:122-151` |
| Merchant cancels an unfunded offer | Merchant wallet (WBT) | `CapitalMarket.cancelOffer(uint256 claimId)`, sel `0xef706adf`. Resets `advanceOf` or `claimOfInvoice`. | `OfferCancelled(claimId)` | 1. `NotMerchant` 2. `OfferClosed` 0x1bc36e2d 3. `AlreadyFunded` 0x5adf6387 | `CapitalMarket.sol:154-163` |
| Investor funds (advance or invoice units), gasless | Relayer; the investor only signs (§2) | `CapitalMarket.fundWithAuthorization(uint256 claimId, address investor, uint256 units /*face units, ≤ face−sold*/, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s)`, sel `0x47827929`. Cost = `quote` = ceil(units × price / face). Anyone may submit. | 1. `Funded(claimId, investor, units, cost)` 2. first funding only: `ClaimStateSet(id, lockFrom = maturity−60, false)` for an invoice, or `LienAdded(merchant, claimId, bps)` for an advance 3. USDT `AuthorizationUsed(investor, nonce)` (topic `0x98de5035`) 4. USDT `Transfer` investor → market, then market → merchant 5. `TransferSingle(market, 0, investor, id, units)` | 1. `OfferClosed` (unknown, cancelled, settled, now > deadline) 2. `WrongUnits` 0x427c47e4 3. `MerchantCannotFund` 0x005feb16 4. invoice only: `OfferClosed` if the invoice isn't Open or paid ≠ 0 5. USDT signature, expiry or used-nonce revert (USDT's own strings); `SafeERC20FailedOperation` 0x5274afe7 6. `ERC7943CannotReceive` 0x705c1eed (not eligible) 7. `TooManyHolders` 0xd893fdf8 (9th holder) | `CapitalMarket.sol:74,176-202,249-253,294-321`; `ClaimToken.sol:176-177,227-236`. Event order matches the live fund receipts `0x6b346413…ab3c` and `0x8d4958eb…6810` (chain). |
| Customer sale (repays an advance) | Relayer; the customer signs (existing checkout) | `MerchantPay.paySale(merchant, orderRef, from, amount, validAfter, validBefore, salt, v, r, s)`, sel `0x96d2584e`. The fee is inside the price. Lien = min(gross × bps/10000, outstanding, net). | USDT `AuthorizationUsed`, `Transfer`s; `Distributed(claimId, paymentId, amount, outstanding)`; `Settled(claimId)` when it reaches 0; `TransferSingle` burns; USDT pushes or `PushFailed`; then `Paid(paymentId, merchant, payer, invoiceId=0, orderRef, gross, fee, toInvestors, toMerchant)` | 1. `EnforcedPause` 0xd93c0665 2. `InvalidOrder` 0xaf610693 3. `WrongAmount` 0x49986e73 4. `OrderPaid` 0xa6c8e7e0 5. USDT `receiveWithAuthorization` revert | `MerchantPay.sol:163-187,241-245,268-269,295`; `CapitalMarket.sol:223-231,329-369` |
| Debtor pays an invoice | Relayer; the payer signs on the existing `/pay/[invoiceId]`, which uses the **browser's guest key** (`components/InvoicePay.tsx:84-85` → `lib/sign-sale.ts:38-44`) | `MerchantPay.payInvoice(id, from, amount, validAfter, validBefore, salt, v, r, s)`, sel `0xcdb71426`. Signed value = amount + relayFee. Holders get min(net, outstanding) first. | Same as a sale; `Paid.invoiceId` = id and **`Paid.gross` = amount + relayFee** (`MerchantPay.sol:156,158,295`) | 1. `EnforcedPause` 2. `InvoiceNotOpen` 0x094311f1 3. `WrongAmount` 4. USDT `receiveWithAuthorization` revert | `MerchantPay.sol:135-159,247-249,268-269,284-295`; `CapitalMarket.sol:213-233` |
| Investor transfers a claim | Holder wallet (WBT; the relayer has no transfer action) | ERC-1155 `safeTransferFrom(from, to, id, value, data)`, sel `0xf242432a` | `TransferSingle(operator, from, to, id, value)` | In order: `ERC1155MissingApprovalForAll` 0xe237d922; `ERC1155InvalidReceiver(0)` 0x57f447ce, then `ERC1155InvalidSender(0)` 0x01a83514; `ERC7943CannotTransfer` 0x869d0e66 (claim frozen, or now ≥ lockFrom); `ERC7943CannotSend` 0x45bae9e2; `ERC7943CannotReceive` 0x705c1eed; `ERC7943InsufficientUnfrozenBalance` 0x7ce5d37b; `ERC1155InsufficientBalance` 0x03dee4c5; `TooManyHolders` 0xd893fdf8; a receiver contract that rejects gives `ERC1155InvalidReceiver(to)` 0x57f447ce for a wrong return value or an empty revert, or **its own revert data** otherwise | `ClaimToken.sol:174-266`; OZ `ERC1155.sol:99-101,117-120,237-245` and `ERC1155Utils.sol:25-46` at `cab19933`; `relayer.ts:51-55,242-243` |
| Holder withdraws a failed push | Holder wallet (WBT) | `CapitalMarket.withdrawOwed()`, sel `0x39a72c5c` | `OwedWithdrawn(holder, amount)` | `NothingOwed` 0x797dba54 | `CapitalMarket.sol:237-244` |
| Admin sets eligibility | Admin (owner) | `InvestorRegistry.setEligible(address investor, uint64 expiry /*0 removes*/)`, sel `0xd8568bec` | `EligibilitySet(investor, expiry)` | 1. `OwnableUnauthorizedAccount` 0x118cdaa7 2. `ZeroAddress` 0xd92e233d | `InvestorRegistry.sol:26-30` |
| Admin partial freeze / force transfer (FR-TOK-5, priority C) | Admin (owner) | `ClaimToken.setFrozenTokens(account, id, amount)` sel `0xbd456f5c`; `forcedTransfer(from, to, id, amount)` sel `0x18d308d0`. No admin whole-claim freeze exists (`setClaimState` is market-only, `ClaimToken.sol:93`). | `Frozen(account, id, amount)`; `TransferSingle`, then `ForcedTransfer(from, to, id, amount)` | setFrozenTokens: `OwnableUnauthorizedAccount`. forcedTransfer: 1. `OwnableUnauthorizedAccount` 2. `ERC1155InvalidSender(0)` 3. `ERC1155InvalidReceiver(0)` 4. `ERC7943CannotReceive` 5. `ERC1155InsufficientBalance` / `TooManyHolders` | `ClaimToken.sol:108-128` |

**Views the UI reads:**

CapitalMarket:
- `offers(claimId)` returns `(uint8 kind /*1 invoice, 2 advance*/, address merchant, uint64 offerDeadline, uint16 bps, bool cancelled, bool settled, uint256 invoiceId, uint128 face, uint128 price, uint64 maturity, uint128 sold)` (`CapitalMarket.sol:37-49,56`)
- `offerCount` (`:55`, ids start at 1, per market deployment)
- `quote` (`:249-253`, 0 for an unknown claim) and `fundingNonce` (`:255-261`)
- `outstanding` = `totalSupply(id)` (`:263-265`)
- `advanceOf` (`:58`), `claimOfInvoice` (`:57`), `isFinanced` (`:284-287`), `liensOf` (`:268-273`), `owed` (`:59`)

ClaimToken:
- `balanceOf(address,uint256)`, `balanceOfBatch`, `holdersOf` (`:99-101`, `:165-167`)
- `claimState(id)` returns `(uint64 lockFrom, bool frozen)` (`:48`)
- `getFrozenTokens` (`:145-147`), `canSend` / `canReceive` / `canTransfer` (`:133-155`)

InvestorRegistry: `isEligible` (`:20-23`), `expiryOf` (`:13`).

MerchantPay: `invoices(id)` returns `(merchant, dueDate, status 0 None / 1 Open / 2 Paid / 3 Cancelled, customer, amount, paid)` (`MerchantPay.sol:30-44,59`), `invoiceCount` (`:57`, ids from `++invoiceCount` at `:116`) and `relayFee` (`:55`).

USDT: `balanceOf` and `authorizationState(authorizer, nonce)` (`relayer.ts:59-62`).

---

## 2. What each wallet signs, and who pays gas

### 2.1 Investor: fund authorization (EIP-3009 `ReceiveWithAuthorization`)

```ts
domain = { name: "Tether USD", version: "1", chainId: 1874,
           verifyingContract: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" }   // the USDT contract, not CapitalMarket
types  = { ReceiveWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] }
primaryType = "ReceiveWithAuthorization"
```

Sources: `packages/shared/contracts.ts:23-46`. The web copy is identical (`apps/web/lib/usdt.ts:5,10,12-21`).

| Field | Value | Where it comes from |
|---|---|---|
| `from` | the investor's address | the connected browser wallet, re-read with `eth_accounts` right before signing (§4 I0) |
| `to` | CapitalMarket `0xecd63a369d23dfddc6bfac921e41a86760c20abe` | `contracts.ts:10,35` |
| `value` | `quote(claimId, units)` = `ceil(units × price / face)`, 0 if face = 0 | **Read from the contract** in the I2 browser multicall, not from local math (`docs/FRONTEND-PLAN.md:83-84`; `CapitalMarket.sol:249-253`). The local `quoteUnits` is only the estimate shown while typing. The relayer and the contract recompute it from chain (`relayer.ts:305-313`, `CapitalMarket.sol:187-199`). Vectors (chain): `quote(2, 60e6)` = 58839334, `quote(2, 40e6)` = 39226223, `quote(1, 11e6)` = 10000000. |
| `validAfter` | **must be `0`** | `lib/relay.ts:61` always sends `validAfter: "0"`. A non-zero signed value would not match, so the route accepts only `"0"` (G2). |
| `validBefore` | now + `SIGNATURE_WINDOW_S` (465 s) | `lib/pay.ts:15`. The relayer accepts `[now+30, now+900]`: it refuses `< now+30` (`relayer.ts:38,110,323`) and `> now+900` (`:37,324`). `parseApproval` is stricter at `(now+30, now+900]` (`lib/pay.ts:76-85`, check `:83`). |
| `nonce` | `fundingNonce(claimId, investor, units, salt)` = `keccak256(abi.encode(uint256 chainid, address market, uint256 claimId, address investor, uint256 units, bytes32 salt))` | `CapitalMarket.sol:255-261`. Test vector (chain): `fundingNonce(2, A, 60000000, 0x00…01)` = `0x91151ff3e6e3cc466bac44d1d58ab1e22b3b4de6a7255cea6d25e95d9f571878`. |
| `salt` | 32 random bytes | Same pattern as `freshSalt` in `lib/sign-sale.ts:11` (not exported; copy or export it). |

- **Wallet call:** `walletClient.signTypedData({ account, domain, types, primaryType, message })`. This path does not exist yet and has never been run with MetaMask on 1874 (§8 Q2).
- **Chain switch first:** switch the wallet to 1874 before signing, since MetaMask refuses `signTypedData_v4` when the domain chainId isn't the active chain. The switch/add-on-4902 code is at `lib/merchant-wallet.ts:124-129`.
- **What it costs:** nothing; it is a signature with no gas (CON-4, `docs/SRS.md:70`).
- **Money movement:** the USDT goes straight to the merchant (`CapitalMarket.sol:200`). There is no relay fee on funding, so the relayer refuses a funding below 1 USDT (`relayer.ts:54`, check `:326`).

### 2.2 Signatures that already exist (no new work)

| Who | What | value / to / nonce | Code |
|---|---|---|---|
| Customer (checkout sale, AT-4/AT-5) | `ReceiveWithAuthorization`, guest key | `amount` (fee inside) / MerchantPay / `saleNonce(merchant, orderRef, amount, salt)` | `MerchantPay.sol:241-245`; `lib/pay.ts:46,62`; `lib/sign-sale.ts:22-28` |
| Invoice payer (AT-7) | `ReceiveWithAuthorization`, **guest key of the browser that opens `/pay`**, not the seeded debtor | `amount + relayFee` / MerchantPay / `invoiceNonce(id, amount, salt)` | `MerchantPay.sol:247-249`; `lib/pay.ts:49,65`; `lib/sign-sale.ts:37-45`; `lib/guest-wallet.ts:11-25` (random key in localStorage) |
| Merchant sign-in | SIWE message, chain 1874, 5-min expiry; sets the `mc_session` cookie (8 h) | n/a | `components/merchant/SignIn.tsx:25-58`; `lib/auth.ts:8-10,29-99` |

The guest key is per origin (`app/api/demo-checkout/route.ts:15-16`), so one browser profile pays every customer and invoice step of a run (§6 rate limits).

**Merchants have no typed data for listing.** `listAdvance`, `listInvoice`, `cancelOffer` and `createInvoice` use `msg.sender`. There is no signature variant and no ERC-2771 forwarder (`CapitalMarket.sol:113,117,134,156`; `MerchantPay.sol:117`).

### 2.3 Who pays gas

| Action | Gas payer | Measured gas (5 gwei) |
|---|---|---|
| createInvoice | Merchant (WBT) | 115,199 ≈ 0.00058 WBT |
| listAdvance | Merchant (WBT) | 142,959 ≈ 0.00072 WBT |
| listInvoice | Merchant (WBT) | 159,276 ≈ 0.00080 WBT |
| cancelOffer | Merchant (WBT) | not measured |
| fundWithAuthorization | Relayer hot wallet (cap 400k gas at 6 gwei, `relayer.ts:30-36`) | 238,514 (advance, first fund); 275,623 (invoice, first fund, with `ClaimStateSet`); 200,239 (second fund) ≈ 0.0010–0.0014 WBT |
| paySale / payInvoice | Relayer (fee 0.10 USDT to `feeRecipient`) | 190k–274k for sales (LiveAdvance); payInvoice with 2 holders 277,255 |
| safeTransferFrom / withdrawOwed | Holder (WBT); conflicts with CON-4 (§8 Q4) | not measured |
| Arkiv create/patch | Web server's Arkiv key (Rabdi, chain 7794095) | `arkiv/schema.md:3`; `ARCHITECTURE.md:141,161` |

Gas figures come from `contracts/broadcast/LiveAdvance.s.sol/1874/run-latest.json`, `contracts/broadcast/LiveInvoice.s.sol/1874/fund-latest.json` and `…/pay-latest.json` (effectiveGasPrice 5,000,000,001).

**WBT on hand (chain):** relayer `0xdd02…a651` 0.490402 WBT, with a 0.1 WBT daily budget per process (`relayer.ts:40`); merchant 0.013079 WBT; deployer 0.180110 WBT; A, B and the script debtor 0 WBT.

**WBT per run (estimate from the figures above):** relayer about 0.015 WBT (about 9 relayed payments plus 3 funds); merchant about 0.004 WBT (two createInvoice, one listAdvance, two listInvoice, plus the AT-2 refund). The merchant's 0.013 WBT covers about 3 runs; Seed tops it to 0.02 (`contracts/script/Seed.s.sol:25`).

---

## 3. Server API

### 3.0 Decisions for claude-contracts (conflicts with the 08:53 note)

These change the agreed shape or wording, so they are not conventions. claude-contracts decides each one on agentbus before either lane builds against it.

| # | Conflict | Recommendation |
|---|---|---|
| D1 | **Amount and time encoding.** 08:53 says "plain USDT decimal strings" (agentbus :522). The codebase's API form is `plainUsdt` "1234.50" (`lib/usdt.ts:35-36`), used across lanes ("one API amount format across lanes", `app/api/v1/payments/route.ts:12`); `usdtField` parses "25.00" (`lib/server/http.ts:63-74`). The draft of this pack used 6-dp base-unit strings; if one lane builds from that and the other from 08:53, every amount is off by 10^6. | Keep `plainUsdt` strings for every USDT figure (`cost`, `price`, `face`, `principal`, `cap`, `outstanding`, `units_left`). `units` in POST /fund is also a plain USDT string, since 1 unit = 0.000001 USDT; the route parses it with `parseUsdt` (exact to 6 dp, `lib/usdt.ts:24-27`). Response timestamps are ISO strings, as the gateway API does (`lib/server/vouchers.ts:85,94`). `valid_before` in POST /fund stays a unix-seconds decimal string because it is the signed uint256 (same as the pay routes, `lib/pay.ts:81`). The bigint vectors in §7 test the pure functions; the route layer converts. |
| D2 | **`matches` is terms only.** 08:53 defines it as "every Arkiv term equals the chain" and keeps expiry and cancellation separate. | `matches` compares terms only (§5.4); liveness lives in `status`. `aprBps` and `remainingUsdt` are not compared (derived or mutable), which deviates from "every term". |
| D3 | **The browser can't check matches without the entity.** | GET /offers adds `arkiv.terms`, the entity's raw values (§3.1). Top-level fields are chain values. |
| D4 | **FR-ARK-4 says "debtor identity hashed"** (`docs/SRS.md:172`; `arkiv/schema.md:39,41`). | Omit the debtor (§8 Q9) through a change request to claude-research (SRS change control, `docs/SRS.md:9`). |
| D5 | **New server-side chain reads** fall outside the FR-PRIV-4 exclusion list (`docs/SRS.md:182`). | Disclose them (§8 Q6). |

**Conventions (proposed):**
- Addresses are checksummed. Errors are `{error: "<one plain sentence>"}` from the `fail`/`ok` helpers (`lib/server/http.ts:26-27`).
- Every POST is rate-limited with `rateLimit` + `clientIp` (`http.ts:129-137,143`).
- Every Arkiv error goes through `redactArkivError(err, process.env.ARKIV_ACCESS_KEY)` (`lib/arkiv.ts:31-35`).

### 3.1 `GET /api/v1/capital/offers` (public)

**Response:**
```
{ offers: [ { id, kind: "advance"|"invoice", merchant, merchant_name, face, price, principal?, cap?, holdback_pct,
              maturity, offer_deadline, units_left, status: "open"|"funded"|"closed",
              arkiv: { entity_key, matches, terms: { $owner, chainId, market, claimId, kind, merchant, faceUsdt,
                       priceUsdt, maturity, deadline, holdbackBps, invoiceId, recourseBps } } } ] }
```
`arkiv.terms` is **proposed** (D3). Every top-level field is the chain value from `offers(id)`.

**How the server builds it:**
1. Query Arkiv for the offer book (§5.3), with a short timeout (about 5 s) and the last good result cached per instance (§5.3).
2. Make one multicall of `offers(id)` for every returned `claimId`, plus `invoices(invoiceId)` for invoice offers.
3. Leave out expired (`now > offer_deadline`) and cancelled offers (AT-9, `docs/SRS.md:259`).
4. `units_left` = `face − sold` (`CapitalMarket.sol:24`).
5. `matches` = `offerMatches(terms, chainOffer)` (§5.4).
6. Log Arkiv's `QueryResult.skipped` count (`sdk/src/query/queryResult.ts:30-39`).

**Field definitions (proposed clarification):**
- Always send `face` and `price` with their chain meaning, so one formula prices both kinds: `quote = ceil(units × price / face)`. For an advance, `principal` = `price` and `cap` = `face` are extra labels. Without this, `principal|face` can be read two ways.
- `holdback_pct` = `bps / 100`, and 0 for an invoice, whose `bps` is recourse (`CapitalMarket.sol:41`).
- `status` comes from chain: `open` when `!cancelled && !settled && now ≤ offerDeadline && sold < face` and, for an invoice, `invoices(invoiceId).status == 1 && paid == 0` (`CapitalMarket.sol:299-310`). Because the book query keeps only entities with `status == "open"` (§5.3) and step 3 drops expired offers, `funded` (sold == face) and `closed` (settled, or invoice not Open) appear only for a **stale entity** whose Arkiv patch failed (§3.6 step 6).
- `merchant_name`: `merchantName(merchant)` (`lib/server/http.ts:113-118`): the configured shop name for the demo merchant, otherwise the short address. Never invent a name.

### 3.2 `POST /api/v1/capital/offers/{id}/publish` (dashboard cookie; caller must be that offer's merchant)

**Request:** empty body. **Response:** `{entity_key}`.

1. `signedInMerchant()` (`http.ts:42-47`). No session gives 401.
2. Read `offers(id)` on chain. Build the entity from chain values only, never from the body (FR-ARK-1, FR-ARK-4).
3. If `offer.merchant` isn't the session's merchant, return 404, as voucher publish does (`lib/server/vouchers.ts:187-189`).
4. If the offer is cancelled, settled, past its deadline, or its deadline is more than `MAX_OFFER_DAYS` = 180 days ahead, return 409. One constant in `lib/capital.ts`, used by M1, M2, this route and §7 test 6; it stays under Arkiv's maximum lifetime of 7,884,000 blocks, about 182.5 days (`sdk/src/consts.ts:3,9`).
5. Make it idempotent and serialized:
   - Hold an in-process lock per `claimId` for the whole step, the same pattern as the invoice lock (`lib/sessions.ts:116,119`; used at `app/api/v1/invoices/[id]/pay/route.ts:66-67`). `ponytail:` per instance; two instances could still race, so the lookup below is the real guard.
   - Query Arkiv for `eq("chainId", u64(1874))`, `eq("market", addr(CAPITAL_MARKET))`, `eq("claimId", u64(id))` + `ownedBy(WRITER)`. claimId restarts at 1 on every new CapitalMarket (`CapitalMarket.sol:55,115`), so the chain and market filters keep an older market's entity out.
   - If an entity is found, `patchEntity` its `status` and `remainingUsdt` (a patch never changes expiry, `sdk/src/actions/wallet/patchEntity.ts:45`).
   - Otherwise `createEntity(Offer, values, { expiration: ExpirationTime.atDate(new Date(deadline*1000)) })` (`sdk/src/utils/expirationTime.ts:155-160`).
6. The frontend calls it right after the `listAdvance`/`listInvoice` receipt. M3 shows "Publish again" for offers on chain but not on Arkiv (G4). Record the returned `entity_key` so AT-9 can show the throwaway offer existed (§6 AT-9).

### 3.3 `GET /api/v1/capital/quote?claim=&units=` (public)

**Response:** `{cost}` = `CapitalMarket.quote(claim, units)`. The I2 panel may use this or its own browser multicall; either way the signed value comes from the contract (§2.1).

### 3.4 `GET /api/v1/capital/transfer-check?from=&to=&claim=&amount=` (public)

**Response:** `{allowed, reason|null}`, in the contract's own check order (FR-TOK-8, AT-8 UI half).

This route sends the investor's address and the counterparty to our server and on to its RPC (Ankr, `lib/onchain.ts:10`), so it goes on the FR-PRIV-4 list (§8 Q6).

**Proposed implementation:**
1. Parse the query. Reject `amount == 0` and `to == 0x0` (`zero_address`).
2. Run one `eth_call` simulation of `ClaimToken.safeTransferFrom(from, to, claim, amount, "0x")` with `account: from`. A simulation costs no gas, and it reverts with the first failing check in the contract's order (`ClaimToken.sol:174-214`). With `account: from` the operator is the owner, so the approval check passes (OZ `ERC1155.sol:117-120`).
3. Decode the error with the ClaimToken ABI errors.
4. Only for `ERC7943CannotTransfer`, also read `claimState(claim)` to tell a frozen claim (`frozen`) from a locked one (`lockFrom != 0 && now >= lockFrom`). Both revert with the same error (`ClaimToken.sol:199,250-254`).

`canTransfer` returns only a bool and skips the approval and zero-address checks (`ClaimToken.sol:152-155`), so it can't give the reason.

**Reason codes (proposed):**

| Order | `reason` | Error |
|---|---|---|
| 1 | `zero_address` | `ERC1155InvalidReceiver(0)` |
| 2 | `claim_frozen` | `ERC7943CannotTransfer` + `frozen` |
| 3 | `claim_locked` | `ERC7943CannotTransfer` + lock reached |
| 4 | `sender_not_eligible` | `ERC7943CannotSend` |
| 5 | `receiver_not_eligible` | `ERC7943CannotReceive` |
| 6 | `units_frozen` | `ERC7943InsufficientUnfrozenBalance` |
| 7 | `insufficient_balance` | `ERC1155InsufficientBalance` |
| 8 | `holder_cap` | `TooManyHolders` |
| 9 | `receiver_rejects` | `ERC1155InvalidReceiver(to)`, or any undecodable revert from a receiver contract (it can bubble its own revert data, OZ `ERC1155Utils.sol:39-46`) |

Proposed extra response field: `error` (the decoded error name, e.g. `"ERC7943CannotReceive"`), which is the dry-run evidence for AT-8.

### 3.5 `GET /api/v1/capital/merchant` (cookie)

**Agreed response:** `{advance: {claim_id, outstanding, cap, holdback_pct} | null, offers: [...]}` (FR-ARK-2 "my live offers").

**Proposed additions:**
- `advance.status` (`open` | `expired` | `repaying` | `repaid`), plus `principal`, `sold` and `offer_deadline`.
  - `advanceOf` resets to 0 on `Settled` (`CapitalMarket.sol:364-369`), so with the agreed shape a repaid advance reads `null`. AT-5's "Repaid, sales go 100% to you" can't be shown that way.
  - The server multicalls `offers(1..offerCount)`, filters by merchant, and returns the newest advance even when settled. `ponytail:` O(offerCount) reads, fine at 2 offers; switch to an index if the book grows.
  - An unfunded advance past its deadline still blocks a new listing (`CapitalMarket.sol:113,160`). `expired` lets M1 show "Cancel it to list a new one".
- `unpublished: [claim_id]`: this merchant's open chain offers with no Arkiv entity, from the same multicall plus the Arkiv query. They drive "Publish again".
- `listable_invoices: [{invoice_id, amount, due_date}]`: Open, `paid == 0`, `claimOfInvoice == 0`.
  - Build it from a multicall of `invoices(1..invoiceCount)` filtered by merchant (`MerchantPay.sol:57,116`), plus `claimOfInvoice` for each. `ponytail:` O(invoiceCount) (1 today, chain).
  - Don't use `merchantInvoices` (`lib/onchain.ts:161-189`): it takes ids from Blockscout's log index, so an invoice created a moment earlier may not be listed yet.
  - The Invoices create-success view can also link straight to `/capital/merchant?invoice=<id>` with the id from the `createInvoice` receipt (`lib/merchant-wallet.ts:148-155`).
- Each entry in `offers[]` gets `arkiv_status: "on_arkiv" | "not_on_arkiv"`, the voucher pattern (`lib/server/vouchers.ts:90`).

### 3.6 `POST /api/v1/capital/fund` (no cookie; the signature is the authority)

**Request:** `{claim_id, investor, units, valid_after, valid_before, salt, sig}`. **Response:** `{tx_hash, block_number}`. Errors are plain sentences.

**Route steps:**
1. **Parse.** Map the snake_case fields onto `parseApproval({from: investor, salt, signature: sig, validBefore: valid_before})` (`lib/pay.ts:76-85`). `claim_id` is a uint256 decimal string; `units` is parsed per D1 and must be > 0. **`valid_after` must be `"0"`** (G2).
2. **Read in one multicall:** `offers(claim_id)`, `quote(claim_id, units)`, `fundingNonce(claim_id, investor, units, salt)`, the investor's USDT `balanceOf`. Recompute the typed data and run `verifyTypedData`. A wrong signer gets 400 before the relayer is called, the same shape as the invoice route (`app/api/v1/invoices/[id]/pay/route.ts:47-64`). Refuse cost < 1 USDT and balance < cost here too.
3. **Simulate** `fundWithAuthorization(...)` with v = yParity + 27 (`relayer.ts:296`). Anyone may submit it (`CapitalMarket.sol:174-175`). Decode with the CapitalMarket and ClaimToken errors and map each to investor copy:
   - `OfferClosed`: "This offer is closed."
   - `WrongUnits`: "Only N units are left."
   - `MerchantCannotFund`: "A shop can't fund its own offer."
   - `ERC7943CannotReceive`: "This wallet isn't approved to invest yet."
   - `TooManyHolders`: "This offer already has 8 investors."
   - USDT balance or signature revert: plain copy.

   Why: the relayer returns every CapitalMarket revert as an undecoded `would_revert` (`relayer.ts:222-231`), and a mined revert bans the investor for the life of the relayer process and counts one of the three reverts that open the breaker (`relayer.ts:44,146,156-157,172-173`).
4. **Relay** with `relayFund` (G9), which returns the relayer's `code`. Map the results:
   - 422 `insufficient_funds`: "This wallet doesn't hold enough test USDT for this." Not `NOT_FUNDED`, which is customer copy (`lib/outcome.ts:11`).
   - 422 `below_minimum`: "The smallest buy is 1 USDT." (`relayer.ts:326`)
   - 422 other codes: "That approval didn't work. Nothing was charged; please try again."
   - 503/429: `BUSY` (`lib/relay.ts:34,86-87`)
   - 5xx or a 200 without a `txHash`: unknown outcome, "Don't fund again" (G11).
5. **Confirm** with `getTransactionReceipt(tx_hash)` and decode `Funded(claimId, investor, units, cost)` (`CapitalMarket.sol:74`). The relayer returns `paymentId` only from a `Paid` log, so a fund has none (`relayer.ts:449-451`).
6. **Patch Arkiv** `status` / `remainingUsdt` (FR-ARK-5). If the patch fails, still return 200: the money moved and the chain join corrects `units_left` and `status`. Log the redacted error.

### 3.7 Gaps (all proposed)

| # | Gap | Proposal | Owner |
|---|---|---|---|
| G1 | No CapitalMarket, ClaimToken or InvestorRegistry address or ABI in apps/web; browser and server need the same math | `apps/web/lib/capital.ts`: pure, client-safe, no `server-only`. Holds the addresses, `MAX_OFFER_DAYS`, `parseAbi` fragments and the pure helpers `quoteUnits`, `fundingNonce`, `fundingAuthorization`, `priceFromApr`, `aprFromPrice`, `offerMatches`, `offerStatus`, `REASON_COPY`. Fragments, with their lines in `packages/shared/contracts.ts`: CapitalMarket `offers` :1459, `quote` :1605, `fundingNonce` :1264, `listAdvance` :1360, `listInvoice` :1399, `cancelOffer` :1148, `advanceOf` :1129, `claimOfInvoice` :1161, `isFinanced` :1322, `offerCount` :1446, `outstanding` :1567, `owed` :1586, `fundWithAuthorization` :1211, `Funded`; ClaimToken `balanceOf(address,uint256)` :2019, `balanceOfBatch` :2043, `canTransfer` :2128, `claimState` :2162, `getFrozenTokens` :2239, `holdersOf` :2263, `safeTransferFrom` :2421 + errors; InvestorRegistry `isEligible` :3134; MerchantPay `invoices` :244, `invoiceCount` :202 (today only in the server-only `lib/onchain.ts:1,21`); USDT `balanceOf(address)` (as `lib/merchant-wallet.ts:42`). | Needs one owner by CLAIM (§0); claude-contracts reviews the selectors |
| G2 | `valid_after` is in the 08:53 shape, but `lib/relay.ts:61` hard-codes `"0"` | Accept only `"0"` (400 otherwise), or drop the field | claude-relayer |
| G3 | Invoice price from target APR (FR-INV-2) | `priceFromApr(face, aprBps, days)` = `floor(face × 31_536_000 × 10000 / (31_536_000 × 10000 + aprBps × days × 86400))`. **`days` = IST calendar days from today to the due date.** The invoices UI sets `dueDate` to 23:59:59 IST of the chosen day (`components/merchant/Invoices.tsx:167`), so `ceil(seconds/86400)` would price a "60 days" invoice at 61 days. Computed: 60 days gives 98065556 (matches chain `offers(2).price` and `LiveInvoice.s.sol:24`), 61 days gives 98033949 (A would pay 58.820370, failing AT-6). Show "N days" next to the APR. Must stay < face (`CapitalMarket.sol:138`). | in `lib/capital.ts` |
| G4 | Publish can fail after the listing tx is mined, and then the offer is missing from the book | `unpublished` in GET /merchant (3.5) and an M3 "Publish again" button. No DB table: Arkiv itself is the record. | claude-relayer / claude-frontend |
| G5 | GET /merchant can't show a repaid advance (AT-5) or an expired one | `advance.status` and newest advance (3.5) | claude-relayer |
| G6 | Holdings (I3) | **No route, one browser multicall.** The page's server data passes `offerCount` (a public counter; disclosed per §8 Q6). The browser then makes one Anon-RPC multicall for ids 1..n: `balanceOfBatch(investor × n)`, `offers`, `outstanding`, `claimState`, `getFrozenTokens(investor, id)`, plus `owed(investor)`. One batched read per screen (NFR-5, `docs/SRS.md:211`); these count on the meter (AT-9). `ponytail:` O(offerCount). | claude-frontend |
| G7 | Eligibility before signing (I0) | **No route.** Add `isEligible(investor)`, USDT `balanceOf`, `holdersOf(claim)` and `balanceOf(investor, claim)` to the book's browser multicall. | claude-frontend |
| G8 | Investor sign-in: none exists (no role in `mc_session`, `lib/auth.ts:8-10`) | **None needed.** The fund signature authorizes the payment; holdings are public chain reads by address. | none |
| G9 | `relay()` is private, typed `"paySale" \| "payInvoice"` (`lib/relay.ts:60`), drops the relayer's `code` (`RelayResult`, `:27-31`), maps 422 `insufficient_funds` to customer copy (`:81`) and folds every other 422 into one sentence (`:83`). The relayer sends `{error, code}` (`relayer.ts:105`). | Widen the action type; add `code` (and the HTTP status) to the failure branch of `RelayResult`; make the 422 mapping per action, or return the code and let the fund route map it (§3.6 step 4). `export const relayFund = (f) => relay(f, "fund", { claimId: f.claimId.toString(), investor: f.from, units: f.units.toString() })` (target values are strings, `:60`). `relay()` always adds `from` and `amount` (`:61`) and `Signed.amount` is a required bigint (`:11`), so pass `amount` = the quote; the relayer's fund parser ignores both (`relayer.ts:283-298`). `relayAuth` and `redirect: "manual"` stay as they are (`:52-58,69`). | One owner by CLAIM (§8 Q21) |
| G10 | `/capital` has no CSP (`next.config.ts:35-63`) | Add `{ source: "/capital/:path*", headers: merchantCsp }` (`merchantCsp` `:29-34` carries the Nym hosts, `'wasm-unsafe-eval' blob:` and `worker-src blob:`). Don't copy the strict pay-page policy (`:7-18`) as `/merchant/developers` does (`:60`): the Nym worker would not boot and AT-9's meter would show only plain reads. Add a test that `headers()` gives `/capital` and `/capital/merchant` the merchant policy. Ask claude-research to update the README CSP line (`README.md:39`, "on `/merchant` pages"). | claude-frontend |
| G11 | Investor-facing outcome copy | Funding variants of `UNKNOWN` / `NOT_FUNDED`: "We couldn't confirm this yet. Don't fund again; check Holdings in a few minutes." and "This wallet doesn't hold enough test USDT for this." (no faucet, CON-8) | with G9 |
| G12 | Arkiv is on the Buy path of AT-3 and AT-6, not only AT-9 | GET /offers uses a short Arkiv timeout (about 5 s, against the 30 s client default, `lib/arkiv.ts:8`) and serves the last good entity list when Arkiv is slow. Safe because an entity's terms never change on chain once listed, and liveness comes from the chain join. `ponytail:` per-instance memory. | claude-relayer |

---

## 4. Screens and states per role

**Proposed routes (claude-frontend):**
- `/capital`: offer book with a fund panel per offer (investor, public)
- `/capital/holdings`: holdings and transfer check (investor)
- `/capital/merchant`: M1, M2 and M3 (merchant cookie; shop wallet only, as `app/merchant/page.tsx:192,276`)

Point Nav's capital item at `/capital/merchant` (`Nav.tsx:21,58-62`). Pages link with plain `<a>` (`Nav.tsx:1-2`).

**Every screen has five states:** empty, loading, error, pending, done.

**Copy and layout rules:**
- Merchant pages:
  - WBT may appear, always with `WBT_HINT` and 6 decimals (`lib/dashboard.ts:107-116`).
  - An unread figure shows "—" (`app/merchant/page.tsx:3-4,36`).
  - Every figure carries its unit. Times are in IST (`page.tsx:33-34`).
- Investor pages:
  - No gas prompts (U4 "Never", `docs/SRS.md:56`; CON-4 `:70`).
  - Signing copy follows `SignIn.tsx:46,63` ("sign one message; it's free"). For funding the message does move money, so say exactly what it moves: "Sign once to pay 58.839334 USDT. No gas."
- Both:
  - Errors use `role=alert` and results use `role=status`.
  - A stale error clears on change (`Invoices.tsx:189`).
  - Destructive actions take two steps (`Invoices.tsx:286-307`).
  - Touch targets use `min-h-11`.
  - A card per row on phones, a table from `sm` up (`page.tsx:286`).
  - Last-known data shows first and private reads boot when idle (NFR-13, `docs/SRS.md:219`; `PrivateReads.tsx:25-42`).
  - `prefers-reduced-motion` is respected (`Reveal.tsx:18`).
  - At 375 px, a 66-character entity key or tx hash overflows. Show `0xabcd…1234` linked to the explorer (the `short` pattern, `lib/merchant-wallet.ts:60`), with the full value in a `CopyButton` (`break-all` as `components/gateway/RevealOnce.tsx:38`).

**Reusable pieces:**

| Need | Use |
|---|---|
| Page frame and meter | `components/dashboard/Shell.tsx:8`. The meter starts only when `account` is passed (`:24`), so pass the connected investor. |
| Headings, cards, fields | `components/gateway/Frame.tsx:7-66`: `card`, `field`, `textLink`, `EditorialHeader` (one serif `.emphasis`, as `app/merchant/settlements/page.tsx:16-20`), `SectionLabel`, `Problem`, `Account`, `SignedOut` |
| Buttons | `components/Button.tsx:22-30`; `components/HoldButton.tsx:4-5` for money moves; `Confirming`; `CopyButton` |
| Private reads | `startPrivateReads` (`lib/merchant-wallet.ts:66-77`); `getChainClient` with multicall batching (`lib/anon.ts:71-90`); `countRead` / `meterValue` (`lib/read-meter.ts:19,30-34`); private-first read with wallet fallback `readVia` (`merchant-wallet.ts:92-116`, not exported; export it rather than copy it) |
| Merchant txs | `connectMerchant` + simulate → send → receipt (`merchant-wallet.ts:119-144`); `walletError` / `COPY` (`:46-54,190-197`). Add `listAdvance`, `listInvoice` and `cancelOffer` helpers next to `createInvoice` (`:148`), and CapitalMarket error copy for `BadTerms`, `AdvanceActive`, `InvoiceNotListable`, `AlreadyFunded`, `NotMerchant`. |
| Money and format | `formatUsdt`, `parseUsdt`, `plainUsdt`, `EXPLORER` (`lib/usdt.ts:7,24-36`); `formatWbt` (`lib/dashboard.ts:108-116`) |
| Loading text | Suspense fallback pattern (`app/merchant/settlements/page.tsx:34-40`) |

### Merchant (`/capital/merchant`)

**M1 Cash advance** (FR-ADV-1, 2, 6)

Form fields: principal, cap, holdback %, term (days), offer deadline.

Validation mirrors `BadTerms` (`CapitalMarket.sol:107-111`):
- principal > 0
- cap ≥ principal
- 0 < holdback ≤ 30%
- term > 0
- now < deadline ≤ now + `MAX_OFFER_DAYS` (180 days, §3.2)

Before the wallet opens, show the cost (FR-ADV-6). Listing moves no USDT (`CapitalMarket.sol:103-120`); the USDT reaches the merchant when investors fund (`:200`). So: "When investors fund it, you get 10.00 USDT. You repay 11.00 USDT (cost 1.00 USDT) from 20% of each sale until it's repaid." Then the gas line: "Listing costs about 0.0007 WBT" + `WBT_HINT`.

Rules from GET /merchant:
- `open` (listed, nobody funded yet): show the offer with a two-step Cancel (`cancelOffer`, allowed while `sold == 0`).
- `repaying`: show the running advance instead of the form (`AdvanceActive`, `:113`).
- `expired` (unfunded, past the deadline): show the advance with a two-step Cancel and "Cancel it to list a new one".
- `repaid`: the note "Repaid. Sales now go 100% to you, minus the fee." (AT-5) **plus the form**, since `advanceOf` is 0 again. Run 2's AT-3 needs it.

States:
- empty: the form
- loading: Suspense text
- error: one sentence per wallet error; "—" for unread figures
- pending: "Waiting for your wallet…" → receipt → "Adding it to the offer book…" (publish)
- done: offer card with explorer link and status open / repaying (outstanding, repaid = sold − outstanding) / repaid

**M2 Get paid today** (FR-INV-1, 2)

Inputs:
- invoice picker from `listable_invoices`, preselected from `?invoice=<id>` when present (§3.5)
- target APR (%)
- offer deadline: ≤ dueDate − 60 s (`CapitalMarket.sol:138-141`; `contracts.ts:21`) and ≤ now + `MAX_OFFER_DAYS`. The contract allows any future due date (`MerchantPay.sol:115`), so without the 180-day cap an offer could list on chain and never publish. The existing date inputs are date-only (`Invoices.tsx:196`); use `datetime-local` or presets (5 minutes, 1 day, 7 days) so the AT-9 throwaway can use a 5-minute deadline.

Show the price from `priceFromApr` with the APR and the day count, e.g. "Investors pay 98.065556 USDT now for 100.00 USDT due in 60 days (12.00% APR)." Pass `recourseBps` = 0 (FR-INV-6 is cut, `docs/SRS.md:6`).

States:
- empty: "Create an invoice first", linking to `/merchant#invoices`
- error: copy for `InvoiceNotListable` / `BadTerms`
- pending and done: as M1

**Cancel rule in the merchant invoices list.** The contract refuses `cancelInvoice` only once an investor has funded: it reverts `InvoiceFinanced` when `isFinanced(id)`, i.e. `claimOfInvoice != 0 && sold != 0` (`MerchantPay.sol:126`; `CapitalMarket.sol:284-287`). A listed but unfunded invoice can be cancelled; the offer then stays listed but unfundable (`fund` reverts `OfferClosed`, `CapitalMarket.sol:309`), and `claimOfInvoice` stays set because only `cancelOffer` resets it (`:161`). **Product choice (proposed):** hide Cancel while `claimOfInvoice != 0` (the list shows it today, `Invoices.tsx:271`) and say "This invoice is listed for financing. Cancel its offer in Capital first." Keep the existing `InvoiceFinanced` copy (`merchant-wallet.ts:51`) for the contract's own revert.

**M3 My live offers** (FR-ARK-2, 5)

Rows come from GET /merchant `offers` plus `unpublished`. Each shows status, units sold / face, an Arkiv entity link or "Not in the offer book yet" with Publish again, and Cancel only while `sold == 0` (`CapitalMarket.sol:154-158`).

States:
- empty: "No live offers"
- error: Arkiv down. Show the chain rows from `advance` / `unpublished` with "The offer book can't be read right now".

### Investor (`/capital`, `/capital/holdings`)

**I0 Connect.** In `lib/capital-wallet.ts` (released to claude-frontend, agentbus :521):
- `connectInvestor(provider)` calls `eth_requestAccounts`, then switches or adds chain 1874 (share the helper from `merchant-wallet.ts:124-129`). There is no merchant check.
- Right before `signTypedData` it re-reads `eth_accounts` and it listens for `accountsChanged`, so a stale address can't produce a signature for the wrong `from`.
- Not eligible means a read-only book with "This wallet isn't approved to invest yet. KYC is simulated on this demo." (NFR-9, `docs/SRS.md:215`). No faucet (CON-8).

**I1 Offer book** (FR-ARK-2, 3, 4; AT-9)

Reads:
- The server-rendered list from GET /offers shows at once.
- Then one browser multicall over Anon-RPC: `offers(id)` for every id, `invoices(invoiceId)` for every invoice offer, `isEligible`, USDT `balanceOf`, `holdersOf`, `balanceOf(investor, id)`. These update the rows and the meter.

Buy is enabled only when all of these hold:
- `arkiv.matches` is true **and** the browser's own `offerMatches(arkiv.terms, its own offers(id) read)` is true
- the browser's chain read says the offer is live: `!cancelled && !settled && now ≤ offerDeadline && sold < face`, and for an invoice `status == 1 && paid == 0` (`CapitalMarket.sol:299-310`)
- the wallet is eligible and isn't the offer's merchant

States (pick the copy from the chain status first, then from terms):
- empty: "No open offers right now"
- loading: "Checking…" per row while Nym boots
- error: Arkiv down means no Buy ("The offer book can't be read right now"); a failed chain check means Buy off ("Can't check this offer right now")
- funded or closed (stale entity): Buy off, "Fully funded" / "Closed"
- mismatch (terms differ): Buy off, "This offer's terms don't match the chain"

**I2 Fund** (FR-ADV-3, FR-INV-3)

The panel takes an amount you get back (units, shown as USDT). It shows:
- the cost: `quoteUnits` as an estimate while typing, then the contract's `quote(claimId, units)` from a browser read once typing stops. The signed `value` is that read (`docs/FRONTEND-PLAN.md:83-84`).
- maturity, and the APR and day count for an invoice, or the cap and holdback terms for an advance
- the minimum buy, the smallest units with cost ≥ 1 USDT (`relayer.ts:54,326`); computed: 1,019,726 units for claim 2's terms, 1,099,999 for claim 1's

Blockers, checked before signing:
- not eligible
- is the merchant (`CapitalMarket.sol:305`)
- USDT balance < cost
- cost < 1 USDT
- 8 holders already and the wallet isn't one of them (`ClaimToken.sol:227-236`)
- **proposed:** a lower holder cap until repayment gas is measured (§8 Q19)

Confirm with `HoldButton`, then sign (§2.1), then POST /fund.

States:
- pending: "Funding…"
- unknown: "We couldn't confirm this yet. Don't fund again; check Holdings in a few minutes." (pattern `lib/outcome.ts:5-6,27-34`)
- done: explorer tx link, units now held

**I3 Holdings** (G6)

Each held claim shows units (= USDT still owed to you), the claim's outstanding, maturity, and a lock badge when `lockFrom` is set.

- A claim that settles burns all its units (`CapitalMarket.sol:347-352`), so it drops out of a balance-only list. To show "Repaid in full" after AT-7, keep the claim ids this wallet funded in `localStorage` (a per-viewer convenience written after a confirmed fund) and show those with balance 0 and `settled` as "Repaid in full". Without that list the row just disappears.
- A revoked investor (FR-TOK-7) still sees holdings and payouts: burns are never blocked (`ClaimToken.sol:178-181`). Its transfer check gives `sender_not_eligible` and I2 blocks buying.
- `owed(investor) > 0` shows "X USDT is waiting for you". There is no withdraw button: `withdrawOwed` costs gas (§8 Q4).
- No payout history: the explorer is an FR-PRIV-4 exclusion, and `onchain.ts:164-181` knows only MerchantPay.
- Empty state: "You don't hold any claims yet".

**I4 Transfer check** (FR-TOK-8, AT-8)

Inputs: recipient and units. The panel calls GET /transfer-check on change and shows the reason sentence for the code (§3.4), or "This transfer would go through".

States: checking, blocked (reason), allowed, error.

Whether a real Send button exists depends on §8 Q4. Without one, AT-8's "Transaction reverts" never happens in a G5 run.

### Debtor

No new screen. The existing `/pay/[invoiceId]` covers AT-7:
- fee on top (`components/InvoicePay.tsx:119,154-157`)
- states open, paid, cancelled, pending, confirming (`:30,39`)
- strict CSP (`next.config.ts:46`)

It signs with the guest key of whichever browser opens it (§2.2), and it serves only the configured shop's invoices (`app/api/v1/invoices/[id]/pay/route.ts:53`).

---

## 5. Arkiv offer entity `mcplus.offer.v1`

### 5.1 Attributes

Source: `arkiv/schema.md:23-43`, `ARCHITECTURE.md:144`. Use `u64`, not `u256`. Values are written as `u64(x)` and `addr(x)`. Tag the schema the way the voucher entity does (`type` attribute, `lib/server/vouchers.ts:35-37`).

| Name | Type | Indexed | Value (from chain `offers(claimId)`) |
|---|---|---|---|
| `kind` | str | yes | `"invoice"` if kind 1, `"advance"` if kind 2 (`CapitalMarket.sol:31-32`) |
| `chainId` | u64 | yes | 1874 |
| `market` | addr | yes | CapitalMarket |
| `claimId` | u64 | yes | claimId |
| `merchant` | addr | yes | `offer.merchant`. Write `addr`, not the voucher's `str()` (`vouchers.ts:38`). |
| `faceUsdt` | u64 | yes | `face` |
| `priceUsdt` | u64 | yes | `price` |
| `remainingUsdt` | u64 | yes | `face − sold` (mutable) |
| `aprBps` | u64 | yes | display and sort only: `aprFromPrice` at publish time; 0 for an advance. Listing time isn't on chain (`CapitalMarket.sol:37-49`), so no reader can recompute the same value; readers recompute APR from `price`, `face` and `maturity − now`. |
| `holdbackBps` | u64 | yes | `bps` for an advance; **0 for an invoice** (its bps is recourse) |
| `maturity` | u64 | yes | `maturity` |
| `deadline` | u64 | yes | `offerDeadline` (exact; the entity expiry is block-rounded) |
| `status` | str | yes | `"open"` / `"funded"` (only documented values, `schema.md:37`) |
| `terms` | bytes (JSON) | no | `{invoiceId, recourseBps}`, both on chain (`CapitalMarket.sol:41,44`). No debtor, no names, no memo (FR-ARK-4). The draft's `termSeconds` is dropped: the term isn't stored on chain, so it could never be checked. |

Drop `sector` and update `schema.md` through claude-research: it has no source anywhere in apps/web (grep). The count stays under the 32-attribute limit (`schema.md:43`). A `str` is at most 128 bytes (`sdk/src/schema/values.ts:40`).

### 5.2 Expiry

- `ExpirationTime.atDate(new Date(deadline*1000))` (`schema.md:25`). It rounds up to the next block (`sdk/src/utils/expirationTime.ts:143-160`); a past date is refused (research note `research_notes/build_prep/frontend_sdk_api.md:85`, local only).
- The maximum lifetime is 7,884,000 blocks, about 182.5 days (`sdk/src/consts.ts:3,9`). The app uses one 180-day cap (`MAX_OFFER_DAYS`, §3.2).
- An offer is open while `now ≤ deadline`, because the contract reverts on `block.timestamp > offerDeadline` (`CapitalMarket.sol:299`).

### 5.3 Offer-book query

The query runs on the server (`lib/arkiv.ts:1-2,11-28`). The client timeout is 30 s (`:8`); GET /offers wraps it in about 5 s with the last good result (G12). `orderBy` takes one key (`sdk/src/query/queryBuilder.ts:187`) and `limit` is at most 100 (`sdk/src/query/engine.ts:11`).

```ts
reader.select().from(Offer)
  .where(eq("chainId", u64(1874)), eq("market", addr(CAPITAL_MARKET)), eq("status", "open"), gt("deadline", u64(nowSec)))
  .ownedBy(WRITER).orderBy(asc("deadline")).limit(100).fetch()
// merchant "my live offers": replace eq("status","open") with eq("merchant", addr(m)); keep ownedBy and the deadline filter
```

- `WRITER` = `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` (`schema.md:3`). `ownedBy` is required because anyone can write a matching entity.
- The SDK skips non-matching entities silently and counts them in `skipped` (`queryResult.ts:30-39`). Log that count.
- Env names: `ARKIV_ACCESS_KEY` (refused if empty, `arkiv.ts:13`) and `ARKIV_PRIVATE_KEY` (malformed gives a fixed message, `:15-20`). Never read or print their values.
- Rabdi has been down before: unreachable for about 2.5 h on Nov 5 (`arkiv/friction.md:9-13`). §6 has an Arkiv preflight.

### 5.4 The exact `matches` rule (FR-ARK-3)

`offerMatches(terms, chainOffer)` compares **terms only** (D2). It is true only if (addresses compared lowercase):
- `$owner == WRITER`
- `chainId == 1874`
- `market == CAPITAL_MARKET`
- `claimId == id`
- `kind` ⇔ `chain.kind` (invoice ⇔ 1, advance ⇔ 2)
- `merchant == chain.merchant`
- `faceUsdt == face`
- `priceUsdt == price`
- `deadline == offerDeadline`
- `maturity == maturity`
- `holdbackBps == (kind == 2 ? bps : 0)`
- `terms.invoiceId == invoiceId` and `terms.recourseBps == (kind == 1 ? bps : 0)`

**Not compared:** `remainingUsdt` (use the chain's `face − sold`), `aprBps` (display only, §5.1), `status` (liveness comes from the chain read, §3.1 and §4 I1).

Sources: `CapitalMarket.sol:37-49`, `ARCHITECTURE.md:77,144`.

### 5.5 Status updates (FR-ARK-5)

- After a confirmed `Funded`, the fund route patches: `patchEntity(Offer, key, { set: { status: sold == face ? "funded" : "open", remainingUsdt: face − sold } })`.
- Cancel and settle are not written. The book's chain join leaves them out or marks them closed.
- `ponytail:` no write on a public GET; a stale Arkiv status is corrected for display by the chain join.

### 5.6 Failure rules (`arkiv/friction.md:14-18`; `lib/arkiv.ts:13-35`)

- Pass every error through `redactArkivError`: the key is in the RPC URL path, and viem copies the URL into error messages.
- Rethrow private-key errors without their cause.
- Follow the voucher `Mirror` pattern on main: the mirror returns `{entityKey, txHash} | {error}` and never swallows a failure (`lib/server/vouchers.ts:138,151-184`). The frontend then shows "Not in the offer book yet".

---

## 6. AT-3 to AT-9 click paths

The amounts below are the ÷100 SRS values (`docs/SRS.md:6,253-259`).

### Before each run

**1. Funding preflight (blocks run 1 today).** Chain balances: team/deployer `0xb4E7…714D` 148.430885 USDT and 0.180110 WBT; merchant 70.71 USDT; A, B and the script debtor 0 USDT; guest `0x4f59…8e12` 0.59 USDT.
- `Seed.fund()` checks the whole shortfall first and reverts `TeamWalletShort` without moving anything (`Seed.s.sol:67-77`).
- Seed as written, with `CUSTOMER` set to the guest: after `reclaim()` the team holds about 219.14. The targets (`Seed.s.sol:24-29`) need 1 + 69 + 40 + 100 + 55.41 = 265.41, so it is short by 46.27. Without a reclaim first it is short by 115.98.
- The UI never spends the debtor's 100 USDT: `/pay` signs with the guest key (§2.2). The targets for UI runs (proposed, claude-contracts changes Seed):
  - `CUSTOMER` required for UI runs (today optional, `Seed.s.sol:15,113-114,119`), with `CUSTOMER_USDT` = 156,100,000 for AT-4 to AT-7 (5 + 50 + 1 + 100.10). The full G5 run adds AT-1 25 (`docs/SRS.md:251`; refunded at AT-2), AT-11 25 (`:261`), and AT-12 to AT-14, about 35 more by claude-review's reading of the live txs (not re-checked here).
  - `DEBTOR_USDT` = 0 for UI runs (keep it only for the `LiveInvoice` script).
  - `INVESTOR_A_USDT` = 58e6: A spends 10 at AT-3 and gets 1 + 10 back at AT-4/AT-5 before AT-6, so it holds 59 ≥ 58.839334.
  - That totals about 254.5 for AT-3 to AT-7 (short about 35 after a reclaim) and about 314 for full G5 (short about 95).
- The human claims faucet WBT (2 WBT/day, `ARCHITECTURE.md:97`) and swaps about 0.5 WBT (Capital only) or about 1.3 WBT (full G5) to USDT on YetiTrade (`README.md:82`; pool about 74.6 USDT/WBT, `ARCHITECTURE.md:160`, verified 2026-11-05). Keep at least 0.05 WBT on the deployer for Seed and reclaim gas.
- Run `reclaim()` before run 1, not only between runs. Then run `Seed.s.sol --sig "fund()"` **without** `--broadcast` and confirm it doesn't revert (shortfall covered) before broadcasting.

**2. Chain and service preflight** (a short script or checklist before each run):
- `advanceOf(merchant)` = 0 (chain today: 0); the merchant has no open unfunded offers.
- `isEligible(A)` and `isEligible(B)` are true and their balances are at target.
- Relayer `/health`: `paused` false and `budgetLeft` ≥ 0.05 WBT (fields at `relayer.ts:492-500`).
- Rabdi up: the README query (§5.3) answers in under 2 s.
- Reset after a failed run: settle a live advance with a script sale, and `cancelOffer` any unfunded offer. A funded, unrepaid advance blocks `listAdvance` (`AdvanceActive`, `CapitalMarket.sol:113`), and so does an expired unfunded one until cancelled (`:154-163`). A mined revert bans that payer for the life of the relayer process (`relayer.ts:146,157,172`).

**3. Payment links.** The one-click test checkout is fixed at 25 USDT (`app/api/demo-checkout/route.ts:29`), and a 25 USDT sale at AT-4 would pay the investor 5 and leave 6 outstanding. Create reusable payment links of 5, 50 and 1 USD once (links accept 1 to 1,000 USDT, `lib/server/links.ts:62`; USD = USDT 1:1, `README.md:28`).

**4. Wallets and browser profiles.** The human imports A and B into browser wallets (never an agent reading `.env`). Use three Chrome profiles: merchant plus guest, A, B, so nobody switches accounts mid-scenario. Run G5 on desktop and take the 375 px screenshots with device emulation; investor signing at phone width works only in a wallet's in-app browser.

**5. Relayer rate limit.** The relayer allows 10 broadcasts per payer per hour (`relayer.ts:42`, checked at `:160-162`, counted at `:170`), in-process (`:139-141`). The guest pays AT-1, AT-4, AT-5 (two sales), AT-7, AT-11, AT-12, AT-13 and AT-14: 9 per run. A second run inside the hour reaches 10 at its AT-1 and gets 429 at AT-4, which the web app shows as "Payments are busy" (`lib/relay.ts:86-87`). The human picks one (§8 Q8).

**Verification:**
- claude-research checks on chain with `cast receipt <tx>` and the views listed, plus a screenshot of each UI state named.
- Each tx hash is copied from the UI's explorer link.

### AT-3: investor funds a 10 USDT advance (cap 11, holdback 20%)

**UI steps:**
1. Merchant signs in and opens `/capital/merchant` → Cash advance. Enters principal 10, cap 11, holdback 20, term 30 days, deadline tomorrow.
2. The page shows "When investors fund it, you get 10.00 USDT. You repay 11.00 USDT (cost 1.00 USDT)…". Merchant confirms in the wallet.
3. The receipt arrives and the offer is published to Arkiv.
4. Investor A opens `/capital` and connects. The advance row shows Buy.
5. A enters 11 (all units). The page shows cost 10.000000 USDT. A holds the button, signs, and sees done.

**On chain:**
- `listAdvance(10000000, 11000000, 2000, 2592000, deadline)`, then `fundWithAuthorization(claimId, A, 11000000, …)` (same values as `LiveAdvance.s.sol:20-22,46-51`).
- Events: `Funded(units 11000000, cost 10000000)`, `LienAdded(merchant, claimId, 2000)`, USDT `AuthorizationUsed` and transfers, `TransferSingle(market, 0, A, claimId, 11000000)`.
- Merchant USDT +10.000000. `balanceOf(A, claimId)` = 11000000.

**Verify:**
- `cast receipt` on both txs
- `balanceOf(A, id)` = 11000000; `outstanding(id)` = 11000000; `liensOf(merchant)` contains id
- screenshot of M1 "repaying" and of I3 holdings

### AT-4: a 5 USDT sale after AT-3

**UI steps:** the customer (guest profile) pays the 5 USD payment link. The merchant's Capital page then shows outstanding 10.00.

**On chain:**
- `Distributed(claimId, paymentId, 1000000, 10000000)`
- `Paid(gross 5000000, fee 100000, toInvestors 1000000, toMerchant 3900000)`
- Lien = min(5 × 20%, 11, 4.9) = 1 (`CapitalMarket.sol:223-231`)

**Verify:**
- receipt events
- `outstanding(id)` = 10000000; A's USDT +1.000000
- Settlements "To investors" column shows 1.00 (`components/gateway/Settlements.tsx:14`)

### AT-5: the advance reaches its cap

**UI steps:**
1. Customer pays the 50 USD link. 50 × 20% = 10 = outstanding, so one sale settles the claim. `LiveAdvance.s.sol:63-67` used five 10 USDT sales; keep the single 50 sale, since five sales would also use 4 more of the guest's 10 relays per hour.
2. Merchant page shows "Repaid. Sales now go 100% to you, minus the fee." with the form back.
3. Customer pays the 1 USD link.

**On chain:**
- Sale 1: `Distributed(…, 10000000, 0)`, `Settled(claimId)`, burn `TransferSingle(market, A, 0, id, 10000000)`, `Paid(toInvestors 10000000, toMerchant 39900000)`. `advanceOf(merchant)` = 0 (`CapitalMarket.sol:349,364-369`).
- Sale 2: `Paid(gross 1000000, fee 100000, toInvestors 0, toMerchant 900000)`.

**Verify:**
- `outstanding(id)` = 0; `offers(id).settled` = true; `advanceOf(merchant)` = 0
- the next sale's `toInvestors` = 0
- screenshot of the "Repaid" state

### AT-6: two investors fund a 100 USDT invoice at 12% APR, 60 days (60/40)

**UI steps:**
1. Merchant creates a 100 USDT invoice due 60 days from today in the existing invoices UI and sends its `/pay` link to the payer. The UI invoice names no customer (`lib/merchant-wallet.ts:150`; the customer box is a private note, `Invoices.tsx:169`), so anyone with the link can pay it.
2. From the create-success view, the merchant opens `/capital/merchant?invoice=<id>` → Get paid today, enters APR 12, and sees price 98.065556, 60 days, 12.00% APR. Sets the deadline to tomorrow, lists, and publishes.
3. Investor A buys 60 (cost 58.839334 from `quote`) and signs.
4. Investor B buys 40 (cost 39.226223) and signs.

**On chain:**
- `listInvoice(invoiceId, 98065556, deadline, 0)`
- First fund: `Funded(…, 60000000, 58839334)` + `ClaimStateSet(id, dueDate − 60, false)`. Second fund: `Funded(…, 40000000, 39226223)`.
- Merchant receives 98.065557 (two ceilings).
- Chain vectors: `offers(2).price` = 98065556; `quote(2, 60e6)` = 58839334; `quote(2, 40e6)` = 39226223.

**Verify:**
- receipts; `balanceOf(A, id)` = 60000000; `balanceOf(B, id)` = 40000000
- merchant USDT delta = 98065557
- `claimState(id).lockFrom` = dueDate − 60
- screenshot of M2 showing the price, APR and "60 days"

### AT-8: investor tries to send a claim to a non-eligible wallet

**Blocked on §8 Q4.** The SRS pass criterion is "Transaction reverts; the UI showed the reason first" (`docs/SRS.md:258`), and G5 is the whole demo AT-1 to AT-15 twice (`PHASES.md:117`). G4 counted only the contract half (`PHASES.md:102`). Without a Send button nothing reverts in a G5 run.

Run this between AT-6 and AT-7, as `LiveInvoice.s.sol:11` did.

**UI steps:**
1. A opens `/capital/holdings` → the AT-6 claim → Transfer check. A enters a non-eligible address (the script debtor `0x518b…6D9D` or the guest `0x4f59…8e12`, both `isEligible` = false on chain) and 10 units.
2. The panel shows "That wallet isn't approved to hold claims" (`receiver_not_eligible`).
3. Only if Q4 allows a real send: A sends, and the tx reverts with `ERC7943CannotReceive`.

**On chain:** the dry run `eth_call safeTransferFrom(A, recipient, id, 10000000)` from A reverts with `ERC7943CannotReceive(recipient)` 0x705c1eed (`ClaimToken.sol:201`).

**Verify:**
- `cast call ClaimToken "canTransfer(address,address,uint256,uint256)(bool)" A recipient id 10000000` → false
- `cast call --from A ClaimToken "safeTransferFrom(address,address,uint256,uint256,bytes)" …` → 0x705c1eed
- screenshot of the reason shown before any send
- The README's mined AT-8 revert `0x08f45d4b…56f8` (`README.md:31`) was sent by the admin `0xb4E7…714D`: decoded `safeTransferFrom(admin, 0xdEaD, 2, 1)`, status reverted (chain). It was not an investor sending; describe it that way.

### AT-7: the invoice is paid (100.10 = face + relay fee)

**UI steps:** the payer opens `/pay/<invoiceId>` in the **guest profile** (the browser whose guest wallet Seed funded as `CUSTOMER`), sees 100.10, pays, and sees Paid. The page signs with that browser's guest key (§2.2), so the seeded script debtor plays no part.

**On chain:**
- Signed value 100100000. `Paid(invoiceId, gross 100100000, fee 100000, toInvestors 100000000, toMerchant 0)` (`MerchantPay.sol:156,158,295`).
- `Distributed(…, 100000000, 0)` and `Settled(id)`. Burns: A 60000000, B 40000000. A +60.000000 USDT, B +40.000000 USDT.
- The live G4 run had the same shape: tx `0xd9172e76c1f19d2152d10283a84732ac0ef14680698f7279cfc2c10dd71003b1` logs `AuthorizationUsed`, the USDT transfers, `Distributed`, `Settled`, two burns, two pushes, then `Paid` with gross 100100000, fee 100000, toInvestors 100000000, toMerchant 0 (chain). That run's payer was the script debtor (`LiveInvoice.s.sol:48-66`).

**Verify:**
- receipt events and per-holder USDT deltas
- `outstanding(id)` = 0; `offers(id).settled` = true
- I3 shows "Repaid in full" (needs the funded-claims list, §4 I3)

### AT-9: the investor offer book loads

**Setup:** at the start of the run, the merchant creates a ≥ 1 USDT invoice and lists it as a throwaway offer with a **5-minute** deadline (M2 preset), costing about 0.0014 WBT. The page records its entity key at publish. Nobody funds it. Check AT-9 after it has expired and while the AT-6 offer is still open, i.e. after step 2 of AT-6.

Don't use an advance: an expired unfunded advance blocks the next listing until cancelled (`CapitalMarket.sol:113,160`).

**UI steps:** investor A opens `/capital` with the wallet connected. The open offer is listed with its Arkiv entity key. The throwaway offer is not listed. The meter shows private reads.

**On chain / Arkiv:** the README query (§5.3) returns the open offer's entity and not the expired one. The throwaway's `offers(id).offerDeadline` < now.

**Verify:**
- run the README query (SR-ARK-1, `docs/SRS.md:239`) and compare entity keys with the page
- run the same query **without** the `deadline` filter and show the throwaway's recorded entity key is absent, so Arkiv's own expiry removed it, not our filter
- screenshot with a meter value > 0
- the network panel shows the `offers()` multicall going through the Nym worker
- `skipped` = 0 in the server log

---

## 7. Tests each lane writes first (failing first)

The repo uses plain `node:test` `.mjs` files in `apps/web/test`, testing pure logic (`lib/dashboard.ts:1-2`; `package.json` test script). Route logic is split into pure functions so it can be tested without a server. The vectors below are bigint base units for the pure helpers; the routes convert per D1.

### claude-relayer: `apps/web/test/capital.test.mjs` (`lib/capital.ts`, `lib/server/capital*.ts`)

1. `quoteUnits`:
   - 60000000n at price 98065556n / face 100000000n === 58839334n
   - 40000000n === 39226223n
   - 11000000n at 10000000n / 11000000n === 10000000n
   - face 0n → 0n
2. `fundingNonce(2n, A, 60000000n, 0x00…01)` === `0x91151ff3e6e3cc466bac44d1d58ab1e22b3b4de6a7255cea6d25e95d9f571878`.
3. `fundingAuthorization(...)`:
   - domain `verifyingContract` is USDT, chainId 1874; `to` is CapitalMarket; `value` is the quote
   - a test key's `signTypedData` verifies with `verifyTypedData`
4. `priceFromApr` and `daysToDue(dueDate, now)` (IST calendar days):
   - (100000000n, 1200, 60) === 98065556n; (…, 61) === 98033949n
   - dueDate = 23:59:59 IST 60 days ahead, now = 00:30 IST and 23:30 IST today → 60 days → 98065556n
   - dueDate = now + 60 × 86400 exactly (`LiveInvoice.s.sol:37`), now + 1 minute → still 60 days
   - APR 0 is rejected (price must be < face)
5. `offerMatches(terms, chainOffer)`:
   - identical terms → true
   - each of kind, merchant, face, price, deadline, maturity, holdbackBps, market, chainId, `$owner`, `terms.invoiceId`, `terms.recourseBps` changed → false
   - merchant compared case-insensitively
   - invoice with chain bps 500, `holdbackBps` 0 and `terms.recourseBps` 500 → true
   - settled, cancelled, past deadline, `sold == face` with equal terms → **true** (liveness is `offerStatus`'s job)
6. `offerStatus(chainOffer, invoice, now)`: open; funded when `sold == face`; closed when settled or the invoice isn't Open or paid > 0; dropped when cancelled or past the deadline.
7. `offerAttributes(chainOffer, id)`:
   - kind strings; `u64`/`addr` wrappers; `terms` is exactly `{invoiceId, recourseBps}`
   - no `customer` anywhere in the output
   - expiration from the deadline; throws for a past deadline or one more than `MAX_OFFER_DAYS` (180) ahead
8. `parseFund(body)`:
   - rejects `valid_after` ≠ "0", units "0", a bad salt, a 64-byte sig
   - rejects `valid_before` outside (now+30, now+900], as `parseApproval` does
   - accepts the AT-6 vector
9. `fundErrorCopy`:
   - each decoded error name (`OfferClosed`, `WrongUnits`, `MerchantCannotFund`, `ERC7943CannotReceive`, `TooManyHolders`) → its sentence
   - relay 422 with `code` `insufficient_funds` → investor copy, not `NOT_FUNDED`; `below_minimum` → "The smallest buy is 1 USDT."
   - unknown outcome → "Don't fund again"
10. `transferReason(errorName, claimState, now)`:
    - `ERC7943CannotTransfer` + frozen → `claim_frozen`; + lock reached → `claim_locked`
    - one case per §3.4 code; an undecodable receiver revert → `receiver_rejects`; no error → `allowed: true`
11. `publishDecision(session, chainOffer, now)`: no session → 401; other merchant → 404; cancelled, settled, expired or beyond 180 days → 409; own open offer → ok.
12. `joinOffers(entities, chainOffers, now)`:
    - expired and cancelled left out
    - `units_left = face − sold`; `status` from chain
    - `face` and `price` always present; `arkiv.terms` carries the entity values
13. `relayFund` (mock fetch): the body's `action` is `"fund"`, and `args` **contains** `{claimId, investor, units, validAfter: "0", validBefore, salt}` (a subset check: `relay()` also adds `from` and `amount`); a 422 response's `code` reaches the caller.

### claude-frontend: `apps/web/test/ui-capital.test.mjs` (pure modules in `components/capital/*.ts`)

1. `advanceTermsError`:
   - principal 0; cap < principal; holdback 0% and 30.01%; term 0; deadline past; deadline > now + 180 d → each gives its sentence
   - AT-3 terms (10, 11, 20%, 30 d, now + 1 d) → null
2. `advanceCostLine(10000000n, 11000000n, 2000)` === "When investors fund it, you get 10.00 USDT. You repay 11.00 USDT (cost 1.00 USDT) from 20% of each sale until it's repaid."
3. `invoiceListingError`: price ≥ face; deadline > due − 60; deadline > now + 180 d; invoice not Open, part-paid or already listed.
4. `offerStatusLabel`: Cancelled, Repaid, Expired (sold 0, past deadline), Closed (invoice paid), "Open · 60% funded", Repaying.
5. `fundBlocker`:
   - not eligible; is merchant; balance < cost; cost < 1 USDT; 8 holders and not a holder → each sentence
   - otherwise null
6. `minUnitsForOneUsdt(price, face)`: the smallest units with `quoteUnits ≥ 1000000` (1019726n for 98065556n / 100000000n; 1099999n for 10000000n / 11000000n).
7. `heldClaims(balanceOfBatchResult, ids, fundedIds, settled)`: keeps non-zero balances, plus funded ids that settled ("Repaid in full").
8. `REASON_COPY` has a sentence for every §3.4 code, and none mention gas, WBT or signatures.
9. CSP: `headers()` gives `/capital` and `/capital/merchant` the merchant policy (`next.config.ts:29-34`).
10. Screens, after the logic: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and a screenshot per state (AGENTS.md "Done means verified").

### claude-contracts (review lane)

1. `apps/web/test/abi-capital.test.mjs`: every `parseAbi` fragment in `lib/capital.ts` (the full G1 list, including ClaimToken `balanceOf(address,uint256)`, MerchantPay `invoices` and `invoiceCount`, and USDT `balanceOf` against the standard selector) has the same selector as the matching entry in `packages/shared/contracts.ts`, and the addresses match `contracts.ts:5-13`.
2. A Seed check, as a forge test or an assertion in `Seed.s.sol`: for UI runs `CUSTOMER` is set and `CUSTOMER_USDT ≥ 5e6 + 50e6 + 1e6 + 100e6 + relayFee` (§6), and `INVESTOR_A_USDT + 11e6 − 10e6 ≥ quote(60e6 units)` at the AT-6 price.
3. Review both lanes' batches against §1, §3.0 and §5.4 before the human gate.

---

## 8. Open questions and risks, with recommended answers

| # | Question / risk | Recommended answer |
|---|---|---|
| Q1 | **Merchant gas for listing.** No gasless path exists; the relayer allows only `paySale`, `payInvoice` and `fund` (`relayer.ts:51-55,242-243`). The ABI is frozen. A 7702-delegated account wouldn't help either: the relayer refuses any payer with code, "incl. EIP-7702" (`ARCHITECTURE.md:94`; `relayer.ts:360,366`). | Accept it. The merchant wallet sends `createInvoice` / `listAdvance` / `listInvoice` / `cancelOffer` itself, about 0.0006–0.0008 WBT each, with the cost shown with `WBT_HINT`. The merchant already sends `createInvoice` this way (`merchant-wallet.ts:148`). Seed gives 0.02 WBT (`Seed.s.sol:25`). |
| Q2 | **Investor wallet in the browser.** No injected-wallet typed-data path exists (§0 status). The guest wallet is random per browser and not eligible (`lib/guest-wallet.ts:11-25`; chain `isEligible(0x4f59…)` = false). `connectMerchant` refuses any account other than the signed-in merchant (`merchant-wallet.ts:123`). A and B have 0 USDT, 0 WBT and nonce 0, and their keys exist only in `.env` (`Seed.s.sol:116-117` reads them). | An injected wallet through `connectInvestor` (§4 I0). The human imports A and B (eligible until 1796500938, set at `DeployPhase3.s.sol:41-42`) into separate browser profiles (§6 step 4); keys go nowhere but those wallets and `.env`. **Before I2 is wired:** prove one MetaMask `signTypedData_v4` on 1874 against `verifyTypedData`. The alternative is admin `setEligible` on two new accounts plus a Seed change. |
| Q3 | **Investor sign-in.** | None. The fund signature is the authority and holdings are public reads (G8). |
| Q4 | **Claim transfer and `withdrawOwed` cost the investor gas**, which conflicts with U4 "Never" and CON-4 (`docs/SRS.md:56,70`). The relayer has no transfer action. AT-8 needs "Transaction reverts" at G5 (`docs/SRS.md:258`; `PHASES.md:102,117`). | **The human decides before G5.** Option A: the `eth_call` dry run's revert counts as AT-8's pass for G5; the UI ships the transfer check only, no Send. Option B: a disclosed CON-4 exception gives A about 0.001 WBT for one real failing send per run. No withdraw button either way; show the owed amount. |
| Q5 | **The seed funds the wrong wallet for AT-7.** `DEBTOR_USDT = 100e6` goes to the script debtor (`Seed.s.sol:28,118`), but `/pay` signs with the browser's guest key (§2.2). The guest gets `CUSTOMER_USDT` = 56 only when `CUSTOMER` is set (`Seed.s.sol:15,29,113-114,119`), and AT-4/AT-5 spend all of it. Raising `DEBTOR_USDT` alone fixes nothing. Chain today: script debtor 0 USDT, guest 0.59. | claude-contracts changes Seed for UI runs: `CUSTOMER` required, `CUSTOMER_USDT` = 156,100,000 (more for full G5), `DEBTOR_USDT` = 0, `INVESTOR_A_USDT` = 58e6 (§6 step 1). An alternative is a second browser profile for the payer, passed as its own Seed target with ≥ 100.10. Keep the forge assertion (§7 contracts 2) on the guest target. |
| Q6 | **FR-PRIV-2 / FR-PRIV-4.** FR-PRIV-2 wants Arkiv reads over the private transport (`docs/SRS.md:180`); a browser read would expose the access key in the URL (`arkiv.ts:31-34`; `friction.md:14`). The server also reads the chain for GET /offers, /quote, /transfer-check (the investor's from and to), /merchant, POST /fund pre-checks and the holdings `offerCount`, through Ankr (`lib/onchain.ts:10`). FR-PRIV-4's list names only "the server-side read behind the pay and checkout pages" (`docs/SRS.md:182`). | The server reads Arkiv; disclose FR-PRIV-2 as an exclusion. Add the Capital server chain reads to the README exclusion list through claude-research. The browser's `offers()` multicall over Nym supplies AT-9's meter reads. The other option, running the transfer-check simulation in the browser over Anon-RPC (`readVia`, `merchant-wallet.ts:92-116`), deviates from 08:53 and needs claude-contracts' yes. |
| Q7 | **Publish fails after the listing tx** and the offer is missing from the book. | `unpublished` in GET /merchant and "Publish again" (G4). Publish is idempotent and serialized (§3.2). |
| Q8 | **Relayer limits per payer.** A mined revert bans that payer for the life of the process and counts one of the three reverts per hour that open the breaker (`relayer.ts:44,146,156-157,172-173`). 10 broadcasts per payer per hour (`relayer.ts:42,160-162`), counted per process (`:139-141`), so on Vercel the outcome depends on which instance answers. Investors: A funds 2 per run, B 1, within the limit. **The guest pays 9 per run**, so run 2 inside an hour fails at AT-4 (§6 step 5). | The fund route simulates and decodes before relaying (§3.6 step 3). For the guest, the human picks one (the limits are human-approved, `relayer.ts:39`): raise `PAYER_SENDS_PER_HOUR` for the demo (e.g. 30), start run 2 at least 60 minutes after run 1's first payment, or use separate profiles for the customer and the invoice payer. |
| Q9 | **The `sector` attribute has no source; `schema.md` says the debtor is "hashed"** (`arkiv/schema.md:39,41`; FR-ARK-4 `docs/SRS.md:172`). The UI creates invoices with `customer` = zero address (`lib/merchant-wallet.ts:150`), so there is no on-chain debtor to hash. | Drop `sector`. Omit the debtor from `terms`, which meets "no personal data". Send both as a requirement and schema change to claude-research before building (SRS change control, `docs/SRS.md:9`). If the human wants the literal hash, use an HMAC with a new server secret, as `codeHash` does (`vouchers.ts:98`); a plain address hash can be reversed. |
| Q10 | **u64 vs u256** for amounts and claimId. | u64: micro-USDT values fit easily (`schema.md:34`). |
| Q11 | **Showing "expired offers are gone" (AT-9)** needs an expired offer. | A throwaway invoice listing with a 5-minute deadline at the start of each run (§6 AT-9). |
| Q12 | **Ambiguous `principal\|face` and `holdback_pct`** in the 08:53 shape. | Always send `face` and `price`; `holdback_pct = bps/100`; 0 for invoices (§3.1). claude-contracts confirms. |
| Q13 | **AT-4/AT-5 by hand.** The only one-click checkout is 25 USDT (`app/api/demo-checkout/route.ts:29`). | Payment links of 5, 50 and 1 USD, made once (§6 step 3). One 50 USDT sale settles the advance exactly. |
| Q14 | **Lock window.** It is 60 s on testnet (`DeployPhase3.s.sol:19`), so `claim_locked` only shows in the last minute before the due date. | Not part of the demo. AT-8 uses `receiver_not_eligible`. Keep the test case (§7 relayer 10). |
| Q15 | **FR-TOK-5 admin freeze/force** (priority C). It is already done on chain with tests (`PHASES.md:113`). | No admin screen in this pack. Build one only if G5 passes with time left. |
| Q16 | **Is the deployed relayer running the `fund` action?** Not verified here. `/relay` requires `x-relay-secret` and answers 401 without it (`apps/relayer/api/relay.ts:7-14`). The relayer reads the quote first and checks `not_yet_valid`, `expired`, `window_too_long` and `below_minimum` before the signature (`relayer.ts:305-313,322-332`), so an unknown claim (quote 0, `CapitalMarket.sol:251`) gives `below_minimum`. `/health` doesn't show the commit. | claude-relayer runs one probe from an environment that holds the secret: `fund` with claim 2, units 60000000 (quote 58.839334), `validAfter` "0", `validBefore` now + 465 s, and a well-formed wrong signature. Expect 422 `bad_signature`; a 400 "unknown action" (`relayer.ts:242-243`) means an old deploy. Run it before the frontend wires I2. |
| Q17 | **The team wallet can't fund a run** (§6 step 1). | Reclaim first, apply the Q5 targets, and the human swaps faucet WBT to USDT. Dry-run Seed before each run. |
| Q18 | **Amount encoding** conflicts with 08:53 (§3.0 D1). | claude-contracts decides before either lane builds. |
| Q19 | **Many holders may make repayment unrelayable.** The relayer's gas limit is 400k and "Many-holder routings above 400k are refused" (`relayer.ts:31-32`). A 2-holder `payInvoice` used 277,255 gas (`…/LiveInvoice.s.sol/1874/pay-latest.json`), a one-investor routed sale 256–278k, and about 537k with 8 holders (`ARCHITECTURE.md:97`). `_distribute` burns and pushes once per holder (`CapitalMarket.sol:350-359`). A straight-line estimate puts the 400k limit near 4 holders (not measured). | List it as a risk in the README. Measure a 4-holder and a 5-holder repayment on a fork, then cap holders in I2 at the largest count that stays under 400k. The demo uses 2 holders. |
| Q20 | **Arkiv is a hard dependency of AT-3 and AT-6** through FR-ARK-3. | G12's short timeout and cached book, the Arkiv preflight (§6 step 2), and the DEP-5 decision point written down for the gate (`PHASES.md:103`). |
| Q21 | **Who owns `lib/relay.ts`.** This pack's G9 gave `relayFund` to claude-relayer; claude-frontend announced `relayFund` in its batch 024 (agentbus 10:27). | One CLAIM on agentbus decides. Whoever takes it adds `code` to `RelayResult` (G9) and the funding copy (G11) in the same batch. |

---

## Rejected review notes

Every reviewer issue was re-checked against the source and the chain. These were rejected in full or in part:

1. **"Use floor(seconds/86400) days" (one of two G3 fixes): rejected in part.** Floor prices an end-of-day IST due date correctly, but for a due date exactly now + 60 days (`LiveInvoice.s.sol:37`) listed a minute later it gives 59 days, price 98,097,183 (computed). IST calendar days give 60 in both cases, so the pack uses those.
2. **"Re-point citations to df0e1d4": adjusted.** origin/main has moved on to `2a85902` (a docs-only commit after `df0e1d4`); citations point there.
3. **"One mined revert only counts toward the 3-per-hour breaker" (citation fix (2)): rejected in part.** A mined revert also bans that payer for the life of the process (`relayer.ts:146,172`). The line numbers were corrected to the current file (`:42`, `:160-162`).
4. **"Place the /capital CSP rule after the /merchant rules; last match wins": rejected in part.** `/capital/:path*` matches no `/merchant` rule, and the catch-all `/(.*)` rule sets no CSP (`next.config.ts:36-43`), so its position doesn't matter. The test the reviewer asked for is kept (§7 frontend 9).
5. **Live figures not re-checked here and left out or marked:** the YetiTrade quote of 72.69 USDT/WBT (the pack uses the recorded ≈74.6, `ARCHITECTURE.md:160`), the Arkiv writer's 9.9994 GLM balance, the relayer's live `budgetLeft` 0.1, and the AT-12 to AT-14 amounts (marked as claude-review's reading).
6. **Relayer line numbers in reviewer notes (`:52`, `:53`, `:142`, `:151`, `:317`, `:351`, `:357`)** were written against an older `relayer.ts`. The facts hold; the current lines are `:54`, `:326`, `:42`, `:160`, `:360`, `:366`.
