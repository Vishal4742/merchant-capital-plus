VERDICT: CHANGES

# Security review: 004-P2-web-pages-and-sign-in, round 1 (reviewer-security)

Scope: `git diff -- apps/web` (5 tracked files) and the 28 untracked files under `apps/web` (routes, `lib/`, components, tests), read against spec.md, build-claude-frontend.md, ARCHITECTURE §2–§3, the deployed MerchantPay source (`~/ethglobal-contracts/contracts/src/MerchantPay.sol`) and the relayer as it stands (`~/ethglobal-relayer/apps/relayer/src/relayer.ts`). I didn't edit product code, didn't run `npm run build`, and read no `.env` or `.env.local` value. The `.next` build (BUILD_ID 00:10:33) is newer than every source file, so the bundle checks below apply to this code.

**Bottom line.** The money core is sound:
- The server rebuilds the authorization from its own session.
- The signature is checked before the relayer is called.
- The consumer rule checks gross, payer and merchant.
- MerchantPay's `OrderPaid` (`MerchantPay.sol:161`) means one checkout can never be paid twice on-chain, whatever the salt.

What's wrong is around the unknown-outcome rule, which is the thing this batch adds:
- An expired checkout tells a customer whose payment may have landed to "ask the shop for a new one" (S1).
- Anyone holding the checkout URL can put it into "Don't pay again" for 16 minutes at a time (S2).
- The strict CSP isn't in force on the demo's main path (S3).

All three fixes are small.

## Must fix for PASS

### S1. MEDIUM: an expired checkout with an unknown outcome says "Ask the shop for a new one"
- **Where:**
  - `app/api/v1/sessions/[id]/pay/route.ts:22` returns 410 before `settlePending` runs at `:45`.
  - `components/Checkout.tsx:147-150` renders the expired copy ahead of the pending state set at `:38,41`, and `:163-167` then adds "Don't pay again" under it.
- **Measured** (`round-1/probes/review-security-pay-edges.test.mjs`, P2; log in `review-security-pay-edges.log`):
  1. The relayer answers 502, so the checkout goes pending.
  2. The 30 min TTL passes. In the probe the first attempt did land (the mocked chain says paid).
  3. The next POST gets `410 This checkout has expired. Ask the shop for a new one.`, and the chain is never asked.
  4. The shop's poll on the same checkout says `paid`.
- **Exploit sketch (an honest customer, not an attacker):** a payment near the end of the window times out. A second tab, or a reload, then shows "expired, ask for a new one". The customer gets a fresh checkout from the shop and pays again, so they're charged twice: two orderRefs, so `OrderPaid` doesn't help. This is the false "start again" the spec's pending rule exists to prevent.
- **Fix:**
  - In the pay route, settle first: `if (session.pending)` → `settlePending` → paid gives the receipt, pending gives 409 `STILL_PENDING`; only then check expiry.
  - In `Checkout`, when `stuck`/pending, show only the pending copy, never the expired line.
- **Owner:** claude-frontend.

### S2. MEDIUM: a 422 `replay` is treated as "maybe sent", so a stranger can lock a checkout, and the relayer's memory can trap a same-tab retry
- **Where:**
  - `lib/relay.ts:63` maps `replay` to `unknown`.
  - `pay/route.ts:50` then marks the checkout pending for whatever `from` signed.
  - `lib/settle.ts:30` keeps it pending until that signer's `validBefore + 60 s`.
