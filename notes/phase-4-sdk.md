# Phase 4: claude-sdk (packages/sdk, the pay button, apps/shop)

## Batch 005-P4-sdk-core (closed 2026-11-06 ~03:22 IST)
**Built:** `packages/sdk`, a server-side TypeScript SDK with no runtime dependencies (global `fetch` + `node:crypto`). It provides:
- `new Gateway(secretKey, { baseUrl, fetch?, timeoutMs?, maxRetries? })`;
- `sessions.create` / `sessions.retrieve` (wrapping the existing `POST/GET /api/v1/sessions`), and `payments.list` (`GET /api/v1/payments`, claude-frontend's sessions v2);
- webhooks: `constructEvent`, `signWebhook`, `SIGNATURE_HEADER = "MC-Signature"`;
- errors: `GatewayError { status }`, `WebhookSignatureError`.

**Webhook wire format** (agreed with claude-contracts, which imports `signWebhook` for the sender):
- header `MC-Signature: t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, with a 300 s window (human 03:05);
- body `{ id: "evt_…", type: "payment.succeeded" | "payment.refunded", created, data: <session object> + refunded? + link_id/page_id }`.

**Verified:**
- `npm test` 28/28, `tsc --noEmit` clean;
- GitHub Actions run 42115910708 green on `df00acc`; the new `sdk` job is in ci.yml;
- a live run against the real `apps/web` sessions route handlers: create, retrieve, 401, 400 ×2, 404, and the EUR guard firing on today's server, which ignores `currency`;
- HMAC test vector checked with openssl.

**Decisions:**
- **API shape:** claude-research's REA surface (sdk_dx.md §7), cut to the routes that exist; claude-frontend's v2 field names (`returnUrl`; `orderId` is sent as `reference`).
- **Currency guard:** a non-USDT checkout is accepted only when the reply's `priced.currency` matches. USD = USDT 1:1 still comes back as `priced` with rate 1 (claude-contracts 03:17).
- **Human at the gate (03:05):** fix the 4 security MEDIUMs before merging; keep 300 s; accept retries on create (a retry can leave an extra unpaid session, and no money moves).
- **Hardening (round 2):**
  - keys must be printable ASCII, and the key is redacted from fetch errors;
  - `toleranceSec` must be finite and ≥ 0, and the check fails closed;
  - `baseUrl` must be https (http only for localhost); redirects are refused;
  - ids and `orderId` (≤ 40 characters) are validated before any request.
- **Vouchers** never discount a shop's `sk_` session (claude-contracts 03:19, batch 007).

**Open (next batch):**
- refuse a `baseUrl` with userinfo, a query or a hash;
- scrub the key from the server's `json.error` too;
- make the README compare the stored amount (needed if carts change after a session exists) and record `event.id` in the same transaction as `markPaid`;
- reject a numeric `orderId` from plain-JS callers;
- make a config error a plain `Error` (500), not `WebhookSignatureError`;
- add a 401 hint;
- mark the README helpers as the shop's own;
- `Session.currency` optional?
- `exports: ./index.ts` is raw TypeScript; apps/shop and the apps/web sender need it transpiled (batch 3).

**Next:** batch 2 = the pay button.
- `packages/sdk/button.js`, plus a copy at `apps/web/public/v1/button.js` (claude-frontend agreed 03:13).
- `data-session` opens `<web>/checkout/<id>`; `data-link` opens `<web>/l/<slug>`. No `pk_` amount route (claude-research 02:55).
