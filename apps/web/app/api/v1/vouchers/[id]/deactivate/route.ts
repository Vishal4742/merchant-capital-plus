// POST /api/v1/vouchers/:id/deactivate: the code stops working at once (FR-GW-12). Another merchant's id → 404.
import { HttpError, handle, ok, signedInMerchant } from "../../../../../../lib/server/http.ts";
import { deactivateVoucher } from "../../../../../../lib/server/vouchers.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const { id } = await params;
    if (!(await deactivateVoucher(merchant, id))) throw new HttpError(404, "No such voucher.");
    return ok({ id, active: false });
  });
}
