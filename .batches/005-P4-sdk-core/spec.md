# Spec: 005-P4-sdk-core

## Requirements (cite docs/SRS.md IDs)
- **FR-GW-5** SDK in `packages/sdk`: create checkout sessions, read one, list payments, verify webhook signatures.
- **FR-PAY-4** the SDK wraps `POST /api/v1/sessions` (secret key, returns the hosted pay URL) and `GET /api/v1/sessions/:id`.
- **FR-GW-7** the receiving side of signed webhooks: HMAC-SHA256, constant-time compare, replay window. The sender (claude-contracts, `apps/web/app/api/v1/webhooks/`) imports `signWebhook` from here.
- **FR-GW-11** (guard only) a non-USDT price is refused unless the gateway echoes the currency.
- Prepares **AT-14** (the shop's ≤ 20 lines use this SDK in batch 3).

## API (agreed 02:46 on agentbus)
- **Shape:** claude-research REA, `research_notes/gateway_rea/sdk_dx.md` §7 and BACKLOG "claude-sdk", cut to the endpoints that exist or are committed.
- **Field names:** claude-frontend's sessions v2.
- **Wire format:** accepted by claude-contracts.
```ts
const gateway = new Gateway(secretKey, { baseUrl, fetch?, timeoutMs? = 10000, maxRetries? = 2 });
gateway.sessions.create({ amount, currency?, orderId?, items?, returnUrl? }, { idempotencyKey? }) // → { id, url, amount, currency, priced?, expiresAt }
gateway.sessions.retrieve(id)                    // → { id, status: open|pending|paid|expired, amount, currency, reference, paymentId, txHash, refunded? }
gateway.payments.list({ limit?, cursor? })      // → { data: Payment[], next }  (GET /api/v1/payments, claude-frontend builds it)
constructEvent(rawBody, header, secret, { toleranceSec? = 300 }) // also gateway.webhooks.constructEvent; throws WebhookSignatureError
signWebhook(rawBody, secret, t?) · SIGNATURE_HEADER = "MC-Signature" · GatewayError { status }
```
- `orderId` is sent as the API's `reference`.

## Webhook wire format
- **Header:** `MC-Signature: t=<unix seconds>,v1=<64 hex>`, where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Each retry is re-signed with a fresh `t`.
- **Body:** `{ id: "evt_…", type: "payment.succeeded" | "payment.refunded", created, data: <the GET /api/v1/sessions/:id object> }`.
  - `data.refunded` is set on refunds.
  - `data.link_id` and `data.page_id` are set for link/page payments, null otherwise.

## Acceptance criteria (each must be checkable)
- [ ] `sessions.create` sends `POST {baseUrl}/api/v1/sessions` with:
  - `Authorization: Bearer <secretKey>`, the `content-type` header, and `idempotency-key` when given;
  - body `{ amount: String(amount), reference: orderId, currency?, items?, returnUrl? }`, leaving out fields that weren't given.
- [ ] `sessions.retrieve(id)` URL-encodes the id. `payments.list` builds `?limit=&cursor=` only from the given params.
- [ ] A 4xx throws `GatewayError` with `status` and the server's `error` text, with no retry. A 5xx or a network error is retried up to `maxRetries` times with the same idempotency key, then throws (`status` 0 when unreachable). A non-JSON answer throws, even with status 200.
- [ ] `currency` ≠ USDT plus a reply without that currency → `GatewayError`, so 25 EUR is never charged as 25 USDT on a server without FR-GW-11.
- [ ] The constructor throws on:
  - a missing key, or a `pk_` key;
  - a missing or unparsable `baseUrl`;
  - any browser context (`window` exists). The secret key never runs in browser code.
- [ ] `constructEvent`:
  - returns the event for a valid header, with a string or byte body;
  - throws `WebhookSignatureError` for a wrong secret, a changed body, a missing or malformed header, an empty secret, or `t` more than `toleranceSec` off;
  - compares with `timingSafeEqual`.
- [ ] `signWebhook("{}", "k", 1700000000)` equals the openssl vector `v1=c6ef4734…8b5146`.
- [ ] No runtime `dependencies` (`node:crypto` + global `fetch` only). `npm test` and `npm run typecheck` pass, and the GitHub Actions `sdk` job is green on the pushed commit.
- [ ] Integration (evidence, not CI): the SDK against the real `apps/web` sessions route handlers on a local port: create, retrieve, 401, 400 ×2, 404, and the EUR guard.

## Files to touch (owner lane: claude-sdk)
- `packages/sdk/{index.ts, test/sdk.test.ts, package.json, package-lock.json, tsconfig.json, README.md}`
- `.github/workflows/ci.yml`: one `sdk` job plus the `sdk` push branch (claude-research approved 02:45:33; flagged to the human, PIPELINE §11).

## Ponytail ladder (why this is the smallest change that works)
- **Needed:** FR-GW-5 is a must-have, and AT-14's shop is built on it.
- **Already in the repo:** the session API and its Bearer auth (`shopAuthorized`). The SDK wraps them and copies no server code.
- **Platform:** `fetch`, `AbortSignal.timeout` and `node:crypto` (`createHmac`, `timingSafeEqual`). No runtime dependency.
- **Installed dependency:** devDependencies `typescript` 5.9.3 and `@types/node` 20.19.43, the versions apps/web pins, for the type check only. Tests run on Node 26 type stripping with `node:test`.
- **Minimum:** one `index.ts` (~170 lines) and one test file.
- **Skipped from the REA list:** `sessions.expire`/`list`, `payments.retrieve` (no route), `fromEnv`, the route helper, and typed `code`/`requestId` (the server sends only `error`). Add them when a route or a caller needs them.

## Out of scope
- The payment button (batch 2, FR-GW-4), `apps/shop` (batch 3, FR-PAY-11, AT-14), the webhook sender (claude-contracts), the sessions v2 server fields (claude-frontend).
