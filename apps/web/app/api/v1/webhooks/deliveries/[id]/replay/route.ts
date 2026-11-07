// POST /api/v1/webhooks/deliveries/:id/replay: re-send one delivery now, same event body, fresh signature (FR-GW-7)
// → the delivery. Batch 051 R2-1 webhooks:manage (Owner). Another workspace's delivery → 404.
import { handle, ok, sharedRateLimit } from "../../../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../../../lib/server/legacy.ts";
import { replayDelivery } from "../../../../../../../lib/server/webhooks.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "webhooks:manage");
    await sharedRateLimit(`webhook-send:${access.merchant.toLowerCase()}`, 20, 60_000, "closed"); // shared with /test: each call is one outbound request
    const { id } = await params;
    const delivery = await replayDelivery(access.merchant, id);
    await auditV1(access, "webhooks.replay", id);
    return ok(delivery);
  });
}
