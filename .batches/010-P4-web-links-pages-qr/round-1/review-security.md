VERDICT: PASS

# Security review: 010-P4-web-links-pages-qr, round 1 (phase mode, Money: yes)

I found no HIGH or CRITICAL issues. There are two MEDIUMs, and they share one fix. That fix is the `ponytail:` upgrade the builder already planned: now that claude-contracts' backend is on main, call `lib/server/*` directly instead of making an HTTP call back to this same server.

Scope: the tracked diff (Nav, Invoices, merchant home, next.config, package.json and the lock file), every new file named in the brief, and the backend on main (`lib/server/{http,links,pages}.ts` and `app/api/v1/{links,pages,public}/**`). Live probes against :3100 were GETs, plus three unauthenticated POSTs that the server answered with a 303 error. I created nothing.

## Findings

### 1. MEDIUM: on a self-hosted server, a forged `Host` header lets anyone make our server call any URL (SSRF)
- **Where:** `apps/web/lib/gateway-server.ts:14-17,20-24` (`originOf`, `gatewayFor`). Every server-side gateway call uses it: `/l`, `/p`, both `/checkout` POSTs, `/counter`, `/merchant/links` and `/merchant/pages`.
- **Owner:** claude-frontend.
- **Problem:** the base URL is built from the request's `Host` header. `next start` doesn't check that header, and :3100 listens on `*:3100`, so anyone on the same LAN (the venue wifi, for example) can set it.
- **Exploit:** I ran a listener on 127.0.0.1 and sent the probes below.
  - `curl -H 'Host: 127.0.0.1:47123' -H 'Cookie: probe=attacker-own' :3100/l/AbCdEf1234`. Our server sent `GET /api/v1/public/links/AbCdEf1234` to the listener, carrying `cookie: probe=attacker-own` and `x-forwarded-for`.
  - `Host: 127.0.0.1:47123/internal/secret?x=`. The listener received `GET /internal/secret?x=/api/v1/public/links/AbCdEf1234`. The attacker controls the host, the port, the path and the query.
  - `POST /l/AbCdEf1234/checkout` with the forged Host. The listener received a JSON POST, and the customer got a 303 to `?error=down`.
- **Impact:**
  - The attacker can reach anything the server can reach, such as localhost services (supermemory :6767, the relayer :8787) or the LAN.
  - It is mostly blind. Hosted pages show only a fixed notice, and a 404 from the target shows as not-found, so the attacker learns little from the answer.
  - On `/merchant/{links,pages}` the target's JSON `error` string (up to 300 characters) is shown to the attacker, but only if they have a SIWE cookie.
  - The only cookie forwarded is the attacker's own. A browser can't forge `Host`, and DNS rebinding would carry the attacker domain's cookies, not ours. So no victim's cookie can leak.
  - Vercel routes requests by `Host`, so a foreign `Host` should never reach our function. Production should not be exposed this way. I could not verify that live.
  - The response body is read with no size cap. The only limit is the 10 s timeout.
- **Fix:** call `payLink`/`payPage`, `linkBySlug`/`pageBySlug`, `listLinks`/`listPages` and `publicLinkJson`/`publicPageJson` from `lib/server` directly. This removes the HTTP hop, the trust in `Host` and the cookie forwarding. Until then, use a fixed base such as `http://127.0.0.1:${PORT}` or `PUBLIC_ORIGIN`, never `Host`.

### 2. MEDIUM: on Vercel, the checkout rate limit is one shared bucket, so one attacker can block every customer's hosted checkout
- **Where:**
  - `apps/web/lib/gateway-server.ts:3-5,44` (the self-call)
  - `apps/web/lib/server/links.ts:55` (`limitCheckouts`, 20 a minute)
  - `apps/web/lib/server/http.ts:143` (`clientIp`)
- **Owner:** claude-frontend. The self-hosted half is claude-contracts' known item L6 from review 007.
- **Problem:** when our server calls itself, Vercel replaces `x-forwarded-for` with the function's egress IP. All `/l` and `/p` customers served by one warm instance therefore share a single limit of 20 checkouts a minute.
- **Exploit:**
  - About 20 unauthenticated `POST /l/<any active slug>/checkout` requests a minute, from any one machine, make every hosted checkout answer "Lots of people are paying right now" (`busy`).
  - Each of those requests also writes a checkout row.
  - It costs the attacker nothing, and could be used during judging.
- **The reverse on `next start`:** a client's own `X-Forwarded-For: 1.2.3.4` reaches the gateway unchanged (I probed it), so the limit can be bypassed there.
- **Fix:** the same as #1. Calling `lib/server` in-process with the incoming `Request` lets `clientIp` see the payer's IP as Vercel reports it. For self-hosted, L6 stands: trust `x-forwarded-for` only on Vercel.

### 3. LOW: QR codes and copied URLs are built from `Host` and ignore `PUBLIC_ORIGIN`
- **Where:**
  - `apps/web/app/qr/[kind]/[id]/route.ts:12`
  - `apps/web/app/merchant/links/page.tsx:56`
  - `apps/web/app/merchant/pages/page.tsx:58`
- **Owner:** claude-frontend.
- **Exploit:** `curl -H 'Host: evil.example' :3100/qr/pay/1` returns an SVG that is byte-for-byte equal to `renderSVG('http://evil.example/pay/1', …)`. The forged QR goes only to whoever sent the request.
  - `cache-control: private` keeps shared caches from storing it.
  - Every page here renders per request, so nothing is cached that another visitor would see.
