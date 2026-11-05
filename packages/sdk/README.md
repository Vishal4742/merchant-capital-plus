# @merchant-capital/sdk

Two pieces for shops on the Merchant Capital+ gateway (Whitechain testnet):
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
- **Bad input:** an id with anything other than letters, digits, `-` and `_` renders nothing, never navigates, and logs a console error.

## Server SDK

The server SDK holds your **secret** key. It refuses to run in a browser and refuses a `pk_` key. It talks only to an `https` gateway: plain `http` is allowed only for localhost, and a `baseUrl` with `user:pass`, `?query` or `#hash` is refused.

```ts
import { Gateway, WebhookSignatureError, constructEvent, SIGNATURE_HEADER } from "@merchant-capital/sdk";
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
  const order = await orderBySessionId(event.data.id); // the id YOU stored in step 1
  if (order && event.type === "payment.succeeded" && event.data.status === "paid" && event.data.amount === order.amount) {
    await markPaidOnce(order, event.id); // one transaction: mark paid + record event.id; skip if event.id was seen
  }
  return new Response("ok");
}

// 3. Or poll with the stored id: paid when status === "paid" and amount matches what you stored.
const session = await gateway.sessions.retrieve(order.sessionId);
```

- **Credit an order only from your own records:**
  - match the session id you stored, and check that the amount equals the amount you stored;
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
  - Network errors and 5xx are retried twice (`maxRetries`) with the same `idempotencyKey`; 4xx never are.
  - Redirects are refused: use the gateway's final URL as `baseUrl`.
- **Currency:** a price in a currency other than USDT is accepted only when the gateway returns a locked quote (`priced`) in that currency. USD is 1:1 and still comes back as a quote. So a server without FX can't charge 25 EUR as 25 USDT. Send amounts as strings (`"0.30"`, not `0.1 + 0.2`).
- `payments.list({ limit, cursor })` reads `GET /api/v1/payments`.

Tests: `npm test` (node:test, Node 26 type stripping; `button.js` runs in `node:vm` on a fake DOM) · `npm run typecheck`.
