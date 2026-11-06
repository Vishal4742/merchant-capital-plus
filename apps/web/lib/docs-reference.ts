// The reference data /docs renders (FR-GW-8), kept as typed data so test/docs-reference.test.mjs can hold it to the
// code: every path is a route file under app/api/v1 that exports the method, the currencies are lib/server/http.ts's,
// and the limits, rate limits and error messages are the ones the code enforces. Edit the code first, then this file.
// Text fields may mark code with `backticks`; the page renders those as <code>.
// The full endpoint pages (`detail`), the webhook events, the checkout statuses and the test scenarios are held to the
// code too: test/docs-reference.test.mjs reads the route files, test/docs-endpoints.test.mjs calls the real handlers.

export type Method = "GET" | "POST" | "DELETE";
export type Auth = "secret" | "dashboard" | "dashboard-or-secret" | "public";

/** One parameter of a full endpoint page. `in` says where it goes: the JSON body, a header, the path or the query. */
export interface Param {
  name: string;
  in: "body" | "header" | "path" | "query";
  type: string;
  required: boolean;
  about: string;
}

/** A full endpoint page: parameters, and an example request and response. The docs test sends `body`, `headers` and
 *  `query` to the real route and checks its reply has exactly the keys of `response`. */
export interface Detail {
  params: Param[];
  body?: Record<string, unknown>;
  headers?: Record<string, string>; // beyond Authorization
  query?: string;
  status: number;
  response: unknown;
}

export interface Endpoint {
  method: Method;
  path: string; // "/api/v1/sessions/{id}": {param} is a [param] folder
  auth: Auth;
  body: string;
  reply: string;
  detail?: Detail;
}

/** Who calls it: your server with its secret key, the dashboard with your sign-in, or our hosted pages for payers. */
export type Group = "server" | "dashboard" | "hosted";

export interface Resource {
  id: string;
  group: Group;
  title: string;
  about: string;
  endpoints: Endpoint[];
}

export const GROUPS: Record<Group, { title: string; about: string }> = {
  server: { title: "Your server (secret key)", about: "The calls a shop's server makes to take a payment. Start here." },
  dashboard: { title: "Dashboard", about: "What the dashboard screens call with your sign-in. Webhook endpoints take your secret key too." },
  hosted: { title: "Hosted pages", about: "Public calls our checkout, link and page make for your payers. You don't need them to take a payment." },
};

// The example checkout: 20.00 EUR at 0.88875 per USD is 22.51 USDT (the FX example under Currencies).
const EXAMPLE_ID = "9b2f6c1e-4d7a-4f3b-8e21-5a0c3d9e7b14";
const EXAMPLE_PRICED = { currency: "EUR", amount: "20.00", rate: "0.88875", rateAt: "2026-11-06", source: "Frankfurter (ECB and central-bank reference rates)" };
const EXAMPLE_TX = "0x7d1e4b2a9c0f3e8d6b5a4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5dc03a";

export const AUTH: Record<Auth, { label: string; how: string }> = {
  secret: { label: "Secret key", how: "`Authorization: Bearer sk_test_…`, from your server only. A publishable key (`pk_`) gets 403." },
  dashboard: { label: "Dashboard sign-in", how: "The session cookie from signing in with your wallet at /merchant. The dashboard screens call these." },
  "dashboard-or-secret": { label: "Sign-in or secret key", how: "Either one, so a setup script on your server can add its own endpoint." },
  public: { label: "Public", how: "No key. Your customers' browsers and our hosted pages call these." },
};

