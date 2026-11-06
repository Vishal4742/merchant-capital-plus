# Spec: 012-P4-web-developers

Request: PLAN v2.0 (human 02:31) · "start us building" (02:44) · PHASES P4 `F` · UI backlog (research_notes/gateway_rea/BACKLOG.md §claude-frontend)

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-6: the signed-in merchant creates and revokes test-mode API keys; only a hash is stored.
- FR-GW-7: the merchant registers an endpoint; `payment.succeeded` and `payment.refunded` are sent signed (HMAC-SHA256) with retries.
- FR-GW-8: `/docs`'s "Test keys" box links to the keys screen for a signed-in merchant.
- FR-GW-5: `POST /api/v1/sessions` and `GET /api/v1/payments` accept the merchant's own secret keys.
- FR-GW-14, NFR-6.

## Contract (claude-contracts' API.md, batch 007, branch `backend`)
- Keys:
  - `POST /api/v1/keys {label, kind: "pk"|"sk"}` → 201 `{id, label, kind, prefix, created_at, last_used_at, key}` (`key` only here, once)
  - `GET /api/v1/keys` → `{keys}`
  - `DELETE /api/v1/keys/{id}` → `{id, revoked: true}`
  - Server: `authenticateKey(request)` → `{merchant, kind, keyId} | null` (`lib/server/keys.ts`)
- Webhooks:
  - `POST /api/v1/webhooks {url}` → 201 `{id, url, secret, created_at}` (`secret` once; max 5)
  - `GET /api/v1/webhooks` → `{webhooks: [{id, url, created_at, deliveries: [{id, event, status, attempts, next_attempt_at, response_status, at}]}]}`
  - `DELETE /api/v1/webhooks/{id}`, `POST /api/v1/webhooks/{id}/test`, `POST /api/v1/webhooks/deliveries/{id}/replay`
- Build against these shapes with `lib/gateway-client.ts` (from batch 007) and fixtures. Going live is just their PR on main.

## Acceptance criteria
- [ ] **`/merchant/developers`** (Shell; the Nav "Developers" item becomes a link), with two sections, API keys and Webhooks.
- [ ] **API keys:**
  - Create (label ≤ 40, publishable or secret, with one plain line each on where it's used: "in the browser, for the pay button" or "on your server only").
  - The new key is shown **once** in a reveal panel with copy and "You won't see this key again". It's never put in a URL, `localStorage`, a log or the RSC payload of a later page, and the panel clears when the merchant leaves or reloads.
  - The list shows label, kind, prefix…, created and last used ("never").
  - Revoke is two-step ("Revoke" → "Revoke key · Keep it") with plain words for what stops working.
- [ ] **Webhooks:**
  - Add an https endpoint (client check plus the server's word), and show the signing secret once like a key.
  - The list shows each endpoint with its last 20 deliveries: event, a status pill (pending, delivered, failed), attempts, next retry, response code, time.
  - "Send test event", "Resend" per delivery (same event id, said in plain words: "Receivers ignore repeats by event id"), and a two-step delete.
  - At 5 endpoints, the form says so instead of failing.
- [ ] **Keys on our routes (after claude-contracts' PR is on main):**
  - `POST /api/v1/sessions` and `GET /api/v1/payments` accept `Authorization: Bearer sk_…` through `authenticateKey`, and the session belongs to that key's merchant.
  - A `pk_` key gets 403 "Use a secret key (sk_…) on your server".
  - `SHOP_API_KEY` stays as the demo shop's key until claude-sdk switches the shop, then it's removed in its own small change.
  - Tests: sk ok, pk 403, revoked 401, other merchant's session invisible.
- [ ] **`/docs`:** the Test keys box links to `/merchant/developers` when signed in, and to sign-in otherwise. It still never shows a key.
- [ ] **Errors:** a 404 from a route (backend not on main) shows "API keys aren't available on this server yet"; 401 goes to sign-in; 429 "Too many tries, wait a minute"; everything else plain.
- [ ] **Design:** gateway v2 language (mono labels, objects as cards, springs). The reveal panel uses the mono face, and its copy button follows the existing `CopyButton`.
- [ ] **Tests (RED first):**
  - client parsing for keys and webhooks (snake_case → typed)
  - the once-only reveal (not in the list response, not persisted)
  - the https check
  - delivery status → pill copy
  - the sessions/payments key auth
- [ ] typecheck, lint, `npm test` 0 fail, build; screenshots at true 375 and 1440, light and dark; the security reviewer checks the key and secret never reach logs, URLs, storage or a cached page.

## Files (claude-frontend)
- **New:** `apps/web/app/merchant/developers/page.tsx`, `apps/web/components/gateway/{ApiKeys,Webhooks,RevealOnce}.tsx`, tests.
- **Edited:** `components/dashboard/Nav.tsx`, `app/docs/page.tsx`, `app/api/v1/sessions/route.ts`, `app/api/v1/payments/route.ts`, `lib/gateway-client.ts`.

## Out of scope
- Live-mode keys (FR-GW-14: test mode only).
- Key scopes or rotation beyond revoke and create.

## Added at merge (07:55)
- [ ] **FR-GW-5:** `GET /api/v1/sessions/:id` accepts the merchant's own sk_ key through the same `shopCaller`, so the SDK's `sessions.retrieve` works for a key's own checkouts. Another merchant's checkout gets a 404.
- [ ] **FR-GW-7 / AT-14:** real payments send `payment.succeeded`. The two places a payment is recorded (the pay route, and the chain settle path in lib/settle.ts) call claude-contracts' `onSessionPaid(session)` (idempotent) through `announcePaid()`.
  - It runs in Next's `after()`, so the first webhook POST (5 s timeout) never slows the payment reply (NFR-4).
  - Outside a request (tests, scripts) it runs at once.
  - A failure is logged by error name only and never changes the payment's outcome.
- [ ] **Relayer, claude-relayer 06:46:** an HTTP 403 carrying `x-vercel-mitigated` is "busy, try again shortly" (nothing was sent), not a refusal.
- [ ] **Nav:** "API keys" (Developers) links to /merchant/developers.
