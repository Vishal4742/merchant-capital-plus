# Software Requirements Specification: Merchant Capital+

| | |
|---|---|
| Version | **3.0 WhiteFlow (adopted 2026-11-06, owner authorization: "I authorize you to finalize and adopt SRS v3.0 with the previously specified WhiteFlow amendments")** · previously 2.0 (2026-11-06 02:35: pivot to a stablecoin payment gateway for international merchants; financing kept as the Capital tab) |
| Changes | 3.0: WhiteFlow requirements, constraints, dependencies and AT-19…AT-56 added as §8; conflicts resolved in place per §8.B (R1–R16); duplicate FR-PAY-16 → FR-PAY-17. 2.2 (human 2026-11-06 16:16: 'there is no option to pay, there is no wallet connect … no option to settle'): FR-PAY-16 (pay with your own wallet), FR-GW-15 (settlement balance + withdraw), FR-MCP-5 (agent pays a checkout under a cap; Pixa read as a reference only, no code copied: Start Fresh), AT-17/18. 2.1 (human 2026-11-06 16:09: 'i want the mcp … and fix the other things'): FR-MCP-1..4 + AT-16 (assistant connector), FR-ARK-7 (checkout reads the voucher's Arkiv entity), FR-REL-10 (relayer limits across instances). 1.1 (human approved 2026-11-05 19:50): FR-TOK-8 → M, Phase 4 (AT-8 needs it at G4); FR-PRIV-1 and FR-PRIV-4 reworded (pay and checkout pages make no browser chain reads); CON-8 added (demo funding by seed script); DEP-3 pass criteria (Privy then failed them, guest wallet); demo amounts divided by 10 in AT-3–AT-7 to fit the test USDT we can collect; FR-PRIV-4 lists the Nym worker's own traffic (human 21:18); NFR-12–14 speed budgets for web and relayer (human 22:28: "the system should be fast"); FR-PAY-15 merchant wallet sign-in (human asked in the frontend session, 22:5x); FR-PAY-16 owner sweep of stray USDT (human 23:40, contracts gate); demo amounts ÷100 in AT-3–AT-7 (human 23:58: ~110 test USDT available); FR-ADV-7 and FR-INV-6 cut (human 00:34); FR-KYC-2/3, FR-PAY-13/14 and FR-INV-7 cut, contracts freeze after G4 (human 02:02); FR-GW-10 network-fee column (claude-research, delegated by the human 06:43); FR-ARK-4 debtor left out, FR-PRIV-4 lists the Capital server reads, AT-8 pass by dry run + the recorded revert (claude-research from the Capital build pack, delegated, 10:42) |
| Status | v3.0 adopted 2026-11-06 (owner authorization). v2.x scope locked by the human 2026-11-05 |
| Related | ARCHITECTURE.md (design and ABI), PHASES.md (delivery plan), `research_notes/Mumbai hackathon idea validation/build_H1_merchant_capital.md` (design detail and sources), HANDOFF.md (decisions, event facts) |
| Change control | Requirements change only through HANDOFF.md + an agentbus message; IDs are never reused |

---

## 1. Introduction

### 1.1 Purpose
This document states what Merchant Capital+ must do, for whom, and how each requirement is accepted. It is the reference for the contracts lane, the frontend lane, the reviewer and the judges' checklist.

### 1.2 Scope
**v2.0 (human, 2026-11-06):** Merchant Capital+ is a **stablecoin payment gateway for merchants who sell internationally**, like Razorpay or Stripe, settling in USDT on Whitechain with zero gas for the payer. It runs **strictly on Whitechain Sepolia (testnet)**; mainnet is a later step, out of scope. Merchants get payment links, payment pages, invoices, QR codes, a one-line payment button and an SDK, discount vouchers, multi-currency prices, sales reports and instant settlements. Financing stays as one extra tab (Capital). A shop on Whitechain can:
1. get paid in USDT through payment links, payment pages, invoices, QR codes, a payment button, the SDK and a drop-in checkout, where the payer never needs the gas token;
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
| CON-4 | Payers (U2, U3, U4) never sign a transaction that costs them gas **[v3.0: SCOPED to the direct Whitechain route (R5)]** |
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
| FR-PAY-7 | The pay page shows the amount and merchant in plain words, with no mention of gas, signatures or chain names **[v3.0: SUPERSEDED by FR-CHK-2/FR-UX-1 (R4)]** | M | 2 |
| FR-PAY-8 | A merchant can refund all or part of a payment in one click, from its own wallet; refunds never take money from investors | M | 2 |
| FR-PAY-9 | The customer sees a receipt with refund status and an explorer link | S | 2 |
| FR-PAY-10 | The shop receives signed webhooks for `payment.succeeded` and `payment.refunded` | S | 4 |
| FR-PAY-11 | A separate demo shop integrates checkout in about 20 lines; the README counts them | M | 2 |
| FR-PAY-12 | A merchant can export a CSV of sales, invoices, financing, refunds and payouts for an accountant | S | 4 |
| FR-PAY-13 | A debtor can confirm (acknowledge) an invoice with one gasless signature | C | 5 |
| FR-PAY-14 | A debtor can pre-authorize payment on the due date; the system submits it when due | C | 5 |
| FR-PAY-15 | A merchant signs in with its own wallet (EIP-4361 / Sign-In with Ethereum, signed HttpOnly session); the dashboard, API keys and refunds show only that wallet's data | M | 2 |
| FR-PAY-17 | **Pay with your own wallet:** the checkout and invoice page offer "Pay with your wallet" next to the default: connect an injected wallet (MetaMask or similar), add or switch to Whitechain Testnet, and sign the same EIP-3009 authorization (a message, no transaction, no gas); the server path is unchanged. Before the hold, the default path checks the browser wallet's USDT and, if it's short, says so and offers the wallet option instead of failing after the hold. This option may use the word "wallet" (FR-PAY-7 still holds for the default path) **[v3.0: renumbered from the duplicate FR-PAY-16; subsumed by FR-CHK-1 (R6, R12)]** | M | 5 |
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
| FR-REL-10 | The send lock, daily gas budget and per-payer limits hold across all relayer instances (shared Postgres lock and counters), not per process | S | 5 |

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
| FR-ARK-4 | Offers contain no personal data (the debtor is left out of the entity entirely) | M | 4 |
| FR-ARK-5 | An offer's status is updated when it is funded | S | 4 |
| FR-ARK-6 | A merchant stats entity (30-day sales, unique payers) refreshes hourly | C | 5 |
| FR-ARK-7 | At checkout the server reads the code's live Arkiv entity (by its keyed hash, from our writer) and refuses a code whose entity is missing or expired. If Arkiv can't be reached it refuses the code with a plain reason; the customer can still pay without a code | M | 5 |

### 3.8 Private reads (EF Anon-RPC)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PRIV-1 | Every chain read the app makes in the browser goes through Anon-RPC by default (Nym, Tor fallback); the customer pay and checkout pages make no browser chain reads (amount and merchant come from our server) | M | 4 |
| FR-PRIV-2 | Arkiv reads use the same private transport | S | 4 |
| FR-PRIV-3 | A visible meter shows the share of reads that were private | S | 4 |
| FR-PRIV-4 | Exclusions (relayer writes, the two mainnet bootstrap reads, explorer history, the server-side read behind the pay and checkout pages, the Capital tab's server-side chain and Arkiv reads behind /api/v1/capital (no wallet data from the browser), the Nym worker's own plain traffic (directory lookups to validator.nymtech.net, one WSS to a Nym entry gateway, bundle fallbacks unpkg.com / raw.githubusercontent.com after jsDelivr)) are listed in the README | M | 6 |

---

### 3.9 Payment gateway (Whitechain Operate, v2.0)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-GW-1 | **Payment Links:** the merchant creates a link (amount, currency, description, optional expiry, single or reusable); the customer pays it through the hosted checkout; the dashboard shows each link's status and payments | M | 4 |
| FR-GW-2 | **Payment Pages:** a no-code page (title, description, merchant logo and colour, fixed items or an open amount) at a shareable URL | M | 4 |
| FR-GW-3 | **QR codes:** every link, page and invoice has a QR code to download or show at a counter | M | 4 |
| FR-GW-4 | **Payment Button:** one HTML line (`<script>` tag) or one React component renders a pay button that opens the hosted checkout | M | 4 |
| FR-GW-5 | **SDK:** a small TypeScript SDK (`packages/sdk`) to create checkout sessions, list payments and verify webhook signatures; the demo shop integrates with it | M | 4 |
| FR-GW-6 | **API keys:** the signed-in merchant creates and revokes test-mode API keys; only a hash is stored | M | 4 |
| FR-GW-7 | **Webhooks:** the merchant registers an endpoint; `payment.succeeded` and `payment.refunded` are sent signed (HMAC-SHA256) with retries (supersedes FR-PAY-10's C priority) | M | 4 |
| FR-GW-8 | **Developer docs:** a `/docs` page with a 3-step integration (button, SDK, webhooks) and copyable test keys | M | 4 |
| FR-GW-9 | **Reports:** gross, net, fees, refunds and payment count by day for a chosen date range, a sales chart, and CSV export (supersedes FR-PAY-12) | M | 4 |
| FR-GW-10 | **Settlements:** a page listing each payment's settlement to the merchant wallet, with its transaction link, showing that settlement is instant (T+0); a merchant-only "Network fee we covered" column on Payments and Settlements shows the WBT the relayer paid (read from the transaction receipt: gas used × gas price + the L1 fee); customer pages never show it (FR-PAY-7) **[v3.0: "instant (T+0)" wording removed (R7)]** | M | 4 |
| FR-GW-11 | **Multi-currency prices:** the merchant prices in USD, EUR, GBP, INR, AED or SGD; USD converts 1:1 to USDT (a dollar stablecoin, stated at checkout; human 03:02); the others convert at a public FX rate (display and quote only), shows the rate and its time, and locks it for the session | M | 4 |
| FR-GW-12 | **Discount vouchers:** the merchant creates codes (percent or fixed off, expiry, usage limit); the customer applies one at checkout; each code is an Arkiv entity that expires with the code, and redemptions are counted on our server | M | 4 |
| FR-GW-13 | **Gift vouchers:** a customer buys a prepaid USDT voucher that someone else redeems at that merchant | C | 5 |
| FR-GW-14 | **Test mode everywhere:** every page shows a "Test mode · Whitechain testnet" badge; no mainnet path exists | M | 4 |
| FR-GW-15 | **Settlement balance and withdraw:** Settlements shows the USDT already in the merchant's own wallet (settled in the payment's transaction, nothing pending with us) and a Withdraw action: the merchant's wallet sends USDT to an address it enters (for example an exchange deposit address), with the amount, address and network fee shown before signing **[v3.0: DEFERRED (R3)]** | M | 5 |

### 3.10 Assistant connector (MCP, v2.1)
| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-MCP-1 | A local MCP server (`packages/mcp`, stdio, the official MCP TypeScript SDK) signs in with the merchant's own `sk_test_` key from an environment variable and calls only the public gateway API; the web app is unchanged **[v3.0: SUPERSEDED by FR-MCP-6–11 (R2)]** | M | 5 |
| FR-MCP-2 | Tools: `create_checkout` (amount, currency, description → hosted checkout URL; creates no payment), `get_checkout` (status, amount, and once paid the tx hash with its explorer link), `list_payments` (recent payments with amount, refunded and tx link), `sales_summary` (gross, refunded and count for a date range, computed from `list_payments`) **[v3.0: SUPERSEDED by FR-MCP-6–11 (R2)]** | M | 5 |
| FR-MCP-3 | No tool moves money, signs, refunds or changes keys, wallets or webhooks. The key never appears in tool output or logs. Inputs are validated (amount format, currency list, limits) and API errors come back as a plain reason | M | 5 |
| FR-MCP-4 | The README gives one `claude mcp add` command and a Claude Desktop config block **[v3.0: SUPERSEDED by FR-MCP-6–11 (R2)]** | S | 5 |
| FR-MCP-5 | **Agent pays a checkout** (only when `MCP_PAYER_KEY` is set): `pay_checkout` signs the EIP-3009 authorization for a checkout URL with that key and posts it to the pay route (gasless); it refuses a payment above a per-payment cap and a daily cap (defaults 10 and 25 USDT), and `spending_report` lists every payment it made. The merchant tools never move money **[v3.0: CUT (R1)]** | S | 5 |

## 4. Non-functional requirements
| ID | Category | Requirement | How it's verified |
|---|---|---|---|
| NFR-1 | Security | Contracts follow checks-effects-interactions; no external call can re-enter routing; pushes that fail fall back to a pull balance | Tests C3, F1; review |
| NFR-2 | Security | The sum of payouts, merchant share and fee always equals the gross payment; the market never keeps USDT it doesn't owe | Fuzz test F1 |
| NFR-3 | Security | One secret per service: relayer key only in the relayer, Arkiv writer key only in the web app | Grep before freeze |
| NFR-4 | Performance | A gasless payment is confirmed and the content released within 5 seconds of signing | Demo run timing |
| NFR-5 | Performance | Each screen makes one batched private read (Multicall); no event-log scans | Code review |
| NFR-6 | Usability **[v3.0: SUPERSEDED by FR-CHK-2/FR-UX-1 (R4)]** | The customer flow needs no crypto knowledge: no WBT, no seed phrase, no chain name | Demo + screenshots |
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
| SR-SC-1 | Scale **[v3.0: SUPERSEDED by FR-CHK-2/FR-UX-1 (R4)]** | Payer flow with zero visible crypto steps | FR-PAY-7, NFR-6 |
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
| AT-1 | A customer with 0 WBT pays a 25 USDT shop sale | Explorer shows one tx: fee to the relayer recipient, rest to the merchant; the checkout and receipt show Paid (the signed webhook is proven at AT-14) |
| AT-2 | The merchant refunds the sale | Customer receives USDT; investors untouched |
| AT-3 | An investor funds a 10 USDT advance (cap 11, holdback 20%) | Merchant receives 10; investor holds 11,000,000 units |
| AT-4 | A 5 USDT sale after AT-3 | 1 USDT to the investor in the same tx; outstanding falls from 11 to 10 |
| AT-5 | The advance reaches its cap | Lien removed; the next sale pays the merchant 100% minus the fee |
| AT-6 | Two investors fund a 100 USDT invoice at 12% APR, 60 days (60 / 40 split) | Prices ≈58.84 and ≈39.23 (exact 6-decimal values from the contract); merchant receives their sum |
| AT-7 | The debtor pays the invoice (100.10: face + relay fee) | Investors receive 60 and 40 in the same tx; claim settled |
| AT-8 | An investor tries to send a claim to a non-eligible wallet | The UI shows the reason before signing and the transfer's dry run (`eth_call`) reverts; the on-chain revert is recorded once (G4: 0x08f45d4b…56f8). Investors never pay gas, so the demo ships no Send button (claude-research, delegated by the human, 10:42) |
| AT-9 | The investor offer book loads | Offers come from Arkiv; expired offers are gone; meter shows private reads |
| AT-10 | The relayer is asked to submit an invalid or unprofitable call | Rejected before sending; no gas spent |
| AT-11 | A customer pays a 25 USD payment link with 0 WBT | One tx on the explorer; the link shows Paid; the merchant's report and settlement list include it |
| AT-12 | A payment page with two items is bought with a discount code | Arkiv holds the code entity and the checkout read it (FR-ARK-7); the price is reduced; the code's use count rises by one |
| AT-13 | A 20 EUR item is bought | Checkout showed the EUR→USDT rate and its time; the USDT paid matches the locked quote |
| AT-14 | The demo shop adds the gateway with the payment button or the SDK | Integration code ≤ 20 lines; a sale completes; the webhook arrives and its signature verifies |
| AT-15 | The merchant opens Reports for today after AT-11–AT-14 and one refund | Gross, fees, refunds and count match the chain; the CSV has the same rows |
| AT-16 | In Claude Code with the MCP server added, the merchant asks for a 5 USD checkout, a 0-WBT customer pays the URL, and the merchant asks whether it was paid **[v3.0: SUPERSEDED by FR-MCP-6–11 (R2)]** | `get_checkout` returns Paid with the same tx hash the explorer shows; `list_payments` includes it; no tool output contains the key |
| AT-17 | A visitor with MetaMask holding test USDT and 0 WBT opens a 5 USD link and chooses Pay with your wallet | One signature prompt (no transaction); the payment lands in one tx with the usual split; the visitor still has 0 WBT spent. A browser with an empty guest wallet sees the short-balance notice before the hold |
| AT-18 | The merchant opens Settlements and withdraws 1 USDT to a second address **[v3.0: DEFERRED (R3)]** | The balance matches the chain; the withdraw tx moves exactly 1 USDT to that address |

---

## 7. Out of scope
Mainnet deployment of any kind (strictly testnet, human 2026-11-06); subscriptions, smart collect, affordability/EMI and one-click saved checkout (Razorpay features we don't build); Real KYC (simulated by our compliance key, disclosed); late fees; credit scoring beyond public sales stats; mainnet deployment (official USDT isn't on Whitechain mainnet yet); pooled vaults (ERC-7540) for passive investors; legal recovery beyond the merchant's payment stream; preventing merchants from taking sales outside our checkout (mitigated by default rules and visible sales stats, not prevented).

---

## 8. WhiteFlow v3.0 (adopted 2026-11-06)
Sources: owner instructions; `../WhiteFlow-Final-Vision-and-Claude-Build-Plan.md` (WF§); `../Business-Payments-Final-PRD.md` (PRD§). Drafting history: `docs/SRS-v3.0-WhiteFlow-PROPOSAL.md`. Owner decisions recorded: interim testnet login = wallet SIWE behind the shared AuthContext with memberships and server-revocable sessions, separate receiving-wallet proof (FR-BIZ-6); relayer cooldown policy (FR-REL-10 batch 031).

### 8.A Scope change

v3.0 turns the gateway into **WhiteFlow**: a business payments workspace with business onboarding, a business-controlled Whitechain receiving wallet, invoices and payment links, account-free customer checkout, payment from explicitly supported networks/assets, exact designated USDT settlement on Whitechain, transaction evidence, reconciliation and recovery, and dashboard + MCP access to the same records (WF§1).

- Testnet only. Destination: Whitechain Sepolia 1874, designated test USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 dp; verified live 2026-11-06). First external corridor: Ethereum Sepolia 11155111 Circle test USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 dp; verified live 2026-11-06) → Whitechain USDT, **only after DEP-8 and the W6/W7 gates pass** (WF§3, §7).
- Direct collection and cross-chain collection are independently feature-flagged. If the corridor fails, an honestly labelled direct-only build ships and the blocker is recorded; a simulated bridge is never a substitute (WF§3).
- WhiteFlow is the user-facing name. Internal tables, contracts and APIs are not renamed for branding (WF§2).
- Existing v2.2 requirements stay in force unless §B supersedes, scopes or cuts them.