export const RESOURCES: Resource[] = [
  {
    id: "checkouts",
    group: "server",
    title: "Checkouts",
    about: "Your server creates a checkout and sends the customer to its `url`. The SDK's `sessions.create` and `sessions.retrieve`.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/sessions",
        auth: "secret",
        body: '`amount` ("25.00"), `currency`?, `reference`? (up to 40 characters), `items`? [{`name`, `qty`, `price`}], `returnUrl`?. Header `Idempotency-Key`?',
        reply: "201 `{id, url, amount, currency, priced?, expiresAt}`. `amount` is the USDT the customer pays; `priced` is the locked quote, there unless you price in USDT.",
        detail: {
          params: [
            { name: "amount", in: "body", type: "string", required: true, about: 'Your price as a decimal string, like "25.00" (up to 6 decimals), in `currency`. 1.00 to 1,000.00 USDT once converted.' },
            { name: "currency", in: "body", type: "string", required: false, about: "USDT (the default), USD, EUR, GBP, INR, AED or SGD. Any but USDT is converted at a quote locked for the checkout." },
            { name: "reference", in: "body", type: "string", required: false, about: "Your order id, up to 40 characters, trimmed. It comes back on the checkout, the payment and the webhook. The SDK's `orderId`." },
            { name: "items", in: "body", type: "array", required: false, about: 'Up to 20 `{name, qty, price}`: qty 1 to 999, price a string in `currency`. They must add up to `amount`.' },
            { name: "returnUrl", in: "body", type: "string", required: false, about: "Where the checkout's back link goes: http or https, up to 200 characters. A hint for the browser, never proof of payment." },
            { name: "Idempotency-Key", in: "header", type: "string", required: false, about: "1 to 255 characters. The same key and body within 24 hours gets the first checkout back; another body gets 422." },
          ],
          body: { amount: "20.00", currency: "EUR", reference: "order-42", returnUrl: "https://shop.example/" },
          headers: { "Idempotency-Key": "order-42" },
          status: 201,
          response: { id: EXAMPLE_ID, url: `https://your-gateway.example/checkout/${EXAMPLE_ID}`, amount: "22.51", currency: "EUR", priced: EXAMPLE_PRICED, expiresAt: "2026-11-06T10:40:00.000Z" },
        },
      },
      {
        method: "GET",
        path: "/api/v1/sessions/{id}",
        auth: "secret",
        body: "None",
        reply: "`{id, status, amount, currency, priced?, reference, paymentId, txHash, refunded?}`. `status` is open, pending, paid or expired; `refunded` is left out when we can't read it right now.",
        detail: {
          params: [{ name: "id", in: "path", type: "string", required: true, about: "The checkout's `id` from create. A checkout another key made is a 404." }],
          status: 200,
          response: { id: EXAMPLE_ID, status: "paid", amount: "22.51", currency: "EUR", priced: EXAMPLE_PRICED, reference: "order-42", paymentId: "42", txHash: EXAMPLE_TX, refunded: "0.00" },
        },
      },
    ],
  },
  {
    id: "payments",
    group: "server",
    title: "Payments",
    about: "Every payment to your wallet, newest first, with what was refunded. The SDK's `payments.list`.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/payments",
        auth: "secret",
        body: "Query `limit` (1 to 100, default 20), `cursor`",
        reply: "`{data: [{paymentId, sessionId, invoiceId, amount, refunded, txHash, paidAt, reference}], next}`, newest first. Pass `next` as `cursor`; it is null on the last page.",
        detail: {
          params: [
            { name: "limit", in: "query", type: "integer", required: false, about: "How many payments, 1 to 100. Default 20." },
            { name: "cursor", in: "query", type: "string", required: false, about: "The `next` of the page before. Leave it out for the newest." },
          ],
          query: "?limit=20",
          status: 200,
          response: {
            data: [{ paymentId: "42", sessionId: EXAMPLE_ID, invoiceId: null, amount: "22.51", refunded: "0.00", txHash: EXAMPLE_TX, paidAt: "2026-11-06T10:32:05.000Z", reference: "order-42" }],
            next: null,
          },
        },
      },
    ],
  },
  {
    id: "webhooks",
    group: "dashboard",
    title: "Webhooks",
    about: "Where we send payment.succeeded. See Webhooks above for the event and its signature.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/webhooks",
        auth: "dashboard-or-secret",
        body: "`url` (https, a public host; up to 5 endpoints)",
        reply: "201 `{id, url, secret, created_at}`. The `secret` is shown here only.",
      },
      {
        method: "GET",
        path: "/api/v1/webhooks",
        auth: "dashboard-or-secret",
        body: "None",
        reply: "`{webhooks: [{id, url, created_at, deliveries}]}`, each with its last 20 deliveries. Never the secret.",
      },
      { method: "DELETE", path: "/api/v1/webhooks/{id}", auth: "dashboard", body: "None", reply: "`{id, deleted: true}`" },
      {
        method: "POST",
        path: "/api/v1/webhooks/{id}/test",
        auth: "dashboard",
        body: "None",
        reply: "The delivery `{id, event, status, attempts, next_attempt_at, response_status, at}`",
      },
      { method: "POST", path: "/api/v1/webhooks/deliveries/{id}/replay", auth: "dashboard", body: "None", reply: "The delivery, sent again now with the same event id" },
    ],
  },
  {
    id: "links",
    group: "dashboard",
    title: "Payment links",
    about: "A link you can send in any chat. The payer opens a checkout from it.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/links",
        auth: "dashboard",
        body: "`currency`, `description`, `amount`? (leave it out and the payer enters it), `reference_id`?, `expires_at`?, `single_use`?",
        reply: "201 `{id, slug, url, amount, currency, description, reference_id, single_use, status, expires_at, created_at, payments}`",
      },
      { method: "GET", path: "/api/v1/links", auth: "dashboard", body: "None", reply: "`{links: [link]}`, the newest 200" },
      { method: "POST", path: "/api/v1/links/{id}/cancel", auth: "dashboard", body: "None", reply: '`{id, status: "cancelled"}`' },
    ],
  },
  {
    id: "pages",
    group: "dashboard",
    title: "Payment pages",
    about: "A page with your items, or an open amount. Prices always come from the stored page.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/pages",
        auth: "dashboard",
        body: "`title`, `currency`, `items` [{`name`, `price`}] (1 to 20) or `open_amount` {`min`?, `max`?}, `description`?, `logo_url`? (https), `color`? (#RRGGBB)",
        reply: "201 `{id, slug, url, title, description, logo_url, color, currency, items, open_amount, created_at, payments}`",
      },
      { method: "GET", path: "/api/v1/pages", auth: "dashboard", body: "None", reply: "`{pages: [page]}`, the newest 200" },
    ],
  },
  {
    id: "vouchers",
    group: "dashboard",
    title: "Vouchers",
    about: "Discount codes for link and page checkouts.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/vouchers",
        auth: "dashboard",
        body: '`code` (3 to 32 letters, digits, - or _), `kind` (percent or fixed), `value` ("10" or "5.00"), `expires_at`, `max_redemptions`, `min_amount`?',
        reply: "201 `{id, code, kind, value, expires_at, max_redemptions, times_redeemed, min_amount, active, arkiv_entity_key, created_at}`",
      },
      { method: "GET", path: "/api/v1/vouchers", auth: "dashboard", body: "None", reply: "`{vouchers: [voucher]}`, newest first" },
      { method: "POST", path: "/api/v1/vouchers/{id}/deactivate", auth: "dashboard", body: "None", reply: "`{id, active: false}`. The code stops working at once." },
    ],
  },
  {
    id: "keys",
    group: "dashboard",
    title: "API keys",
    about: "Test keys only. We store a hash, so a key is shown once.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/keys",
        auth: "dashboard",
        body: '`label` (up to 60 characters), `kind` ("sk", the default, or "pk")',
        reply: "201 `{id, label, kind, prefix, created_at, last_used_at, key}`. The `key` is shown here only.",
      },
      { method: "GET", path: "/api/v1/keys", auth: "dashboard", body: "None", reply: "`{keys: [{id, label, kind, prefix, created_at, last_used_at}]}`, live keys only" },
      { method: "DELETE", path: "/api/v1/keys/{id}", auth: "dashboard", body: "None", reply: "`{id, revoked: true}`. Calls with it stop working at once." },
    ],
  },
  {
    id: "reports",
    group: "dashboard",
    title: "Reports and settlements",
    about: "Read from your payments on chain. Dates are YYYY-MM-DD and inclusive.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/reports",
        auth: "dashboard",
        body: "Query `from`, `to` (default the last 7 days, at most 92), `tz`? (default UTC)",
        reply: "`{from, to, tz, days: [{date, gross, fees, net, refunds, count}], totals, kpis: {new_payers, returning_payers}}`",
      },
      {
        method: "GET",
        path: "/api/v1/reports.csv",
        auth: "dashboard",
        body: "Query as for reports",
        reply: "A CSV file: payment_id, created_utc, currency, gross, fee, to_investors, net, refunded, payer, tx_hash",
      },
      {
        method: "GET",
        path: "/api/v1/settlements",
        auth: "dashboard",
        body: "Query as for reports",
        reply: "`{balance, settlements: [{payment_id, gross, fee, to_investors, net, tx_hash, settled_at, explorer_url}]}`, newest first",
      },
      {
        method: "POST",
        path: "/api/v1/payments/{id}/refunds/sync",
        auth: "dashboard",
        body: "`{tx_hash}` of your refund transaction; `{id}` is MerchantPay's payment number",
        reply: "`{payment_id, refunds: [{amount, total_refunded}], tx_hash}`, and payment.refunded is sent once per refunded total. 400 if the transaction holds no refund of this payment, 502 if its receipt isn't readable yet (try again)",
      },
    ],
  },
  {
    id: "payer",
    group: "hosted",
    title: "Link and page checkouts",
    about: "Our hosted link and page call these when a payer opens them. The price comes from what you stored.",
    endpoints: [
      { method: "GET", path: "/api/v1/public/links/{slug}", auth: "public", body: "None", reply: "`{slug, merchant_name, amount, currency, description, status, paid_at}`" },
      {
        method: "POST",
        path: "/api/v1/public/links/{slug}/checkout",
        auth: "public",
        body: "`amount`, for a link without one. JSON or a form.",
        reply: "303 to the checkout, or `{checkout_url, session_id}` with `Accept: application/json`. 410 once the link is paid, expired or cancelled.",
      },
      { method: "GET", path: "/api/v1/public/pages/{slug}", auth: "public", body: "None", reply: "The page's `title`, `description`, `logo_url`, `color`, `currency`, `items`, `open_amount` and `merchant_name`" },
      {
        method: "POST",
        path: "/api/v1/public/pages/{slug}/checkout",
        auth: "public",
        body: "`items` [{`name`, `qty`}] (qty 1 to 100), or `amount` for an open-amount page",
        reply: "303 to the checkout, or `{checkout_url, session_id}`, as for links",
      },
    ],
  },
  {
    id: "hosted",
    group: "hosted",
    title: "Quotes and the hosted checkout",
    about: "Our checkout page calls these. You don't need them to take a payment.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/quotes",
        auth: "public",
        body: "`amount`, `currency`",
        reply: "201 `{quote_id, currency, amount, usdt_amount, rate, rate_at, source, fetched_at, expires_at}`, locked for 10 minutes",
      },
      {
        method: "POST",
        path: "/api/v1/sessions/{id}/pay",
        auth: "public",
        body: "The customer's signed approval `{from, salt, signature, validBefore}`, and `amount`, the USDT units it signed (optional; a string of digits, else 400)",
        reply: "`{receiptId, txHash}` once the chain shows the payment. On a payment link or page checkout, 409 `{error, amountDue, discount, amountUnits}` if `amount` isn't the total due now (a shop's own checkout ignores `amount`)",
      },
      { method: "GET", path: "/api/v1/sessions/{id}/voucher", auth: "public", body: "None", reply: "`{amountDue, discount, amountUnits}`" },
      { method: "POST", path: "/api/v1/sessions/{id}/voucher", auth: "public", body: "`code`", reply: "`{amountDue, discount, amountUnits}`. Link and page checkouts only." },
      { method: "DELETE", path: "/api/v1/sessions/{id}/voucher", auth: "public", body: "None", reply: "`{amountDue, discount, amountUnits}` without the code" },
    ],
  },
];

