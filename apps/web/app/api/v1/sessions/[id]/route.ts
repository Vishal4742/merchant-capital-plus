// GET /api/v1/sessions/:id: the shop polls its checkout with its secret key. Polling stands in for the FR-PAY-10
// webhooks on the AT-1 path (PHASES.md cut list). A pending checkout is settled from the chain first.
// v2: `currency`, `priced` (FR-GW-11) and `refunded`, read from payments(id) on chain once paid. Once paid, `amount` is
// what was charged (a discount code makes it less than the checkout's), the same as the receipt and the webhook.
import { payConfig } from "../../../../../lib/config.ts";
import { readPayment } from "../../../../../lib/onchain.ts";
import { currencyFields, getSession, isInFlight } from "../../../../../lib/sessions.ts";
import { settlePending } from "../../../../../lib/settle.ts";
import { announcePaid } from "../../../../../lib/announce-paid.ts";
import { handle } from "../../../../../lib/server/http.ts";
import { shopCaller } from "../../../../../lib/shop-auth.ts";
import { plainUsdt } from "../../../../../lib/usdt.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });

// a database we can't read is handle()'s 503 (not configured) or 500, never a guessed status
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => handle(() => get(request, context));

async function get(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  // the shop's key or a merchant's own sk_ key (FR-GW-6), the same rule as creating a checkout
  const shop = await shopCaller(request);
  if ("error" in shop) return fail(shop.status, shop.error);
  const { id } = await params;
  const found = await getSession(id);
  // only the caller's own checkouts: links, pages and other keys create sessions for other merchants (security 006 R2-F5)
  if (!found || found.merchant.toLowerCase() !== shop.merchant.toLowerCase()) return fail(404, "No such checkout.");
  const pay = payConfig();
  const state = pay ? await settlePending(found, pay.merchantPay) : found.payment ? "paid" : found.pending ? "pending" : "open";
  const session = (await getSession(id)) ?? found;
  // idempotent: re-announcing on each poll of a paid checkout recovers a payment.succeeded lost to a database blip
  // (security review 012 F2); the backend sends it once per checkout
  if (session.payment) announcePaid(session, session.payment.amount ?? session.amount); // the price it was paid at (F3)
  const open = state === "open" && (await isInFlight(id)) ? "pending" : state; // a payment is being relayed right now
  const status = open === "open" && Date.now() > session.expiresAt ? "expired" : open;
  const paymentId = session.payment?.paymentId ?? null;
  // left out when the chain can't be read right now, never guessed
  const refunded = !session.payment
    ? "0.00"
    : pay && paymentId
      ? await readPayment(pay.merchantPay, BigInt(paymentId)).then(
          (record) => plainUsdt(record.refunded),
          () => undefined,
        )
      : undefined;
  const body = { id, status, amount: plainUsdt(session.payment?.amount ?? session.amount), ...currencyFields(session), reference: session.reference, paymentId, txHash: session.payment?.txHash ?? null, ...(status === "pending" && session.pending?.txHash && { pendingTxHash: session.pending.txHash }), refunded };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
