VERDICT: PASS

# reviewer-security: 022-P4-web-vercel-deploy, round 1 (phase mode, Money: yes)

Scope: `apps/web/vercel.json`, `apps/web/.vercelignore`, and the live production deployment
`dpl_2tQBnsnfd4LeNAwCCQCPMT713tUX` at https://merchant-capital-web.vercel.app. I only sent GETs, requests that get
refused, and 6 `POST /api/demo-checkout` calls (the public "Try a checkout" button; they make in-memory sessions only).
I read no `.env*` file and printed no secret value.

Summary: the deployed config passes all six security checks (1-6 below). Finding 1 (HIGH, functional) has moved to
batch 023 (sessions in Neon). It is not a config issue: `spec.md` now hands that batch the acceptance test "One confirm
payment on the live URL" (I re-read it to confirm), so nothing in this batch's own scope blocks.

## Findings

### 1. Moved to batch 023 (sessions in Neon), not a config issue. Was HIGH (functional; fails closed, no fund risk): every checkout on the live URL shows "This checkout link doesn't work"
- **Where:** `apps/web/lib/sessions.ts:70-71` (sessions live in a `globalThis` Map), `:86` (`createSession` writes to it),
  `:90-92` (`getSession` reads it). Callers that depend on it: `app/checkout/[sessionId]/page.tsx:55`,
  `app/api/v1/sessions/[id]/pay/route.ts:32`, `lib/server/links.ts:96`, `app/api/demo-checkout/route.ts:26`.
  `app/api/v1/sessions/route.ts:26` already notes the limit: "not shared between instances ... until sessions move to Neon".
- **Evidence:** I sent 5 `POST /api/demo-checkout` requests and each returned `303 Location: /checkout/<uuid>`. A `GET`
  of each Location, including one sent right after its POST, streams `$RX("B:0","NEXT_HTTP_ERROR_FALLBACK;404")`, which
  is `notFound()` in `CheckoutLoader`, followed by the not-found sheet. `/pay/1` reads its invoice from the chain and
  renders correctly ("Invoice 1 Bandra Beans ... Paid"), so streaming works and the session store is the cause.
- **Impact:** the API route and the page run on different serverless instances on Vercel, so a session created by
  one is missing on the other. This breaks the home page's "Try a checkout", shop sessions (`POST /api/v1/sessions`),
  and link and page checkouts. The acceptance test "One confirm payment on the live URL" can't pass through a
  checkout. Money safety holds: a pay request that lands on an instance without the session gets a 404 before anything
  is relayed, and the EIP-3009 nonce is still single use, so nothing is double-charged or lost.
- **Resolution:** the coordinator took option (a): move sessions, including the pay route's claim and pending state,
  to Neon, keyed by id, with an atomic claim column. It is batch 023, which owns the live confirm payment test.
  `.batches/023-*` didn't exist yet when I re-read the spec (it is being built in scratch). Until 023 ships, the live
  URL's "Try a checkout" and every shop, link and page checkout show the not-found sheet. Batch 023's security pass
  should re-run the 5-checkout probe above and confirm one confirm payment on the live URL.
- **Owner:** claude-frontend (`apps/web/lib/sessions.ts`). Coordinate the table with whoever owns `apps/web/db/`.

### 2. PASS: no secret is served (check 1)
- I fetched 12 pages (`/`, `/docs`, `/merchant`, `/merchant/developers`, `/merchant/pages`, `/checkout/x`, `/pay/1`,
  `/p/x`, `/l/x`, `/r/x`, `/counter/l/x`, `/proofs`) and all 32 `/_next/static/**` chunks they reference.
- No hits for `sk_test_`/`sk_live_`, `whsec_`, `postgres://`, `neon.tech`, any of the 8 secret env names,
  `PRIVATE_KEY`, PEM headers, `VERCEL_OIDC`, a relay-secret header, or JWTs. The only `process.env.*` text is the
  `/docs` code sample (`GATEWAY_SECRET_KEY`, `GATEWAY_WEBHOOK_SECRET` placeholders for merchants).
- I classified all 22 distinct 64-hex strings: secp256k1 curve and endomorphism constants (noble-curves), viem magic
  values (ERC-6492, ERC-8010, the sendCalls fallback id), the zero hash, and the Anon-RPC worker hash pinned in
  `lib/anon.ts`. None is a key.
- Source maps: `*.js.map` gives 403. `/.env`, `/.env.local`, `/.env.production`, `/.vercel/project.json`,
  `/package.json` and `/next.config.ts` give 404. `/_src` redirects to the Vercel dashboard (`publicSource` is null, so
  it is private).
- Deployment source (`vercel api /v6/deployments/<id>/files`): 218 source files, none matching `.env*`, `.pem`, `.key`,
  `.vercel/`, `node_modules`, `.next`, `*.log` or the test output folders. Every uploaded file is git-tracked, except
  `.vercelignore`, `vercel.json`, `next-env.d.ts` and `tsconfig.tsbuildinfo`, which are harmless.
- Env (`/v10/projects/.../env`, names and types only): all 8 secrets are `type=sensitive` (write-only) with
  `target=production` only. No `NEXT_PUBLIC_*` vars. Preview deployments get no secrets.

