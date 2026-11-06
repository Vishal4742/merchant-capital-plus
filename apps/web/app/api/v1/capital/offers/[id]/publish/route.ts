// POST /api/v1/capital/offers/:id/publish (dashboard cookie, that offer's merchant only) → {entity_key}: writes the
// offer's chain terms to Arkiv, right after the merchant's listAdvance/listInvoice tx (FR-ARK-1, FR-ARK-4, FR-ARK-5).
import { publishOffer } from "../../../../../../../lib/server/capital-arkiv.ts";
import { uintField } from "../../../../../../../lib/server/capital.ts";
import { handle, ok, rateLimit, signedInMerchant } from "../../../../../../../lib/server/http.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    rateLimit(`capital-publish:${merchant.toLowerCase()}`, 20, 60_000); // each call is an Arkiv write
    const { id } = await params;
    return ok(await publishOffer(merchant, uintField(id, "id", { positive: true })));
  });
}
