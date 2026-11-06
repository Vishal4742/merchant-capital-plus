// GET /api/v1/sessions/:id: the shop polls its checkout with its secret key. Polling stands in for the FR-PAY-10
// webhooks on the AT-1 path (PHASES.md cut list). A pending checkout is settled from the chain first.
// v2: `currency`, `priced` (FR-GW-11) and `refunded`, read from payments(id) on chain once paid.
import { merchantConfig, payConfig, shopAuthorized } from "../../../../../lib/config.ts";
import { readPayment } from "../../../../../lib/onchain.ts";
import { currencyFields, getSession, isInFlight } from "../../../../../lib/sessions.ts";
import { settlePending } from "../../../../../lib/settle.ts";
import { plainUsdt } from "../../../../../lib/usdt.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = merchantConfig();
  if (!config) return fail(503, "Checkout isn't set up on this server.");
  if (!shopAuthorized(request, config.apiKey)) return fail(401, "Missing or wrong API key.");
  const { id } = await params;
  const found = getSession(id);
  // only this shop's checkouts: links and pages create sessions for other merchants too (security review 006 R2-F5)
  if (!found || found.merchant.toLowerCase() !== config.merchant.toLowerCase()) return fail(404, "No such checkout.");
  const pay = payConfig();
  const state = pay ? await settlePending(found, pay.merchantPay) : found.payment ? "paid" : found.pending ? "pending" : "open";
  const session = getSession(id) ?? found;
  const open = state === "open" && isInFlight(id) ? "pending" : state; // a payment is being relayed right now
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
  const body = { id, status, amount: plainUsdt(session.amount), ...currencyFields(session), reference: session.reference, paymentId, txHash: session.payment?.txHash ?? null, refunded };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
