VERDICT: PASS
# Security review: 032-P5-pay-with-wallet, round 1 (phase mode, Money: yes; one pass, only HIGH/CRITICAL block)

Scope: `git diff origin/main...HEAD -- apps/web` limited to the spec's files (lib/payer-wallet.ts, lib/sign-sale.ts, the two
funds routes, components/WalletPay.tsx, Checkout.tsx, InvoicePay.tsx, the three tests). Read against FR-PAY-16, FR-PAY-5,
FR-PAY-7, FR-PRIV-1, NFR-4, NFR-8, AT-17, and the unchanged pay routes (app/api/v1/sessions/[id]/pay, invoices/[id]/pay),
lib/pay.ts, lib/usdt.ts, lib/onchain.ts, lib/server/http.ts, next.config.ts. No contract, relayer or pay-route change in
this batch. HIGH: 0. CRITICAL: 0. MEDIUM: 0. LOW: 3 follow-ups, INFO: 3.

## Checked, no finding
- **What is charged, to whom, for which order.** The wallet signs the output of the same `saleAuthorization` /
  `invoiceAuthorization` the guest signs (lib/sign-sale.ts:34, :54): the domain is fixed by our code (usdtDomain: Tether
  USD, v1, chain 1874, the USDT contract), `to` = MerchantPay, value = the units on the button (or owed + fee), the nonce
  binds kind + merchant/invoice + orderRef + amount + a fresh 32-byte salt from crypto.getRandomValues. validBefore is
  computed before the wallet prompt opens (min(now+465 s, checkout expiry)), so an approval left open in MetaMask can't
  extend its own life. The server rebuilds the typed data from its own record and verifies against `from` (unchanged), so
  nothing the browser or the wallet sends can change amount, payee, merchant or order. ReceiveWithAuthorization (to ==
  msg.sender) keeps a leaked signature usable only by MerchantPay for that one order.
- **Provider output.** `requestAddresses` checksums with getAddress (viem 2.57.13 actions/wallet/requestAddresses.js);
  the chain id is re-read after switch/add and anything but 1874 is refused before the prompt (payer-wallet.ts:48);
  signTypedData goes out as `eth_signTypedData_v4` with retryCount 0 (no duplicate prompts). A provider that lies about
  its address, chain or signature only produces a body that fails parseApproval or verifyTypedData (400, nothing
  relayed). Smart-account (EIP-1271/6492) signatures fail the 65-byte check: refused, nothing charged (out of scope).
- **No new way to get a payment relayed.** The pay routes are unchanged; anyone could already sign with any key (the
  checkout-api tests do). Two signers on one order: the per-checkout / per-invoice lock, `pending`, OrderPaid and
  MerchantPay's WrongAmount still decide; nothing here touches them.
- **In-flight guard.** Both sheets keep one page-owned `inFlight` ref shared by the hold and the wallet button
  (Checkout.tsx:104, InvoicePay.tsx:72); `walletPayer` (connect, funds check) runs inside it, so a hold pressed while
  MetaMask is open returns the wallet's promise instead of starting a second attempt; the wallet button is aria-disabled
  with no onClick while either path is busy (Checkout.tsx:358, InvoicePay.tsx:171). The countdown still never ends a
  sheet with a payment in flight (`!paying` semantics unchanged for `Via | null`). InvoicePay's old `??=` pattern and the
  new explicit guard are equivalent.
- **Funds routes.** Answer only `{enough}` with `cache-control: no-store` (client also `cache: "no-store"`); errors are
  fixed strings; no logging in either route; rate limit runs first, before any validation, DB or chain read; payer
  checked with isAddress; invoice id regex as the pay route; invoices limited to our shop (`isShopInvoice`, missing and
  foreign both 404). Unit math matches the pay routes: checkout `amountDue ?? session.amount` (`??` keeps a 0n),
  invoice `amount - paid + fee` with `fee === null` (keeps 0n). Built as dynamic (ƒ) routes, so no prerendered answer.
  The "oracle" compares a public on-chain balance with an amount the public pay page already shows: nothing new leaks.
