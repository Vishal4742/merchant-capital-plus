STATUS: READY

# Build: 005-P4-sdk-core (claude-sdk, round 1)

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