/** Every documented endpoint, in page order. */
export const ENDPOINTS: Endpoint[] = RESOURCES.flatMap((resource) => resource.endpoints);

/** The price currencies, in lib/server/http.ts CURRENCIES order. */
export const FX_CURRENCIES = [
  { code: "USDT", name: "Tether USD", how: "Charged as is" },
  { code: "USD", name: "US dollar", how: "1:1 with USDT" },
  { code: "EUR", name: "Euro", how: "Live rate" },
  { code: "GBP", name: "Pound sterling", how: "Live rate" },
  { code: "INR", name: "Indian rupee", how: "Live rate" },
  { code: "AED", name: "UAE dirham", how: "Live rate" },
  { code: "SGD", name: "Singapore dollar", how: "Live rate" },
] as const;

/** The limits the page states, each checked against the code by the docs test. */
export const LIMITS = {
  minPaymentUsdt: "1.00",
  maxPaymentUsdt: "1,000.00",
  checkoutMinutes: 30, // USDT and USD checkouts
  quoteLockMinutes: 10, // any other currency: the checkout ends with its quote
  rateCacheMinutes: 15,
  rateMaxAgeDays: 7,
  fxBandPercent: 15,
  aedPegPercent: 1,
  referenceMax: 40,
  returnUrlMax: 200,
  itemsMax: 20,
  itemQtyMax: 999,
  idempotencyKeyMax: 255,
  idempotencyHours: 24,
  paymentsPageMax: 100,
  keysMax: 20,
  listMax: 200,
  reportDaysMax: 92,
  webhookEndpointsMax: 5,
  webhookToleranceSeconds: 300,
  webhookRetryMinutes: [1, 5, 30],
} as const;