### 8.B Conflict resolutions (applied on approval)

| # | Existing item | Resolution | Source |
|---|---|---|---|
| R1 | FR-MCP-5 (agent signs and pays a checkout with `MCP_PAYER_KEY`) | **Cut.** Not implemented (`packages/mcp` does not exist), so no code is removed. | Owner instruction §7; WF§3 ("Autonomous agent spending/x402 buying: not included"), WF§6 |
| R2 | FR-MCP-1, FR-MCP-2, FR-MCP-4, AT-16 (local stdio server with an env `sk_test_` key) | **Superseded** by FR-MCP-6…11 (remote OAuth MCP). A stdio adapter may exist later only as an optional developer adapter over the same services. FR-MCP-3 (no tool moves money, signs, refunds or changes keys/wallets/webhooks) is kept and strengthened by FR-MCP-8. | WF§5 (`src/index.ts` row), WF§6 |
| R3 | FR-GW-15 + AT-18 (Settlements withdraw) | **Deferred** (not in the WhiteFlow testnet scope table). The balance card may remain only labelled "Wallet balance — not revenue, not held by WhiteFlow". | WF§3, §4 ("never fabricate a dashboard custodial balance"), §6 (no withdrawal tool) |
| R4 | FR-PAY-7, NFR-6, SR-SC-1 (no chain names, gas or signatures on the pay page) | **Superseded** by FR-CHK-2 and FR-UX-1: plain business language first, but the network, token, required approvals/signatures and source-gas requirement are always disclosed, with technical evidence expandable. | WF§1, §4 |
| R5 | CON-4 (payers never pay gas) | **Scoped** to the direct Whitechain route (destination WBT is sponsored by the relayer). On an external route the payer pays source gas and any approval, disclosed before signing. The whole flow is never labelled gasless. | WF§1 |
| R6 | DEP-3 result and ARCHITECTURE §4 (customer guest wallet = key in localStorage) | **Replaced** by FR-CHK-1: an existing funded wallet is the default; the guest wallet is a clearly labelled demo fixture, off in production configuration. | WF§4, §10 (`guest-wallet.ts` row); PRD§6 |
| R7 | FR-GW-10 "showing that settlement is instant (T+0)"; SRS §1.2 "instant settlements" | **Wording removed** (FR-UX-1). Settlement views show observed inclusion and finality with timestamps. | WF§1, §12 first box |
| R8 | FR-GW-11 "USD converts 1:1 to USDT" | WhiteFlow invoices are denominated in settlement USDT atomic units (FR-BILL-1). Legacy multi-currency links/pages keep working, but the 1:1 rule is displayed as the operator's pricing rule, never as a parity claim. | WF§2 ("do not promise stablecoin parity"), PRD§7.2 |
| R9 | NFR-5 ("no event-log scans"); ARCHITECTURE §6 ("Neon holds only sessions…; the chain is the truth") | **Superseded for server workers** by FR-OPS-3/FR-OPS-5: chain events prove execution; Postgres owns drafts, grants, workflows and reconciliation projections; workers use checkpointed, bounded log queries. Browser pages still make no log scans. | WF§8 |
| R10 | SRS §1.2 / §7 "strictly on Whitechain Sepolia"; FR-GW-14 "no mainnet path exists" | **Extended:** Ethereum Sepolia is added as a source **testnet**. Still testnet only (CON-9); mainnet stays disabled behind W10. | WF§3, §11 |
| R11 | FR-PAY-15 (wallet = merchant identity); single-merchant env model (`MERCHANT_ADDRESS`, `SHOP_API_KEY`, `isShopInvoice`) | **Extended** by FR-BIZ-1, FR-BIZ-6 and FR-AUTH-1: identity is principal → membership → business, behind one AuthContext adapter. WF§4.1 asks for a vetted sign-in with a recovery path and passkey enrollment kept separate from wallet signing; the mechanism is a **pending human decision** (FR-BIZ-6). Until it is decided, wallet SIWE remains an adapter so W2 service work is not blocked. Demo-only eligibility checks are replaced by registered-business eligibility, not deleted. | WF§4.1, §6, §10; PRD§6, §14 |
| R12 | Duplicate ID FR-PAY-16 (SRS.md lines 110 and 111) | The owner sweep (v1.1, deployed) keeps **FR-PAY-16**. "Pay with your own wallet" becomes **FR-PAY-17** and is subsumed by FR-CHK-1. | SRS change control ("IDs are never reused") |
| R13 | PHASES "Never cut: the advance"; Phase 5 Capital tab screens | Deployed Capital contracts, server reads and existing positions stay. **No new Capital/lending screens** in WhiteFlow scope. Legacy obligations are protected by CON-11. | WF§3 ("Lending/revenue advances: maintain legacy obligations only"), WF§10 |
| R14 | FR-PRIV-1…4, FR-ARK-* (sponsor tracks) | Kept where implemented; not extended; not part of WhiteFlow acceptance. Cross-chain checkout reads made through the payer's own wallet provider are added to the FR-PRIV-4 exclusions (W7). | Owner instruction §4 ("preserve working integrations") |
| R15 | CON-5, CON-6, SR-* (hackathon submission) | Unchanged; not WhiteFlow acceptance criteria. | — |
| R16 | FR-GW-14 badge vs FR-PAY-7 | The "Test mode · testnet" badge stays on every page (supports CON-9). | WF§11 (testnet/prod separation) |

