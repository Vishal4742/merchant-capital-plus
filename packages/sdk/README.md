# @merchant-capital/sdk

Server-side SDK for the Merchant Capital+ gateway on Whitechain testnet (FR-GW-5). No runtime dependencies: global `fetch` and `node:crypto`. It holds your **secret** key, so it refuses to run in a browser. The pay button (`pk_` key) is a separate script.

```ts
import { Gateway, constructEvent, SIGNATURE_HEADER } from "@merchant-capital/sdk";

const gateway = new Gateway(process.env.GATEWAY_SECRET_KEY!, { baseUrl: process.env.GATEWAY_URL! });

// 1. Create a checkout and send the customer to it.
const { url } = await gateway.sessions.create({ amount: "25.00", orderId: "order-42", returnUrl: "https://shop.example/" });

// 2. Read it back: count the order as paid only when status is "paid".
const session = await gateway.sessions.retrieve(id);

// 3. Verify a webhook. Pass the RAW body, not re-serialized JSON.
export async function POST(request: Request) {
  try {
    const event = constructEvent(await request.text(), request.headers.get(SIGNATURE_HEADER), process.env.GATEWAY_WEBHOOK_SECRET!);
    if (event.type === "payment.succeeded") markPaid(event.data.reference);
    return new Response("ok");
  } catch {
    return new Response("bad signature", { status: 400 });
  }
}
```

- **Webhook header:** `MC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Events more than 300 s off are rejected (`toleranceSec` changes it). The comparison is constant-time. `signWebhook(body, secret)` makes the header; the gateway's sender uses the same function.
- **Errors:** `GatewayError` carries `status` (0 = unreachable) and the server's message. Network errors and 5xx are retried twice (`maxRetries`) with the same `idempotencyKey`; 4xx never are.
- **Currency:** `currency` other than USDT is refused unless the gateway echoes it back, so a server without FX quotes can't charge 25 EUR as 25 USDT.
- `payments.list({ limit, cursor })` reads `GET /api/v1/payments` (the route lands with claude-frontend's sessions v2).

Tests: `npm test` (node:test, Node 26 type stripping) · `npm run typecheck`.
