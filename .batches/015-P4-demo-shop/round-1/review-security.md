VERDICT: PASS

# Security review: 015-P4-demo-shop, round 1

Reviewer: security. Scope: `git diff origin/main...HEAD -- apps/shop` (checkout.ts, webhook.ts, dev.ts, public/index.html, .gitignore, .vercelignore, package.json, tsconfig.json, tests, README). `lib/sdk.ts` is only checked for how the shop calls it. No code edited. No `.env` read. No network calls.

## Evidence run

- `npm test` in apps/shop: 5 pass, 0 fail. `npx tsc --noEmit`: exit 0.
- Probe script (scratchpad, imports the real handlers, mocked fetch):
  - Webhook with `GATEWAY_WEBHOOK_SECRET` unset: throws "No webhook secret configured…", so the answer is 500 and nothing is accepted. Fails closed.
  - Timestamp 301 s old: 400. Lower-case `mc-signature` header: 200 (Headers is case-insensitive, as it should be).
  - The same signed request sent twice within 300 s: 200, 200 (replay inside the window; see L2).
  - The gateway's own test send (`payment.succeeded`, `data: {test: true}`): 200, logged as `verified payment.succeeded evt_t session=undefined status=undefined amount=undefined` (see L2).
  - A body signed over bytes that start with a UTF-8 BOM: 400 (`request.text()` strips the BOM; fails closed, see L4).
  - Checkout sent to `https://evil.example/x?amount=0.01` with body `amount=0.01&price=0.01`: the gateway gets `amount: "2.00"` and `returnUrl: "https://evil.example/"`. The browser can't set the amount; returnUrl follows `request.url` (see L3).
  - 4 checkouts at once: all 4 got the same reference `espresso-1793937060048` (see L1).
