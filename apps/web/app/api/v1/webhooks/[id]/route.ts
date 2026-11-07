// DELETE /api/v1/webhooks/:id: remove one of the merchant's endpoints (FR-GW-7; batch 051 R2-1 webhooks:manage,
// Owner). Another workspace's id → 404.
import { HttpError, handle, ok } from "../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../lib/server/legacy.ts";
import { deleteWebhook } from "../../../../../lib/server/webhooks.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "webhooks:manage");
    const { id } = await params;
    if (!(await deleteWebhook(access.merchant, id))) throw new HttpError(404, "No such webhook endpoint.");
    await auditV1(access, "webhooks.delete", id);
    return ok({ id, deleted: true });
  });
}
