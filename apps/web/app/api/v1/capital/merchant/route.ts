// GET /api/v1/capital/merchant → {advance:{claim_id, outstanding, cap, holdback_pct}|null, offers}: the running advance
// (FR-ADV-1) and the merchant's own offers in the book (FR-ARK-2 "my live offers"). Batch 051 R2-1 account:read (any
// member of the workspace that linked the merchant wallet).
import { offerBook } from "../../../../../lib/server/capital-arkiv.ts";
import { merchantAdvance } from "../../../../../lib/server/capital.ts";
import { handle, ok, sharedRateLimit } from "../../../../../lib/server/http.ts";
import { legacyAccess } from "../../../../../lib/server/legacy.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "account:read");
    await sharedRateLimit(`capital-merchant:${merchant.toLowerCase()}`, 30, 60_000, "memory"); // each call reads chain + Arkiv (F4)
    const [advance, book] = await Promise.all([merchantAdvance(merchant), offerBook()]);
    return ok({ advance, offers: book.filter((o) => o.merchant.toLowerCase() === merchant.toLowerCase()) });
  });
}
