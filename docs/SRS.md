# Software Requirements Specification: Merchant Capital+

| | |
|---|---|
| Version | 1.1 (pre-event planning; no code before the hackathon starts) |
| Changes | 1.1 (human approved 2026-11-05 19:50): FR-TOK-8 → M, Phase 4 (AT-8 needs it at G4); FR-PRIV-1 and FR-PRIV-4 reworded (pay and checkout pages make no browser chain reads); CON-8 added (demo funding by seed script); DEP-3 pass criteria (Privy then failed them, guest wallet); demo amounts divided by 10 in AT-3–AT-7 to fit the test USDT we can collect; FR-PRIV-4 lists the Nym worker's own traffic (human 21:18); NFR-12–14 speed budgets for web and relayer (human 22:28: "the system should be fast"); FR-PAY-15 merchant wallet sign-in (human asked in the frontend session, 22:5x); FR-PAY-16 owner sweep of stray USDT (human 23:40, contracts gate); demo amounts ÷100 in AT-3–AT-7 (human 23:58: ~110 test USDT available); FR-ADV-7 and FR-INV-6 cut (human 00:34) |
| Status | Approved scope, locked by the human 2026-11-05 |
| Related | ARCHITECTURE.md (design and ABI), PHASES.md (delivery plan), `research_notes/Mumbai hackathon idea validation/build_H1_merchant_capital.md` (design detail and sources), HANDOFF.md (decisions, event facts) |
| Change control | Requirements change only through HANDOFF.md + an agentbus message; IDs are never reused |

---

## 1. Introduction

### 1.1 Purpose
This document states what Merchant Capital+ must do, for whom, and how each requirement is accepted. It is the reference for the contracts lane, the frontend lane, the reviewer and the judges' checklist.

### 1.2 Scope
Merchant Capital+ lets a shop on Whitechain:
1. get paid in USDT through invoices, payment links and a drop-in checkout, where the payer never needs the gas token;
2. refund in one click and export its books;
3. raise cash today, either by selling an invoice to investors at a discount, or with an **advance repaid automatically from a share of every future sale**.

