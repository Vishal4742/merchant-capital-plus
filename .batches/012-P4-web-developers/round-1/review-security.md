VERDICT: PASS

# Security review: 012-P4-web-developers, round 1 (phase mode, Money: yes)

Reviewer: reviewer-security. Scope: the working-tree diff in `apps/web`, the untracked batch files, and the "Added at merge" items. claude-contracts' `lib/server/{keys,webhooks,events,http}.ts` were read for context only. I found nothing HIGH or CRITICAL. There is 1 MEDIUM and 2 LOW findings plus 2 INFO notes, none of which block.

## Findings

### 1. MEDIUM: the /docs webhook snippet marks an order paid by `reference` alone, and this batch makes it live
- **Where:** `apps/web/app/docs/page.tsx:45` (`markPaid(event.data.reference)`). The copy at `:112` now says "every paid checkout sends payment.succeeded".
- **Exploit:**
  - Every payment for a merchant now fires `payment.succeeded` to all of that merchant's endpoints: API checkouts, links, pages and the demo checkout.
  - A link checkout's `reference` is `link.referenceId ?? link.slug` (`lib/server/links.ts:214`). A page's is its slug (`pages.ts:149`). An open-amount, reusable link lets the payer choose the amount, and every payment through it carries the same reference.
  - A shop that copies the snippet and has order `ORDER-7` for 100 USDT, and also a reusable link with referenceId `ORDER-7`, marks the order paid when someone pays 1 USDT through the link.
  - The demo checkout's `A-<n>` references restart at `A-1042` on every restart, so they can collide with a shop's own ids.
  - "Send test event" sends `payment.succeeded` with `data: {test: true}`, so `markPaid(undefined)` runs.
- Nothing on our side can be exploited, and it is testnet only. But this is our own payment guide, and it teaches a pattern where a payer can underpay.
- **Fix:**
  - The snippet should ignore `event.data.test`.
  - It should look the order up by the checkout id it stored at create time (`event.data.id`), or check that `event.data.amount` and `currency` equal the order's total before marking it paid.
  - It should dedupe by `event.id`.
  - The SDK README should get the same change.
- **Owner:** claude-frontend (docs), with claude-sdk mirroring it in `packages/sdk/README.md`.

### 2. LOW: one failed `onSessionPaid` means `payment.succeeded` is never sent (reliability, not exposure)
- **Where:** `apps/web/lib/announce-paid.ts:11-21`, `apps/web/lib/settle.ts:22`, and claude-contracts' `lib/server/events.ts:32-41`.
- **Problem:**
  - `announcePaid` runs only when `recordPayment` runs. After that, `session.payment` is set, so `settlePending` returns "paid" without calling `findPayment` again, and the pay route answers 409.
  - If the first `onSessionPaid` throws (a Postgres blip before or inside `sendOnce`), `sendOnce` releases its key correctly, but nothing ever calls it again. AT-14's webhook is lost silently, with only the error name logged.
- **Fix (pick one):**
  - The dispatch cron also sweeps recent paid sessions that have no `paid:<id>` row in `app_gw_events`.
  - Call `announcePaid` from the "paid" branch of the GET poll. It's idempotent through `sendOnce`, at one insert per poll.
- **Owner:** claude-frontend + claude-contracts.

### 3. LOW: any signed-in wallet can now create checkouts with no rate limit and can evict other merchants' Idempotency-Key slots
- **Where:** `apps/web/app/api/v1/sessions/route.ts:26` (shopCaller, no `rateLimit`), `:16` and `:40` (one 1,000-slot `replies` map shared by all merchants, oldest evicted first).
- **Exploit:**
  - SIWE sign-in is free, so a fresh wallet can mint an `sk_test_` key and loop POST /api/v1/sessions.
  - Each call grows the unbounded in-memory sessions map.
  - 1,000 distinct Idempotency-Keys flush the demo shop's slots, so the shop's retry after a timeout opens a second checkout instead of replaying the first.
  - There is no double charge: each checkout has its own `orderRef`, and MerchantPay refuses a second payment for the same order.
  - The memory growth already exists through the unauthenticated `/l` and `/p` checkout routes.
- **Fix:** add `rateLimit(\`sessions:${shop.merchant.toLowerCase()}\`, 60, 60_000)` after `shopCaller` (the helper is already in `lib/server/http.ts`). Optionally cap the idempotency slots per merchant.
- **Owner:** claude-frontend.

### 4. INFO: 403 + `x-vercel-mitigated` → BUSY is safe
- **Where:** `apps/web/lib/relay.ts:85-86`.
- **Why it's safe:**
  - Vercel's firewall answers before the relayer function runs.
  - The relayer's own code never sets that header. Its only 403 is `apps/relayer/dev.ts:16` (host check, before sending), which still maps to "Nothing was charged" (400).
  - Nothing is marked pending, and the lock is released in `finally`.
  - If a fresh approval is relayed later, MerchantPay's OrderPaid (sales) and InvoiceNotOpen (invoices) still refuse a second payment.
  - A plain 403 still reads as 400 (tested).
- **Operational note for claude-relayer:** server-to-server calls can't solve a challenge. If the firewall challenges our server's egress, every payment reads BUSY. Add a bypass rule for requests that carry `x-relay-secret`.

### 5. INFO: shop route errors lack `cache-control: no-store` (existed before this batch)
- **Where:** `apps/web/app/api/v1/payments/route.ts:17`, `apps/web/app/api/v1/sessions/[id]/route.ts:11`. Live probe: 401 with no cache-control.
- Shared caches don't store answers to requests that carry `Authorization` (RFC 9111 §3.5), and Next doesn't cache these dynamic GETs, so this is INFO only.
- **Fix:** if you touch these files again, use `lib/server/http.ts`'s `fail` / `ok`.
- **Owner:** claude-frontend.

