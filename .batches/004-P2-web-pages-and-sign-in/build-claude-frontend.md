STATUS: READY

# Build report: 004-P2-web-pages-and-sign-in (claude-frontend), round 2

Round 1: tester, code, security and ux all CHANGES. Mapped finding by finding:

## Money and security
- **[security S1 / code M1] An expired checkout with a pending attempt** no longer answers 410 "ask for a new one" before the chain is asked. The early 410 applies only when nothing is pending; otherwise the route settles first (paid → receipt, pending → 409 "Don't pay again", open and expired → 410). On the client, `confirming` wins over `expired`. Test: an expired, pending checkout gives 409 pending, then 409 + receiptId once the chain shows it paid.
- **[security S2] A 422 `replay` is a refusal now, never pending:** a stranger who burns a nonce can't lock the checkout. The chain is checked first, so if this customer's order is paid the receipt shows. **The per-checkout salt reuse is deleted:** each attempt gets a fresh salt (`lib/sign-sale.ts`), because on-chain `OrderPaid` already blocks a second payment for the order. Test: a stranger's replay gives 400 with no pending, the next attempt relays at once, and a replay on a paid order shows the receipt.
- **[security S3 / tester 2] Soft navigation bypassed the CSP:** the server action is replaced by `POST /api/demo-checkout`, answered with 303, behind plain `<form method="post">` on / and /merchant, so it is a full load. Live: 303 → /checkout/<id>, which carries the CSP header.
- **[code M2] Checkout:** any 5xx but 503 (and 409, and a thrown fetch) → "confirming", never "Nothing was charged". A 410 → "expired" with no button.
- **[tester 1 / code LOW] A malformed signature** gave 500: `verifyTypedData(...).catch(() => false)` makes it 400 and the relayer isn't called. The tester's `todo` is now a plain test, and the builder added one too.
- **[security S5] The shop's poll says `pending`** while a payment is in flight (`isInFlight`). Test added.
- **[security S4] A 422 whose chain check fails:** the copy stays "That approval didn't work. Nothing was charged; please start the checkout again." (`lib/relay.ts`). That attempt was refused before sending, so nothing was charged by it; and a retry can't pay twice, because `OrderPaid` holds on-chain.
- **[code LOW] Races:** `clearPending(id, expected)` only clears the attempt it read, so a newer pending one survives a slow settle; `recordPayment` keeps the first record, so a relayed txHash is never overwritten. Both are tested in `test/settle.test.mjs`.
- **[tester] Sign-in replay inside the nonce window:** `consumeNonce` makes a nonce single use on the server (per process, like the sessions). Test: replaying the same verify request gives 401.
- **[security INFO]** The SIWE nonce comes from `randomBytes(16)` instead of viem's Math.random. A relayer `txHash` must match `0x` + 64 hex, or it counts as unknown. `cookieFrom` survives a malformed %-escape.
- **[code LOW]** HoldButton's window and document listeners belong to one AbortController per hold. Duplicate item names no longer give duplicate React keys.

## UX
- **[ux must 1] Branded not-found:** `components/NotFoundSheet.tsx` on the static scene, plus `app/checkout/[sessionId]/not-found.tsx` ("This checkout link doesn't work … Nothing was charged from this page.") and `app/r/[id]/not-found.tsx` ("No receipt here yet …"), each with a link home.
- **[ux must 2] Pending reads as pending:** a bordered panel, `role="status"`, a warning "Confirming" pill, the unconfirmed copy in ink (not critical red), and a quiet "Check again" button (a full reload, so the server settles from the chain).
- **[ux LOW]**
  - item prices are `tabular-nums` sans, not mono
  - the paid state has an h1 (sr-only)
  - the hold hint tells screen readers that Enter also pays
  - the gate copy no longer says AUTH_SECRET
  - the no-wallet message works on a phone ("open this page in your wallet app's browser")
  - the home footer link is 44 px
- **[tester / FR-REL-6 / code M3]** "Gas spent today" is shown; the relayer balance is rounded to 4 decimals.
- **[code LOW, scope]** Cut from /merchant: the "Cash advance" placeholder, the "To investors" row and the "Refund soon" column. They come back with their contracts and with refunds (the invoice batch).
- **[tester] Receipt LCP:** the receipt card renders at once; only the refund line waits (its own Suspense, "Checking…", 1.5 s limit).

