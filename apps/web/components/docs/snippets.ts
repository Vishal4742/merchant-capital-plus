// The code blocks on /docs (FR-GW-8), written against packages/sdk's real exports (Gateway, sessions.create/retrieve,
// payments.list, constructEvent, sameAmount, SIGNATURE_HEADER, WebhookSignatureError) and public/v1/button.js.
// Lines stay within about 42 characters, so they fit a 375 px phone without wrapping.

export const BUTTON = `<!-- SESSION_ID: from your server -->
<script src="GATEWAY_URL/v1/button.js"
  data-session="SESSION_ID"
  data-label="Pay 25.00 USDT"></script>`;

export const OWN_ELEMENT = `<!-- once, without data-session -->
<script src="GATEWAY_URL/v1/button.js">
</script>

<!-- then mark any element, even later -->
<button data-mc-session="SESSION_ID">
  Pay now
</button>
<button data-mc-link="LINK_SLUG">
  Pay by link
</button>`;

export const ENV = `GATEWAY_URL=https://your-gateway.example
GATEWAY_SECRET_KEY=sk_test_…
GATEWAY_WEBHOOK_SECRET=whsec_…`;

export const CREATE = `import { Gateway } from "@merchant-capital/sdk";

const gateway = new Gateway(
  process.env.GATEWAY_SECRET_KEY!,
  { baseUrl: process.env.GATEWAY_URL! },
);

// Price in USDT (the default), USD, EUR,
// GBP, INR, AED or SGD. The customer pays
// USDT at a rate locked for the checkout.
const session = await gateway.sessions.create(
  {
    amount: "20.00",
    currency: "EUR",
    orderId: "order-42", // → reference
    returnUrl: "https://shop.example/",
  },
  // a retry gets the same checkout back
  { idempotencyKey: "order-42" },
);

// Save session.id and session.amount (the
// USDT due) with your order; webhooks
// name the checkout by its id. Then send
// the customer to session.url, or give
// session.id to the pay button.`;

export const RETRIEVE = `import { sameAmount } from "@merchant-capital/sdk";

const checkout = await gateway.sessions
  .retrieve(order.sessionId);
// status: "open", "pending" (confirming),
// "paid" or "expired"
const paid = checkout.amount;
if (
  checkout.status === "paid" &&
  sameAmount(paid, order.amountUsdt)
) {
  await markPaid(order.id);
}`;

export const LIST = `const page = await gateway.payments.list({
  limit: 20,
});
for (const payment of page.data) {
  // paymentId, sessionId, amount,
  // refunded, txHash, paidAt, reference
  await reconcile(payment);
}
// next page: list({ cursor: page.next })`;

export const WEBHOOK = `import {
  constructEvent,
  sameAmount,
  SIGNATURE_HEADER,
  WebhookSignatureError,
} from "@merchant-capital/sdk";

const ok = () => new Response("ok");

// A Next.js route handler. Pass the raw
// body: re-serialized JSON won't verify.
export async function POST(req: Request) {
  let event;
  try {
    event = constructEvent(
      await req.text(),
      req.headers.get(SIGNATURE_HEADER),
      process.env.GATEWAY_WEBHOOK_SECRET!,
    );
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      return new Response("bad signature", {
        status: 400,
      });
    }
    throw err; // no secret set: a 500
  }
  // a test event, or one you already
  // handled: do nothing
  if ("test" in event.data) return ok();
  if (await seen(event.id)) return ok();

  if (event.type === "payment.succeeded") {
    // find the order by the checkout id
    // you saved, never by reference
    // alone, and check it was paid in full
    const order = await orderByCheckout(
      event.data.id,
    );
    const paid = event.data.amount;
    if (
      order &&
      sameAmount(paid, order.amountUsdt)
    ) {
      // one transaction: mark it paid and
      // remember event.id
      await markPaid(order.id, event.id);
    }
  }
  return ok();
}`;

export const EVENT_HEADERS = `POST /your/webhook/path
Content-Type: application/json
MC-Signature: t=1793923200,v1=<64 hex>`;

/** The body lib/server/events.ts eventData() sends for a paid checkout. */
export const EVENT = `{
  "id": "evt_Qm3xT8kLp2RvA9sZ",
  "type": "payment.succeeded",
  "created": 1793923200,
  "data": {
    "id": "9b2f6c1e-4d7a-4f3b-8e21-5a0c…",
    "status": "paid",
    "amount": "22.51",
    "currency": "USDT",
    "reference": "order-42",
    "paymentId": "42",
    "txHash": "0x7d1e…c03a",
    "link_id": null,
    "page_id": null
  }
}`;

export const TEST_EVENT = `{
  "id": "evt_…",
  "type": "payment.succeeded",
  "created": 1793923200,
  "data": { "test": true }
}`;