## What I checked and found sound

### 1. Key and signing-secret exposure
- **Server-rendered lists:**
  - The page reads lists on the server through `keyJson(listKeys())` and `listWebhooks()`. Neither selects the key, its hash or the secret.
  - `keyOf` / `webhookOf` copy known fields only, and a test checks that a `key` / `secret` on a list row is dropped.
  - So the HTML and RSC payload of this page, and of every `router.refresh()`, can't hold either value.
- **Client side:**
  - The value lives only in `useState` in `NewKeyCard` / `NewEndpoint`.
  - A grep of all new files finds no `localStorage`, `sessionStorage`, `history`, `location`, `searchParams`, `sendBeacon` or `console` on the client.
  - Ids in paths go through `encodeURIComponent`.
  - Create failures throw the fixed UNREADABLE / plain sentences and never echo the value.
- **Leaving the page:**
  - `cacheComponents: true` keeps client state across soft navigations, but every way out of this page (Nav, Shell logo, docs link) is a plain `<a>`, so leaving is a full load and the panel never survives in a hidden Activity.
  - Sign-out's `router.refresh()` swaps in `SignedOut`, which unmounts the panel.
  - `pagehide` → `flushSync(onDone)` clears it before a bfcache snapshot.
- **Cache headers:** POST /api/v1/keys and POST /api/v1/webhooks answer `cache-control: no-store`. Live probe: `/merchant/developers` answers `private, no-cache, no-store, max-age=0, must-revalidate`, and its signed-out HTML has no `sk_`, `pk_` or `whsec_` strings.
- **Trackers:** none (no middleware, no instrumentation, no analytics packages).

### 2. `lib/shop-auth.ts` shopCaller
- **Order and comparison:**
  - SHOP_API_KEY is checked first: a sha256 of each side, then `timingSafeEqual`.
  - Then `authenticateKey`: lookup by sha256 plus `timingSafeEqual`, `revoked_at IS NULL`.
  - pk → 403. Revoked or unknown → 401.
- **Probe (scratch copy):**
  - A DB outage gives 503 "We can't check API keys right now", and the log line is `shop key check: Error` (name only).
  - With DATABASE_URL unset, a sk_ key gets 401.
  - No header, or `Bearer  `, gets 401.
- **Merchant binding:**
  - `session.merchant` comes from the key, never from the body.
  - GET /api/v1/sessions/:id 404s another merchant's checkout (tested).
  - The Idempotency slot is `lowercase(merchant):key` (tested across two merchants).
  - The payments list asks the index for the key's merchant and re-checks `record.merchant` on chain.

### 3. `lib/announce-paid.ts`
- It's called only after a chain-verified `recordPayment` (`saleSettled` in both the pay route and `findPayment`).
- **No harmful double run:**
  - `markCheckoutPaid` and `confirmRedemption` are idempotent.
  - `sendOnce` uses `INSERT … ON CONFLICT DO NOTHING` on `paid:<session id>` in Postgres, so concurrent calls and multiple instances send once.
  - `recordPayment` is first-write-wins and returns the stored session.
- **Never changes the payment outcome:**
  - It's fire-and-forget (`after()`, or `void run()` outside a request), and its `.catch` logs `payment.succeeded for <session id> not queued: <ErrorName>` only (tested with a postgres URL in the message).
  - The session id is already logged elsewhere and isn't a secret.
- **Right merchant:** `enqueueEvent` selects endpoints `WHERE merchant = lower(session.merchant)`, so a session's event goes to its own merchant's endpoints only.

### 4. Webhooks
- **URL checks:**
  - Client: `httpsProblem` requires https and no userinfo.
  - Server: `httpsUrl` plus `assertPublicUrl`, re-checked before every attempt, with `redirect: "manual"`.
- **SSRF probe (scratch):** blocked 127.0.0.1, [::1], [::ffff:127.0.0.1], [::ffff:7f00:1], 0x7f000001, 2130706433, 169.254.169.254, [::ffff:169.254.169.254], [fd00:ec2::254], [64:ff9b::7f00:1], 0.0.0.0, `localhost.`, `foo.localhost`, `10.1.1.1.nip.io`. Allowed 8.8.8.8. The DNS-rebinding window is a known ponytail in claude-contracts' code.
- **Scoping:**
  - test / replay / delete are scoped to the signed-in merchant (404 otherwise).
  - test and replay share a 20/min/merchant limit.
  - The session cookie is `SameSite=Lax; HttpOnly`, so a cross-site form POST carries no cookie.
- **Display:** the endpoint URL renders as text, never as an href.

### 5. Secrets grep
`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` over every file in the diff, plus the batch folder:
- **Hits:** env-var names inside the /docs snippet strings (`page.tsx:19,43,177`), UI copy (`ApiKeys.tsx:106`, `Webhooks.tsx:108`), `RELAY_API_SECRET` handling (`relay.ts:49,52`), and fake test fixtures (`relay-auth.test.mjs`, `gateway-dev.test.mjs`).
- **No hits:** no 64-hex value, no real key, no secret.
- The preview fixtures hold only 12-character prefixes.

### 6. Tests
- Run in a scratch copy with `.env*` excluded: `npm test` → tests 371, pass 368, fail 0, skipped 3.
- Live :3100 probes were read-only: GETs and refused POSTs. I created nothing.