export interface RateLimit {
  endpoints: { method: Method; path: string }[];
  limit: number;
  windowMs: number;
  per: string;
}

const MINUTE_MS = 60_000;

export const RATE_LIMITS: RateLimit[] = [
  { endpoints: [{ method: "POST", path: "/api/v1/sessions" }], limit: 60, windowMs: MINUTE_MS, per: "merchant" },
  { endpoints: [{ method: "POST", path: "/api/v1/quotes" }], limit: 30, windowMs: MINUTE_MS, per: "IP address" },
  {
    endpoints: [
      { method: "POST", path: "/api/v1/public/links/{slug}/checkout" },
      { method: "POST", path: "/api/v1/public/pages/{slug}/checkout" },
    ],
    limit: 20,
    windowMs: MINUTE_MS,
    per: "IP address, links and pages together",
  },
  {
    endpoints: [
      { method: "POST", path: "/api/v1/sessions/{id}/voucher" },
      { method: "DELETE", path: "/api/v1/sessions/{id}/voucher" },
    ],
    limit: 10,
    windowMs: MINUTE_MS,
    per: "IP address and checkout",
  },
  { endpoints: [{ method: "POST", path: "/api/v1/vouchers" }], limit: 30, windowMs: 60 * MINUTE_MS, per: "merchant" },
  {
    endpoints: [
      { method: "POST", path: "/api/v1/webhooks/{id}/test" },
      { method: "POST", path: "/api/v1/webhooks/deliveries/{id}/replay" },
    ],
    limit: 20,
    windowMs: MINUTE_MS,
    per: "merchant, test and replay together",
  },
];

