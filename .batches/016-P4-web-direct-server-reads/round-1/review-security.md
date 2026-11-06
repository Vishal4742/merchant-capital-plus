VERDICT: PASS

# Security review: 016-P4-web-direct-server-reads, round 1 (phase mode, Money: yes)

Reviewer: reviewer-security, 2026-11-06. Scope: the 21-file working-tree diff in `apps/web` (19 edited, 2 deleted), and claude-contracts' `lib/server/{links,pages,vouchers,reports,settlements,keys,webhooks,http,checkouts}.ts` on main. Read-only on code. I didn't read `.env*`, didn't restart :3100, and sent only GET probes to it.

I found no HIGH or CRITICAL issue. Review 010's F1 (an SSRF through a forged Host) and F2 (one rate-limit bucket shared by every payer on Vercel) are both closed: no server-side HTTP call is left, and the payer's own `x-forwarded-for` now reaches `limitCheckouts`.

## Findings

### 1. LOW: off Vercel, a client can still pick its own checkout-limit bucket through `x-forwarded-for`. Not exploitable on Vercel. No regression.
- **Where:** `apps/web/lib/server/http.ts:143` (`clientIp` takes the first XFF hop). The header is passed on at `apps/web/lib/gateway-server.ts:81`. The bucket is in memory per instance (`http.ts:127`).
- **Owner:** claude-contracts (this is review 007's L6 and 010 F2's self-hosted half).
- **Exploit:** under `next start`, behind a tunnel or proxy that appends to XFF, an attacker sends `X-Forwarded-For: <random>` on each POST to `/l/<slug>/checkout` (or `/api/v1/public/links/<slug>/checkout`). The 20-a-minute limit never trips. The attacker gets unlimited in-memory sessions and `app_gw_checkouts` rows, which is a memory and storage DoS. No money moves, because each session still needs a signed payment. A request with no XFF lands in the shared `checkout:unknown` bucket.
- **On Vercel:** Vercel overwrites `X-Forwarded-For` with the client IP and drops the client's own value ("to prevent IP spoofing", https://vercel.com/docs/headers/request-headers#x-forwarded-for). The client therefore can't choose its bucket, and each payer is counted once: payLink/payPage call `limitCheckouts` and the hosted route doesn't. The test "the checkout limit counts each payer, not our server" covers this. What remains is that the limit is per warm instance, which is the known `http.ts:126` ponytail.
- **Fix (when self-hosting matters):** trust XFF only when `VERCEL` is set, and use the socket address or a fixed proxy hop otherwise. Move the limiter to Postgres if abuse shows up.

### 2. LOW: the Payments page logs viem's full error message, not just the error name
- **Where:** `apps/web/app/merchant/payments/page.tsx:29-32` (`logged`). This code predates the batch (bae44ab), but the file is in this diff, and the spec's NFR-6 line says "Error details are logged by name only".
- **Owner:** claude-frontend.
- **Exploit:** today, none. The RPC is keyless (`https://rpc.ankr.com/whitechain_testnet`, `lib/onchain.ts:10`) and Blockscout is public, so the message holds only a public URL, a contract address and calldata. If someone later sets a keyed RPC URL (a key in the path, as Alchemy, Infura or paid Ankr use), the key would land in Vercel's function logs on every failed fee or payment read.
- **Fix:** replace `logged`'s `console.error` with `logFailure(\`payments: ${what}\`, error)` from `lib/gateway-server.ts:49`. Keep `return null`.

