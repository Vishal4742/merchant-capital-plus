// POST /api/v1/links/{id}/cancel: the merchant cancels one of its links (FR-GW-1); another merchant's id is a 404.
import { HttpError, handle, ok, signedInMerchant } from "../../../../../../lib/server/http.ts";
import { cancelLink } from "../../../../../../lib/server/links.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const { id } = await params;
    if (!(await cancelLink(merchant, id))) throw new HttpError(404, "No such payment link.");
    return ok({ id, status: "cancelled" });
  });
}
