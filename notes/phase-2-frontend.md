# Phase 2, frontend lane (claude-frontend)

## Batch 002-P2-web-design-foundation

Branch `main` · design lock "Mercury + dither" (human 21:30) and the demo picks (21:37): Instrument Sans, pill buttons, press and hold to pay, three.js scene (21:43), electric dot blue #1723E2 (22:21). Reference: `design-refs/merchant-capital-demo.html` (git-ignored, references only).

### What was built
- `app/tokens.css`: tokens generated from the design system (light, dark, and the forced-theme block). `scene-dot` #1723e2, accent #3b4fd9 (dark #8796ff), ground, surface, ink, hairline, shadow-glow.
- `app/globals.css`: the Tailwind 4 `@theme inline` colour map and the type styles (`display`, `title`, `amount-xl`, `label`, `data`). Reduced motion stops every animation except elements marked `data-motion="essential"`.
- `app/layout.tsx`: Instrument Sans, Instrument Serif (italic only) and Geist Mono via `next/font` (self-hosted, 0 requests to Google).
- `lib/dither.ts` + `components/DitherScene.tsx`: a three.js 0.186.1 points shader (`#include <colorspace_fragment>`, so the dots match the token).
  - Behaviour: gather on load, then depth parallax.
  - Reduced motion draws one frame per resize.
  - WebGL2 is checked before three.js starts; without it there's a 2D canvas fallback.
- `components/Button.tsx`: pill variants that own their sizes (primary/glass `h-12`, quiet `min-h-11` for a 44 px target). Clicks are ignored while `aria-disabled`.
- `components/HoldButton.tsx`: press and hold for 900 ms to confirm. Releasing early cancels; one keyboard or assistive-tech press confirms. It's guarded as a money control:
  - auto-repeated keys are ignored
  - the phase lives in a ref
  - only trusted events count, from the left button only
  - sliding off on touch cancels
  - unmounting clears the timer
- `app/page.tsx`: the Phase 1 proofs page restyled over the night scene, with a wash behind the text.

### Verified (with which output)
- Round 3, every check PASS: tester, reviewer-code, reviewer-security, reviewer-ux-ui, ci. ci reported typecheck 0, lint 0, `npm test` 16/16, build 0 (routes `/` and `/_not-found`, static), and a clean secret grep.
- Contrast: label 7.58:1 over lit dots (4.31 in round 2), paragraph ≥ 5.26, h1 ≥ 7.58, the same in light and dark.
- Hold behaviour:
  - Held Enter gives 1 confirm, and held Space for 2 s gives 1 call.
  - A late release gives 1 call, and the 860–950 ms release sweep is consistent in 9 of 9 runs.
  - Right button, script click, slide-off, a second finger, or unmounting mid-hold: 0 calls.
- Reduced motion: 1 draw, 0 draws per second. Nym read OK at 375 and 1440 (21.5 s and 21.3 s, block 12,302,721), with 0 requests to Ankr.
- Dependency: three 0.186.1 and @types/three 0.186.0 add 8 lockfile packages; all 8 registry integrity hashes match, and none has install scripts.

### Decisions (human gate, 23:30)
- three.js pins approved.
- The keyboard confirms instantly on the pay page, with all framing blocked (X-Frame-Options DENY, batch 004).
- A second payment for the same order must also be impossible on-chain: claude-contracts is asked to make `paySale` refuse an `orderRef` that's already paid.

### Open, carried into batch 004 (the first batch whose hold signs a payment)
- code R3 D1 (`cacheComponents` hides routes in `<Activity>`): drop `forceContextLoss()`; HoldButton comes back idle after a hidden "done" but stays busy while a payment is in flight. Fixed in the 004 scratch copy.
- security R3 D1–D5, fixed in the 004 scratch copy:
  - D1: frame blocking
  - D2: a label change cancels a hold
  - D3: the page owns the payment in flight
  - D4: an unknown outcome hides the button, and one salt is used per checkout
  - D5: blur or a hidden tab cancels a hold
- The touch hold still needs a check on a real iPhone and Android, with VoiceOver and TalkBack (the human).
- LOW clean-ups, folded into the next batch that touches each file: duplicated button classes, unused exports, the dither seeding test, the resize debounce, shared brightness constants.

## Batch 004-P2-web-pages-and-sign-in

