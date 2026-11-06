// GET /api/v1/capital/merchant (dashboard cookie) → {advance:{claim_id, outstanding, cap, holdback_pct}|null, offers}:
// the running advance (FR-ADV-1) and the merchant's own offers in the book (FR-ARK-2 "my live offers").
import { offerBook } from "../../../../../lib/server/capital-arkiv.ts";
import { merchantAdvance } from "../../../../../lib/server/capital.ts";
import { handle, ok, rateLimit, signedInMerchant } from "../../../../../lib/server/http.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    rateLimit(`capital-merchant:${merchant.toLowerCase()}`, 30, 60_000); // any wallet can sign in; each call reads chain + Arkiv (F4)
    const [advance, book] = await Promise.all([merchantAdvance(merchant), offerBook()]);
    return ok({ advance, offers: book.filter((o) => o.merchant.toLowerCase() === merchant.toLowerCase()) });
  });
}
