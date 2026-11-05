VERDICT: PASS

# Security review: 004-P2-web-pages-and-sign-in, round 2 (reviewer-security)

Scope: the round-2 build of `apps/web` (5 tracked files changed, 33 untracked; 38 files in all), read against spec.md, build-claude-frontend.md (round-2 section), ARCHITECTURE §2–§3, my round-1 review, MerchantPay's source in `~/ethglobal-contracts` (deployed version `a67d260`, current `c53d1b8`) and the relayer at `27c0250`. The live server on :3100 is `next start` from BUILD_ID `oc6wdSjbYv12Yk6oKT5TQ`, built at 00:57:48 and started at 00:57:57. Every source file is older than that build; the only later change is the tester's `test/checkout-edges.test.mjs`.

I didn't edit product code or run `npm run build`, and I read no `.env` or `.env.local` value. Probes use throwaway keys generated at runtime. Chain checks are `eth_call` only.

Fast mode (PIPELINE §3a) applies: CHANGES only for HIGH or CRITICAL. I found none. The MEDIUM and LOW items are under FOLLOW-UP.

## Bottom line
- S1, S2 and S3 are closed, each measured on the current code and on the live server.
- **Fresh salt per attempt: two attempts on one checkout can't both settle.**
  - The server binds every attempt to the session's own merchant and orderRef.
  - MerchantPay checks `saleOf != 0 → OrderPaid` before it pulls any USDT.
  - I confirmed that live on the deployed contract: a second `paySale` with a fresh salt reverts `OrderPaid`, for the same payer and for another payer.
- **What's left is cross-session.** The remaining double-charge risk is a customer being sent to a *new* checkout (a new orderRef) while an earlier attempt can still land. There are three narrow paths (F1, F3, F4). None is reachable in the normal demo flow.

## Round-1 findings
| ID | Status | Evidence |
|---|---|---|
| S1 expired + pending → "ask for a new one" | **Closed** | `pay/route.ts:24` returns the early 410 only when nothing is pending; `:48-51` settle first. In `Checkout.tsx:47,161`, `confirming` wins. Round-1 probe P2 now gets 409 + receiptId (`round-2/probes/review-security-r1-pay-edges-rerun.log`). New probe R2: expired with a live approval → 409 "Don't pay again"; landed → 409 + receipt; dead (validBefore + 60 s) and not paid → 410, nothing relayed. Residual: F1 |
| S2 stranger lock via `replay` | **Closed** | `relay.ts:64` makes every 422 other than `insufficient_funds` a refusal, so `replay` never marks pending. Round-1 P1 now gets 400. R1: the stranger's replay gives 400 with no pending, and the customer's next attempt relays at once (relayCalls 2, 200). The relayer's `sentAuthorizations` trap (second effect) is gone with the fresh salt (`sign-sale.ts:10,22`). Residual by a costlier path: F2 |
| S3 soft navigation skipped the CSP | **Closed** | `/` and `/merchant` use `<form method="post" action="/api/demo-checkout">`, answered 303 (`demo-checkout/route.ts:12`). Re-ran `review-security-csp-softnav.mjs`: "Try a checkout" now loads the document from `/checkout/<id>` and the cross-origin image is blocked (`violated: true`), the same as a hard load (`round-2/probes/review-security-csp-softnav.json`). The only in-app `<Link>` into a pay page is `/checkout` → `/r` (`Checkout.tsx:112`), which stays inside the CSP document |
| S4 422 + failed chain read → "start again" | Unchanged by choice; FOLLOW-UP F5 | Round-1 P3 still reproduces. A retry on the same checkout can't pay twice (`OrderPaid`), so it's LOW |
| S5 poll says open/expired mid-relay | **Closed** | `[id]/route.ts:20` uses `isInFlight`. Round-1 P4 now gives `pending, pending, paid` |
| S6 unbounded sessions, no `/pay` limit | Deferred to the Neon batch (spec constraint: localhost only) | F6 adds the demo-checkout drive-by |
| I1 SIWE nonce from Math.random | **Closed** | `nonce/route.ts:8` uses `randomBytes(16)`. Live: 32 hex |
| I5 inputs | **Closed** | txHash `^0x[0-9a-fA-F]{64}$` or unknown (`relay.ts:62`); a malformed signature gives 400 (`pay/route.ts:41`); `cookieFrom` survives a bad %-escape (`auth.ts:89-99`) |
| I2, I3, I4, I6, I7 | Open, INFO | Carried under F9 |

