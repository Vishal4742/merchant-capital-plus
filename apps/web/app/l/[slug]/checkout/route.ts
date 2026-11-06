// POST /l/{slug}/checkout: the hosted link page's plain form (FR-GW-1; no JS needed). Our server asks the gateway for a
// checkout and answers 303: to the checkout (a full load, under the checkout's own CSP) or back to /l/{slug} with a
// fixed message. The customer never sees the gateway's JSON.
import { SLUG } from "../../../../lib/gateway-client.ts";
import { amountBody, type CheckoutError } from "../../../../lib/gateway-forms.ts";
import { openCheckout, readForm, seeOther } from "../../../../lib/gateway-server.ts";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return new Response("No such payment link.", { status: 404 });
  const typed = (await readForm(request)).get("amount"); // only an open link's form has one
  const back = (code: CheckoutError) => `/l/${slug}?${new URLSearchParams([...(typed === null ? [] : [["amount", typed]]), ["error", code]])}`;
  if (typed === null) return openCheckout(request, { kind: "links", slug, sent: "fixed" }, {}, back); // the stored price wins
  const body = amountBody(typed);
  return body.ok ? openCheckout(request, { kind: "links", slug, sent: "amount" }, body.value, back) : seeOther(back(body.error));
}