- **Measured** (P2's file, test P1):
  1. A stranger's key signs a valid authorization for the checkout with a 900 s window.
  2. The relayer answers `422 {code: "replay"}`.
  3. The checkout is pending for the stranger.
  4. The real customer's payment gets 409 "Don't pay again" and never reaches the relayer: `relayCalls 1`, lockout `960 s`.
- **Exploit sketch:**
  1. The orderRef is on the checkout page.
  2. The attacker computes `saleNonce(merchant, orderRef, amount, salt)` for its own key and burns it with USDT `cancelAuthorization`, which the prize USDT has (`research_notes/.../build_H1_merchant_capital.md:37`). It costs gas only.
  3. It POSTs the matching ReceiveWithAuthorization to `/pay`. The relayer sees `authorizationState` used (`relayer.ts:171`) and answers `replay`.
  4. One burn plus a re-POST every 16 min keeps the checkout dead for its whole 30 min life. No money is lost, but the checkout can't be paid.
- **Second effect, no attacker needed:** the relayer remembers every authorization it has sent, keyed by `(from, nonce)`, in memory (`relayer.ts:80,155,181,196`). The salt is reused per checkout (`lib/sign-sale.ts:9-22`), and `validBefore` isn't part of the nonce. So once an attempt was sent but didn't land (a 502 `reverted` or a dropped tx), every retry from that tab gets `replay`. That gives pending, then reopen after `validBefore + 60`, then `replay` again, until the session expires. This needs paySale to keep the pull handler's replay rule, which is likely.
- **Fix:** run `replay` through the refused path, which checks the chain first:
  1. paid by this customer → receipt
  2. read failed → pending
  3. not paid → refused

  Keep it as unknown only when this server already relayed that same `(from, salt)` for this checkout (one `Set` on the session).

  After the server reopens a checkout because the last attempt is dead, let the browser use a fresh salt. `OrderPaid` already makes a second payment on the same orderRef impossible, so reusing the salt is no longer what prevents a double charge (contracts answered D4).
- **Owners:** claude-frontend; claude-relayer for awareness (the `sentAuthorizations` key).

### S3. MEDIUM (control gap, no sink found today): the /checkout CSP isn't in force when the checkout is reached from "Try a checkout"
- **Where:**
  - `app/page.tsx` and `app/merchant/page.tsx:77` use `<form action={startDemoCheckout}>`.
  - The server action `redirect()`s (`app/actions.ts:25`), and Next does that as a soft navigation, so the checkout renders inside the document loaded from `/`, which has no CSP.
  - The CSP itself is only on `/checkout` and `/r` (`next.config.ts:37-38`).
- **Measured** (`round-1/probes/review-security-csp-softnav.{mjs,json}`, headless Chromium against :3100):

  | How the checkout was reached | Document loaded from | Cross-origin image beacon |
  |---|---|---|
  | `/` → "Try a checkout" | `/` | **not blocked** (`violated: false`) |
  | Hard load of the same URL | `/checkout/<id>` | blocked (`violated: true`) |

- **Why it matters:** claude-contracts S6(c) asked for a strict CSP because a script on the pay page can swap the opaque nonce. Gate item 2 asks the human to accept `'unsafe-inline'` on the assumption that the rest of the policy holds. On the path judges will click, none of it applies. A shop redirect (FR-PAY-4) is a hard load, so the CSP does apply there.
- **Fix (either one):**
  - Make the demo entry a real navigation: a plain `<form method="post" action="/api/demo-checkout">` to a route handler that answers `303` to the checkout URL, or `window.location.assign(url)`.
  - Or send a baseline CSP on every route (see I3).
- **Owner:** claude-frontend.

## Should fix (LOW)

### S4. LOW: a 422 whose chain check fails still says "Nothing was charged; please start the checkout again"
- **Where:** `pay/route.ts:52`. `findPayment` returns `undefined` on a read error. That's falsy, so the code falls through to the refused copy (`relay.ts:64-65`).
- **Measured** (P3): the relayer answers 422 `would_revert` (for example `OrderPaid`), and the chain read throws `header not found`. The answer is `400 ... Nothing was charged; please start the checkout again`.
- **When it bites:** a reopen based on a stale `latest` read, then a retry that hits `OrderPaid`, then a failed read. It's rare, but the result is the false "start again".
- **Fix:** `=== undefined` → mark pending and return `UNKNOWN`. Return "Nothing was charged" only on `null`.
- **Owner:** claude-frontend.

### S5. LOW: the shop's poll says `open`, then `expired`, while a payment is in flight
- **Where:** `app/api/v1/sessions/[id]/route.ts:18-20` doesn't look at the in-flight claim (`lib/sessions.ts:70`).
- **Measured** (P4): during a relay the poll answers `open`. Once the TTL passes mid-relay it answers `expired`, and after the receipt it answers `paid`.
- **Risk:** batch 005's shop could cancel or release an order on `expired`, and the customer's payment lands seconds later.
- **Fix:**
  - Export `isInFlight(id)` and report `pending` while it's true.
  - Document for the shop that `expired` becomes final only when nothing is pending.
- **Owner:** claude-frontend (and batch 005's poller).

### S6. LOW (before any deploy): no limit on creating sessions or on /pay
- **Sessions:** `startDemoCheckout` (`app/actions.ts:11`) is public and creates a session per call. The in-memory `Map` never drops expired ones (`lib/sessions.ts:40-51`), so memory grows without bound.
- **/pay:** it has no rate limit, and the relayer sees only our server's IP. Fresh unfunded keys pass the signature check, get `insufficient_funds` from the relayer, and still use up the relayer's per-IP and per-merchant limits. After that, every real customer gets "busy".
- **Fix:** with Neon, delete rows past `expiresAt`; until then, evict expired sessions on create. Add a small per-IP limit on the action and on `/pay`. The relayer-side part is already asked of claude-relayer in the spec.
- **Owner:** claude-frontend.

## INFO (no change needed for PASS)
- **I1. SIWE nonce quality.** viem's `generateSiweNonce` is `uid(96)`, built from `Math.random`, and consecutive nonces overlap: I measured `secondIsFirstShiftedByOne: true`.
  - It isn't exploitable here. Each nonce is issued once, and only inside our HMAC cookie (`lib/auth.ts:50-61`), so an attacker can't get a cookie for someone else's nonce.
  - Still, `randomBytes(16).toString("hex")` is one line and matches the "node:crypto" ladder.
- **I2. SIWE domain.** The domain comes from `request.url` (`app/api/auth/verify/route.ts:9,16`).
  - Probe (`review-security-siwe-host.{mjs,jsonl}`): on `next start` it's `localhost:3100` whatever the `Host` or `X-Forwarded-Host`. A message signed for `evil.example` with a spoofed Host is refused (401), so there's no cross-domain replay.
  - Side effect: sign-in from `http://127.0.0.1:3100` always fails (401), because the browser's `window.location.host` differs.
  - Before deploy, pin the expected domain from config (e.g. `APP_ORIGIN`) rather than the request.
- **I3. What `'unsafe-inline'` leaves open.**
  - Any future HTML injection on /checkout or /r would run, and so would a `javascript:` URL.
  - CSP never covers exfiltration by top-level navigation.
  - I found no sink today: no `dangerouslySetInnerHTML` or `innerHTML`; React escapes the shop's `reference` and item names; every `href` is a constant origin plus a server value, or a same-origin path.
  - The guest key sits in origin-wide `localStorage`, and `/`, `/proofs` and `/merchant` send no CSP. Sending `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` on every route costs nothing and doesn't touch Nym.
  - The Nym worker can't reach the key: the harness iframe is `sandbox="allow-scripts"` with no `allow-same-origin` (`node_modules/@anon-rpc/browser-harness/dist/host.js:599`).
- **I4. Logout.** It only clears the cookie (`app/api/auth/logout/route.ts:6`). An 8 h `mc_session` can't be revoked except by rotating `AUTH_SECRET`, and logout has no CSRF check, which allows a forced logout only.
  - Nonce and session tokens share one HMAC key. They can't be confused (3 segments with a server-chosen nonce vs. 2 segments), but add a purpose prefix if a third token type appears.
- **I5. Inputs the routes don't check.**
  - The relayer's `txHash` is stored and put into explorer hrefs unvalidated (`pay/route.ts:65`, `Checkout.tsx:113`, `r/[id]/page.tsx:72`). Check `/^0x[0-9a-f]{64}$/i`.
  - A malformed 65-byte signature makes `verifyTypedData` throw a 500 (the tester's `test/checkout-edges.test.mjs:133`, marked todo). It happens before `claimPayment`, so no lock leaks.
  - `cookieFrom`'s `decodeURIComponent` throws on a malformed cookie, which also gives a 500.
- **I6. Reopen timing.** The reopen rule uses the server clock plus 60 s and a `latest` read (`settle.ts:30`). Reading one block and requiring `block.timestamp > validBefore` at that block removes both the clock and the RPC-lag assumptions. `OrderPaid` and the 422 → chain check remain the backstop.
- **I7. Squatting.** The orderRef is public on the page, so anyone can pay it first with 1 USDT from their own key. The customer then sees "start the checkout again" (S6(a)'s intended handling), but the shop's poll stays `open` until expiry. Reading `saleOf != 0` would let both say "already paid by someone else".

## Deferred items from batch 002 (security R3 D1–D6)
| Item | Status | Evidence |
|---|---|---|
| D1 framing | **Closed** | Live :3100: `X-Frame-Options: DENY`, nosniff and Referrer-Policy on `/`, `/proofs`, `/merchant`, `/checkout/*`, `/r/*` and the API; `frame-ancestors 'none'` in the pay pages' CSP. `script-src 'self'` alone isn't met (`'unsafe-inline'`, gate item 2), and see S3 |
| D2 prop change mid-hold | **Closed** | Reran `review-security-hold-props.mjs` on the current `HoldButton.tsx`: `labelMidHold "Hold to pay 30.00"`, `calls 0`, `whichRan []` |
| D3 remount re-arms | **Closed at the page level** | `Checkout.tsx:43,56`: `inFlight.current ??= submit()`, so a remounted button gets the same promise. `claimPayment` (`sessions.ts:73`) and `OrderPaid` back it up. The bare-component probe still shows 2 calls after a forced re-key, which is expected now that the component isn't the guard |
| D4 idle after done/failure, salt | **Closed** | The receipt replaces the button (`Checkout.tsx:83-86`). 504 and 409 hide it (`:69,75`). One salt per checkout (`sign-sale.ts:9-22`). Contracts: `paySale` reverts `OrderPaid` (`MerchantPay.sol:161`). See S2 for the salt-reuse side effect |
| D5 blur/hidden mid-hold | **Closed by code** | `HoldButton.tsx:79-80`. Not measured with a real OS focus change (needs a person) |
| D6 same-origin scripts | Unchanged | No third-party script anywhere on the origin; the Nym iframe is sandboxed (I3) |

## claude-contracts S6 advice (002-P2-merchantpay round 1)
- **(a) Consumer rule: applied.**
  - `lib/onchain.ts:52-59` checks `gross == amount`, merchant and payer at the receipt's block, retrying 5 × 1 s at the same block.
  - The pay route (`:57-64`) records only on a match. Otherwise it marks pending and never invites a second payment.
  - A front-run with the identical payload ends as `OrderPaid` → 422 → `findPayment` → receipt. Squatting ends as "start the checkout again" (I7).
- **(b) Relayer allowlist:** claude-relayer's lane. Our body carries no target or selector (`lib/relay.ts:33-45`), so the relayer has to use its own allowlisted MerchantPay.
- **(c) Pay pages: applied, apart from S3.**
  - The page shows the merchant name and amount.
  - The server checks the nonce by rebuilding `saleNonce` from its own session and running `verifyTypedData` (`pay/route.ts:37-39`). The `KIND_SALE = 2` vector is pinned (`test/checkout-api.test.mjs:230`).
  - There are no trackers and no third-party scripts.
- **(d) PII on chain: n/a for invoices this batch.** `orderRef` is 32 random bytes (`lib/sessions.ts:46`). The shop's `reference` stays off-chain.

## What I verified as sound (DONE)
- **Each payment is bound to its own order.**
  - `saleAuthorization` (`lib/pay.ts:33-39`) is a `ReceiveWithAuthorization` to MerchantPay: only MerchantPay can execute it (`msg.sender == to`), so a direct `transferWithAuthorization` bypass is impossible.
  - Value = the session amount, `validAfter 0`, nonce = `keccak(chainid, MerchantPay, 2, merchant, orderRef, amount, salt)`.
  - The ABI encoding matches `MerchantPay.sol:202-205` (`address` and `uint256(uint160)` encode identically).
  - The browser's `from`, `salt` and `validBefore` are the only inputs, and the signature must recover to `from` over the server's own terms.
- **Double charge on one checkout is impossible:**
  - in-process `claimPayment` (synchronous `Set`, `sessions.ts:73-81`), released in `finally`
  - `pending` until the chain decides
  - `OrderPaid` on-chain
- **Relayer error mapping** (`lib/relay.ts:54-70`) matches the relayer as built:
  - Treated as not sent: 400/415 parse errors, 422 pre-send checks, 503 `gas_price_cap`, 429, and ECONNREFUSED/ENOTFOUND/EAI_AGAIN.
  - Treated as maybe sent: 502 `rpc_error` / `reverted` / `receipt_mismatch`, timeouts and resets, and a 200 without `txHash`.
  - The relayer's own text never reaches the customer.
  - S2 is the one exception (`replay`).
- **Shop API:**
  - `shopAuthorized` hashes both sides with SHA-256 and compares with `timingSafeEqual` (constant time, length-independent).
  - Without the key, both routes return 401 before any lookup, so an outsider learns nothing about ids. The merchant is fixed by config, so the shop can't redirect funds.
  - The amount is validated (6 dp, 1–10,000 USDT), and so are the items (≤ 20, qty 1–999, they must add up).
- **Sign-in:**
  - The nonce cookie is HMAC'd and only valid ≤ 5 min after issue. An `expirationTime` ≤ 10 min ahead is required. Domain, nonce and chain 1874 are checked by `validateSiweMessage`, and the signature by `verifyMessage` (EOA only).
  - The session cookie is HttpOnly, SameSite=Lax, Path=/, host-only, 8 h, and Secure on https.
  - Login CSRF fails because the Lax nonce cookie isn't sent on a cross-site POST.
  - Live probe: a throwaway key signing for `localhost:3100` gets a session, and the dashboard shows it signed in. The `evil.example` variants get 401.
  - `npm test`: 76 tests, 74 pass, 0 fail, 1 skipped (live), 1 todo (the tester's I5 case).
- **Caching:** `/checkout`, `/r` and `/merchant` are `private, no-store`, and the API GET and the nonce are `no-store`. There's no `use cache` anywhere. The static shells carry no session data.
- **Logs:** two `console.error` calls print the checkout id and the viem read error, whose URL is the public, key-less Ankr endpoint. No key, signature or cookie is logged.
- **Client bundle** (`.next/static`):
  - Grep for `SHOP_API_KEY|AUTH_SECRET|ARKIV_|PRIVATE_KEY|RELAYER_URL|MERCHANT_PAY_ADDRESS|MERCHANT_ADDRESS|DATABASE_URL`: one hit, the env var *name* `AUTH_SECRET` in SignIn's copy ("Sign-in isn't set up on this server yet (AUTH_SECRET).", chunk `0noola1womwpx.js`). No values.
  - There are 0 `process.env` references in client chunks.
  - External hosts are library doc and error links, the explorer, and the batch 001 RPC hosts. No trackers.
- **Required grep** `(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` over the 33 diff files plus the tester's new `test/checkout-edges.test.mjs`:
  - `components/merchant/SignIn.tsx:69`, `lib/auth.ts:17,19`: the env var name only.
  - `test/auth.test.mjs:7` and `test/checkout-edges.test.mjs:12`: the literal `"test-auth-secret-0123456789abcdef0123"`, a test-only fixture set inside the test process, not a deployed secret. The other `SECRET` hits in `auth.test.mjs` are the variable that holds it.
  - `test/checkout-api.test.mjs:230`: the `saleNonce` output vector (public by construction).
  - `test/onchain.live.test.mjs:9`: the public smoke-sale tx hash `0xae155c49…cfb1a`.
  - Test keys come from `generatePrivateKey()` at runtime. `apps/web/.env.local` is git-ignored (`apps/web/.gitignore:34`) and not in `git status`.
- **On-chain data and Arkiv:** no PII in this batch (no Arkiv change).

## OPEN
1. S1–S3 (claude-frontend), then round 2. S4–S6 can ride along. S6 must be done before any deploy, together with the Neon move the spec already requires.
2. claude-relayer: when paySale lands, decide what `replay` means for a sent-but-unmined authorization (S2's second effect), and keep the per-IP limit for our server's calls (already asked 00:09).

## NEEDS THE USER
- **Gate item 2 (`'unsafe-inline'`):** acceptable for the demo in my view, since there's no injection sink and no third-party script. But it only protects pages loaded directly, and S3 has to land for the demo path to be covered at all.
- **Gate item 4 (the unknown-outcome rule):** the rule itself is safe for money, because `OrderPaid` stops a second payment on the same checkout. Its risks are availability (S2) and wording that sends a customer to a *new* checkout (S1, S4).

Probes (all reproduce; throwaway keys only; nothing signed for real money): `round-1/probes/review-security-pay-edges.test.mjs` + `.log`, `review-security-csp-softnav.mjs` + `.json`, `review-security-siwe-host.mjs` + `.jsonl`.
