// POST /api/demo-checkout: "Try a checkout" opens a real checkout for the demo shop, the same way a shop's server
// would through POST /api/v1/sessions (FR-PAY-4), without exposing the shop's API key. A plain form POST answered
// with 303 is a full page load, so the checkout runs under its own strict CSP. A server action's redirect is a soft
// navigation that stays inside the CSP-less home document (security review, batch 004 round 1, S3).
// Rate-limited per IP (security review 006 R2-F8), shared across instances in Postgres (batch 031 Part C); it fails
// closed: with the limit store down the button answers 503 instead of opening unlimited checkouts.
import { merchantConfig } from "../../../lib/config.ts";
import { createSession } from "../../../lib/sessions.ts";
import { HttpError, RATE_LIMIT_DOWN, clientIp, sharedRateLimit } from "../../../lib/server/http.ts";

let orderNumber = 1041;
const DEMO_LIMIT = 10; // checkouts per IP per minute
const MINUTE_MS = 60_000;

export async function POST(request: Request) {
  // a relative Location keeps the browser on the host it pressed the button on: `next start` reports request.url as
  // localhost, and the guest key lives per origin (G2 run, 06:06)
  const to = (path: string) => new Response(null, { status: 303, headers: { Location: path } });
  try {
    await sharedRateLimit(`demo:${clientIp(request)}`, DEMO_LIMIT, MINUTE_MS, "closed");
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return new Response("Too many test checkouts. Wait a minute and try again.", { status: 429 });
    return new Response(RATE_LIMIT_DOWN, { status: 503 });
  }
  const config = merchantConfig();
  if (!config) return to("/merchant"); // the dashboard explains what isn't set up
  orderNumber += 1;
  try {
    const session = await createSession({
      merchant: config.merchant,
      merchantName: config.merchantName,
      amount: 25_000_000n,
      reference: `A-${orderNumber}`,
      items: [
        { name: "Cold brew", qty: 2, price: 10_000_000n },
        { name: "Banana bread", qty: 1, price: 5_000_000n },
      ],
    });
    return to(`/checkout/${session.id}`);
  } catch (error) {
    // the checkout store is the database (batch 023): no DATABASE_URL, or it can't be reached
    console.error(`demo checkout: not created: ${error instanceof Error ? error.name : "error"}`);
    return new Response("We can't open a test checkout right now. Nothing was charged. Try again in a minute.", { status: 503 });
  }
}
