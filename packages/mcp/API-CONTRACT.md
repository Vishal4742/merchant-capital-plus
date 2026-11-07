# Whiteflow merchant API: the connector's contract (batch 052)

These are the routes the Whiteflow Merchant MCP calls.
- **LIVE** routes are served by `apps/web` on `main`, on testnet.
- **PROPOSED** routes aren't on the web backend yet. The sandbox adapter (`src/sandbox/`) implements every route here, LIVE ones in their live shapes, so it is an executable reference for the W3 lane.
- Types are in `src/contract.ts`.

## Common rules

- **Auth:** `Authorization: Bearer <key>`. Testnet uses an `sk_test_` key. The sandbox uses a `wf_sbx_` key, which has scopes and an optional expiry.
- **Tenancy:** the merchant comes from the key, never from a parameter. Another merchant's id answers **404**, exactly like an unknown id.
- **Errors:** `{ "error": "<plain reason>" }`.
  - `400` invalid input, `401` missing, unknown, revoked or expired key, `403` wrong key type or missing scope;
  - `404` no such record, `409` conflict (duplicate reference, wrong state, likely duplicate customer), `413` too large;
  - `422` idempotency key reused with a different request, or a state that can no longer be finalized;
  - `429` rate limited, `5xx` server error.
  - A route the server doesn't have answers a non-JSON 404. The client reports it as "not offered yet".
- **Writes** need `Idempotency-Key` (1 to 255 characters).
  - The slot is (merchant, route, key) and lives 24 h.
  - The request hash covers the **path and** the body: SHA-256 of `{path, body}` as JSON with sorted keys. The path matters because finalize's body is always `{}`. A body-only hash would let one key replay invoice A's finalize for invoice B (review 052 M2). On the web, link slots hash the body, and their route-scoped slot name stands in for the path.
  - The same key and hash replay the stored 2xx reply, with the header `Idempotent-Replayed: true`.
  - The same key with a different hash is 422.
  - A refused request (4xx) stores nothing, so a corrected retry can reuse the key.
  - The slot is written in the same transaction as the record.
  - On the web, the slot lives in `app_web_idempotency`. Link slots are `links:<merchant>:<key>`, kept apart from the checkout slots (`<merchant>:<key>`).
- **Money:** decimal strings. Fiat has at most 2 decimals and USDT 6. Amounts are stored as integer minor units; no floats.
- **Dates:**
  - `due_date` is a calendar date (`YYYY-MM-DD`) in the business time zone.
  - Times are ISO 8601 UTC.
  - "Overdue" means `open` and the due date is before today in the business zone.

## Routes