## The round-2 design, judged as money code

### 1. Fresh salt per attempt: can two attempts with different salts both settle? No, not on one checkout.
- **The server pins the order.**
  - `pay/route.ts:39` rebuilds the sale from `session.merchant`, `session.orderRef` and `session.amount`.
  - `verifyTypedData` (`:41`) requires the signature to cover exactly that nonce: `keccak(chainid, MerchantPay, 2, merchant, orderRef, amount, salt)`, from `pay.ts:23-30`.
  - The relay body names the same merchant and orderRef (`relay.ts:36-37`).
  - Probe R4: both attempts carry the same orderRef and merchant with different nonces.
- **The contract refuses a second payment before any USDT moves.**
  - Deployed source (`a67d260`) `MerchantPay.sol:161`, current source `:178`: `if (saleOf[merchant][orderRef] != 0) revert OrderPaid();`. It runs before `_pull` (`:182`). `saleOf` is set before the pull, inside `nonReentrant`.
  - The signature can only be spent through MerchantPay: it's a `ReceiveWithAuthorization` with `to = MerchantPay`, and USDT requires `msg.sender == to`.
  - The nonce includes `address(this)` and `KIND_SALE`, so it can't be replayed through `payInvoice` or another deployment.
- **Live on chain 1874** (`round-2/probes/review-security-orderpaid-live.{mjs,json}`):
  - On 0x83b5 (the contract is paused, so I cleared the pause byte with an `eth_call` state override), a second `paySale` for the smoke sale's order with a fresh salt reverts `OrderPaid`, for the same payer and for another payer.
  - Control: an unpaid order gets past that check and fails in USDT (`ECRecover: invalid signature`).
- **Ordering doesn't matter.** Whichever of two outstanding authorizations lands first wins, and the other reverts. Blocks execute in sequence, so the same block doesn't help.
- **Server clock skew doesn't matter either.** It can only make the reopen early or late; it can't make two land.
- **The new MerchantPay 0x8eff…248f** (HANDOFF_LOG: 0x83b5 was paused at 00:57; G2 runs on 0x8eff):
  - Not paused; `KIND_SALE = 2`.
  - Its `saleNonce` view equals `lib/pay.ts` on a fixed vector (`nonceMatchesWeb: true`, `review-security-new-merchantpay-live.json`).
  - Its source keeps `OrderPaid` (`c53d1b8:178`).
  - It has no paid sale yet, so I couldn't simulate the second payment there.
- **Where a double charge is still possible:** only across sessions, when the customer is told to get a new checkout while an attempt can still land. See F1 (in flight at expiry), F3 (not-found copy after a restart) and F4 (MerchantPay not pinned per session, once sessions persist).

### 2. `replay` as a refusal: correct
- For an honest browser, a `replay` can't come from its own attempt any more: one POST per signature, and a fresh nonce each time.
- A replay of the customer's own captured body:
  - mined → `findPayment` shows the receipt
  - not mined, or the read fails → 400 to the replayer, with no state change (R1)
- The stranger lock from round 1 is gone.

### 3. Compare-and-clear and first-write-wins: correct for money; one cosmetic race
- `clearPending(id, expected)` compares by reference (`sessions.ts:104-107`). `markPending` always stores a new object (`:100-102`), so a slow poll can't clear a newer attempt.
- Every `markPending` call happens inside the `claimPayment` section, so only one pay request at a time settles and relays.
- `settlePending` re-reads the session after the clear (`settle.ts:31-33`).
- **Every `recordPayment` write has passed the consumer rule** (gross, merchant, payer at `saleOf(merchant, orderRef)`), and `saleOf` holds one payment per order. So a first write is always the true payment, and only metadata can differ. R6 shows the one difference: a slow poll can record first with `txHash: null`, which drops the relayed hash (F7, INFO).
- R7: a concurrent second attempt with a different salt gets 409 and never reaches the relayer.

### 4. Single-use SIWE nonces: correct
- `consumeNonce` (`auth.ts:65-73`) is synchronous between `has` and `set`, so two concurrent verifies can't both win.
- It runs only after a valid signature (`verify/route.ts:18`).
- Live: replaying the exact verify request (same cookie and body) gives `401`, with no session cookie.
- The Host and X-Forwarded-Host spoofs still give 401 (`round-2/probes/review-security-siwe-host.{mjs,jsonl}`).
- Limits, both documented as ponytail and inside the spec's localhost-only constraint:
  - It's per process.
  - A restart within the 5 min nonce TTL forgets used nonces, so a *captured* verify request could be replayed once.