- `git ls-files apps/shop` and `git archive HEAD apps/shop | tar -t`: no `.env`, no `.vercel`.
- Secret grep (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` over every diff file), hits:
  - `api/checkout.ts:7,8`, `api/webhook.ts:6`, `dev.ts:1`, `lib/sdk.ts:221`: env var **names** only (`GATEWAY_SECRET_KEY`, `GATEWAY_WEBHOOK_SECRET`).
  - `test/shop.test.ts:8-10,18,23`: test-only literals `whsec_test_only`, `sk_test_only`.
  - No 64-hex string anywhere. An extra grep for real-looking `sk_…`/`whsec_…` values (8+ chars) found nothing. **No secret in the diff.**

## Findings

No CRITICAL, HIGH or MEDIUM findings.

### L1 LOW: orderId repeats when two checkouts land in the same millisecond
- `apps/shop/api/checkout.ts:10`, ``orderId: `espresso-${Date.now()}` ``.
- Scenario: two customers (or one double-click) hit Buy in the same ms and get two sessions with the same `reference`. The probe gave 4 sessions one reference. In this log-only shop nothing goes wrong. But this file is the AT-14 "20 lines" integration that merchants will copy. A copier who matches the webhook to an order by `reference` (not by `data.id`) can mark the wrong order paid, or both orders paid from one payment.
- Fix (same line count): `orderId: crypto.randomUUID()` (36 chars, inside the SDK's 1-40 rule). Or `espresso-${crypto.randomUUID().slice(0, 12)}`.
- Owner: claude-relayer.

### L2 LOW: webhook accepts duplicates and the gateway's test event as "verified payment.succeeded" (documented ponytail)
- `apps/shop/api/webhook.ts:7-10`. The gateway re-signs every retry and every replay with a fresh timestamp and the **same event id** (`apps/web/lib/server/webhooks.ts:2,125-142,175-179`), so duplicates are expected by design and the 300 s window (`lib/sdk.ts:92,115`) can't stop them; only an `event.id` dedupe can. The dashboard test send is `payment.succeeded` with `data: {test: true}` (`apps/web/lib/server/webhooks.ts:167-172`).
- For this demo shop the risk is nil: no fulfilment, no stock, no money moves on the webhook. A captured request can't be replayed from outside, because delivery records never expose the body or the signature (`deliveryJson`, webhooks.ts:62-70) and the endpoint is HTTPS.
- The two real risks:
  1. **AT-14 evidence.** A "send test event" from the dashboard also gives a 200 delivery and a `verified payment.succeeded` log line. The batch's evidence must be the line with `session=cs_… status=paid amount=2.00`, plus the delivery for that same `evt_` id and the tx hash, not any 200. Vercel keeps runtime logs only a short time on Hobby, so screenshot the line when it happens.
  2. **Copy hazard.** The ponytail comment names matching `data.id` to a stored session, `sameAmount`, and dedupe on `event.id`. It doesn't name the `event.type` check, and a `payment.refunded` event goes through the same "verified" path. A copier who swaps `console.info` for `fulfil()` would fulfil on refunds and on test sends.
- Fix (comment only, keeps the 20-line count): add "checks event.type === 'payment.succeeded' and data.status === 'paid'" to the ponytail comment at `webhook.ts:7-8`.
- Owner: claude-relayer. Cross-lane FYI for the apps/web lane: a test event that shares the live `payment.succeeded` type, told apart only by `data.test`, is a trap for every merchant. A distinct type like `test.ping` would be safer. Not a blocker here.

### L3 LOW (no change required): `returnUrl` trusts `request.url`
- `apps/shop/api/checkout.ts:10`, `returnUrl: new URL('/', request.url).href`. The probe shows the handler uses whatever origin `request.url` has.
- **dev.ts:** safe. `dev.ts:25` builds the Request from the fixed `http://127.0.0.1:4100`, so the client's `Host` header is never used. returnUrl is always `http://127.0.0.1:4100/`.
- **Vercel:** Vercel routes by Host, so only this project's own domains (the production alias, per-deployment and preview URLs) reach the function. That leaves `X-Forwarded-Host`: this is safe only if Vercel overwrites it, which I could not test (no network calls allowed). Worst case, if it could be spoofed: an attacker makes a 2.00 USDT session *to this shop* whose "Back to shop" link points at their site. They then have to get a victim to open it, the victim pays the real merchant, and the back link lands on a phishing page. The gateway already allows only http/https (`apps/web/app/api/v1/sessions/route.ts:83-84`, `webUrl`), so there is no `javascript:`.
- Optional check once `/api/checkout` is live on Vercel: `POST` with `X-Forwarded-Host: evil.example` and confirm the session's returnUrl is still the shop's domain. Optional hardening: `process.env.SHOP_URL ?? request.url`. Not needed for the demo.
- Owner: claude-relayer.

### L4 LOW: `request.text()` is not byte-exact
- `apps/shop/api/webhook.ts:6`. `text()` decodes as UTF-8: it strips a leading BOM and turns invalid bytes into U+FFFD. The HMAC is then computed over the re-encoded string, not the bytes on the wire. This fails closed (400, probe confirmed) and never fails open. Today the gateway signs `JSON.stringify` output (`webhooks.ts:148`), which is valid UTF-8 with no BOM, so the two always agree. The comment on line 1 ("The raw body is what was signed") is slightly too strong.
- Optional fix (same length): `constructEvent(new Uint8Array(await request.arrayBuffer()), …)`. The SDK already accepts a `Uint8Array`.
- Owner: claude-relayer.

### L5 LOW: `/api/checkout` is an unauthenticated session creator (CSRF / spam) once wired
- `apps/shop/api/checkout.ts:6-12` (Vercel) and `dev.ts:12` (local, no Host check, as the ponytail comment says).
- Scenario: any web page can auto-submit a form to `/api/checkout`, or loop `curl`, and each request makes a gateway session under the shop's `sk_` key. For dev.ts this works through a cross-site form POST to `127.0.0.1:4100`, or DNS rebinding, from any site the developer visits. Impact: unpaid sessions that expire in 30 min, plus gateway/Vercel load. A shared per-key rate limit on the gateway would also lock out real customers. No money moves. The key never appears in a response (303 `Location` or a fixed 502 text; the SDK scrubs the key from logged errors, and the test at `shop.test.ts:43-48` pins this).
- Today on Vercel `GATEWAY_SECRET_KEY` is unset, so the constructor throws and Vercel answers a generic 500 (message "Gateway needs your secret key.", no value). Not live yet.
- This is the normal shape of a public checkout button (Stripe Checkout works the same way). Fix when it goes public: a Vercel WAF rate-limit rule on `/api/checkout`, or accept it for the demo. dev.ts: accepted as documented.
- Owner: claude-relayer.

## Checked and fine

- **Amount can't come from the browser:** the form posts no fields, the handler never reads the body or query, and `ESPRESSO.price` "2.00" is a server constant (probe: a hostile body/query still sends "2.00"). It is under the 2.49 USDT G4 cap.
- **Webhook verification:** the signature is checked over the body before `JSON.parse`. `timingSafeEqual` runs on two 32-byte buffers; v1 must be 64 hex first, so the lengths always match and nothing throws. Every failure (missing, malformed, stale or mismatched) gives the same static `bad signature` 400, so there is no oracle. `instanceof WebhookSignatureError` uses the same module as `constructEvent`. No path returns 200 without a verified event. Unset secret → 500 (fails closed; Production-only env means preview deploys fail closed too).
- **No secret leakage:** no key or secret in responses, error bodies or log lines. The webhook log line holds event id, session id, status and amount only, so no PII. The checkout error log is SDK-scrubbed. dev.ts logs only `err.message` from these handlers.
- **Deploy bundle:** built from `git archive`, which has no `.env`. `.vercelignore` also excludes `.env`, `.env.*`, `test`, `dev.ts` and `node_modules` for a direct `vercel deploy`. `.gitignore` covers `.env`, `.env.*` and `.vercel`. The local `.env` is mode 600 (listed, not read).
- **dev.ts:** binds 127.0.0.1 only. No static file serving (GET `/` serves the in-memory page; everything else is a fixed `not found`), so no path traversal. Nothing is reflected into the HTML. It forwards only `mc-signature`. Absolute-form request lines simply miss the route table (404).
- **index.html:** no scripts, no external resources, no trackers. No security headers (no vercel.json), which is acceptable for a script-free static page. A clickjacked Buy click only opens a checkout the customer must still approve on the gateway.
- **Open redirect:** the 303 target is `session.url` from the authenticated gateway response (the SDK uses `redirect: "error"`, and http only for localhost). It never comes from the browser.

Verdict: PASS with LOWs (L1-L5; none block AT-14. L1 and the L2 comment line are cheap fixes to make before merchants copy this file).