### 3. PASS: per-route CSP and X-Frame-Options (check 2)
- `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin` and HSTS are on every route.
- Strict policy (`default-src 'self'` ... `connect-src 'self'` ... `frame-ancestors 'none'`, no `'unsafe-eval'` in
  production) is on `/checkout/x`, `/pay/1`, `/r/x`, `/l/x`, `/counter/l/x`, `/docs` and `/merchant/developers`
  (no Nym hosts). `/p/x` is strict plus `img-src https:` only. `/merchant` and `/merchant/pages` carry the Anon-RPC
  policy. `/` and `/proofs` have no CSP, same as :3100 by design (`next.config.ts:42`).
- The headers come from `next.config.ts`; `vercel.json` overrides nothing.

### 4. PASS: APIs refuse without credentials (check 3)
- `POST /api/v1/sessions` gives 401, also with a fake bearer. `GET /api/v1/payments` gives 401. `GET /api/v1/links`
  gives 401.
- `GET` and `POST /api/v1/webhooks/dispatch` with no bearer, a wrong bearer, an empty bearer, or `Bearer undefined`
  all give 401. 401 rather than 503 means `CRON_SECRET` is set. The compare is a constant-time sha256 compare.
- Without credentials, `/api/v1/{keys,webhooks,reports,reports.csv,settlements,vouchers,pages}` and the POST routes
  for keys, webhooks, webhook test, delivery replay, voucher publish and link cancel all give 401.
- `/api/demo-checkout`: `GET` gives 405. The 6 POSTs gave 303. The limit is 10 per IP per minute
  (`route.ts:11`), and Vercel overwrites `x-forwarded-for` "to prevent IP spoofing" (Vercel docs, Request headers),
  so a spoofed header can't buy a fresh window. I didn't flood it to trip the 429.
- Functions run in iad1 (`x-vercel-id: bom1::iad1::…`). The SIWE nonce cookie is `HttpOnly; Secure; SameSite=Lax;
  Max-Age=300`.

### 5. PASS: test-mode strip and chains (check 4)
- All 12 fetched pages show "Test mode · Whitechain testnet · no real money moves".
- The bundles name chain `id:1874` only. There is no 1875 (Whitechain mainnet). RPCs are `rpc.testnet.whitechain.io`
  and `rpc.ankr.com/whitechain_testnet`.
- The only mainnet host is `ethereum-rpc.publicnode.com`, used for the Anon-RPC worker registry `eth_call`
  (read-only and hash-pinned, `lib/anon.ts`) and allowed only in `/merchant`'s CSP. No payment touches it.

### 6. PASS: `.vercelignore` and `vercel.json` (check 5)
- `apps/web/.vercelignore:2-3` ignores `.env` and `.env.*`, which covers `.env.local` and its `VERCEL_OIDC_TOKEN`.
  It also ignores `.next`, `node_modules`, `.vercel`, test output and `*.log`. The deployment file listing in
  finding 2 confirms it.
- `apps/web/vercel.json` holds `$schema`, `framework: nextjs` and `regions: ["iad1"]` only. It has no rewrites,
  redirects, headers or crons.

### 7. PASS: Deployment Protection (check 6)
- The project's `ssoProtection` is `all_except_custom_domains` (Standard Protection). `https://merchant-capital-web.vercel.app/`
  gives 200, so it is public for judges as intended.
- The generated URL `merchant-capital-3hq5omlkl-…vercel.app` and the team alias
  `merchant-capital-web-vishal4742s-projects.vercel.app` both give 302 to `vercel.com/sso-api`, including
  `/api/v1/payments`.
- Previews fall under the same protection and carry no secrets. `gitForkProtection` is true and there is no
  `protectionBypass`.

## Required grep
`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over `apps/web/vercel.json`, `apps/web/.vercelignore`, and the
batch's `spec.md` and `batch.md` has one hit: `.batches/022-P4-web-vercel-deploy/spec.md:14`. It lists env var names
only (`AUTH_SECRET`, `RELAY_API_SECRET`, `ARKIV_PRIVATE_KEY`, `CRON_SECRET`, …) and contains no value.

## FOLLOW-UP (MEDIUM/LOW, non-blocking)
- **F1 MEDIUM: webhook retries never run.** The project's `crons.definitions` is `[]`, and nothing else calls
  `/api/v1/webhooks/dispatch` (`lib/server/webhooks.ts:3` says retries come from it). A merchant whose first
  `payment.succeeded` attempt fails never gets the event again. Fix: add
  `"crons": [{"path": "/api/v1/webhooks/dispatch", "schedule": "0 0 * * *"}]` to `apps/web/vercel.json`. Vercel Cron
  sends `Authorization: Bearer $CRON_SECRET` itself, and Hobby allows once a day while Pro allows a tighter schedule.
  Owner: claude-frontend.
- **F2 MEDIUM: other per-instance state is weaker on serverless.** Fix it with finding 1's Neon move.
  - The rate limits (`lib/server/http.ts:127`) now count per instance: demo 10/min, sessions 60/min per merchant,
    and the checkout limits.
  - `Idempotency-Key` replies (`app/api/v1/sessions/route.ts:27`): a retry that lands on another instance makes a
    second checkout.
  - The used SIWE nonce set (`lib/auth.ts:65`): a captured verify request could be replayed on another instance
    within 5 minutes. This needs the victim's nonce cookie, so it is LOW on its own.
- **F3 LOW: no CSP on `/` and `/proofs`.** This is unchanged from :3100 and by design (Nym CDNs), and DENY framing is
  present. Noted only because these are now public pages.