### 8.C New requirements

Priority: M must / S should / C could. **W** = WhiteFlow roadmap batch (WF§11).

#### 8.C.1 Business workspace, roles and receiving policy — FR-BIZ
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-BIZ-1 | A business workspace has a display name and an IANA timezone. A principal (signed-in account) can belong to several businesses through memberships; the active business is resolved on the server, never from a client-supplied id. | M | W2 | WF§4.1, §8 |
| FR-BIZ-2 | Membership roles Owner, Operator, Viewer with exactly the permissions of WF§9: Owner manages team/settings, approves receiving policies, publishes, authorizes refunds (subject to wallet authority); Operator drafts invoices, inspects payments, prepares links and refund proposals, but cannot change destinations or move treasury funds; Viewer reads only. Enforced in the shared services for dashboard, API and MCP. | M | W2 | WF§9 |
| FR-BIZ-3 | Receiving-wallet proof of control: a fresh, single-use, short-lived, domain-bound challenge (EIP-4361 format) signed by the receiving wallet. EOA signatures only; EIP-1271 contract wallets stay unsupported until an actual compatibility test passes. The status is labelled "wallet control confirmed", never business legitimacy. | M | W2 | WF§4.2–4.3, §9 |
| FR-BIZ-4 | Settlement policy versions are immutable rows: business, version, chain id, token address, recipient, policy hash, approver, approval evidence (wallet proof id), created time. The confirmation screen shows the full address with copy and explorer options, the network and the exact token, and requires an explicit confirm action. Only an Owner approves. A new version requires step-up authentication (engineering choice: a sign-in within the last 10 minutes, testnet value, labelled) and a fresh proof for the new address, notifies the other Owners and writes an audit event. Approved or published invoices keep their original policy version; changing settings or recovering an account can never redirect them. | M | W2 | WF§4.3, §4, §9; PRD§6 (settlement address changes) |
| FR-BIZ-5 | Activation: WhiteFlow collection starts only when an approved policy exists. A new workspace can draft and preview invoices before activation. A receiving wallet with outstanding V1 Capital claims or liens stays on the V1 liability-aware payment path (V1 MerchantPay, which repays investors) and is refused for V2 and any new route (CON-11). Verification statuses are shown separately and only when actually checked: account authenticated · wallet control confirmed · domain confirmed (not implemented) · human verified (optional, W8) · business verified (not implemented). | M | W3 | WF§4.4, §9, §10; PRD§11.1 |
| FR-BIZ-6 | Verified workspace sign-in with a recovery path and passkey enrollment, using a vetted authentication implementation; login is kept separate from wallet signing (a passkey is not an EVM signer). **Owner decision 2026-11-06 (testnet):** wallet-only SIWE behind the shared AuthContext, with memberships and server-revocable sessions, kept separate from receiving-wallet proof; the absence of WhiteFlow-side recovery is disclosed as a testnet limitation; email/passkey sign-in with reviewed recovery is required before broader pilots. No recovery path may change a policy or a published invoice. | M | W2 (testnet form) / before pilots (recovery) | WF§4.1, §6; PRD§19 |
| FR-BIZ-7 | Platform roles are separate from workspace roles: Platform support has redacted, scoped, audited diagnostic access with no payouts and no impersonation. Treasury administration is separate: tested multisig with distinct operators before production, least privilege, change delays where appropriate, explicit break-glass. A worker executes allowed intents only, never arbitrary vault withdrawals. Independent Approver / dual control is **deferred** to the team release. | M | W6/W9 | WF§9 |