/** What each status means, with messages the API really sends (the test finds each one in the code), and what to do. */
export const ERRORS: { status: number; meaning: string; examples: string[]; fix: string }[] = [
  {
    status: 400,
    meaning: "The request is missing something or a field is wrong.",
    examples: ['Send JSON like {"amount": "25.00"}.', "amount must look like 25.00 (up to 6 decimals)."],
    fix: "Fix the field the message names, then send it again. The same request will fail the same way.",
  },
  {
    status: 401,
    meaning: "No key, a wrong or revoked key, or not signed in.",
    examples: ["Missing or wrong API key.", "Sign in to your merchant dashboard first."],
    fix: "Check `GATEWAY_SECRET_KEY` on your server and that the key isn't revoked. On a dashboard call, sign in again.",
  },
  { status: 403, meaning: "A publishable key on a secret-key route.", examples: ["Use a secret key (sk_…) on your server."], fix: "Use an `sk_test_` key from your server. `pk_` keys are for the browser." },
  {
    status: 404,
    meaning: "Not found, or not yours: another merchant's id is a 404 too.",
    examples: ["No such checkout.", "No such payment link."],
    fix: "Check the id, and that the same merchant's key made it.",
  },
  {
    status: 409,
    meaning: "It clashes with what is already there.",
    examples: ["You already have a link with that reference_id.", "This checkout is already being paid."],
    fix: "Don't create it again: read what's there, or pick another `reference_id`. A checkout being paid settles on its own.",
  },
  {
    status: 410,
    meaning: "Gone: the checkout expired or is paid, or the link is paid, expired or cancelled.",
    examples: ["This checkout has expired. Ask the shop for a new one."],
    fix: "Make a new checkout or link for the customer.",
  },
  { status: 413, meaning: "The body is too large.", examples: ["That request is too large."], fix: "Send less: fewer items or shorter text." },
  {
    status: 422,
    meaning: "An Idempotency-Key reused with a different body.",
    examples: ["This Idempotency-Key was already used for a different request."],
    fix: "Use a new key for a new request. To retry, send the first body exactly as it was.",
  },
  {
    status: 429,
    meaning: "Too many requests. Wait a minute.",
    examples: ["Too many checkouts at once. Wait a minute and try again.", "Too many requests. Wait a minute and try again."],
    fix: "Wait a minute, then retry. Slow down any loop that creates checkouts.",
  },
  {
    status: 500,
    meaning: "Our mistake. The message never names internals.",
    examples: ["Something went wrong on our side. Try again."],
    fix: "Retry with the same `Idempotency-Key`; the SDK does it for you.",
  },
  {
    status: 502,
    meaning: "The chain or its index didn't answer us.",
    examples: ["The payment history isn't available right now. Try again in a minute."],
    fix: "Try again in a minute. The SDK retries it twice first.",
  },
  {
    status: 503,
    meaning: "Not available right now, or not set up on this server. Nothing was created.",
    examples: ["Exchange rates are unavailable right now. Price in USD or USDT, or try again in a minute.", "We can't check API keys right now. Try again in a minute."],
    fix: "Price in USD or USDT, or try again in a minute.",
  },
];

