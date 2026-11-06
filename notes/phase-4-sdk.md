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

## Batch 007-P4-sdk-button (closed 2026-11-06 ~04:13 IST)
**Built:**
- **`packages/sdk/button.js`** (2,248 bytes, no dependencies, no requests), with a byte-identical copy at `apps/web/public/v1/button.js`, served at `<web>/v1/button.js`.
  - `<script … data-session=ID | data-link=SLUG [data-label]>` renders a button after itself.
  - One delegated click listener handles every `data-mc-session` / `data-mc-link` element (React too) and goes to `<script origin>/checkout/<id>` or `/l/<slug>`.
  - Bad ids render nothing and log one error.
- **SDK additions:** `sameAmount(a, b)` (compares base units), key scrubbing on every error path, a `baseUrl` with no credentials, query or hash (rebuilt from origin + path), config errors as plain `Error`s, a 401 hint.

**Found and fixed (round 1 HIGH, both reviewers):** DOM clobbering.
- **The attack:** `<img name="currentScript">` replaced `document.currentScript` and sent the shop's pay buttons to the attacker's origin. It's the same class as webpack CVE-2024-43788.
- **The fix:**
  - `currentScript` is read from `Document.prototype`'s getter and must be an `HTMLScriptElement`;
  - the guard flag is `!== true`;
  - `defaultPrevented` is respected.
- **Proof:** in real Chrome, against 12 clobbering shapes, every click lands on the gateway. The old file went to the attacker.

**Also fixed:** amounts arrived as "1,000.00" from the sessions API and "1000.00" from webhooks.
- `sameAmount` compares the money; the README uses it.
- claude-frontend agreed one `plainUsdt` format for all routes (03:44).

**Verified:**
- `npm test` 47/47, tsc clean; CI run 42123543707 green;
- a real EUR/USD run against the v2 sessions route: EUR 25.00 → 28.13 USDT at 0.88879 (frankfurter.dev), USD rate 1;
- real-Chrome screenshots in `.batches/007-P4-sdk-button/round-{1,2}/shots/`.

**Human gate (04:12):**
- approve and merge;
- the `sameAmount` comma laxity ("10,00" = "1000") goes to the next batch;
- the user-content `data-mc-*` risk is accepted (README rule plus the merchant name on the checkout).

**Open (next batch):**
- make `sameAmount` allow commas only as thousands separators;
- make the README's "Canceling" line precise (element handlers always run first; a document handler must be added before `button.js`), and mention `stopPropagation`;
- the README poll path should say `sameAmount`;
- name the exact DOMPurify config (`FORBID_ATTR: ["data-mc-session","data-mc-link"]` or `ALLOW_DATA_ATTR: false`);
- a 2 px white focus ring;
- a Safari spot-check of the getter;
- re-check `/l/<slug>` and `GET /api/v1/payments` on main before AT-14;
- add `sameAmount` to ARCHITECTURE §2 (claude-research).

**Next:** batch 3, `apps/shop` on the SDK and the button in ≤ 20 lines (FR-PAY-11, AT-14), with the webhook verified.