#### 8.C.2 Authorization, idempotency and audit — FR-AUTH
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-AUTH-1 | One `AuthContext` {principal, business, role, scopes, grant or key id, request id, source} is produced by the cookie-session, API-key and OAuth adapters. Every shared service takes it and checks role/scope. Guessed or foreign ids return 404 with no disclosure. | M | W2 | WF§6, §8 |
| FR-AUTH-2 | Sessions are server-side and revocable (logout, membership removal, suspension). | M | W2 | WF§9 (stolen login); PRD§13 |
| FR-AUTH-3 | API keys belong to a business, carry scopes, show only a prefix after creation, and can be revoked. The env `SHOP_API_KEY` credential is confined to the labelled demo fixture. | M | W2 | WF§8; PRD§14 |
| FR-AUTH-4 | Every write takes business + operation + idempotency key and a canonical request hash (engineering choice: sorted-key JSON, SHA-256). Same key + same hash returns the original operation; same key + different hash returns 409. The idempotency record and the domain write commit in one transaction; uniqueness is enforced by the database under concurrency. | M | W2 | WF§8; PRD§12.3 |
| FR-AUTH-5 | Append-only audit events for every mutation: actor, source, role, grant/key id, request id, operation, target, version/hash, result. | M | W2 | WF§11 (W2 row) |