Each financed claim is a token whose transfer, maturity and settlement rules the contract enforces. Investors find offers on Arkiv, and every app read goes through Anon-RPC.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| USDT | The prize USDT on Whitechain Sepolia, `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 decimals |
| WBT | Whitechain's gas token |
| Gasless | The payer signs a message; the relayer submits the transaction and pays WBT |
| Claim | A financed invoice or advance; represented by one ERC-1155 token id |
| Unit | 0.000001 USDT owed to the holder of a claim; `totalSupply(id)` = USDT still owed |
| Advance | Cash paid to a merchant now, repaid by a fixed share (holdback) of each sale until a cap |
| Lien | The rule that routes the holdback of each sale to an advance's holders |
| Recourse | After an invoice defaults, a share of the merchant's future sales repays its holders |
| Relayer | Our service that submits signed authorizations and pays gas |
| Offer | A financing listing on Arkiv that expires at its deadline |

### 1.4 References
Whitechain prize text (verbatim in `research_notes/…/whitechain_inventory.md`), the Whitechain workshop notes (`…/whitechain_workshop_and_anonrpc_test.md`), the Mumbai prize list (`research/mumbai_prizes_2026-11-05.md`), EIP-3009, ERC-1155, ERC-7943, EAS.

---

## 2. Overall description

### 2.1 Product perspective
A set of Solidity contracts on Whitechain Sepolia (chain 1874), a relayer service, a web app with four role views, and a separate demo shop. See ARCHITECTURE.md §1.

### 2.2 Users and roles
| ID | Role | Goal | Holds WBT? |
|---|---|---|---|
| U1 | Merchant (shop) | Get paid, refund, raise cash | May (for its own admin actions) |
| U2 | Customer | Pay a checkout or invoice | **Never** |
| U3 | Business debtor | Confirm and pay an invoice, possibly on its due date | **Never** |
| U4 | Investor | Find, fund and hold claims; receive repayments | **Never** |
| U5 | Compliance admin | Approve or remove investors (KYC) | Yes (admin key) |
| U6 | Relayer operator | Keep the relayer funded and safe | Yes (hot wallet) |
| U7 | Shop developer | Add checkout to a store in about 20 lines | n/a |

### 2.3 Operating environment
Whitechain Sepolia 1874 (OP Stack, `prague` EVM); reads through `rpc.ankr.com/whitechain_testnet`; Blockscout explorer; Arkiv Rabdi testnet; modern desktop and mobile browsers; hosting on Vercel + Neon.

### 2.4 Constraints
| ID | Constraint |
|---|---|
| CON-1 | No product code, designs or assets before the hackathon starts (ETHGlobal Start Fresh) |
| CON-2 | Every payment in the main flow uses the prize USDT; self-minted tokens don't count |
| CON-3 | All contracts are deployed and verified on Whitechain Sepolia |
| CON-4 | Payers (U2, U3, U4) never sign a transaction that costs them gas |
| CON-5 | Public repo with steady commits; AI usage disclosed; spec files committed |
| CON-6 | Demo video 2:30–2:55, narrated by a team member (CROPS caps at 3 min, ETHGlobal needs 2–4) |
| CON-7 | Keys only in a git-ignored `.env` or hosting secrets; never in the repo or on agentbus |
| CON-8 | Demo wallets (customer, investors, debtor) are funded by a one-off seed script from a team wallet whose key is in `.env`; the app has no faucet or "get test USDT" button; disclosed in the README |

### 2.5 Assumptions and dependencies
| ID | Item | If it fails |
|---|---|---|
| DEP-1 | USDT `receiveWithAuthorization` works as verified (payee must be the caller) | Stop and ask Whitechain's dev Telegram |
| DEP-2 | Faucet gives 2 WBT/day per wallet, IP and GitHub account | Pool WBT across team wallets |
| DEP-3 | Privy embedded wallets sign typed data on 1874, load no third-party trackers, and integrate in about an hour (tested in Phase 1) | Any check fails → guest wallet in the browser, stated in the README limitations **Result (human, 2026-11-05 20:31): failed.** Privy always posts its own analytics to auth.privy.io, including the wallet address on every typed-data signature, with no off switch, and it pins a second viem (2.57.8) → guest wallet |
| DEP-4 | EAS predeploy `0x4200…0021` works for attestations | Owner-managed allowlist |
| DEP-5 | Arkiv SDK 1.0.1 and the Rabdi testnet are available | Drop the Arkiv track; keep offers on-chain |
| DEP-6 | Anon-RPC Nym and Tor networks reach Whitechain (tested) | Fall back to direct reads, disclosed |
| DEP-7 | YetiTrade WWBT/USDT pool for fee swaps | One manual swap, linked in the README |

---

## 3. Functional requirements
Priority: **M** = must (never cut), **S** = should, **C** = could (first to cut). Phase = PHASES.md.

### 3.1 Payments (Whitechain Operate)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PAY-1 | A merchant can create an invoice with customer, amount, due date and reference | M | 2 |
| FR-PAY-2 | A merchant can cancel an invoice that is unpaid and not financed | S | 2 |
| FR-PAY-3 | A customer can pay an invoice by signing one message; the relayer submits it | M | 2 |
| FR-PAY-4 | A shop can create a checkout session through an API with a secret key and redirect the customer to a hosted pay page | M | 2 |
| FR-PAY-5 | A customer can pay a checkout sale by signing one message | M | 2 |
| FR-PAY-6 | Each payment is bound to its invoice or order by a nonce the contract recomputes; a signature can't be reused for another payment | M | 2 |
| FR-PAY-7 | The pay page shows the amount and merchant in plain words, with no mention of gas, signatures or chain names | M | 2 |
| FR-PAY-8 | A merchant can refund all or part of a payment in one click, from its own wallet; refunds never take money from investors | M | 2 |
| FR-PAY-9 | The customer sees a receipt with refund status and an explorer link | S | 2 |
| FR-PAY-10 | The shop receives signed webhooks for `payment.succeeded` and `payment.refunded` | S | 4 |
| FR-PAY-11 | A separate demo shop integrates checkout in about 20 lines; the README counts them | M | 2 |
| FR-PAY-12 | A merchant can export a CSV of sales, invoices, financing, refunds and payouts for an accountant | S | 4 |
| FR-PAY-13 | A debtor can confirm (acknowledge) an invoice with one gasless signature | C | 5 |
| FR-PAY-14 | A debtor can pre-authorize payment on the due date; the system submits it when due | C | 5 |
| FR-PAY-15 | A merchant signs in with its own wallet (EIP-4361 / Sign-In with Ethereum, signed HttpOnly session); the dashboard, API keys and refunds show only that wallet's data | M | 2 |
| FR-PAY-16 | The owner can sweep USDT sent to MerchantPay by plain transfer (MerchantPay never holds funds between transactions) | S | 3 |

### 3.2 Relayer and gas (Whitechain Scale)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-REL-1 | The relayer submits signed payment, funding, acknowledgement and registration actions and returns the transaction hash | M | 1–2 |
| FR-REL-2 | The relayer only calls an allowlist of contract functions | M | 2 |
| FR-REL-3 | The relayer simulates every transaction and never sends one that would revert | M | 2 |
| FR-REL-4 | Each relayed payment carries a relay fee (0.10 USDT, contract cap 0.25) and a minimum payment of 1 USDT. On a sale the fee is inside the price; on an invoice it is added on top (the debtor pays face + 0.10), so financed holders are repaid in full | M | 2 |
| FR-REL-5 | The relayer enforces gas price and gas limit caps, short signature windows, per-payer/merchant/IP rate limits, and a daily WBT budget | M | 2 |
| FR-REL-6 | A health endpoint reports WBT balance, gas spent today, budget left, unswapped fees and pause state; the merchant dashboard shows it | M | 2 |
| FR-REL-7 | Payment functions are permissionless, so anyone can submit a signed authorization if the relayer is down | M | 2 |
| FR-REL-8 | Collected fees are swapped to WBT on YetiTrade to refill the relayer | C | 5 |
| FR-REL-9 | The merchant contract can be paused by the owner | S | 2 |

### 3.3 Revenue advance (Whitechain Tokenize, our differentiator)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ADV-1 | A merchant can list an advance with principal, cap, holdback percentage, term and offer deadline; cap ≥ principal and holdback ≤ 30% | M | 3 |
| FR-ADV-2 | At most one active advance per merchant | M | 3 |
| FR-ADV-3 | An eligible investor can fund an advance by signing one message; USDT goes to the merchant and claim units are minted in the same transaction | M | 3 |
| FR-ADV-4 | On every later payment to the merchant, the holdback share of the gross amount goes to the advance's holders, capped by what is still owed, in the same transaction | M | 3 |
| FR-ADV-5 | When the cap is repaid, the lien ends and later sales go 100% to the merchant | M | 3 |
| FR-ADV-6 | The merchant sees the total cost of the advance before signing | M | 3 |
| FR-ADV-7 | After term + grace with money still owed, anyone can mark the advance defaulted; the claim freezes and the lien keeps repaying | C | 5 |

### 3.4 Invoice financing (Whitechain Tokenize)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-INV-1 | A merchant can list an unpaid invoice for financing at a price below face, with an offer deadline before the maturity lock | S | 4 |
| FR-INV-2 | The UI computes the price from a target APR and shows both | S | 4 |
| FR-INV-3 | One or more eligible investors can fund parts of an invoice; USDT and units move in one transaction | S | 4 |
| FR-INV-4 | When the debtor pays, holders are paid pro-rata in the same transaction and the covered units burn; partial payments are allowed | S | 4 |
| FR-INV-5 | From the maturity lock until settlement, claim transfers are blocked | S | 4 |
| FR-INV-6 | After the due date + grace with money owed, the claim freezes and a recourse share of the merchant's future sales repays holders | C | 5 |
| FR-INV-7 | A merchant can repay a claim directly | C | 5 |

### 3.5 Claim token rules (Whitechain Tokenize)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-TOK-1 | Claims are ERC-1155 ids; only the market contract can mint and burn; burning is never blocked | M | 3 |
| FR-TOK-2 | A transfer succeeds only if sender and receiver are eligible investors | M | 3 |
| FR-TOK-3 | A claim has at most 8 holders | S | 3 |
| FR-TOK-4 | Frozen claims and frozen token amounts can't be transferred | S | 3 |
| FR-TOK-5 | The compliance admin can force a transfer and set frozen amounts (ERC-7943) | C | 5 |
| FR-TOK-6 | The token exposes ERC-7943 `canSend`, `canReceive`, `canTransfer` and its interface id | S | 3 |
| FR-TOK-7 | A revoked investor can't trade but still receives repayments | M | 3 |
| FR-TOK-8 | The UI shows the reason a transfer would fail before the user tries it | M | 4 |

### 3.6 Investor eligibility (KYC)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-KYC-1 | The compliance admin can add and remove eligible investors (owner list) | M | 3 |
| FR-KYC-2 | An investor can register an EAS KYC attestation; eligibility re-checks schema, attester, recipient, revocation and expiry on every use | C | 5 |
| FR-KYC-3 | Revoking an attestation takes effect immediately | C | 5 |

### 3.7 Offers on Arkiv
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ARK-1 | Each open offer is written to Arkiv with its terms, expiring at the offer deadline | M | 4 |
| FR-ARK-2 | The investor offer book and the merchant's "my live offers" read from Arkiv | M | 4 |
| FR-ARK-3 | The Buy button is enabled only if the Arkiv offer matches the on-chain offer | M | 4 |
| FR-ARK-4 | Offers contain no personal data (debtor identity hashed) | M | 4 |
| FR-ARK-5 | An offer's status is updated when it is funded | S | 4 |
| FR-ARK-6 | A merchant stats entity (30-day sales, unique payers) refreshes hourly | C | 5 |

### 3.8 Private reads (EF Anon-RPC)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PRIV-1 | Every chain read the app makes in the browser goes through Anon-RPC by default (Nym, Tor fallback); the customer pay and checkout pages make no browser chain reads (amount and merchant come from our server) | M | 4 |
| FR-PRIV-2 | Arkiv reads use the same private transport | S | 4 |
| FR-PRIV-3 | A visible meter shows the share of reads that were private | S | 4 |
| FR-PRIV-4 | Exclusions (relayer writes, the two mainnet bootstrap reads, explorer history, the server-side read behind the pay and checkout pages, the Nym worker's own plain traffic (directory lookups to validator.nymtech.net, one WSS to a Nym entry gateway, bundle fallbacks unpkg.com / raw.githubusercontent.com after jsDelivr)) are listed in the README | M | 6 |

---

## 4. Non-functional requirements
| ID | Category | Requirement | How it's verified |
|---|---|---|---|
| NFR-1 | Security | Contracts follow checks-effects-interactions; no external call can re-enter routing; pushes that fail fall back to a pull balance | Tests C3, F1; review |
| NFR-2 | Security | The sum of payouts, merchant share and fee always equals the gross payment; the market never keeps USDT it doesn't owe | Fuzz test F1 |
| NFR-3 | Security | One secret per service: relayer key only in the relayer, Arkiv writer key only in the web app | Grep before freeze |
| NFR-4 | Performance | A gasless payment is confirmed and the content released within 5 seconds of signing | Demo run timing |
| NFR-5 | Performance | Each screen makes one batched private read (Multicall); no event-log scans | Code review |
| NFR-6 | Usability | The customer flow needs no crypto knowledge: no WBT, no seed phrase, no chain name | Demo + screenshots |
| NFR-7 | Reliability | The product works if our relayer is down (anyone can submit) | Test M1 variant |
| NFR-8 | Privacy | No personal data on-chain or on Arkiv; no third-party trackers or analytics in the client | Review + CSP |
| NFR-9 | Transparency | Testnet timings (60 s lock, 120 s grace) and simulated KYC are stated in the README limitations | README review |
| NFR-10 | Maintainability | Foundry tests M1–M3, C1–C6, T1–T2, I1, F1, E1; coverage report before the freeze | `forge test`, `forge coverage` |
| NFR-11 | Quality gate | Web: `tsc --noEmit`, lint and build pass with a screenshot of each changed page | AGENTS.md "done means verified" |
| NFR-12 | Performance (web) | Customer pay and checkout pages: LCP ≤ 2.0 s and INP ≤ 200 ms on a mid-range phone over 4G; ≤ 200 KB of JS (gzip); no Nym bundle and no 3D scene on those pages | Lighthouse mobile (perf ≥ 90) + bundle report in test.md |
| NFR-13 | Performance (web) | Merchant and investor pages: first paint ≤ 2.5 s; the dither scene and the Anon-RPC worker load after first paint and never block input; last-known chain data shows at once, private reads update in the background; `prefers-reduced-motion` turns the scene off | Lighthouse mobile + a recorded load in test.md |
| NFR-14 | Performance (backend) | Relayer: `GET /health` ≤ 300 ms p95; an invalid or unprofitable `/relay` is rejected in ≤ 500 ms with no transaction; a valid payment meets NFR-4 (≤ 5 s, using `eth_sendRawTransactionSync`) | Timed runs in test.md (20 requests, p95) |

---

## 5. Sponsor and event requirements
| ID | Source | Requirement | Covered by |
|---|---|---|---|
| SR-WC-1 | Whitechain (all tracks) | Contracts deployed and verified on 1874 | CON-3 |
| SR-WC-2 | Whitechain | At least one USDT payment in the main flow, explorer link in the README | FR-PAY-3/5 |
| SR-WC-3 | Whitechain | One README line on why on-chain stablecoin settlement is needed | Phase 6 |
| SR-WC-4 | Whitechain | Public repo with steady progress; README with setup, architecture, limitations | CON-5 |
| SR-WC-5 | Whitechain | Demo video 2–4 min showing each party | CON-6 |
| SR-WC-6 | Whitechain | `WHITECHAIN_FEEDBACK.md` | Phase 6 |
| SR-OP-1 | Operate | A drop-in piece a separate demo app adds in about 20 lines; merchant and customer views | FR-PAY-4/11 |
| SR-OP-2 | Operate (extra credit) | Flow goes past the first payment: refund, renewal or accountant export | FR-PAY-8/12 |
| SR-SC-1 | Scale | Payer flow with zero visible crypto steps | FR-PAY-7, NFR-6 |
| SR-SC-2 | Scale | Explain who pays gas, how the relayer gets WBT, what stops draining | FR-REL-4/5/6/8 |
| SR-TK-1 | Tokenize | Real transfer rules in the contract (allowlist, restrictions, maturity or settlement conditions) | FR-TOK-1–4, FR-INV-5 |
| SR-TK-2 | Tokenize | Clear issuer and investor roles; at least one full lifecycle step in the demo | FR-ADV-1–5 |
| SR-ARK-1 | Arkiv | Writes to Arkiv and a user-visible feature reads from it; writer address + runnable query in the README | FR-ARK-1–3 |
| SR-ARK-2 | Arkiv | `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` | Phase 6 |
| SR-EF-1 | EF Anon-RPC | The app routes its RPC reads through Anon-RPC by default; share of traffic shown | FR-PRIV-1–4 |
| SR-EF-2 | EF CROPS | FOSS license, README CROPS section, no trackers, keys on device | NFR-8, Phase 6 |
| SR-ETH-1 | ETHGlobal | AI usage disclosed per file; spec and planning files committed | CON-5 |
| SR-ETH-2 | ETHGlobal | Submitted before the deadline, selecting Whitechain, Arkiv and EF | Phase 7 |

---

## 6. Acceptance scenarios (demo script = acceptance test)
| ID | Scenario | Pass when |
|---|---|---|
| AT-1 | A customer with 0 WBT pays a 25 USDT shop sale | Explorer shows one tx: fee to the relayer recipient, rest to the merchant; webhook received |
| AT-2 | The merchant refunds the sale | Customer receives USDT; investors untouched |
| AT-3 | An investor funds a 10 USDT advance (cap 11, holdback 20%) | Merchant receives 10; investor holds 11,000,000 units |
| AT-4 | A 5 USDT sale after AT-3 | 1 USDT to the investor in the same tx; outstanding falls from 11 to 10 |
| AT-5 | The advance reaches its cap | Lien removed; the next sale pays the merchant 100% minus the fee |
| AT-6 | Two investors fund a 100 USDT invoice at 12% APR, 60 days (60 / 40 split) | Prices ≈58.84 and ≈39.23 (exact 6-decimal values from the contract); merchant receives their sum |
| AT-7 | The debtor pays the invoice (100.10: face + relay fee) | Investors receive 60 and 40 in the same tx; claim settled |
| AT-8 | An investor tries to send a claim to a non-eligible wallet | Transaction reverts; the UI showed the reason first |
| AT-9 | The investor offer book loads | Offers come from Arkiv; expired offers are gone; meter shows private reads |
| AT-10 | The relayer is asked to submit an invalid or unprofitable call | Rejected before sending; no gas spent |

---

## 7. Out of scope
Real KYC (simulated by our compliance key, disclosed); late fees; credit scoring beyond public sales stats; mainnet deployment (official USDT isn't on Whitechain mainnet yet); pooled vaults (ERC-7540) for passive investors; legal recovery beyond the merchant's payment stream; preventing merchants from taking sales outside our checkout (mitigated by default rules and visible sales stats, not prevented).