### 5. `POST /api/demo-checkout`: no CSRF impact beyond S6
- **It takes no input.**
  - It ignores the body: a POST with `amount=1&merchant=0x…01` still opens 25.00 for Bandra Beans.
  - The merchant is fixed by config (`route.ts:16-25`). It reads no cookie and sets no state on the visitor.
- **What a cross-site form can do:** create a demo session and navigate the visitor to it. That's equivalent to linking them to a checkout. Paying still needs a deliberate hold, on a page that shows the shop and the amount.
- **Live** (`review-security-demo-checkout.log`):
  - A cross-site Origin gets 303.
  - `Host: evil.example` isn't reflected; Location stays `http://localhost:3100/checkout/<id>`.
  - `X-Forwarded-Proto: https` switches the Location scheme. Only the caller's own response changes, so it's not exploitable from a browser.
  - GET gives 405.
- **Abuse:** each call grows the in-memory Map (S6). A no-cors `fetch` from any site lets visitors' browsers create sessions too (F6).
- Side effect (INFO, F8): the absolute Location sends a visitor who is on `127.0.0.1:3100` to `localhost:3100`, another origin with a different guest key.

### 6. Branded not-found pages and "Check again"
- **No reflection.**
  - The sheets are static text (`NotFoundSheet.tsx`).
  - A `<script>` in the id isn't echoed.
  - /checkout's not-found carries the CSP, `noindex` and `no-store`.
- **"Check again" is a plain `location.reload()`** of a GET URL (the 303 made it one), so the browser never resubmits the form. A reload runs the server-side settle and sends nothing to the chain from the browser (FR-PRIV-1).
- Two copy and state issues:
  - F1: a reload during an in-flight relay doesn't show "confirming".
  - F3: after a restart the checkout not-found says "Nothing was charged from this page."

## FOLLOW-UP (MEDIUM/LOW, fix in the next batch; owner claude-frontend unless noted)

### F1. LOW: an attempt in flight at expiry: the second view says "Ask the shop for a new one" while the first can still land
- **Where:**
  - `pay/route.ts:24`: expired and `!session.pending` gives 410, without checking `isInFlight`.
  - `checkout/[sessionId]/page.tsx:31,43` passes `pending` only from `settlePending`, never `isInFlight`, so `Checkout.tsx:47` renders "expired" (`:170-173`).
- **Measured, probe R3:** the relay starts 5 s before the TTL ends. A second POST at TTL + 5 s gets `410 This checkout has expired. Ask the shop for a new one.` The first attempt then returns 200, and the poll says `paid`.
- **Path:**
  1. A 4G drop makes the client's fetch throw, and the page shows "confirming" (`Checkout.tsx:72-75`). The server is still relaying, for up to 35 s.
  2. The TTL passes, and the customer presses "Check again".
  3. The page says expired, ask for a new one.
  4. The customer pays a new checkout, and the first attempt lands.
- **Why LOW:** it needs the attempt to start in the last ~35 s of the 30 min TTL, plus a dropped connection or a second view.
- **Fix:** add `&& !isInFlight(id)` at `:24`, so an in-flight checkout falls through to `claimPayment`'s 409, which the client shows as "confirming". In the loader, use `pending={state === "pending" || isInFlight(sessionId)}`.

### F2. LOW (availability): a stranger with the URL can still pin "pending" by forcing a post-simulation revert
- **Where:**
  - `pay/route.ts:54` marks pending for whatever `from` signed when the relayer answers 502.
  - `:50` then refuses everyone else with 409 until `validBefore + 60 s`. The signer picks validBefore up to now + 900 s.
- **Measured, probe R5:** a stranger's relay ends `502 reverted`. The real customer gets 409, and the lock lasts 960 s.
- **Exploit sketch:**
  1. The stranger holds the checkout amount in its own wallet and POSTs a valid authorization.
  2. Between the relayer's simulation and inclusion, it lands its own `cancelAuthorization`, or moves its balance away.
  3. The relayer's tx reverts, and the relayer answers 502.
  4. Two successes cover the 30 min life of the checkout. The cost is the attacker's front-run gas plus the relayer's gas for the revert (claude-relayer: guard (10) alerts on failed txs).