/** The events lib/server/events.ts defines. `sent`: something in the app calls its sender today (the docs test checks
 *  both ways, so wiring refunds fails the test until this says so). */
export const EVENTS: { type: "payment.succeeded" | "payment.refunded"; sent: boolean; when: string; extra: string }[] = [
  {
    type: "payment.succeeded",
    sent: true,
    when: "A checkout is paid: one your server made, or one a payer opened from a payment link or page. Once per checkout.",
    extra: "None beyond the fields below",
  },
  {
    type: "payment.refunded",
    sent: true,
    when: "A refund is synced: after you refund on chain, `POST /api/v1/payments/{id}/refunds/sync` names the transaction and we check MerchantPay's own Refunded log. Once per refunded total.",
    extra: "`refunded` (the total so far) and `refund_amount` (this refund)",
  },
];

/** What `data` holds in payment.succeeded, in the order lib/server/events.ts writes it (names joined by ", " share a line). */
export const EVENT_FIELDS: [string, string][] = [
  ["id", "The checkout's id: the one you saved when you created it."],
  ["status", '"paid".'],
  ["amount", "The USDT the customer paid, after any voucher."],
  ["currency", '"USDT".'],
  ["reference", "Your orderId, or the link's reference_id or slug, or the page's slug."],
  ["paymentId, txHash", "The payment on chain."],
  ["link_id, page_id", "Set when the checkout came from a payment link or page; null otherwise."],
];