### 3. INFO: unknown ids show the 404 sheet, but the HTTP status is 200
- **Where:** `app/{l,p}/[slug]/page.tsx` and `app/counter/[kind]/[id]/page.tsx`: `notFound()` runs inside `<Suspense>`, after the shell has streamed.
- **Probe (GET, :3100):** `/l/ZZZZZZZZZZ`, `/p/ZZZZZZZZZZ`, `/counter/l/ZZZZZZZZZZ`, `/counter/p/ZZZZZZZZZZ` and `/counter/pay/999999` each return 200, and the body carries `NEXT_HTTP_ERROR_FALLBACK;404` plus `robots noindex`. No link, page or invoice data appears. `/counter/pay/1` (the shop's own invoice) renders "Invoice 1".
- **Security impact:** none, since nothing leaks. Code and UX review can decide whether a real 404 status matters (for crawlers or monitors).

### 4. INFO: `openCheckout` no longer checks that the session id looks like a UUID
- **Where:** `apps/web/lib/gateway-server.ts:85-87`.
- **Why this is fine:** the id now comes from `payLink`/`payPage` in the same process. It is `randomUUID()` from `lib/sessions.ts` `createSession`, and not data from another host. `Location` is the relative `/checkout/<uuid>`, and the request's Host plays no part. The `checkout_url` built from `request.url` in `links.ts` `openCheckout` is ignored, so there is no open redirect. `back()` builds a relative `/l/<slug>?…` or `/p/<slug>?…` with a slug that passed `SLUG` and values encoded by URLSearchParams. No action.

## What I checked and found sound

1. **The hosted checkout routes.** `app/{l,p}/[slug]/checkout/route.ts` → `openCheckout` → `payLink`/`payPage` with a new `Request` that carries only accept, content-type, the payer's XFF and the JSON body. No cookie is forwarded and there is no fetch.
   - For a fixed link, `link.amount ?? priceField(...)` (`links.ts`, `payLink`) means the stored price wins. The test at `test/hosted-pages.test.mjs:74-75` posts `amount=1.00` to a 25 USDT link and still gets 25 USDT.
   - For an items page, `pickItems` prices every line from the stored menu. A posted `amount` on an items page gives `body.items` undefined → 400. An open-amount page enforces `openMin`/`openMax`, and `openCheckout` enforces the 1 to 1,000 USDT bounds.
   - Errors: an HttpError status maps to a fixed message code, and anything else is logged by name only.
2. **Merchant scoping.** Every dashboard read takes `merchant` from `currentMerchant()` (the HMAC SIWE cookie, `lib/merchant-session.ts`) and nothing else. No query, form or path value picks the merchant.
   - `listLinks`, `listPages`, `listVouchers`, `listKeys` and `listWebhooks` (hooks and deliveries alike) all filter `WHERE merchant = $1` on the lowercased address.
   - `merchantHistory` filters Paid by topic2 = merchant, checks `p.merchant` again after decoding, and keeps only refunds of that merchant's payment ids. `settlements` reads that history and the merchant's own balance.
   - Payments keeps its existing scoping (`listPayments(merchant)`, `paidLogs({ merchant })`, `confirmed(..., merchant)`).
   - The skipped GET routes did nothing beyond `signedInMerchant`: none of them is rate-limited (the vouchers limit is on POST only), so going in-process loses no check.
3. **Errors.** `logFailure` logs `error.name` only. `readFailure` returns either an HttpError's curated sentence (range, 502 or 503 messages, no SQL), the DbUnavailable sentence, or a fixed "We couldn't read your … right now". The hosted pages and the counter page log by name and show fixed copy. Finding 2 is the one exception.
4. **Leftovers.** `selfOrigin|transportFor|gatewayFor|GATEWAY_PREVIEW|previewOn|previewFetch|previewDev|gateway-preview|gateway-dev-preview|PREVIEW_` returns nothing in `apps/web` (node_modules and .next excluded). The only server-side `fetch` calls go to Blockscout, Frankfurter, the relayer URL and merchant webhook URLs. None goes to our own origin, and `VERCEL_URL` is gone. `gatewayClient`, `moneyClient` and `devClient` are called only from `"use client"` components with relative paths. No client component imports `lib/gateway-server.ts` or `lib/server/*`.
5. **Counter `notFound()`.** `unstable_rethrow` (`counter/[kind]/[id]/page.tsx:67`) now lets `notFound()` from `viewOf` through (line 53, `isShopInvoice`, and the null link or page). Before this batch, the catch swallowed it and showed "can't show this code". A missing invoice, or one that isn't the shop's, gets the 404 sheet (probe above).
6. **Client bundle.** In `.next/static`, the only hit for `app_gw_|DATABASE_URL|AUTH_SECRET|RELAYER_PRIVATE|whsec_` is the `^whsec_…$` format regex in the Webhooks client's create parser (batch 012, by design).
7. **Secrets grep** (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` over the 19 edited files and the HEAD copies of the 2 deleted ones):
   - `test/gateway-dev.test.mjs:13,91,96,100,109`: `SECRET = "whsec_" + "s".repeat(43)`, a dummy placeholder. Not a secret.
   - The deleted `lib/gateway-preview.ts:125-127` held three 0x…64 Arkiv entity keys. These are public entity ids, not private keys, and this batch deletes them.
   - No other hits. No `.env*` file is in the diff.
8. **Tests.** I ran them in a scratch copy with `.env*` excluded and DATABASE_URL and AUTH_SECRET unset: `tests 391, pass 389, fail 0, skipped 2`. That matches CI.