| Method and path | Status | Scope | Notes |
|---|---|---|---|
| `GET /api/v1/operations/{idempotency_key}` | LIVE (PR #48) | account:read | `{idempotency_key, route, state: "succeeded" \| "pending", http_status, result_id, created_at}` for the caller's own write; foreign, unknown or older than 24 h → 404. The connector uses it to settle an unknown outcome |
| `GET /api/v1/account` | LIVE | account:read | Merchant, environment, network, settlement asset, price currencies, payment limits, payment methods, `timezone` (null on testnet until Stage 3), credential (`scopes`/`expires_at` null on testnet), `capabilities` |
| `GET /api/v1/customers?query&limit≤20` | PROPOSED | customers:read | `{data: Customer[], next}`. Customer = `{id, name, email_masked, created_at}` |
| `POST /api/v1/customers` | PROPOSED | customers:write | `{name, email?, confirm_new?}` → 201 Customer. A likely duplicate (same normalized name or same email) without `confirm_new` → **409** `{error, possible_duplicates: Customer[]}` |
| `POST /api/v1/links` | LIVE | links:write | `{amount?, currency, description, reference_id?, expires_at?, single_use?, customer_id? (sandbox)}` → 201 Link. Live: `currency` ∈ USDT, USD, EUR, GBP, INR, AED, SGD; 1 to 1,000 USDT at today's rate; `reference_id` unique per merchant (409) |
| `GET /api/v1/links/{id}` | LIVE | links:read | Link plus `paid_checkouts: [{session_id, payment_id, amount (USDT), currency, tx_hash, paid_at}]`, from the server's payment records |
| `POST /api/v1/invoices` | PROPOSED | invoices:write | A draft. `{customer_id, currency: "USDT", line_items[1..50]: {description, quantity 1..10000, unit_price}, due_date (today..+2y), discount?: {type:"amount", amount} \| {type:"percent", percent}, tax?: {name, rate_percent}, memo?}` → 201 Invoice. Total 1 to 1,000 USDT |
| `POST /api/v1/invoices/{id}` | PROPOSED | invoices:write | Edit a draft: `{revision, customer_id, line_items, due_date, discount, tax, memo}`. `revision` must equal the current one (409 otherwise). It creates revision n+1 and supersedes any pending approval. Not a draft → 409 |
| `POST /api/v1/invoices/{id}/finalize` | PROPOSED | invoices:write | **Owner-approval policy:** `{revision}` → **202** `{status: "approval_required", approval, invoice}`. It publishes nothing; asking again for the same revision returns the same pending approval. Not a draft → 409; stale revision → 409; due date passed → 422. Sends nothing |
| `GET /api/v1/approvals/{id}` | PROPOSED | invoices:read | `{id, invoice_id, revision, status: pending\|approved\|rejected\|superseded\|expired, total, currency, customer_id, requested_at, expires_at, decided_at, review_url}` |
| `GET /api/v1/invoices/{id\|number}` | PROPOSED | invoices:read | Invoice |
| `GET /api/v1/invoices?customer_id&status&due_from&due_to&limit≤50&cursor` | PROPOSED | invoices:read | `status` ∈ draft, open, paid, overdue. Newest first |
| `GET /api/v1/invoices/{id}/reminder-draft` | PROPOSED | invoices:read | Open invoices only (409 otherwise). `{invoice_id, number, recipient: {customer_id, name, email}, subject, body, payment_url, sent: false}`. Never sends |
| `GET /api/v1/receivables` | PROPOSED | invoices:read | `{as_of, timezone, by_currency: {C: {outstanding, overdue, open_count, overdue_count}}}` |
| `GET /api/v1/payments?limit≤100&cursor` | LIVE | payments:read | Verified payments only. `{data: [{paymentId, sessionId, invoiceId, amount, refunded, txHash, paidAt, reference}], next}`. The sandbox adds `linkId`, `invoiceNumber` |
| `GET /api/v1/reports?from&to&tz` | LIVE | reports:read | `{from, to, tz, days[], totals: {gross, fees, net, refunds, count}, kpis}` (USDT) |

**Invoice fields:**
- identity and status: `id`, `number`, `status` (draft, open or paid), `overdue`, `customer {id, name}`, `currency`;
- amounts: `line_items[] {description, quantity, unit_price, amount}`, `subtotal`, `discount {type, percent, amount} | null`, `tax {name, rate_percent, amount} | null`, `total`, `amount_paid`, `amount_due`, `overpaid`;
- dates and links: `due_date`, `timezone`, `memo`, `hosted_url`, `pdf_url` (null: unsupported), `created_at`, `finalized_at`, `paid_at`;
- `payments[] {id, amount, currency, status: "succeeded", paid_at, evidence}`.

**Arithmetic:**
- `amount = quantity × unit_price`, and `subtotal = Σ amount`.
- A percent discount is `round_half_up(subtotal × bps / 10000)`; a fixed discount must be less than the subtotal.
- `tax = round_half_up((subtotal − discount) × bps / 10000)`, and `total = subtotal − discount + tax`.
- Rounding is to the currency's minor unit. A percentage has at most 2 decimals. A tax is only ever the one stated.

**Approvals (production review F4; human decision 2026-11-07: an Owner approves on the review page):**
- An approval binds the merchant, the invoice, its `revision`, a SHA-256 of its content, the total, currency and customer, and an expiry (48 h in the sandbox).
- An authenticated Owner decides it once, on the review page. The sandbox stand-in is `whiteflow-sandbox approve|reject <id>`.
- Approving re-checks that the invoice is still that revision, with that hash and that total. If anything changed, the approval becomes `superseded` and nothing is published.
- An edit supersedes pending approvals.
- No API-key route can approve, and a request field is never approval.

**State transitions:**
- `draft → open` happens only when an Owner approves a pending publication request for the current revision.
- `open → paid` happens when verified payments reach `total`.
- An underpayment keeps the invoice `open` with `amount_due > 0`. An overpayment sets `paid` with `overpaid > 0`.
- `void` and `refunded` are phase two, and they need a server-enforced approval.

## Provider events (sandbox; the shape for a future provider integration)

Headers and envelope:
- Header: `MC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. This is the gateway's own webhook scheme (`packages/sdk` `signWebhook` and `constructEvent`).
- Body: `{id: "evt_…", type: "payment.pending" | "payment.succeeded" | "payment.failed", created, data: {payment_id, merchant_id, target: {kind: "invoice" | "link", id}, amount (USDT minor units), currency: "USDT", sequence, provider_ref}}`.

Processing:
1. Verify the signature and that the timestamp is within 5 minutes. A failure rejects the event and changes nothing.
2. Apply each event `id` once; a repeat is a `duplicate`.
3. Drop an event whose `sequence` isn't newer than the payment's, and any event after a final status. A late `pending` can never undo `succeeded`.
4. An event that disagrees with the recorded payment (merchant, target, amount) is rejected.
5. `succeeded` credits the invoice once.
6. `reconcile` recomputes every invoice's `amount_paid` from succeeded payments and reports any drift.