- **When it matters:** this is the same risk as review 006 F5. It becomes real behind a CDN or proxy that caches the response or passes `Host` through. QR codes get printed and shown at counters, so a poisoned one would last.
- **Fix:** `publicOrigin(originOf(h))` from `lib/config.ts`. That is the helper review 006 F5 added, and it is one call at each of the three places.

### 4. LOW: the live preview on `/merchant/pages` fetches an image on every keystroke
- **Where:** `apps/web/components/gateway/Pages.tsx:89`
- **Owner:** claude-frontend.
- **Problem:** once the logo field matches `^https://\S+$`, each keystroke starts a request to a different partial host (`https://e`, `https://ev`, and so on). This leaks only the merchant's own IP and browser details.
- **What I checked:** the relaxed `img-src https:` exposes nothing else on that page.
  - `script-src` and `connect-src` stay `'self'`.
  - None of these files use `dangerouslySetInnerHTML`.
  - Nav items are plain `<a>` full loads, so no other dashboard page keeps the relaxed policy.
  - `Referrer-Policy: strict-origin-when-cross-origin` applies.
  - The CSS `url("…")` uses the parsed href, where `"` is already encoded as `%22`.
- **Accepted trade-off:** on `/p`, the merchant's logo host sees each customer's IP and browser details. The human accepted this at 06:30.
- **Fix:** load the preview logo on blur, or after a 500 ms debounce.

### 5. LOW: `readForm` reads the whole body before checking its size
- **Where:** `apps/web/lib/gateway-server.ts:31-34`
- **Owner:** claude-frontend.
- **Problem:** `request.text()` reads the entire body before the 16 KB check. On `next start` the body size is unbounded; Vercel caps it at 4.5 MB. The backend's `readJson` follows the same pattern.
- **Fix:** check `content-length` first, or read the stream up to the cap. It goes away with #1 if the routes hand the `Request` to `lib/server`.

## Checked and clean
- **Open redirect and header injection:** `Location` is always a relative path.
  - It is `/checkout/<id>`, where the id must match a UUID regex and the gateway's `checkout_url` is ignored.
  - Otherwise it is `/l|p/<SLUG>?<URLSearchParams>`, with the slug matching `^[0-9A-Za-z]{1,64}$` and CR/LF encoded.
- **Fixed prices can't be changed:**
  - `/l` sends `{}` when the form has no amount.
  - `payLink` uses the stored price whenever the link has one (`links.ts:200`), so a forged `amount=0.01` is ignored.
  - `/p` sends only names and quantities. `pickItems` prices each line from the stored menu, and an `amount` sent to an items page gets a 400.
  - Open amounts are checked against min and max on the backend.
  - The USDT conversion rounds up (`inUsdt`), never in the payer's favour.
- **CSRF:**
  - The public POSTs only open a checkout, which an attacker could do directly anyway.
  - The SIWE cookie is `SameSite=Lax` (`auth.ts:116`), so browsers don't send it on cross-site POSTs.
  - Dashboard writes are same-origin JSON.
- **`/merchant/payments`:**
  - The merchant comes from the cookie (`currentMerchant`), and `paidLogs({merchant})` reads only that wallet's payments.
  - `confirmed()` drops any row whose on-chain merchant is someone else.
  - The refundable amount comes from `payments(id)` on chain.
  - `Refund` calls `merchant-wallet.refund`, which reads the allowance and `balanceOf` and dry-runs with `simulateContract` before any approval (`merchant-wallet.ts:103-111`).
  - The `logged()` helper writes viem messages to the server log. They name only the public Ankr URL, which has no key.
- **QR:**
  - Only three kinds are allowed (`Object.hasOwn`: l, p and pay), and the id must match a pattern. I probed `__proto__`, `a%2Fb` and `0`; each got a 404.
  - The download filename `qr-<kind>-<id>.svg` is built only from the checked parts.
  - The SVG contains no `<script>`, `foreignObject` or `href`. It is served with `default-src 'none'` and `nosniff`.
  - `uqr` appears in no `.next/static` chunk.
  - `uqr` 0.1.3 is MIT, has no dependencies and no install scripts, and the lock file pins its integrity hash.
- **CSP:** curl against :3100 shows `img-src 'self' data: https:` only on `/p/x` and `/merchant/pages`. The strict policy is on `/l/x`, `/counter/pay/1`, `/merchant`, `/merchant/links`, `/merchant/payments` and `/docs`. `/qr` sets its own `default-src 'none'`.
- **`GATEWAY_PREVIEW`:**
  - `previewOn` is false whenever `VERCEL` or `VERCEL_ENV` is set; `test/hosted-pages.test.mjs:96-100` covers this.
  - Every non-GET call answers 503, so a fixture can't be paid.
  - Preview is off on :3100: the fixture slug `CoLdBrEw01` gives a 404.
  - No client component imports `gateway-server` or `gateway-preview`.
- **Secrets:** I ran `grep -rnE --exclude='.env*' '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on every file in the diff and every new file: 0 hits. On the backend files, the only hits are env variable names (`VOUCHER_HASH_SECRET`), with no values.
- **Tests:** the four new test files pass 28/28 in a scratch copy with no `.env*` files.
