# Spec: 004-P2-web-pages-and-sign-in

Request (verbatim): "build karo page pura" · "why not signing in ??" · "tum continue build karte raho" (human, 2026-11-05)

Reviewed before round 1 by plan-reviewer (00:01): 1 BLOCKER and about 20 SHOULD/NICE items. Each is fixed below, deferred with an owner, or flagged for the human.

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-4: a shop creates a checkout session through an API with a secret key and redirects the customer to a hosted pay page.
- FR-PAY-5: the customer pays a checkout sale by signing one message (press and hold, human pick 21:37).
- FR-PAY-6 (client and server side): the payment is bound to its order by a nonce the contract recomputes. The server rebuilds the authorization from its own session, so the browser can't change the amount, merchant or order.
- FR-PAY-7 / NFR-6: the pay page shows the amount and merchant in plain words, with no "sign", "gas", "wallet" or chain names.
- FR-PAY-9: a receipt with refund status and an explorer link.
- FR-PAY-15 (added by claude-research 22:57 after the human asked "why not signing in ??"): a merchant signs in with its own wallet (EIP-4361 / SIWE, signed HttpOnly session); the dashboard shows only that wallet's data.
- FR-REL-4: the 1 USDT minimum is enforced when a session is created.
- FR-REL-6: the merchant dashboard shows the relayer's health (WBT, gas today, budget left, unswapped fees, paused).
- FR-PRIV-1 (SRS 1.1): /checkout and the receipt make no browser chain reads; the amount, merchant and refund status come from our server.
- NFR-12: /checkout and /r: LCP ≤ 2.0 s on a mid-range phone over 4G, ≤ 200 KB of gzipped JS, no Nym and no three.js.
- NFR-13: home and the merchant page load the scene and Nym after first paint.
- AT-1 (partial): everything up to and including the call to the relayer's `/relay`, plus the shop's poll (PHASES cut list: "FR-PAY-10 webhooks → shop polls the receipt"). MerchantPay is deployed. The live AT-1 needs only `paySale` wired on the relayer, which today answers "this relayer supports \"pull\"".

## Constraints
- **Localhost only until Neon `app_sessions`.** Sessions, the in-flight claim and pending outcomes live in one process's memory. On Vercel, the create call and /checkout could hit different instances. Before any deploy, move them to Neon with a database unique claim (`INSERT … ON CONFLICT`).

## Acceptance criteria
- [ ] `POST /api/v1/sessions`:
  - the Bearer key is compared in constant time (`shopAuthorized`); 401 without it
  - validates the amount (format, 6 dp, 1–10,000 USDT) and items (≤ 20, qty 1–999, must add up to the amount)
  - returns 201 `{id, url, amount, expiresAt}`; sessions expire after 30 min
