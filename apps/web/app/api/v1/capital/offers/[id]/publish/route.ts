// POST /api/v1/capital/offers/:id/publish (that offer's merchant only) → {entity_key}: writes the offer's chain terms
// to Arkiv, right after the merchant's listAdvance/listInvoice tx (FR-ARK-1, FR-ARK-4, FR-ARK-5). Batch 051 R2-1
// business:manage (Owner of the workspace that linked the merchant wallet).
import { publishOffer } from "../../../../../../../lib/server/capital-arkiv.ts";
import { uintField } from "../../../../../../../lib/server/capital.ts";
import { handle, ok, sharedRateLimit } from "../../../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../../../lib/server/legacy.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "business:manage");
    await sharedRateLimit(`capital-publish:${access.merchant.toLowerCase()}`, 20, 60_000, "closed"); // each call is an Arkiv write
    const { id } = await params;
    const published = await publishOffer(access.merchant, uintField(id, "id", { positive: true }));
    await auditV1(access, "capital.publish", id);
    return ok(published);
  });
}
