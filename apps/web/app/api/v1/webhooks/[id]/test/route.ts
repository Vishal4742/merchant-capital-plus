// POST /api/v1/webhooks/:id/test: send a signed payment.succeeded event with data {test: true} to this endpoint only
// (FR-GW-7) → the delivery. Batch 051 R2-1 webhooks:manage (Owner). Another workspace's id → 404.
import { handle, ok, sharedRateLimit } from "../../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../../lib/server/legacy.ts";
import { sendTestEvent } from "../../../../../../lib/server/webhooks.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "webhooks:manage");
    await sharedRateLimit(`webhook-send:${access.merchant.toLowerCase()}`, 20, 60_000, "closed"); // each call is one outbound request
    const { id } = await params;
    const delivery = await sendTestEvent(access.merchant, id);
    await auditV1(access, "webhooks.test", id);
    return ok(delivery);
  });
}
