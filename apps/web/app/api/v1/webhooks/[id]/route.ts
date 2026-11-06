// DELETE /api/v1/webhooks/:id: remove one of the signed-in merchant's endpoints (FR-GW-7). Another merchant's id → 404.
import { HttpError, handle, ok, signedInMerchant } from "../../../../../lib/server/http.ts";
import { deleteWebhook } from "../../../../../lib/server/webhooks.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const { id } = await params;
    if (!(await deleteWebhook(merchant, id))) throw new HttpError(404, "No such webhook endpoint.");
    return ok({ id, deleted: true });
  });
}