- **FR-PRIV-1 / CSP.** `git diff origin/main...HEAD -- apps/web/next.config.ts` is empty; pay-page `connect-src 'self'`
  still blocks any browser chain read; all balance reads go through our server; the wallet path talks only to
  `window.ethereum`. No dangerouslySetInnerHTML; the only new link is a static metamask.io URL with rel="noreferrer".
- **Tests:** `node --experimental-test-module-mocks --test test/payer-wallet.test.mjs test/funds.test.mjs`: 14 pass,
  0 fail (11.5 s). Keys in tests are generated or derived at runtime.
- **Secret grep** `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over every file in `git diff --name-only
  origin/main...HEAD` plus probes/wallet-walk.mjs: one hit, `.batches/032-P5-pay-with-wallet/round-1/ci.md:69`, the word
  PRIVATE_KEY in prose describing ci's own grep. Not a secret. No other hit.

## FOLLOW-UP (non-blocking)
**L1 (LOW, privacy): the payer's address travels in a GET query string, and the guest check runs on every page view.**
components/WalletPay.tsx:25 (`fetch(\`${fundsUrl}?payer=${payer}\`)`), :56 (`guestAddress()` on idle after first paint).
Sketch: platform request logs usually keep the full URL, so our logs now pair IP + checkout/invoice id + address for every
visitor who merely opens a pay page (the guest key, which links that browser across every shop on the gateway), and for
the customer's real MetaMask address on the wallet path. Before this batch the address reached us only in a POST body
when the customer paid. It also creates a guest key in localStorage for every visitor. Fix: send `{payer}` as a POST
JSON body (same response, same rate limit), or note it in the README privacy limitations. Owner: the web lane that owns
apps/web (batch owner per batch.md: claude-research).

**L2 (LOW, docs): FR-PRIV-4 exclusions don't list the customer's own wallet traffic.** lib/payer-wallet.ts:45.
`wallet_addEthereumChain` hands MetaMask our two 1874 RPC URLs; from then on the wallet polls them (and its own services)
from the customer's IP with the customer's address. That's the wallet's traffic, not the page's, so FR-PRIV-1 holds, but
the README's exclusion list (FR-PRIV-4) should name it next to "the server-side read behind the pay and checkout pages",
together with the new funds routes. Owner: claude-research (README/SRS).

**L3 (LOW, availability/abuse): no client timeout on the funds check; worst-case server read time is long.**
components/WalletPay.tsx:25, lib/onchain.ts:33, sessions/[id]/funds/route.ts:12, invoices/[id]/funds/route.ts:11.
With a hanging RPC, one funds request can take about 2 tries × 3 viem attempts × 10 s ≈ 60 s of function time and up to
6 eth_calls, and the wallet path waits on it (button says "Check your wallet…") before the MetaMask prompt opens. Bounded
by the 30/min/IP limit, and the unlimited pay routes already allow the same reads, so no new class of amplification.
Fix: `signal: AbortSignal.timeout(3000)` on the client fetch (timeout → "unknown", which already falls through to the
server's own check), and optionally `tries: 1` in the funds routes. Owner: web lane.

## INFO (no action needed)
- I1: the rate-limit key is the first x-forwarded-for hop, per instance (pre-existing ponytail in lib/server/http.ts).
  Vercel overwrites XFF so it can't be spoofed there. A shared NAT (the venue Wi-Fi) or a cross-site page firing
  no-cors GETs can use up a visitor's 30/min; the answer then becomes 429 → "unknown" → the hold is shown and the pay
  route checks the balance itself. It fails open to the pre-batch behaviour, never blocks a payment.
- I2: the short notice (WalletPay.tsx:79) now asks customers to fund the localStorage guest key, which any XSS on the pay
  page could read (`script-src 'unsafe-inline'`, pre-existing; guest-wallet.ts:9 ponytail). Testnet only; keep the README
  limitation line.
- I3: the invoice funds route answers for paid/cancelled invoices (owed 0 → `balance >= fee`). Boolean only, and the sheet
  asks only while the invoice is open. Harmless.
