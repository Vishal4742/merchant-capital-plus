// POST /api/demo-checkout: "Try a checkout" opens a real checkout for the demo shop, the same way a shop's server
// would through POST /api/v1/sessions (FR-PAY-4), without exposing the shop's API key. A plain form POST answered
// with 303 is a full page load, so the checkout runs under its own strict CSP. A server action's redirect is a soft
// navigation that stays inside the CSP-less home document (security review, batch 004 round 1, S3).
// ponytail: unauthenticated and unbounded like any public demo button; rate-limit with Neon before any deploy (S6).
import { merchantConfig } from "../../../lib/config.ts";
import { createSession } from "../../../lib/sessions.ts";

let orderNumber = 1041;

export async function POST(request: Request) {
  const to = (path: string) => Response.redirect(new URL(path, request.url), 303);
  const config = merchantConfig();
  if (!config) return to("/merchant"); // the dashboard explains what isn't set up
  orderNumber += 1;
  const session = createSession({
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
}
