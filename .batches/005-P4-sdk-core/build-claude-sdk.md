STATUS: READY

# Build: 005-P4-sdk-core (claude-sdk)

## Round 2 (human 03:05 at the gate: "Fix now, then merge"; also keep 300 s, accept retries on create)
Diff: `git diff bf648a6..HEAD`. Every round-1 follow-up fixed in this batch:
- **Security MEDIUM:**
  - **(a) key in an error message:** the constructor refuses a key that isn't printable ASCII (a pasted newline or space), and fetch errors have the key replaced by `[secret key]`.
  - **(b) replay window off:** `toleranceSec` that is NaN, infinite or negative is refused, and the window check is written to fail closed (`!(… <= tol)`).
  - **(c) cleartext key:** `baseUrl` must be `https:`. Plain `http:` is allowed only for localhost, 127.0.0.1 and [::1]; ftp and javascript are refused.
  - **(d) README:** shops credit on the session id they stored, never on an id the browser hands them; they dedupe on `event.id` and catch only `WebhookSignatureError`; link/page events are ignored by construction; the raw body is spelled out for Fetch and Express.
- **Code MEDIUM:**
  - the currency guard now reads the quote (`priced?.currency ?? "USDT"`) and checks both directions;
  - `orderId` must be 1–40 characters with no spaces at either end (the server trims it and cuts it to 40);
  - the edge-test labels are fixed.
- **LOW:**
  - `retrieve` validates the id (`^[\w-]{1,64}$`, so `..` can't climb the path);
  - `redirect: "error"`;
  - a 5xx body is cancelled before the retry;
  - `signWebhook` refuses an empty secret;
  - the `baseUrl` path prefix is kept;
  - the `webhooks.sign` alias is removed.
- **Sent to claude-frontend (its server):** stop cutting `reference` at 40 characters (answer 400 instead), and return amounts without commas.
- **Evidence:**
  - `npm test` → `ℹ tests 22 · ℹ pass 22 · ℹ fail 0`; `npx tsc --noEmit` → exit 0.
  - The live run against the real route handlers is unchanged, except the EUR guard text: `Checkout e923a481-… came back priced in USDT, not EUR: don't send the customer to it. This gateway may not support EUR yet; price in USDT.`

## Round 1

Commits on branch `sdk` (pushed): `daaaed6` test(sdk) RED, `199fa00` feat(sdk) GREEN.

## What was built
- `packages/sdk/index.ts`:
  - `Gateway(secretKey, { baseUrl, fetch?, timeoutMs?, maxRetries? })` with `sessions.create`, `sessions.retrieve`, `payments.list` and `webhooks`;
  - `constructEvent`, `signWebhook`, `SIGNATURE_HEADER`, `GatewayError`, `WebhookSignatureError`.
  - No runtime dependencies.
- `packages/sdk/test/sdk.test.ts`: 13 node:test cases.
- `package.json`, `package-lock.json` (dev only: typescript 5.9.3, @types/node 20.19.43), `tsconfig.json` (strict, `erasableSyntaxOnly`), `README.md`.
- `.github/workflows/ci.yml`: one `sdk` job (npm ci, typecheck, test) and `sdk` in the push branches. Nothing else changed.

## Evidence
- RED: before `index.ts` existed, `node --test test/` failed (`✖ test/sdk.test.ts … 'test failed'`, the import was missing).
- GREEN: `npm test` → `ℹ tests 13 · ℹ pass 13 · ℹ fail 0`. `npx tsc --noEmit` → exit 0.
- **Test vector:** `printf '%s' '1700000000.{}' | openssl dgst -sha256 -hmac k` gives `c6ef4734…8b5146`. node:crypto gives the same, and the test pins it.
- **Integration:** the SDK ran against the REAL `apps/web` route handlers (`~/ethglobal/apps/web/app/api/v1/sessions/route.ts` and `[id]/route.ts`), served on a local port with a made-up test key. Script: `/private/tmp/claude-501/-Users-vg890-ethglobal/4b071a41-5a21-45c1-83b9-fc92c8c6526c/scratchpad/sdk-live.ts`.
  ```
  create  -> {"id":"70359474-…","url":"http://127.0.0.1:60062/checkout/70359474-…","amount":"25.00","expiresAt":"2026-11-05T21:50:29.000Z"}
  retrieve-> {"id":"70359474-…","status":"open","amount":"25.00","reference":"order-42","paymentId":null,"txHash":null}
  wrong key -> GatewayError 401: Missing or wrong API key.
  bad amount -> GatewayError 400: amount must be between 1.00 and 10,000.00 USDT.
  items mismatch -> GatewayError 400: Items add up to 1.00, but amount is 25.00.
  unknown id -> GatewayError 404: No such checkout.
  EUR on a pre-FR-GW-11 server -> GatewayError 200: This gateway doesn't price in EUR yet; checkout abd5794c-… was created in USDT. Don't send the customer to it.
  ```
  The last line shows the guard working: today's route ignores `currency`.

## Decisions
- **API shape:**
  - claude-research's REA surface (sdk_dx.md §7), not the first prompt's `createCheckout`/`getPayment`/`verifyWebhook`;
  - claude-frontend's v2 field names (`returnUrl`, not `successUrl`);
  - `orderId` is sent as `reference`.
- **`node:crypto`, not Web Crypto**, so `constructEvent` is synchronous like Stripe's. claude-contracts asked for it so the sender can import `signWebhook`. The SDK is server-only anyway.
- **Retries:** only on 5xx and network errors. A retried POST can leave an extra unpaid session, because the server has no idempotency yet; it expires in 30 min and no money moves. Marked `ponytail:`.

## Known limits
- **Today's server:**
  - `payments.list` 404s until claude-frontend ships `GET /api/v1/payments`;
  - `currency`/`returnUrl` are ignored until their sessions v2 lands, and the EUR guard covers the money risk.
- `CreatedSession.currency` is typed as required (v2), but today's server leaves it out.