## Not changed, deliberately
- **security S6:** unbounded demo sessions and no `/pay` rate limit. The spec's constraint is "localhost only until Neon", so this goes in the Neon/deploy batch.
- **code LOW:** `packages/shared/merchantPay.ts` is on main, but importing it needs `turbopack.root` outside the app; the vector tests guard our copy until then.
- **Sessions never evicted:** same Neon constraint.

## Verified (00:58)
- typecheck 0 · lint 0 · `npm test` **80 pass**, 1 skipped (the live test), 0 todo · build 0 (adds `ƒ /api/demo-checkout`; removes the server action).
- **Live on :3100:**
  - `POST /api/demo-checkout` → 303 → /checkout/<id> with the CSP header
  - home's form is `<form action="/api/demo-checkout" method="post">`
  - unknown /checkout and /r ids show the branded sheets
  - the nonce cookie is 32 hex

# Round 1 report (kept)

# Build report: 004-P2-web-pages-and-sign-in (claude-frontend), round 1 (after the plan review)

The plan-reviewer (00:01) found 1 BLOCKER and about 20 SHOULD/NICE items in the spec. Built since, test first each time (RED, then GREEN):

- **BLOCKER, sign-in replay.** The nonce cookie was a plain, caller-chosen value, and the SIWE message had no expiry, so any captured signature could sign in forever.
  - Fix: the cookie is now `nonce.issuedAt.HMAC(AUTH_SECRET)` (`signNonce`/`readNonce`, 5 min); the server requires an `expirationTime` ≤ 10 min ahead; the client sets 5 min.
  - Tests: a forged plain cookie gives 401 at the route; an edited, wrong-secret or old cookie is refused; no expiry or a 1-day expiry is refused.
- **Unknown outcomes are pending, settled by the chain** (`lib/settle.ts`, `session.pending`). This replaces the permanent lock and the false copy "the shop will see it".
  - Paid by this customer → recorded (`txHash` null) → receipt.
  - Not paid and past `validBefore` + 60 s → opens again.
  - Otherwise 409 "Don't pay again".
  - It runs on the next pay attempt, on checkout page load and on the shop's poll.
- **A 422 checks the chain before "start again"** (e.g. `OrderPaid` from a second tab): if paid by this customer, the receipt shows. A 429 counts as busy ("Nothing was charged").
- **Browser → server fetch throws** (4G drop): the page goes pending, never "Nothing was charged".
- **Consumer-rule read retries** 5 × 1 s at the receipt's block on a lagging Ankr backend ("header not found"), never falling back to a later block; failures are logged.
- **`GET /api/v1/sessions/:id`** (Bearer, shared `shopAuthorized`): `{status: open|pending|paid|expired, paymentId, txHash, …}`, so batch 005's shop can poll (PHASES: polling replaces FR-PAY-10 webhooks).
- **Receipt** reads `payments(id).refunded` on the server (1.5 s limit; the timer is cleared), so the refund line is real. No explorer link when there's no `txHash`.
- **Dashboard:** "Sales, before fees"; the relayer's unswapped fees are shown (FR-REL-6); the stale "once the payment contract is live" note is replaced with how the 0.10 fee works; no explorer link when there's no `txHash`.
- **Cut the InvoicePricer:** FR-INV-2 is Phase 4, and its float price (980.66) differed from the contract's tranches (980.65).
- `SIGNATURE_WINDOW_S = 465`, centred in the relayer's +30…+900 s window, so a phone clock about 7 min off still works.
- `test/onchain.live.test.mjs` (`LIVE=1`): the smoke sale settles; amount − 1, another order and another payer give null. **Passed live in 1.8 s.**

## Verified (00:16)
- typecheck 0 · lint 0 · `npm test` 59 pass + 1 skipped (the live test) · build 0 (adds `ƒ /api/v1/sessions/[id]`).
- **Live:** `POST /api/v1/sessions` 201 → `GET …/:id` gives `open`, and 401 without the key; `/`, `/proofs`, `/merchant` and `/checkout/<id>` all return 200.
- **NFR-12 as Chrome downloads it** (resource `encodedBodySize`): first load 161,027 B plus the signer at idle 18,573 B = **179,600 B** ≤ 204,800. The HTML's 39 KB `noModule` polyfill isn't fetched. My earlier "195.3 KB" summed the HTML's script tags and counted that polyfill.
- The CSP and the real-relayer round trip from the first build still apply (no header or flow change since).

# Before the plan review (kept)

# Build report: 004-P2-web-pages-and-sign-in (claude-frontend), round 1

## DONE
Built and tested in the scratchpad while batches 002 and 003 were under review, then ported file by file. A `diff -rq` against the scratch copy shows only intended differences: the repo's tsconfig formatting, and the batch 003 test file.

