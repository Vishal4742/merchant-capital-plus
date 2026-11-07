// POST /api/v1/vouchers/:id/deactivate: the code stops working at once (FR-GW-12). Another workspace's id → 404.
// Batch 051 R2-1 invoices:draft (Owner, Operator).
import { HttpError, handle, ok } from "../../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../../lib/server/legacy.ts";
import { deactivateVoucher } from "../../../../../../lib/server/vouchers.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft");
    const { id } = await params;
    if (!(await deactivateVoucher(access.merchant, id))) throw new HttpError(404, "No such voucher.");
    await auditV1(access, "vouchers.deactivate", id);
    return ok({ id, active: false });
  });
}
