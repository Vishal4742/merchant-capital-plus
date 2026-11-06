// POST /p/{slug}/checkout: the hosted payment page's plain form (FR-GW-2; no JS needed): `qty:<item>` fields or an
// `amount`. The gateway reads a form as flat fields, so our server sends it the {items: [{name, qty}]} it needs, then
// answers 303: to the checkout, or back to /p/{slug} with the customer's choices kept and a fixed message.
import { SLUG } from "../../../../lib/gateway-client.ts";
import { QTY, pageCheckoutBody, type CheckoutError } from "../../../../lib/gateway-forms.ts";
import { openCheckout, readForm, seeOther } from "../../../../lib/gateway-server.ts";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return new Response("No such payment page.", { status: 404 });
  const form = await readForm(request);
  const kept = [...form].filter(([key]) => key === "amount" || key.startsWith(QTY));
  const back = (code: CheckoutError) => `/p/${slug}?${new URLSearchParams([...kept, ["error", code]])}`;
  const body = pageCheckoutBody(form);
  if (!body.ok) return seeOther(back(body.error));
  return openCheckout(request, { kind: "pages", slug, sent: "amount" in body.value ? "amount" : "items" }, body.value, back);
}