- **Checkout API** (`app/api/v1/sessions`, `[id]/pay`, `lib/{sessions,config,pay,relay,onchain,usdt}.ts`):
  - Constant-time Bearer check; validated amounts and items.
  - The server rebuilds the sale from its own session and checks the signature with `verifyTypedData` before calling the relayer.
  - One payment in flight per checkout.
  - The relayer's 22:50 error codes are mapped: `replay`, 502, a timeout or a dropped connection stay locked ("Don't pay again"); other 422s, 503 and a refused connection unlock with a plain reason.
  - **Consumer rule:** after the relayer's 200, `saleSettled` reads `saleOf` + `payments` on chain at the receipt's block, and records the payment only if gross == amount, payer == the signer and merchant == the session's merchant.
- **`KIND_SALE = 2`**, pinned by a test vector read from the deployed MerchantPay's `saleNonce` view.
- **Pages:**
  - `/`: hero over the DitherScene, "Try a checkout", "How it works".
  - `/proofs`: the Phase 1 proofs, moved here.
  - `/checkout/[sessionId]`: StaticScene, the session streamed in Suspense, the signer loaded when the browser is idle.
  - `/r/[id]`: the receipt.
  - `/merchant`: SIWE gate, today's sales, relayer health (FR-REL-6), payments table, pricer preview.
- **Sign-in (FR-PAY-15):**
  - `app/api/auth/{nonce,verify,logout}`; `lib/{auth,merchant-session}.ts`.
  - EIP-4361 checked for domain, nonce, chain 1874 and expiry.
  - The HMAC-signed `mc_session` cookie is HttpOnly, SameSite=Lax, Secure on https, and lasts 8 h.
- **Carried from batch 002:**
  - code R3 D1: no `forceContextLoss`; HoldButton comes back idle after a hidden "done" but stays busy in flight.
  - security R3 D1: frame blocking, plus the CSP below.
  - D2: a label change cancels a hold.
  - D3: the page owns the payment in flight.
  - D4: an unknown outcome or 409 hides the button; one salt per checkout.
  - D5: blur or a hidden tab cancels a hold.
  - LOW #17: 12 px slop for the touch bounds check.
- **Headers:** X-Frame-Options DENY, nosniff and Referrer-Policy everywhere. A strict CSP on `/checkout` and `/r` (claude-contracts S6 c).

## Verified
- `npm run typecheck` 0 · `npm run lint` 0 · `npm test` **49/49** · `npm run build` 0.
- **Route table:** `/` and `/proofs` are static; `/checkout/[sessionId]`, `/r/[id]` and `/merchant` are partial prerenders; the API routes are dynamic.
- **NFR-12** (gzip of the first-load scripts in the served HTML): /checkout **195.3 KB** (≤ 200), /r 172.2 KB, / 176.8 KB, /merchant 238.8 KB. Not Lighthouse; the tester runs Lighthouse mobile.
- **Live consumer rule** against the deployed MerchantPay, using the smoke sale `0xae155c49…cfb1a`: settled = payment id 1 at the exact amount; amount − 1 and another order give null.
- **Chrome** (`next start`, local test config in git-ignored `apps/web/.env.local`):
  - `POST /api/v1/sessions` returns 201, and the checkout renders: Bandra Beans, BB-1042, 2 × Cold brew, 1 × Banana bread, 25.00 USDT, "Hold to pay 25.00".
  - CSP header present, **0 `securitypolicyviolation` events**, every script from our own origin.
  - Enter on the focused button: one confirm → signed → server verified → the real local relayer (127.0.0.1:8787) refused `paySale` (not wired yet) → "The payment didn't go through. Nothing was charged." → the button is idle again.
- An unknown checkout id streams Next's 404 page with `noindex`; the status is 200 because the shell is already streaming (partial prerendering).

## Not done / needs others
- **The live AT-1 payment** needs `paySale` wired on the relayer (claude-relayer: "when the MerchantPay ABI lands in packages/shared"); today `/relay` answers "this relayer supports \"pull\"".
- **The guest wallet holds 0 USDT**, so a live demo payment needs funding (no faucet button, per the human). That's a demo-flow decision for later.
- **`MERCHANT_ADDRESS`** in the local config is the contracts lane's smoke-sale merchant `0xb4E7…714D`, until the human gives their wallet.
- **Sign-in** needs a browser wallet (an injected EIP-1193 provider) to complete in a browser. The SIWE paths are covered by `auth.test.mjs` (7 tests); the tester checks the signed-out gate.