- **No money is lost.** It needs the session URL and a winning race. It's a costlier version of round-1 S2.
- **Fix, if wanted (both parts together):**
  1. Let a *different* `from` relay while another signer's attempt is pending. `OrderPaid` still allows only one payment.
  2. On any 422, read `saleOf(merchant, orderRef) != 0` whoever paid, and answer "This order is already paid. Don't pay again." This also closes I7.

  Doing (1) without (2) would show "start again" to a customer paying from a second device after the first device's payment landed.

### F3. LOW: the checkout not-found sheet says "Nothing was charged from this page"
- **Where:** `app/checkout/[sessionId]/not-found.tsx:4`: "Ask the shop for a new link. Nothing was charged from this page."
- **Path:**
  1. Sessions live in memory (`sessions.ts:39-40`).
  2. A restart with an unknown-outcome attempt pending turns the customer's checkout link into this sheet.
  3. The sheet tells the customer they weren't charged and should get a new link. A second order follows.
- **Fix:** drop the "Nothing was charged" sentence, and say "If you already paid, don't pay again; your receipt link shows it." Neon persistence removes the restart path.

### F4. LOW today, must land with the Neon batch: sessions don't pin the MerchantPay address
- **Where:**
  - `payConfig()` (`config.ts:19-23`) is read per request.
  - The verify, relay, settle and refund paths all use it (`pay/route.ts:39,48`, `[id]/route.ts:18`, `checkout/page.tsx:31`, `r/[id]/page.tsx:25`), not a value stored on the session.
- **Why now:** 0x83b5 is paused (`paused() == true` live) and the lanes are moving to 0x8eff.
- **Exploit sketch (once sessions persist across a config switch):**
  1. Attempt A goes to 0x83b5 and its outcome is unknown.
  2. The config switches to 0x8eff.
  3. `settlePending` reads 0x8eff, sees not paid, and reopens after validBefore.
  4. B pays on 0x8eff, while A may already have landed on 0x83b5.

  That's two `saleOf` maps for one order, so the customer is charged twice. The receipt's refund line would also read the wrong contract.
- **Unreachable today:** a config change needs a restart, which wipes the in-memory sessions.
- **Fix:** store `merchantPay` on the session at create (and on `pending`), and use it everywhere.
- **Related (claude-relayer):** the relay body has no target, so if the web and the relayer point at different MerchantPays, every payment fails closed with a 422. Consider sending `merchantPay` in the body and having the relayer refuse a mismatch with its allowlist.

### F5. LOW (carried S4): a 422 with a failed chain read still says "please start the checkout again"
- **Where:** `pay/route.ts:56` → `relay.ts:64`.
- The builder's reasoning holds for the same checkout: a retry there can't pay twice. The wording is the risk, if read as "get a new checkout".
- **Fix:** `=== undefined` → pending.

### F6. LOW (carried S6, before any deploy): unbounded sessions
- Session creation has no limit: `demo-checkout/route.ts`, with the Map never evicted. `/pay` has no rate limit either.
- **New this round:** a no-cors cross-site POST lets any site's visitors create sessions.
- **Fix:**
  - Refuse `Sec-Fetch-Site: cross-site`, or an Origin other than ours.
  - Evict expired sessions on create.
  - Add a per-IP limit with Neon.

### F7. INFO: reconcile-first race drops the relayed txHash
- Probe R6: a slow poll records `txHash: null` first. The pay response still carries the hash, but the stored record and `/r` don't.
- **Fix:** merge in `recordPayment`, keeping a non-null `txHash` / `blockNumber` from either write.

### F8. INFO: absolute 303 Location from `request.url`
- `demo-checkout/route.ts:12`.
- **Fix:** a relative `Location: /checkout/<id>` keeps the visitor's own origin, and with it the guest key, and needs no host at all.

### F9. INFO: carried from round 1, still open
- I2: pin the SIWE domain from config before deploy. Sign-in from `127.0.0.1:3100` still fails 401.
- I3: a baseline CSP on every route (`object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`).
- I4: logout can't revoke a session.
- I6: decide "dead" from a block's timestamp, not the server clock.
- I7: squatting; F2's part (2) covers it.