#### 8.C.3 Invoices and payment links — FR-BILL
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-BILL-1 | Invoice drafts are editable and private (off-chain): customer reference, description, optional line items, amount in settlement-USDT atomic units, concrete due date stored in UTC plus the business timezone. | M | W3 | WF§4.5, §8 |
| FR-BILL-2 | Approval creates an immutable invoice version binding business, invoice id/version, settlement policy version and hash, chain id, token, recipient, amount, fee policy and expiry, with a terms hash shown on the review page. Any change creates a new version and invalidates earlier approvals. | M | W3 | WF§6; PRD§7.1 |
| FR-BILL-3 | Draft, approval, on-chain issuance and link publication are distinct operations with distinct statuses. Publication never claims issuance before issuance is confirmed on chain. | M | W3 | WF§6 |
| FR-BILL-4 | A published invoice has a public payment link showing business display name, amount, token, network and due date; the customer needs no WhiteFlow account. | M | W3 | WF§1, §4 |
| FR-BILL-5 | Capacity: credited amount plus active reservations never exceeds the approved amount. Testnet release supports one-off full payment only. | M | W3/W6 | WF§3; PRD§15 invariants |
| FR-BILL-6 | An unpaid published invoice can be cancelled; cancellation and payment resolve to exactly one terminal outcome. | S | W3 | WF§7 (races) |

#### 8.C.4 Customer checkout and receipt — FR-CHK
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-CHK-1 | The default customer path connects an existing EIP-1193 wallet; mobile deep links only where tested. No customer registration, World ID or AI subscription. The localStorage guest wallet is a labelled demo fixture disabled in production configuration. | M | W3 | WF§1, §4, §10 |
| FR-CHK-2 | Before any signature: total paid, business net, each fee and who pays it, network and exact token, the approvals/signatures required, source-gas requirement, expiry and recovery expectations. | M | W3 | WF§4 |
| FR-CHK-3 | Exceptional states — unsupported network/token; insufficient funds or gas; rejected signature; expired quote; insufficient destination liquidity; deposited but destination delayed; action required; cancellation requested; refund pending; refunded — each show one clear next action and a support reference. State survives refresh and wallet switching. The UI never invites a second payment while one is unresolved. | M | W3/W7 | WF§4 |
| FR-CHK-4 | Separate state machines for invoice, source funding, destination settlement, finality and recovery (vocabulary PRD§7.3); no single `paid` boolean decides the workflow. | M | W3/W4 | WF§8; PRD§7.3 |
| FR-CHK-5 | Public receipt: invoice/version, business display name, policy hash, exact source/destination assets and amounts, fees, original payer, funding vault (external route), chain evidence links, finality observed-at, refund totals. No customer PII or secrets. It proves the recorded payment, not service delivery. | M | W3 | WF§8; PRD§12.4 |
| FR-CHK-6 | Only routes that can execute (asset, liquidity, amount, wallet capability) are offered. Unsupported network/token/wallet and exchange-send cases are explained before any deposit; no escrow address is exposed as a universal payment address. | M | W3/W7 | WF§1, §4 |

#### 8.C.5 Refunds — FR-RFD
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-RFD-1 | Direct Whitechain refund: beneficiary is the original payer only; cumulative refunds ≤ gross; proposal → Owner approval bound to the exact terms → wallet-signed execution → verified on chain. Status is never "Refunded" before the chain shows it. | M | W3 | WF§6, §7; PRD§9 |
| FR-RFD-2 | Cross-chain full refund after settlement: business-funded USDT returns to a restricted refund vault; only after that is verified does the source refund treasury pay the original source principal under the locked terms. Two legs tracked separately; liquidity shortage shows "Refund pending". Original source-escrow proceeds are never refunded again after Paid. Required before the corridor is enabled. | M | W7 | WF§7; PRD§9 |
| FR-RFD-3 | Double-payment protection for refunds is on-chain, not only in the database: each refund payout binds the original payment and beneficiary, the approved exact amount and a unique refund id, and executes idempotently (V1 direct refunds already enforce cumulative ≤ gross in MerchantPay). | M | W3/W6 | WF§7 ("do not leave 'database said paid' as the only double-payment protection") |

