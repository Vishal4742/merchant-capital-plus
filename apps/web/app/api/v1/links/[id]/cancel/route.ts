// POST /api/v1/links/{id}/cancel: the merchant cancels one of its links (FR-GW-1); another workspace's id is a 404.
// Batch 051 R2-1 invoices:draft (Owner, Operator).
import { HttpError, handle, ok } from "../../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../../lib/server/legacy.ts";
import { cancelLink } from "../../../../../../lib/server/links.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft");
    const { id } = await params;
    if (!(await cancelLink(access.merchant, id))) throw new HttpError(404, "No such payment link.");
    await auditV1(access, "links.cancel", id);
    return ok({ id, status: "cancelled" });
  });
}
