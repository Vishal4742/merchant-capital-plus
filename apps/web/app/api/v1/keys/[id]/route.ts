// DELETE /api/v1/keys/:id: revoke one of the signed-in merchant's keys (SRS FR-GW-6). Another merchant's id → 404.
import { HttpError, handle, ok, signedInMerchant } from "../../../../../lib/server/http.ts";
import { revokeKey } from "../../../../../lib/server/keys.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const { id } = await params;
    if (!(await revokeKey(merchant, id))) throw new HttpError(404, "No such key.");
    return ok({ id, revoked: true });
  });
}