### F10. INFO: the spec still describes the round-1 design
- `spec.md:164` says "one salt per checkout (sessionStorage), so a retry reuses the on-chain nonce".
- `:165` lists "a 422 `replay`" as pending.
- The code now does the opposite, on purpose. Update the spec lines and the gate item 4 text so the human approves what was built (PIPELINE §2).

## DONE (what I verified, and how)
- **Probes**, all under `round-2/probes/`:
  - `review-security-r1-pay-edges-rerun.log`: round-1 P1, P2 and P4 now fail their bug assertions, so the bugs are fixed. P3 still reproduces (F5).
  - `review-security-pay-r2.test.mjs` + `.log`: R1–R7, 7/7.
  - `review-security-csp-softnav.json`
  - `review-security-siwe-host.{mjs,jsonl}`
  - `review-security-demo-checkout.log`
  - `review-security-orderpaid-live.{mjs,json}`
  - `review-security-new-merchantpay-live.{mjs,json}`
- **HoldButton (AbortController refactor):** re-ran batch 002's `review-security-hold-props.mjs` and `review-security-hold-r3.mjs` on the current component. Both outputs are identical to round 1: a label change mid-hold makes 0 calls; unmount, mouse off and two fingers make 0; Enter and Space make 1 (`002-review-security-hold-*.out`).
- **`npm test`:** 83 tests, 82 pass, 0 fail, 1 skipped (live), 0 todo.
- **Client bundle** (`.next/static`):
  - No env var names: `SHOP_API_KEY|AUTH_SECRET|ARKIV_|PRIVATE_KEY|RELAYER_URL|MERCHANT_PAY_ADDRESS|MERCHANT_ADDRESS|DATABASE_URL` gives 0 files. The round-1 `AUTH_SECRET` copy is gone.
  - 0 `process.env` references.
  - External hosts are library docs, the explorer and the batch 001 RPCs. No trackers.
- **Logs:** the same two `console.error` lines as round 1, with the checkout id and the viem read error (a public RPC URL). No key, signature or cookie is logged.
- **No HTML sinks:** no `dangerouslySetInnerHTML` or `innerHTML`.
- **Headers on /checkout/<id>** after the 303: the full CSP, `X-Frame-Options: DENY` and `no-store`.
- **On-chain data and Arkiv:** no PII; no Arkiv change this batch. `orderRef` is 32 random bytes.

### Required grep `(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` over the 38 diff files
- `lib/auth.ts:17,19`: the env var name `AUTH_SECRET` only.
- `test/auth.test.mjs:7`, `test/checkout-edges.test.mjs:12`: the literal `"test-auth-secret-0123456789abcdef0123"`, a test-only fixture set inside the test process. The other `SECRET` hits in `auth.test.mjs` (`:12-105`) are the variable that holds it.
- `test/checkout-api.test.mjs:235`: the public `saleNonce` output vector.
- `test/onchain.live.test.mjs:9`: the public smoke-sale tx hash `0xae155c49…cfb1a`.
- No deployed secret or private key anywhere. `apps/web/.env.local` is git-ignored and not in `git status`.
- My probe files hold no key: keys come from `generatePrivateKey()` at runtime. The live scripts contain only the public smoke tx hash and contract addresses.

## OPEN
1. F1–F6 → claude-frontend, next batch. F4 must land together with the Neon `app_sessions` move.
2. claude-relayer, for awareness:
   - F2's forced-revert path costs relayer gas.
   - F4's address mismatch fails closed; consider `merchantPay` in the relay body.
   - When `paySale` lands, `replay` can stay a 422. This web no longer re-sends a nonce.
3. **Deployed MerchantPay 0x83b5 is paused on-chain** (`EnforcedPause` on every `paySale`). The live AT-1 must point both the web's `MERCHANT_PAY_ADDRESS` and the relayer at 0x8eff. The web's nonce encoding already matches 0x8eff (live check).

## NEEDS THE USER
- **Gate item 4 changed meaning.** Before, the unknown-outcome rule reused one salt per checkout. Now:
  - Each attempt has a fresh salt.
  - The on-chain `OrderPaid` check is the only thing preventing a second payment on the same checkout. I verified it live.
  - "Pending" is now about wording: never sending a customer to a *new* checkout while an attempt may land.

  The spec text (F10) still describes the old design.
- **Gate item 2 (`'unsafe-inline'`).** After S3, the CSP now covers the demo path. I still find no injection sink, so I consider it acceptable for the demo.