Branch `main` · FR-PAY-4/5/6/7/9/15, FR-REL-4/6, FR-PRIV-1, NFR-12/13, AT-1 (up to `/relay` plus the shop's poll). Plan-reviewed (1 BLOCKER), 2 rounds, all five checks PASS.

### What was built
- **Checkout API:**
  - `POST /api/v1/sessions` (Bearer, constant time), `GET /api/v1/sessions/:id` (the shop's poll: open, pending, paid or expired), `POST /api/v1/sessions/:id/pay`.
  - The server rebuilds the sale from its own session and verifies the signature before relaying.
  - One payment in flight per checkout.
  - **Consumer rule:** a payment is recorded only when the chain shows gross == amount, payer == the signer and merchant == the session's merchant, read at the receipt's block with 5 × 1 s retries.
- **Unknown outcomes are pending:** timeouts, dropped connections, 5xx and unconfirmed 200s.
  - The chain settles them on the next attempt, on page load and on the poll.
  - If the order is paid, the receipt shows. If not, the checkout reopens once the approval is past `validBefore` + 60 s.
- **Each attempt gets a fresh salt**, and a relayer `replay` is a refusal, because MerchantPay's `OrderPaid` blocks a second payment per order on-chain.
- **KIND_SALE = 2**, pinned by a vector read from the deployed contract.
- **Pages:**
  - `/`: hero over the DitherScene; "Try a checkout" is a plain form POST that gets a 303.
  - `/proofs`.
  - `/checkout/[id]`: static scene; ready, confirming, expired, error and paid states.
  - `/r/[id]`: the refund status streams in from the chain.
  - Branded not-found sheets.
  - `/merchant`: SIWE gate, today's sales before fees, relayer health, payments.
- **Sign-in (FR-PAY-15):**
  - an HMAC-signed, time-stamped, single-use nonce cookie from a CSPRNG
  - the message must expire within 10 min
  - an HMAC session cookie (HttpOnly, Lax, Secure on https, 8 h)
- **Headers:** X-Frame-Options DENY everywhere. A strict CSP on /checkout and /r: `'self'` scripts and connects, `frame-ancestors 'none'`.

### Verified
- **Round 2:** tester, code, security, ux and ci PASS. ci: typecheck, lint, 82 tests (1 live skipped), build, bundle grep all clean.
- **Mutations:** tester 16/16 round-2 mutants and 24/25 round-1 mutants killed; code reviewer 21/30 new mutants killed, plus 9/12 round-1 survivors.
- **NFR-12** (Chrome, as downloaded): /checkout 184,554 B ≤ 204,800; LCP 0.62 s (lab, Lighthouse mobile settings; Lighthouse itself isn't installed).
- **FR-PAY-7 / FR-PRIV-1 scan:** 0 crypto words, 0 other origins, 0 CSP violations in every reachable state.
- **Live:** the consumer rule against the deployed MerchantPay (smoke sale); the hold → sign → server verify → real relayer round trip (refused: no `paySale` yet).
- **Final MerchantPay** `0xab81…4251`: KIND_SALE 2, not paused, fee 0.10.

### Decisions (human gate, 01:45)
- Public home copy approved.
- `'unsafe-inline'` stays on the pay pages.
- Visitors' demo: say plainly that it's a demo (batch 005).
- Money rules approved: pending settled by the chain, a fresh salt per attempt, replay = refusal.

### Open (batch 005 unless noted)
- The live AT-1 needs relayer `paySale` on `0xab81…` (claude-relayer RL2) and a funded customer (H1).
- Carried items:
  - security F1: in flight at expiry
  - security F3: not-found copy after a restart
  - ux L1/L2
  - code F2/F5/F6
  - the privacy link in tokens.css
- Neon `app_sessions` before any deploy (sessions, claims, pending and used nonces are per process).

## Batch 005-P2-web-invoices-refunds

Branch `main` · FR-PAY-1/2/3/7/8/9, FR-PRIV-1, NFR-12, G2 plan F2/F3/F4. Built by a developer subagent in scratch, replayed onto 004 under this batch. 2 rounds, all five checks PASS.

### What was built
- **Invoices on the final Phase 3 MerchantPay `0xab81…4251`:**
  - The customer signs `amount + relayFee()`, with a nonce over the credited amount.
  - Partial payments are allowed; Paid only when fully paid.
  - Consumer rule: gross, payer and merchant, and `paid` rose by exactly the amount.
- **The server checks the payer's USDT before taking the lock.** An unfunded guest gets the demo message and nothing is relayed (the human's "say it's a demo").
- **`/pay/[invoiceId]`:** only our merchant's invoices (anti-phishing; human), the fee shown on top, part-paid/paid/cancelled states.
- **Merchant invoices:**
  - a random refHash
  - the customer name and label kept only in the browser (human; NFR-8)
  - copy link, a two-step cancel
- **Refunds:** an exact approval, then refund; stops before approving when the refund would fail.
- **Receipts** by payment id from the chain. Stacked cards at 375. The strict CSP on `/merchant` and `/pay`.

### Verified
- **Round 2:** tester, code, security, ux and ci PASS; 133 tests.
- **Fork E2E** on the real bytecode: a 7.50 invoice cost the customer 7.60 and the merchant got 7.50; a part payment then the rest → Paid; exact-approval refunds with the allowance back to 0; another merchant's invoice → 404; a low-balance refund stopped before any approval.
- **On real :3100:** the demo message with 0 relayer calls.
- **Speed:** /pay JS 190,936 B ≤ 204,800; LCP 668 ms (lab).

### Decisions (human)
- Invoice customer = a private browser-only name.
- /pay serves only MERCHANT_ADDRESS.
- Exact refund approvals.
- "Payment fee" wording.
- The pending wait (worst case about 9 min) is OK.

### Open (batch 006)
- the balance check is skipped while a session is pending (code R2-F1 / security F-N1)
- `readUsdtBalance` retry
- plain `<a>` to /merchant on home
- refund `balanceOf` before approving
- test gaps G1/P1/P2
- ux N1–N3
