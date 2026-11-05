// GET /api/v1/sessions/:id: the shop polls its checkout with its secret key. Polling stands in for the FR-PAY-10
// webhooks on the AT-1 path (PHASES.md cut list). A pending checkout is settled from the chain first.
import { merchantConfig, payConfig, shopAuthorized } from "../../../../../lib/config.ts";
import { getSession, isInFlight } from "../../../../../lib/sessions.ts";
import { settlePending } from "../../../../../lib/settle.ts";
import { formatUsdt } from "../../../../../lib/usdt.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = merchantConfig();
  if (!config) return fail(503, "Checkout isn't set up on this server.");
  if (!shopAuthorized(request, config.apiKey)) return fail(401, "Missing or wrong API key.");
  const { id } = await params;
  const found = getSession(id);
  if (!found) return fail(404, "No such checkout.");
  const pay = payConfig();
  const state = pay ? await settlePending(found, pay.merchantPay) : found.payment ? "paid" : found.pending ? "pending" : "open";
  const session = getSession(id) ?? found;
  const open = state === "open" && isInFlight(id) ? "pending" : state; // a payment is being relayed right now
  const status = open === "open" && Date.now() > session.expiresAt ? "expired" : open;
  const body = { id, status, amount: formatUsdt(session.amount), reference: session.reference, paymentId: session.payment?.paymentId ?? null, txHash: session.payment?.txHash ?? null };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