#### 8.C.6 Durable financial operations — FR-OPS
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-OPS-1 | Versioned migrations: a `schema_migrations` record (file, checksum, applied time), an advisory lock, each file applied once in a transaction, checksum-drift refusal, a documented rollback per migration. | M | W4 | WF§8, §11 |
| FR-OPS-2 | Durable jobs (run-at, lease, attempts, dedupe key) driven by a scheduler independent of user traffic; request handlers only enqueue. | M | W4 | WF§8 |
| FR-OPS-3 | Chain event indexer: unique (chain id, contract, tx hash, log index); block number and hash stored; checkpointed bounded ranges with a supported fallback; confirmation depth; reorg detection and rewind. | M | W4 | WF§8 |
| FR-OPS-4 | One durable nonce coordinator per signer; execution attempts (nonce, raw-tx hash) written before broadcast; uncertain results become Unknown and are reconciled before any replacement with economic effect. | M | W4 | WF§7, §8 |
| FR-OPS-5 | Per-asset, per-chain, append-only balanced journal in integer atomic units with explicit clearing accounts; corrections by reversal; a reconciliation job compares journal, invoice totals and chain facts and reports every difference. USDC and USDT never balance each other. | M | W4 | WF§8 |
| FR-OPS-6 | Transactional outbox: business events commit with the state change; a dispatcher creates at most one delivery per (endpoint, event); retries with bounded backoff run without user traffic; manual replay takes the same lease; signed, timestamped payloads with stable event ids and published receiver idempotency instructions; SSRF guard rejects private targets, redirects and DNS rebinding (connects to the vetted address). Never marked delivered before durably queued. | M | W4 | WF§8 |
| FR-OPS-7 | Feature flags default OFF for cross-chain, MCP writes, World sponsorship and mainnet; a flag can never switch an existing intent's route. Route health (RPC freshness, relayer state, inventory) with observed-at timestamps and explicit stale/unknown indicators. | M | W4 | WF§11, §13 |
| FR-OPS-8 | Environment separation: each deployment pins its chain ids and registry and uses separate test/production data, keys, RPCs and deployments; a mismatch is refused in UI, API, contracts and verification. | M | W4 | WF§11; PRD A36 |
| FR-OPS-9 | Every rate limit and sponsorship budget (web per-IP limits, relayer limits, sponsored allowances) is durable across restarts and instances; no in-memory-only limiter on a money or abuse path. | M | W4 | WF§9 ("rate limits and sponsorship budgets must survive restarts") |
| FR-OPS-10 | Pause and change control: pausing new quotes/deposits is separate from existing entitlements; outcome recording and safe claims keep working while paused; disabling a route never loses an in-flight payment; contract upgrades or counterpart changes need a versioned migration plan and active intents keep their original version. | M | W6/W7 | WF§9; PRD§13 |

#### 8.C.7 Routes, registry and corridor — FR-RTE, FR-XC
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-RTE-1 | Versioned chain/token registry: chain id, token address, decimals, display symbol, verification evidence (bytecode, decimals, token behaviour, EIP-712 domain / permit / EIP-3009 support, proxy and issuer/admin controls, check date). Symbols never identify a token. Testnet entries cannot load in a mainnet configuration. | M | W3 | WF§7; PRD§2.2 |
| FR-RTE-2 | `RouteProvider` interface (capabilities, quote, prepare funding, observe funding, observe settlement, request recovery, recovery status). A route records source/destination chain and token addresses, amount bounds, fees, quote/deposit/destination deadlines, finality policy, liquidity/reservation state, refund method, provider trust model and health. Providers: `DirectWhitechain` (enabled) and `CanonicalInventorySepolia` (disabled until DEP-8 and the W6/W7 gates). A third-party provider is added only after an executable quote and success/failure/refund tests for the exact pair. The capability version is stored with every intent; a new route never changes an existing deposit's terms. | M | W3 | WF§7 |
| FR-RTE-3 | Versioned contracts and APIs: ABIs and addresses generated per version from tested artifacts; V1 consumers keep working; V1/V2 contract versions appear in receipts and route configs; webhook payloads and the SDK are versioned; `packages/sdk` and `apps/shop` are updated and their existing integrations tested. | M | W3/W6 | WF§10; PRD§14 |
| FR-XC-1 | `SourcePaymentEscrow` (Ethereum Sepolia): exact registry-token deposit bound to a signed quote, immutable payer/refund recipient, destination/domain, intent id and deadline; balance-delta check; transfer and zero-value canonical message dispatch in one transaction; terminal-claim bookkeeping. | M | W6 | WF§7; PRD§8.4, §8.6 |
| FR-XC-2 | `DestinationSettlementVault` (Whitechain): bounded prefunded inventory, on-chain reservations, intake only when `msg.sender` is the local messenger **and** `xDomainMessageSender()` is the paired escrow, idempotent duplicates, immutable mutually exclusive Paid/Cancelled with tombstones, outcome dispatch, permissionless retry of the stored outcome only. No arbitrary-calldata execution. | M | W6 | WF§7; PRD§8.4–8.7 |
| FR-XC-3 | `PaymentRouterV2`: approved invoice terms, remaining-capacity enforcement, designated vault funding path, exact net accounting, origin attribution (source payer ≠ funding vault). Public calls cannot bypass funding or authorization. Recipients with outstanding V1 obligations are refused (CON-11). Final ABI reviewed before implementation. | M | W6 | WF§7, §10 |
| FR-XC-4 | Source entitlement after authenticated outcome: Paid → fixed treasury claim; Cancelled → original refund beneficiary claim; withdrawals separate from outcome recording; a missing acknowledgement never triggers a unilateral refund. | M | W6 | WF§7 |
| FR-XC-5 | Quote only after the reservation is confirmed (UI shows "Preparing quote" meanwhile); the signed quote binds every PRD§7.2 term under a globally domain-separated intent id. Deadlines are experimental values from PRD§8.6 (10 min deposit, 60 min fulfilment), tuned from measurements. **Source expiry permits a cancellation request, not an immediate refund; a destination reservation is never released on an off-chain timer alone** — expiry terminally cancels on the destination (tombstone) or keeps the liability. Multiple source attempts never exceed the invoice's authoritative capacity. | M | W7 | WF§7 |
| FR-XC-6 | Keeper drives outcome prove/finalize/replay; failed inner relays are detected (outer success is not application success) and replayed without double execution. Nonce/hash stored before broadcast; uncertain results are Unknown and reconciled before any replacement with economic effect. | M | W7 | WF§7; PRD§8.6 |
| FR-XC-7 | Treasury controls: inventory and reservation monitoring, refund reserve, gas, replenishment. Usable destination inventory = confirmed balance − active reservations − unpaid liabilities − refund reserves − safety buffer; pending source deposits and assets elsewhere never count as Whitechain liquidity. Insufficient inventory disables new quotes without abandoning existing obligations. Production requires a proven replenishment route for the exact USDT (W10). | M | W7 | WF§7, §12 |
| FR-XC-8 | Settlement is requested only after the worker has enforced the documented source finality policy on the authenticated deposit evidence; the policy is disclosed as an operational trust assumption, not a cryptographic proof. Settlement atomically consumes the reservation, settles through RouterV2 and records Paid — no partial success (inventory debited but invoice unpaid). | M | W6/W7 | WF§7 steps 4–5 |

