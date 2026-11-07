// DELETE /api/v1/keys/:id: revoke one of the merchant's keys (SRS FR-GW-6; batch 051 R2-1 keys:manage, Owner).
// Another workspace's id → 404.
import { HttpError, handle, ok } from "../../../../../lib/server/http.ts";
import { revokeKey } from "../../../../../lib/server/keys.ts";
import { auditV1, legacyAccess } from "../../../../../lib/server/legacy.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "keys:manage");
    const { id } = await params;
    if (!(await revokeKey(access.merchant, id))) throw new HttpError(404, "No such key.");
    await auditV1(access, "keys.revoke", id);
    return ok({ id, revoked: true });
  });
}