- [ ] `GET /api/v1/sessions/:id` (Bearer): `{id, status: open|pending|paid|expired, amount, reference, paymentId, txHash}`. A pending checkout is settled from the chain first. Tests: 401, 404, open → paid, and pending → paid after a timeout.
- [ ] `POST /api/v1/sessions/:id/pay`:
  - 404 / 409 (paid, with `receiptId`) / 410 (expired) / 503 (payments not configured)
  - validates `from`, `salt`, `signature` and `validBefore` (now+30 s … now+15 min, the relayer's window). The browser signs with `SIGNATURE_WINDOW_S = 465`, centred in that window, so a phone clock about 7 min off still works.
  - rebuilds the sale from the session and checks the signature with `verifyTypedData` before relaying; a mismatch gives 400 and the relayer is **not** called
  - **consumer rule:** after the relayer's 200, the server reads `saleOf` + `payments` at the receipt's block, retrying 5 × 1 s on a lagging RPC backend and never reading a later block. It records the payment only if gross == amount, payer == the signer and merchant == the session's merchant.
- [ ] **No double charge, and no false "Nothing was charged"** (relayer contract 22:13 and 22:50; plan review):
  - one payment in flight per checkout (409 for the concurrent second). **A fresh salt per attempt**: MerchantPay refuses a second payment for the same order on-chain (`OrderPaid`), so reusing one nonce per checkout protected nothing, and it let anyone who burned that nonce lock the checkout (security R1 S2; changed in round 2).
  - **pending** when the outcome is unknown: a timeout, a dropped connection, a 502 or other 5xx, or a 200 the chain doesn't confirm. The customer sees "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes."
  - a 422 `replay` is a **refusal**, never pending: anyone can burn a nonce on purpose. The chain is checked first, and the receipt shows if this customer's order is paid.
  - **the chain settles a pending checkout** on the next pay attempt, on page load and on the shop's poll:
    - paid by this customer, with the exact amount → recorded (`txHash` null), and the receipt shows
    - not paid and past the approval's `validBefore` + 60 s → USDT can no longer settle it, so the checkout opens again
    - otherwise it stays pending (409, "Don't pay again")
  - unlocks with a plain reason only when nothing was sent:
    - a 422 (`insufficient_funds` gets "There isn't enough balance…", any other code gets "start the checkout again"), but **first** the chain is checked, and if the order is already paid by this customer (e.g. `OrderPaid` from a second tab), the receipt shows instead
    - a 503 or 429
    - a connection that never opened (ECONNREFUSED / ENOTFOUND / EAI_AGAIN)
  - a browser→server fetch that throws marks the page pending: no "Nothing was charged"
  - the relayer's own error text never reaches the customer
- [ ] `/checkout/[sessionId]`: a static night scene (`StaticScene`, 2D canvas) with the session streamed in Suspense.
  - The sheet follows the approved demo: shop, order, items, `amount-xl` total, a "Hold to pay 25.00" HoldButton, and "You pay exactly 25.00 USDT. No fees for you."
  - States: ready, expired, "Payments aren't live yet", error, pending ("Don't pay again", no button), paid (receipt inline).
  - The signer loads lazily when the browser is idle.
  - An unknown id streams Next's 404 page with `noindex`.
- [ ] `/r/[id]` (receipt id = checkout id): amount, shop, time (IST), order, **refund status read from `payments(id).refunded` on the server** (1.5 s limit, else "Couldn't check right now"), and an explorer link (or "Payment number N is confirmed." when it was found by reconciling).
- [ ] Home `/`: hero over DitherScene with the night wash; "Try a checkout" (a plain form POST to `/api/demo-checkout`, answered with 303, so the checkout is a full page load under its own CSP; security R1 S3); "How it works". The Phase 1 proofs move to `/proofs`.
- [ ] `/merchant`: signed out, it shows a "Sign in with your wallet" gate. Signed in, it shows today's sales (labelled "Sales, before fees"), relayer health with unswapped fees, the payments table and a sign-out link.
  - `GET /api/auth/nonce` sets an HttpOnly SameSite=Lax cookie holding **`nonce.issuedAt.HMAC(AUTH_SECRET)`**.
  - `POST /api/auth/verify` accepts only a nonce cookie we issued in the last 5 min, and an EIP-4361 message for our domain, that nonce, chain 1874 and **an `expirationTime` no more than 10 min ahead**. It checks the signature with viem `verifyMessage`, sets an HMAC-signed `mc_session` cookie (HttpOnly, SameSite=Lax, Secure on https, 8 h) and clears the nonce.
  - Tests: a forged (plain) nonce cookie gives 401; an edited, wrong-secret or old nonce cookie is refused; a message with no expiry or a 1-day expiry is refused.
  - `POST /api/auth/logout` clears the session cookie. Without `AUTH_SECRET` (≥ 32 chars), sign-in is off with 503.
  - Each signed-in wallet sees only payments made to its own address; any other wallet gets a note that the demo shop is paid to `MERCHANT_ADDRESS`.
- [ ] **HoldButton as a money control** (002 security R3 D2–D5, code R3 D1), verified by re-running 002's probes against /checkout:
  - `review-security-hold-props.mjs`: a label change mid-hold cancels (0 calls)
  - remount while busy: no second call (the page owns the in-flight payment)
  - blur or a hidden tab mid-hold cancels
  - success leaves the receipt, never an idle button
  - `review-code-activity-remount.mjs` / `-activity-hold.mjs`: the scene still draws after a hidden route is shown again (draws > 0), and a hidden "done" comes back as "Hold" with the next hold confirming once
- [ ] Security headers in `next.config.ts`: X-Frame-Options DENY, nosniff and Referrer-Policy on every page. **/checkout and /r get a strict CSP** (claude-contracts S6 c, 002 security D1):
  - default/script/connect `'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`
  - scripts keep `'unsafe-inline'` (a nonce forces dynamic rendering and loses the static shell, NFR-12); dev adds `'unsafe-eval'`
  - home and /proofs get no CSP, because they need Nym's CDNs and gateways
  - Check: 0 `securitypolicyviolation` events and every script from our own origin.
- [ ] **FR-PAY-7 / FR-PRIV-1 scan:** in a real browser, /checkout and /r in every state reachable locally (ready, expired, not live, error, pending, paid). `innerText` has no match for `/\b(sign|gas|wallet|whitechain|chain)\b/i`, and the page makes 0 requests to other origins.
- [ ] **NFR-12, measured as a phone downloads it:** on /checkout/<id> in Chrome, after the idle signer has loaded, the sum of `encodedBodySize` over `performance.getEntriesByType("resource")` for `.js` (compressed bytes as `next start` serves them) is ≤ 204,800 B. The HTML's `noModule` polyfill (39 KB) is never fetched by modern browsers, so summing the HTML's script tags overstates it.
  - Builder, 00:16: first load 161,027 B (9 chunks) plus the signer at idle (+1.1 s) 18,573 B = **179,600 B**. The plan reviewer independently got about 175 KB.
  - Lighthouse mobile JSON on /checkout/<id> and /r/<id>: LCP ≤ 2000 ms and performance ≥ 90.
- [ ] **NFR-13, measured:** Lighthouse mobile on / and /merchant, plus the network log: the three.js chunk and the Nym worker are requested only after first contentful paint.
- [ ] `npm test` exits 0 with 0 failures. Named money-path tests: concurrent pay, timeout pending → paid → receipt, pending → open after validBefore, 422 + paid on chain → receipt, 429 busy, chain not confirming a 200 → pending, consumer rule with payer, RPC-lag retry, KIND_SALE vector, nonce-cookie forgery. `LIVE=1 node --test test/onchain.live.test.mjs` passes against the deployed MerchantPay: the smoke sale settles; amount − 1, another order and another payer give null.
- [ ] typecheck, lint and build pass. Screenshots at 375 and 1440, light and dark, of /, /checkout (ready, pending, paid), /r and /merchant (signed out).

## Files (claude-frontend)
- `apps/web/lib/{usdt,pay,sign-sale,sessions,settle,config,relay,onchain,auth,merchant-session,guest-wallet}.ts`
- `apps/web/app/page.tsx`, `apps/web/app/api/demo-checkout/route.ts`, `apps/web/app/{checkout/[sessionId],r/[id]}/not-found.tsx`, `apps/web/app/proofs/page.tsx`, `apps/web/app/merchant/page.tsx`, `apps/web/app/checkout/[sessionId]/page.tsx`, `apps/web/app/r/[id]/page.tsx`
- `apps/web/app/api/v1/sessions/route.ts`, `apps/web/app/api/v1/sessions/[id]/route.ts`, `apps/web/app/api/v1/sessions/[id]/pay/route.ts`, `apps/web/app/api/auth/{nonce,verify,logout}/route.ts`
- `apps/web/components/{Checkout,StaticScene,DitherScene,HoldButton,NotFoundSheet}.tsx`, `apps/web/components/merchant/SignIn.tsx`
- `apps/web/next.config.ts`
- `apps/web/test/{checkout-api,auth,onchain,onchain.live,settle}.test.mjs`, `apps/web/test/checkout-edges.test.mjs` (added by the tester in round 1)
- Removed: `apps/web/app/actions.ts` (the server action), `apps/web/components/merchant/InvoicePricer.tsx`

## Env (server only, never NEXT_PUBLIC)
`MERCHANT_ADDRESS` (the human's merchant wallet, **needed from the human**; locally the contracts lane's smoke-sale merchant `0xb4E7…714D`), `MERCHANT_NAME`, `SHOP_API_KEY` (≥ 24 chars), `AUTH_SECRET` (≥ 32 chars), `MERCHANT_PAY_ADDRESS`, `RELAYER_URL`. Locally they live in the git-ignored `apps/web/.env.local` (generated test values); later in Vercel.

## MerchantPay facts (deployed 0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7, ARCHITECTURE §2, verified by claude-research 23:12)
- `KIND_SALE = 2` (INVOICE = 1). Our `saleNonce` equals the contract's `saleNonce` view on a fixed vector read from chain 1874 (test).
- `paySale` reverts `OrderPaid()` when an order is paid a second time (`MerchantPay.sol:161`). That matches the human's gate decision (23:30): repeat payments are refused on-chain, as well as by our server lock and the reused nonce.
- The relay fee of 0.10 USDT is taken inside the payment: the customer pays exactly the total, and the merchant receives the total minus 0.10.
- **Consumer rule (claude-contracts S6 a):** an order counts as paid only if `payments(saleOf(merchant, orderRef))` has gross == the session amount, payer == the signer and merchant == the session's merchant.
- Use `packages/shared/merchantPay.ts` (ABI, constants, address) once it's merged to main; until then the vector test guards our copy.

## Ponytail ladder
- Needed: FR-PAY-4/5/9/15 are Phase 2 musts on the gate G2 path (AT-1).
- In repo: guest wallet, HoldButton, DitherScene, tokens.
- Platform: `node:crypto` (`timingSafeEqual`, `randomUUID`, HMAC), fetch with `AbortSignal.timeout`; viem `verifyTypedData`, `viem/siwe`, `verifyMessage`. No auth library, no wagmi.
- No new dependency.
- Cut after the plan review: the "Get paid today" InvoicePricer. FR-INV-2 is Phase 4 and its float maths showed 980.66 where the contract pays 980.65; it returns with CapitalMarket, using the contract's own rounding.

## For the human at the gate (PIPELINE §11)
1. Public landing copy on `/` (hero and "How it works").
2. `'unsafe-inline'` scripts on /checkout and /r, where 002 security D1 asked for `'self'` only.
3. "Try a checkout" on the public home ends in "There isn't enough balance" for visitors, because guest wallets start with 0 USDT (no faucet button). Choose a demo flow.
4. The unknown-outcome rule: pending, settled by the chain, and reopened only after `validBefore` + 60 s. Changed in round 2 (security S2): a relayer `replay` is a refusal (the chain is checked first), never pending, and each attempt signs with a fresh salt, because on-chain `OrderPaid` already blocks a second payment for the order.

## Out of scope (owner claude-frontend unless noted)
- Invoices (FR-PAY-1/2/3, `/pay/[invoiceId]`), refunds (FR-PAY-8), webhooks (FR-PAY-10), apps/shop (FR-PAY-11, batch 005).
- The live relay (needs `paySale` on the relayer, claude-relayer).
- Neon `app_sessions` (before any deploy).
- Keying /r by the on-chain paymentId (survives restarts; with Neon).
- A distinct relayer code for `OrderPaid` (asked 00:09) and per-IP rate limiting for server-to-relayer calls (asked 00:09, claude-relayer).
