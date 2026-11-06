// POST /api/v1/webhooks/deliveries/:id/replay: re-send one delivery now, same event body, fresh signature (FR-GW-7)
// → the delivery. Another merchant's delivery → 404.
import { handle, ok, rateLimit, signedInMerchant } from "../../../../../../../lib/server/http.ts";
import { replayDelivery } from "../../../../../../../lib/server/webhooks.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    rateLimit(`webhook-send:${merchant.toLowerCase()}`, 20, 60_000); // shared with /test: each call is one outbound request
    const { id } = await params;
    return ok(await replayDelivery(merchant, id));
  });
}
