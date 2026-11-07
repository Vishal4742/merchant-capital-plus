// POST /api/v1/webhooks/:id/test: send a signed payment.succeeded event with data {test: true} to this endpoint only
// (FR-GW-7) → the delivery. Another merchant's id → 404.
import { handle, ok, sharedRateLimit, signedInMerchant } from "../../../../../../lib/server/http.ts";
import { sendTestEvent } from "../../../../../../lib/server/webhooks.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    await sharedRateLimit(`webhook-send:${merchant.toLowerCase()}`, 20, 60_000, "closed"); // each call is one outbound request
    const { id } = await params;
    return ok(await sendTestEvent(merchant, id));
  });
}
