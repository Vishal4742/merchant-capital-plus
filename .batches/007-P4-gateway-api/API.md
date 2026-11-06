# Gateway backend API (batch 007): the shapes to build against

Owner: claude-contracts. Source of truth = the code under `apps/web/app/api/v1/` + `apps/web/lib/server/` on branch `backend` (merges to main with batch 007). JSON is snake_case; amounts are plain decimal strings (≤ 6 dp, unpadded: "25", "24.9"); times are ISO strings; errors are `{error: "<plain sentence>"}` with 400 / 401 / 404 / 409 / 410 / 413 / 429 / 502 / 503.

**Auth:** dashboard routes need the SIWE session cookie (`mc_session`) → 401 without; ids of another merchant → 404. Public routes (`/api/v1/public/*`, `POST /api/v1/quotes`) need nothing and are rate-limited per IP.

## Keys (FR-GW-6)
- `POST /api/v1/keys {label, kind: "pk"|"sk" (default sk)}` → 201 `{id, label, kind, prefix, created_at, last_used_at, key}` (`key` only here, once)
- `GET /api/v1/keys` → `{keys: [{id, label, kind, prefix, created_at, last_used_at}]}`
- `DELETE /api/v1/keys/{id}` → `{id, revoked: true}`
- Server use (claude-frontend's sessions route): `authenticateKey(request)` → `{merchant, kind, keyId} | null` from `lib/server/keys.ts`.

## Quotes (FR-GW-11)
- `POST /api/v1/quotes {amount: "20.00", currency}` → 201 `{quote_id, currency, amount, usdt_amount, rate, source, fetched_at, expires_at}` (locked 10 min; USD/USDT rate "1")
- Server use: `getQuote(id)` → quote or null when expired (`lib/server/quotes.ts`).

## Links (FR-GW-1)
- `POST /api/v1/links {amount: "25.00" | null, currency, description, reference_id?, expires_at?, single_use?}` → 201 link
- `GET /api/v1/links` → `{links: [link]}` newest first (max 200)
- `POST /api/v1/links/{id}/cancel` → `{id, status: "cancelled"}`
- link = `{id, slug, url: "/l/<slug>", amount, currency, description, reference_id, single_use, status: "active"|"paid"|"expired"|"cancelled", expires_at, created_at, payments}`
- Public `GET /api/v1/public/links/{slug}` → `{slug, merchant_name, amount, currency, description, status}`
- Public `POST /api/v1/public/links/{slug}/checkout` (`{amount}` only for open links; JSON or form) → **303** `Location: /checkout/<session>`, or with `accept: application/json` → `{checkout_url, session_id}`; 410 when not active.

## Pages (FR-GW-2)
- `POST /api/v1/pages {title, description?, logo_url? (https), color? (#RRGGBB), currency, items: [{name, price}] (1..20) | open_amount: {min?, max?}}` → 201 page
- `GET /api/v1/pages` → `{pages: [page]}`
- page = `{id, slug, url: "/p/<slug>", title, description, logo_url, color, currency, items: [{name, price}] | null, open_amount: {min, max} | null, created_at, payments}`
- Public `GET /api/v1/public/pages/{slug}` → the page's render fields + `merchant_name`
- Public `POST /api/v1/public/pages/{slug}/checkout {items: [{name, qty}]} | {amount}` → 303 / `{checkout_url, session_id}` like links.

## Checkout FX line (AT-13)
- `checkoutOf(sessionId)` (`lib/server/checkouts.ts`) → `{kind, refId, usdtAmount, fx: {currency, amount (bigint units), rate, source, fetchedAt}, paidAt}` | null (a shop's own session).

## Vouchers (FR-GW-12)
- `POST /api/v1/vouchers {code (3..32, A-Z 0-9 _ -), kind: "percent"|"fixed", value ("10" | "5.00"), expires_at, max_redemptions, min_amount?}` → 201 voucher
- `GET /api/v1/vouchers` → `{vouchers: [voucher]}` · `POST /api/v1/vouchers/{id}/deactivate`
- voucher = `{id, code, kind, value, expires_at, max_redemptions, times_redeemed, min_amount, active, arkiv_entity_key}`
- Server use (claude-frontend's `POST /api/v1/sessions/:id/voucher`): `applyVoucher(merchant, code, sessionId, originalUsdtAmount)` → `{ok: true, discount, usdtAmount}` | `{ok: false, reason}`. Only sessions from links/pages; pass the **original** amount (`checkoutOf(id).usdtAmount`), never an already-discounted one. Counting happens in `onSessionPaid`.

## Webhooks (FR-GW-7)
- `POST /api/v1/webhooks {url (https, public host)}` → 201 `{id, url, secret: "whsec_…", created_at}` (`secret` once) · max 5
- `GET /api/v1/webhooks` → `{webhooks: [{id, url, created_at, deliveries: [{id, event, status: "pending"|"succeeded"|"failed", attempts, next_attempt_at, response_status, at}] (last 20)}]}`
- `DELETE /api/v1/webhooks/{id}` · `POST /api/v1/webhooks/{id}/test` · `POST /api/v1/webhooks/deliveries/{id}/replay`
- `GET|POST /api/v1/webhooks/dispatch` with `authorization: Bearer <CRON_SECRET>` (Vercel Cron, every minute) runs due retries (1 m / 5 m / 30 m).
- Wire format: `MC-Signature: t=<s>,v1=<hex HMAC-SHA256(secret, "t.body")>`; body `{id: "evt_…", type: "payment.succeeded"|"payment.refunded", created, data: {id, status, amount, currency: "USDT", reference, paymentId, txHash, link_id, page_id[, refunded (running total), refund_amount (this refund)]}}` = claude-sdk's `GatewayEvent.data` (its `Session` + link_id/page_id). Receivers dedupe on the event `id` (replays resend the same id).

## Reports + settlements (FR-GW-9, FR-GW-10; from on-chain Paid/Refunded logs)
- `GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC, inclusive, default last 7 days, max 92) → `{from, to, days: [{date, gross, fees, net, refunds, count}], totals: {gross, fees, net, refunds, count}, kpis: {new_payers, returning_payers}}` (net = gross − fee)
- `GET /api/v1/reports.csv?from=&to=` → CSV `payment_id,created_utc,currency,gross,fee,to_investors,net,refunded,payer,tx_hash`
- `GET /api/v1/settlements?from=&to=` → `{balance, settlements: [{payment_id, gross, fee, to_investors, net, tx_hash, settled_at, explorer_url}]}` newest first (net = to_merchant, T+0)

## Payment hook (claude-frontend calls these)
- `onSessionPaid(session)` and `onRefund(session, amount, totalRefunded)` from `lib/server/events.ts`: idempotent; mark the link/page checkout paid, count the voucher, send the webhook.
