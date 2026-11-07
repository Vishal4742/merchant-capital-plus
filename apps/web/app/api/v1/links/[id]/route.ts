// GET /api/v1/links/{id}: one of the merchant's payment links with its status and paid checkouts (FR-GW-1; batch 052,
// FR-GW-16 proposed: the assistant connector's get_payment_link). Session or secret key; another merchant's id is a 404.
import { HttpError, handle, ok } from "../../../../../lib/server/http.ts";
import { callerMerchant } from "../../../../../lib/server/keys.ts";
import { linkById, linkJson, linkPayments } from "../../../../../lib/server/links.ts";

const LINK_ID = /^lnk_[A-Za-z0-9_-]{1,40}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { merchant } = await callerMerchant(request);
    const { id } = await params;
    const link = LINK_ID.test(id) ? await linkById(merchant, id) : null;
    if (!link) throw new HttpError(404, "No such payment link.");
    // `payments` stays linkJson's count (as in the list); the records are `paid_checkouts`
    return ok({ ...linkJson(link), paid_checkouts: await linkPayments(link) });
  });
}
