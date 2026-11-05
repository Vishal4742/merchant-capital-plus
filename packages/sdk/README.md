# @merchant-capital/sdk

Server-side SDK for the Merchant Capital+ gateway on Whitechain testnet (FR-GW-5). It has no runtime dependencies: global `fetch` and `node:crypto` only.

It holds your **secret** key, so it refuses to run in a browser, refuses a `pk_` key, and talks only to an `https` gateway (plain `http` only for localhost). The pay button (`pk_` key) is a separate script.

```ts
import { Gateway, WebhookSignatureError, constructEvent, SIGNATURE_HEADER } from "@merchant-capital/sdk";

const gateway = new Gateway(process.env.GATEWAY_SECRET_KEY!, { baseUrl: process.env.GATEWAY_URL! });

// 1. Create a checkout for an order you stored, remember its id, send the customer to its url.
const { id, url } = await gateway.sessions.create({ amount: "25.00", orderId: order.id, returnUrl: "https://shop.example/" });
await saveSessionId(order.id, id);

// 2. Webhook endpoint (Next.js / Fetch). Pass the RAW body: request.text() here, express.raw() in Express.
export async function POST(request: Request) {
  let event;
  try {
    event = constructEvent(await request.text(), request.headers.get(SIGNATURE_HEADER), process.env.GATEWAY_WEBHOOK_SECRET!);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response("bad signature", { status: 400 });
    throw err;
  }
  if (await alreadyHandled(event.id)) return new Response("ok"); // retries repeat the event id
  const order = await orderBySessionId(event.data.id); // the id YOU stored in step 1, not just the reference
  if (order && event.type === "payment.succeeded" && event.data.status === "paid") await markPaid(order);
  return new Response("ok");
}

// 3. Or poll instead of (or as well as) the webhook, with the id you stored:
const session = await gateway.sessions.retrieve(storedSessionId); // paid when session.status === "paid"
```

- **Match on your stored session id.** Each session id belongs to one of your orders, and its amount was set by your server.
  - Don't credit an order from a session id the browser hands you (a query string, a form field). A paid 1 USDT session could then pass for a bigger order.
  - Payments through payment links and pages carry `data.link_id` / `data.page_id`. They have no stored session id, so step 2 ignores them.
- **`orderId`** is 1–40 characters with no spaces at either end, and comes back as `reference`. Longer ids are refused, because the server would cut them.
- **Webhook header:** `MC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
  - Events more than 300 s old or ahead are rejected; `toleranceSec` must be a finite number ≥ 0.
  - The compare is constant-time.
  - The secret is the signing secret shown when you add your endpoint under the dashboard's webhook settings. The gateway's sender uses this package's `signWebhook`.
- **Errors:** `GatewayError` carries `status` (0 = unreachable) and the server's message, never your key.
  - Network errors and 5xx are retried twice (`maxRetries`) with the same `idempotencyKey`; 4xx never are.
  - Redirects are refused: use the gateway's final URL as `baseUrl`.
- **Currency:** a price in a currency other than USDT is accepted only when the gateway returns a locked quote (`priced`) in that currency. So a server without FX can't charge 25 EUR as 25 USDT. Send amounts as strings (`"0.30"`, not `0.1 + 0.2`).
- `payments.list({ limit, cursor })` reads `GET /api/v1/payments`. The route lands with claude-frontend's sessions v2.

Tests: `npm test` (node:test, Node 26 type stripping) · `npm run typecheck`.