#### 8.C.8 Remote MCP — FR-MCP (continued)
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-MCP-6 | Remote MCP at an HTTPS Streamable HTTP endpoint using the official `@modelcontextprotocol/sdk`, pinned at W5 after re-verification (1.32.2 was current on 2026-11-06 and negotiates up to 2025-11-25). Supported protocol versions are those the target clients actually support, chosen and tested at W5. A thin adapter over the shared services; no second payments backend. Read/draft tools ship first; publication only when client eligibility permits. | M | W5 | WF§3, §6, §8 |
| FR-MCP-7 | OAuth: authorization-code with PKCE S256, RFC 9728 protected-resource metadata, RFC 8707 resource/audience validation, issuer and expiry checks, short-lived access tokens, refresh rotation, revocation; registration compatible with the target clients (pre-registration/CIMD/DCR); no token passthrough, no shared superuser key. | M | W5 | WF§6; S3 |
| FR-MCP-8 | Tools and scopes exactly as WF§6 (`get_business_account`, `draft_invoice`, `get_invoice`, `list_invoices`, `prepare_payment_link`, `publish_payment_link` (optional), `list_payments`, `get_payment_status`, `get_settlement_summary`, `propose_refund`, `get_refund_status`). No transfer, withdrawal, calldata, SQL, URL-fetch or key tools. Responses return ids and observed status — never keys, bearer tokens, signatures, payment authorization headers, World proofs or unnecessary PII. Accurate annotations. | M | W5 | WF§6 |
| FR-MCP-9 | Publication and refund proposals bind business, immutable version, policy hash, ids, token, amount, recipient, deadline and an operation hash; approval happens only on an authenticated review page by an authorized role, is consumed once and re-checks balance/refundable amount and role. Model-supplied approval flags and conversation text are never authorization. | M | W5 | WF§6; PRD§10.4 |
| FR-MCP-10 | Customer names, descriptions, memos and webhook payloads are untrusted: bounded, escaped, never fetched, and unable to change scopes, recipients or available tools. | M | W5 | WF§6; PRD§10.4 |
| FR-MCP-11 | Connections page: setup instructions, active grants, revoke; public-directory status stated accurately. Creating a link never implies sending it (invoice email is a separate, later scope). The dashboard never depends on an AI client's availability or subscription. | S | W5 | WF§4, §6 |

#### 8.C.9 Optional human verification — FR-WLD
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-WLD-1 | Optional World IDKit operator check under Settings → Security: server-generated short-lived signed request, server verification, atomic nonce + scoped nullifier consumption, environment binding (staging rejected in production), one sponsored onboarding allowance per human. Labelled "human verified — not business verification". Never required for checkout or ordinary invoicing. | C | W8 | WF§9; PRD§11 |

#### 8.C.10 Experience — FR-UX
| ID | Requirement | Pri | W | Source |
|---|---|---|---|---|
| FR-UX-1 | User-facing brand WhiteFlow. No unverified "any chain", "instant", "safe", "audited", "insured", "institutional-grade" or blanket "gasless" claims; no hard-coded performance figures. | M | W3 | WF§1, §12 |
| FR-UX-2 | Dashboard navigation: Overview, Invoices, Payments, Connections, Settings. Existing gateway features (links, pages, vouchers, QR, reports, developers) live inside these; checkout and receipt stay separate public pages; Capital stays legacy/beta outside main navigation with existing positions visible. | M | W3 | WF§4 |
| FR-UX-3 | Receivables, settled collections, fees and refunds are distinct metrics computed from records; a wallet balance is labelled as not revenue. | M | W3 | WF§4 |
| FR-UX-4 | Keyboard operation, visible focus, readable contrast, labelled controls, inline validation, wallet return path, no horizontal overflow at 360 px, no colour-only status. | M | W3 | WF§4 |

#### 8.C.11 Non-functional
| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-15 | Money | Integer atomic units with explicit decimals; reject zero, negative, malformed and excess-precision input; no floating-point money; rounding rules frozen in the quote schema. | Unit + property tests |
| NFR-16 | Privacy | Invoice descriptions, names, emails and line items stay off-chain; on-chain data is limited to commitments (salted where guessable) and payment references; no person-to-wallet links are published on-chain (e.g. for a verification badge). | Review + receipt/log/model-output scan (AT-26 public receipts; AT-32 MCP output) |
| NFR-17 | Secrets | No private keys, tokens or raw signatures in model context, production browser storage, logs or receipts; treasury/relayer keys unreachable from browser and MCP. | Grep + MCP output tests |
| NFR-18 | Freshness | Every status shows observed-at and an explicit stale/unknown indicator. | RPC/worker interruption test |
| NFR-19 | Integrity | Zero duplicate economic executions in the adversarial suite; every event accounted for in reconciliation. | Invariant + fault-injection tests |

### 8.D Constraints and dependencies
| ID | Item |
|---|---|
| CON-9 | Testnet only. Mainnet stays disabled until a written W10 launch decision; never reuse testnet addresses on mainnet. (WF§11, §14) |
| CON-10 | No autonomous agent spending, x402 buying, chat-held keys or model-triggered money movement. (WF§3, §6) |
| CON-11 | Legacy V1 obligations are preserved: businesses and wallets with outstanding CapitalMarket claims or liens keep collecting on the V1 liability-aware path (V1 MerchantPay repays investors) and are refused by V2 and every new route until a reviewed migration preserves the obligations. Removing Capital from navigation never erases entitlements. **Before mainnet**, liability checks must not be defeatable merely by opening a second workspace or using a fresh wallet (W10 gate). (WF§10) |
| CON-12 | No simulated bridge or mock settlement in any real payment path; mocks only in isolated tests or labelled demo fixtures. (Owner instruction §6, §9; WF§3) |
| CON-13 | Pixa is a pattern reference only; no code copied. This deliberately tightens WF§5 (which allows copying with license notices) because CON-1 Start Fresh still applies to this repository. (WF§5) |
| CON-14 | Out of scope for this release: fiat conversion and bank payouts, new lending/revenue-advance features, autonomous agent spending/x402 buying, token creation, DEX trading, public liquidity pools or yield (treasury funding never via public LP pools or yield promises), partial or recurring payments. (WF§3, §7) |
| DEP-8 | Canonical zero-value message round trip on the deployed Ethereum Sepolia L1CrossDomainMessenger `0x547967f45d19dc4ca0a056ba525afe99bda18a88` ↔ Whitechain L2 messenger `0x4200…0007`, including authenticated origin and failed-relay replay (W1). Pairing and CGT mode verified read-only 2026-11-06; delivery unproven. Fallback: corridor stays disabled; direct-only release. |
| DEP-9 | Circle Sepolia USDC test funds and Sepolia ETH for the payer and operator test wallets. |
| DEP-10 | Real MCP client connectivity (Claude custom connector; any ChatGPT surface separately). Public-directory approval is a separate external gate. |
| DEP-11 | World developer app registration (only if W8 is enabled). |
| DEP-12 | Owner-provided `.env` values (names listed in `notes/whiteflow-status.md`): Postgres URL, funded testnet keys, RPC URLs. |

### 8.E Acceptance tests AT-19 … AT-56 (WF§12, the 38-item minimum checklist)

All start unchecked; a box is checked only with reproducible evidence.

