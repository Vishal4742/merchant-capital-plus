# @whiteflow/sdk

Two pieces for shops on the Whiteflow gateway (Whitechain testnet):
- **`index.ts`:** the server SDK (FR-GW-5).
- **`button.js`:** the one-line pay button (FR-GW-4).

Neither has dependencies.

## Pay button

```html
<script src="https://GATEWAY/v1/button.js" data-session="SESSION_ID" data-label="Pay 25.00 USDT"></script>
```

- **What it does:** renders a button right after the script tag. A click opens the hosted checkout on the gateway that served the script. `SESSION_ID` comes from your server (`sessions.create` below), so the browser never sets the amount.
- **Payment link:** `data-link="SLUG"` opens the payment link you made in the dashboard (`/l/SLUG`).
- **Your own element (React, SPA):** load the script once, without `data-session`, then mark any element: `<button data-mc-session="SESSION_ID">Pay</button>` or `data-mc-link="SLUG"`. One delegated click listener handles every element, including ones rendered later. Style it however you like. The script's own button is styled inline (`.mc-pay-button`).
- **Bad input:** an id (1–64 characters) with anything other than letters, digits, `-` and `_` renders nothing, never navigates, and logs a console error. That's deliberate: a broken id is a developer mistake, and customers never see a dead button.
- **Placement:** put the script tag in `<body>` where the button should appear; in `<head>` it has nowhere visible to go. Use one gateway per page: the first copy of the script to load handles every button.
- **Styling:** the script's own button has inline styles (so a strict `style-src` CSP doesn't strip them). To change its look, write your own element with `data-mc-session` instead of overriding with `!important`.
- **User content:** strip `data-mc-*` attributes from anything users can post (reviews, comments). Otherwise someone could post a pay button for their own checkout on your page. It would still open our gateway, never another site.
- **Canceling:** a click handler of yours that calls `event.preventDefault()` cancels the redirect.

## Server SDK

**Install:**
- It isn't on npm. Copy [`index.ts`](index.ts) into your server code, for example as `lib/gateway.ts`, and import from that file. It's one file with no dependencies, and it's how our own demo shop uses it (`apps/shop/lib/sdk.ts`).
- Node 22.18+ runs the `.ts` file directly. With a TypeScript build (Next.js, `tsc`, a bundler), any Node 20+ works.
- Don't `npm install` it from a tarball: Node refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).

The server SDK holds your **secret** key. It refuses to run in a browser and refuses a `pk_` key. It talks only to an `https` gateway: plain `http` is allowed only for localhost, and a `baseUrl` with `user:pass`, `?query` or `#hash` is refused.

```ts
import { Gateway, WebhookSignatureError, constructEvent, sameAmount, SIGNATURE_HEADER } from "./lib/gateway.ts"; // your copy of index.ts
// saveOrderSession, orderBySessionId and markPaidOnce are YOUR shop's own database helpers.

const gateway = new Gateway(process.env.GATEWAY_SECRET_KEY!, { baseUrl: process.env.GATEWAY_URL! });

// 1. Create a checkout for an order you stored; remember its id and amount; send the customer to url
//    (or render the pay button with data-session = id).
const { id, url, amount } = await gateway.sessions.create({ amount: "25.00", orderId: order.id, returnUrl: "https://shop.example/" });
await saveOrderSession(order.id, { sessionId: id, amount });

// 2. Webhook endpoint (Next.js / Fetch). Pass the RAW body: request.text() here, express.raw() in Express.
export async function POST(request: Request) {
  let event;
  try {
    event = constructEvent(await request.text(), request.headers.get(SIGNATURE_HEADER), process.env.GATEWAY_WEBHOOK_SECRET!);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response("bad signature", { status: 400 });
    throw err; // a config mistake (no secret, bad toleranceSec): let it be a 500
  }
  if (event.data.test) return new Response("ok"); // the dashboard's "Send test event": signed, but no order behind it
  const order = await orderBySessionId(event.data.id); // the id YOU stored in step 1
  if (order && event.type === "payment.succeeded" && event.data.status === "paid" && sameAmount(event.data.amount, order.amount)) {
    await markPaidOnce(order, event.id); // one transaction: mark paid + record event.id; skip if event.id was seen
  }
  return new Response("ok");
}

// 3. Or poll with the stored id: paid when status === "paid" and amount matches what you stored.
const session = await gateway.sessions.retrieve(order.sessionId);
```

- **Credit an order only from your own records:**
  - match the session id you stored, and check the amount with `sameAmount(a, b)`. It compares money, so `"1,000.00"` and `"1000.00"` match; a plain `===` would not;
  - never credit from a session id the browser hands you (a query string, a form field), because a paid 1 USDT session could then pass for a bigger order;
  - payments through links and pages carry `data.link_id` / `data.page_id` and no stored session id, so step 2 ignores them.
- **Deduplicate on `event.id`** in the same transaction that marks the order paid, because retries repeat the id.
- **`orderId`** must be a string of 1–40 characters with no spaces at either end. It comes back as `reference`.
- **Webhook header:** `MC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
  - Events more than 300 s old or ahead are rejected; `toleranceSec` must be a finite number ≥ 0.
  - The compare is constant-time.
  - The secret is the signing secret shown when you add your endpoint under the dashboard's webhook settings. The gateway's sender uses this package's `signWebhook`.
- **Errors:** `GatewayError` carries `status` (0 = unreachable) and the server's message, with your key always replaced by `[secret key]`.
  - A 401 adds a hint to check `GATEWAY_SECRET_KEY` and `baseUrl`.
  - Network errors and 5xx are retried twice (`maxRetries`); 4xx never are.
  - `sessions.create` always sends an idempotency key: yours, or a random one per call. The gateway returns the same session for a repeated key, so a retry never makes a second checkout.
  - Redirects are refused: use the gateway's final URL as `baseUrl`.
- **Amounts and currency:** `amount` is always USDT, the money that moves.
  - On a session, `currency` is the currency you priced in, and `priced` holds your original price and the locked rate. So a 20 EUR checkout reads `amount: "22.51", currency: "EUR", priced: { amount: "20.00", … }`.
  - Webhook data says `currency: "USDT"`, and its `amount` is what was actually paid (after any voucher).
  - Print `priced.amount priced.currency` to show the price, and `amount USDT` to show the charge.
- **Currency guard:** a price in a currency other than USDT is accepted only when the gateway returns a locked quote (`priced`) in that currency. USD is 1:1 and still comes back as a quote. So a server without FX can't charge 25 EUR as 25 USDT. Send amounts as strings (`"0.30"`, not `0.1 + 0.2`).
- `payments.list({ limit, cursor })` reads `GET /api/v1/payments`.

Tests: `npm test` (node:test, Node 26 type stripping; `button.js` runs in `node:vm` on a fake DOM) · `npm run typecheck`.
