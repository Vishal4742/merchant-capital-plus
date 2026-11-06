// The reference data /docs renders (FR-GW-8), kept as typed data so test/docs-reference.test.mjs can hold it to the
// code: every path is a route file under app/api/v1 that exports the method, the currencies are lib/server/http.ts's,
// and the limits, rate limits and error messages are the ones the code enforces. Edit the code first, then this file.
// Text fields may mark code with `backticks`; the page renders those as <code>.

export type Method = "GET" | "POST" | "DELETE";
export type Auth = "secret" | "dashboard" | "dashboard-or-secret" | "public";

export interface Endpoint {
  method: Method;
  path: string; // "/api/v1/sessions/{id}": {param} is a [param] folder
  auth: Auth;
  body: string;
  reply: string;
}

export interface Resource {
  id: string;
  title: string;
  about: string;
  endpoints: Endpoint[];
}

export const AUTH: Record<Auth, { label: string; how: string }> = {
  secret: { label: "Secret key", how: "`Authorization: Bearer sk_test_…`, from your server only. A publishable key (`pk_`) gets 403." },
  dashboard: { label: "Dashboard sign-in", how: "The session cookie from signing in with your wallet at /merchant. The dashboard screens call these." },
  "dashboard-or-secret": { label: "Sign-in or secret key", how: "Either one, so a setup script on your server can add its own endpoint." },
  public: { label: "Public", how: "No key. Your customers' browsers and our hosted pages call these." },
};

export const RESOURCES: Resource[] = [
  {
    id: "checkouts",
    title: "Checkouts",
    about: "Your server creates a checkout and sends the customer to its `url`. The SDK's `sessions.create` and `sessions.retrieve`.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/sessions",
        auth: "secret",
        body: '`amount` ("25.00"), `currency`?, `reference`? (up to 40 characters), `items`? [{`name`, `qty`, `price`}], `returnUrl`?. Header `Idempotency-Key`?',
        reply: "201 `{id, url, amount, currency, priced?, expiresAt}`. `amount` is the USDT the customer pays; `priced` is the locked quote.",
      },
      {
        method: "GET",
        path: "/api/v1/sessions/{id}",
        auth: "secret",
        body: "None",
        reply: "`{id, status, amount, currency, priced?, reference, paymentId, txHash, refunded?}`. `status` is open, pending, paid or expired.",
      },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    about: "Every payment to your wallet, read from the chain. The SDK's `payments.list`.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/payments",
        auth: "secret",
        body: "Query `limit` (1 to 100, default 20), `cursor`",
        reply: "`{data: [{paymentId, sessionId, invoiceId, amount, refunded, txHash, paidAt, reference}], next}`, newest first. Pass `next` as `cursor`.",
      },
    ],
  },
  {
    id: "links",
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
      { method: "GET", path: "/api/v1/public/links/{slug}", auth: "public", body: "None", reply: "`{slug, merchant_name, amount, currency, description, status}`" },
      {
        method: "POST",
        path: "/api/v1/public/links/{slug}/checkout",
        auth: "public",
        body: "`amount`, for a link without one. JSON or a form.",
        reply: "303 to the checkout, or `{checkout_url, session_id}` with `Accept: application/json`. 410 once the link is paid, expired or cancelled.",
      },
    ],
  },
  {
    id: "pages",
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
    id: "vouchers",
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
    id: "webhooks",
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
    id: "keys",
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
    ],
  },
  {
    id: "hosted",
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
        body: "The customer's signed approval `{from, salt, signature, validBefore}`",
        reply: "`{receiptId, txHash}` once the chain shows the payment",
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

/** What each status means, with messages the API really sends (the test finds each one in the code). */
export const ERRORS: { status: number; meaning: string; examples: string[] }[] = [
  { status: 400, meaning: "The request is missing something or a field is wrong.", examples: ['Send JSON like {"amount": "25.00"}.', "amount must look like 25.00 (up to 6 decimals)."] },
  { status: 401, meaning: "No key, a wrong or revoked key, or not signed in.", examples: ["Missing or wrong API key.", "Sign in to your merchant dashboard first."] },
  { status: 403, meaning: "A publishable key on a secret-key route.", examples: ["Use a secret key (sk_…) on your server."] },
  { status: 404, meaning: "Not found, or not yours: another merchant's id is a 404 too.", examples: ["No such checkout.", "No such payment link."] },
  { status: 409, meaning: "It clashes with what is already there.", examples: ["You already have a link with that reference_id.", "This checkout is already being paid."] },
  { status: 410, meaning: "Gone: the checkout expired or is paid, or the link is paid, expired or cancelled.", examples: ["This checkout has expired. Ask the shop for a new one."] },
  { status: 413, meaning: "The body is too large.", examples: ["That request is too large."] },
  { status: 422, meaning: "An Idempotency-Key reused with a different body.", examples: ["This Idempotency-Key was already used for a different request."] },
  { status: 429, meaning: "Too many requests. Wait a minute.", examples: ["Too many checkouts at once. Wait a minute and try again.", "Too many requests. Wait a minute and try again."] },
  { status: 500, meaning: "Our mistake. The message never names internals.", examples: ["Something went wrong on our side. Try again."] },
  { status: 502, meaning: "The chain or its index didn't answer us.", examples: ["The payment history isn't available right now. Try again in a minute."] },
  {
    status: 503,
    meaning: "Not available right now, or not set up on this server. Nothing was created.",
    examples: ["Exchange rates are unavailable right now. Price in USD or USDT, or try again in a minute.", "We can't check API keys right now. Try again in a minute."],
  },
];