/** A checkout's `status`, in the order it moves (the SDK's Session status). */
export const CHECKOUT_STATUSES: { status: "open" | "pending" | "paid" | "expired"; means: string }[] = [
  { status: "open", means: "Waiting for the customer to pay." },
  { status: "pending", means: "A payment is on its way. Don't make a new checkout: if it fails, this one is open again." },
  { status: "paid", means: "The payment is confirmed. Check the amount, then fulfil the order." },
  {
    status: "expired",
    means: `Nothing was paid in time: ${LIMITS.checkoutMinutes} minutes, or ${LIMITS.quoteLockMinutes} when priced in another currency. Make a new checkout.`,
  },
];

/** Test mode scenarios. `status` and `messages` are what the gateway (or, for a bad signature, the webhook snippet)
 *  answers; test/docs-endpoints.test.mjs gets each one from the real handlers. */
export const TEST_SCENARIOS: { id: string; scenario: string; how: string; result: string; status?: number; messages?: string[] }[] = [
  {
    id: "paid",
    scenario: "Paid",
    how: "Pay a test checkout with test USDT, or press Simulate a payment.",
    result: "`status` reads paid, and each of your endpoints gets payment.succeeded.",
  },
  {
    id: "expired",
    scenario: "Expired",
    how: `Leave a checkout unpaid for ${LIMITS.checkoutMinutes} minutes (${LIMITS.quoteLockMinutes} when priced in EUR, GBP, INR, AED or SGD).`,
    result: "`status` reads expired, and paying it is refused.",
    status: 410,
    messages: ["This checkout has expired. Ask the shop for a new one."],
  },
  {
    id: "paid-twice",
    scenario: "Paid twice",
    how: "Pay the same checkout again from a second tab, during the first payment or after it.",
    result: "Refused, and the customer is charged once. After the first lands, the reply carries its receipt.",
    status: 409,
    messages: ["This checkout is already being paid.", "Already paid."],
  },
  {
    id: "link-paid",
    scenario: "Link already paid",
    how: "Open a single-use payment link again once it's paid.",
    result: "Refused. Make the customer a new link.",
    status: 410,
    messages: ["This payment link is paid."],
  },
  {
    id: "idempotency",
    scenario: "Idempotency-Key reused",
    how: "Create a checkout, then send the same `Idempotency-Key` with a different body.",
    result: "Refused, and nothing is created.",
    status: 422,
    messages: ["This Idempotency-Key was already used for a different request."],
  },
  {
    id: "endpoint-down",
    scenario: "Your endpoint is down",
    how: "Point a webhook at a URL that answers 500, or doesn't answer, then pay.",
    result: `We try again after ${LIMITS.webhookRetryMinutes[0]} minute, then ${LIMITS.webhookRetryMinutes.slice(1).join(", then ")} more, then mark it failed. Resend it from the Developers screen.`,
  },
  {
    id: "bad-signature",
    scenario: "Bad signature",
    how: "Put a wrong `GATEWAY_WEBHOOK_SECRET` on your server, then press Send test event.",
    result: "`constructEvent` throws `WebhookSignatureError` and the webhook handler in Webhooks answers 400. We count it as failed and retry.",
    status: 400,
  },
];