**Product and onboarding**
AT-19 WhiteFlow branding consistent; no unverified "any chain", "instant", "safe", "audited" or "institutional-grade" claims. ·
AT-20 A new business can create a draft before completing collection activation. ·
AT-21 Receiving-wallet proof and immutable policy are enforced; a changed policy cannot redirect an existing invoice. ·
AT-22 A customer pays without a WhiteFlow account, World ID or AI subscription. ·
AT-23 Unsupported network/token/wallet/exchange-send cases are explained before a deposit. ·
AT-24 Exact fees/net receipt and recovery limitations are visible before approval. ·
AT-25 Mobile wallet return, refresh and expired-quote flows preserve correct state. ·
AT-26 Public receipts avoid private invoice/customer information.

**Authorization and MCP**
AT-27 Tenant spoofing and guessed ids fail for every session/API/MCP entry point. ·
AT-28 Viewer/Operator cannot elevate permissions or modify the receiving policy. ·
AT-29 OAuth expiry, wrong audience, wrong issuer, revoked grants and insufficient scopes fail. ·
AT-30 Prompt injection in invoice descriptions cannot cause privileged tools or recipient changes. ·
AT-31 Duplicate requests are idempotent; a changed payload under the same key conflicts. ·
AT-32 MCP never returns private keys, bearer credentials or payment authorization headers. ·
AT-33 Independent review invalidates changed invoice/refund terms; conversation text cannot authorize funds. ·
AT-34 Real client connectivity is demonstrated and public-directory status is stated accurately.

**Contracts and cross-chain correctness**
AT-35 Wrong token/amount/chain/domain/recipient/nonce/expired quote is rejected. ·
AT-36 Concurrent quotes/deposits cannot overspend inventory or invoice capacity. ·
AT-37 Only authenticated canonical counterpart messages are accepted. ·
AT-38 Destination Paid and Cancelled cannot both occur for an intent. ·
AT-39 Cancel-before-deposit and deposit-before-cancel produce correct immutable outcomes. ·
AT-40 A missing acknowledgement cannot trigger a unilateral source refund. ·
AT-41 Replayed outcomes cannot create a second treasury/refund entitlement. ·
AT-42 A failed inner message relay is detected and recoverable without double execution. ·
AT-43 Source payer is distinguished from destination vault in receipts/refunds. ·
AT-44 Reorg/RPC disagreement fails closed under the documented finality policy. ·
AT-45 Token pause/blocklist failures preserve recorded entitlement and accurate pending state. ·
AT-46 Full external success, cancellation, claim and post-settlement refund are demonstrated on deployed testnet contracts. ·
AT-47 Legacy claims cannot be bypassed by migration or a new route.

**Operations and business readiness**
AT-48 Worker crash/restart and uncertain broadcast do not duplicate financial actions. ·
AT-49 On-chain records, invoice totals and the per-asset ledger reconcile. ·
AT-50 Webhook loss/retry/replay and consumer idempotency are exercised. ·
AT-51 Inventory shortage disables quotes without abandoning existing obligations. ·
AT-52 Treasury reservation, refund coverage, gas and replenishment are monitored. ·
AT-53 Backup restore, key recovery, route pause and incident escalation are rehearsed. ·
AT-54 Optional World proof replay/environment controls pass; the label says human, not legitimate business. ·
AT-55 Runtime versions, dependencies, source history, license notices and reproducible build instructions are recorded. ·
AT-56 Mainnet exact asset, route, security, operational, economic and eligibility gates are approved before real funds.

### 8.F Proposed PHASES.md rows (WF§11; gates = exit evidence)

| Phase | Delivers | Gate |
|---|---|---|
| W0 Baseline | Inventory, matrix, this proposal | Baseline report with fresh check output (`notes/phase-W0-baseline.md`) |
| W1 Route experiment | DEP-8 | Source/destination/outcome tx evidence; failed-inner-call handling; measured timing; economics note |
| W2 Identity & service boundary | FR-BIZ-1–4, 6; FR-AUTH-1–5 | AT-27, AT-28, AT-31 (service level); policy-change invalidation; migration/backfill plan |
| W3 Direct collection | FR-BIZ-5; FR-BILL-*; FR-CHK-*; FR-RFD-1, FR-RFD-3; FR-RTE-*; FR-UX-* | Real testnet direct payment and refund end to end; AT-19–AT-26; desktop/mobile checks |
| W4 Durable operations | FR-OPS-1–9; FR-REL-10 | AT-48, AT-49, AT-50; crash/restart, duplicate, RPC-uncertainty, reorg evidence |
| W5 MCP | FR-MCP-6–11 | AT-29, AT-30, AT-32, AT-33, AT-34 |
| W6 Corridor contracts | FR-XC-1–4, FR-XC-8; FR-OPS-10; FR-BIZ-7 (treasury separation) | AT-35–AT-45, AT-47 in unit/fuzz/invariant/fork tests; no fake bridge |
| W7 Cross-chain UX | FR-XC-5–7; FR-RFD-2 | AT-46, AT-51, AT-52; reconciled balances |
| W8 Optional World | FR-WLD-1 | AT-54; checkout unaffected |
| W9 Pilot readiness | runbooks, evidence | AT-53, AT-55; all applicable boxes evidenced; documented limitations |
| W10 Mainnet decision | CON-9 | AT-56 (human/external) |

Feature flags default off for cross-chain, MCP writes, World sponsorship and mainnet (WF§11). Dependencies (WF§11): W1 and W2 run independently after W0; W3 needs W2 and does not wait for W1; W4 needs W2 and integrates W3; **W5 needs W2–W4 and cannot bypass missing durable services**; W6 needs W1 and frozen W2/W4 interfaces; W7 needs W4 and W6; W8 needs W2 and is optional; **W9's gate also requires no critical unresolved money/auth defects**; W10 needs pilot evidence. If W1 fails, W6/W7 stay disabled and the direct path continues.

### 8.G Per-batch gate artifacts (WF§11)
Every WhiteFlow batch records in its spec/build files: problem and acceptance criteria, SRS mapping, affected interfaces, migrations, tests with real output, residual risks, rollback plan and evidence links. (Adding these headings to `tools/batch-start.sh`'s template is a pipeline change and needs the human, PIPELINE §11; until then batches include them by hand.)

### 8.H Engineering choices (reversible, not requirements)
Labelled so they are not mistaken for owner rules: EIP-4361 format for wallet proofs (FR-BIZ-3); 10-minute step-up window (FR-BIZ-4); sorted-key JSON + SHA-256 canonical hash (FR-AUTH-4); 404 for foreign ids (FR-AUTH-1); "insured" added to the banned-claims list and "no colour-only status" (FR-UX-1/4); 10/60-minute corridor deadlines come from PRD§8.6, not WF. External facts used here (SDK version, messenger addresses, token metadata) carry their verification date and are re-checked at the batch that relies on them.
