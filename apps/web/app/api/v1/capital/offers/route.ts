// GET /api/v1/capital/offers (public): the Capital offer book, chain offers joined with their Arkiv entities.
// Cancelled and expired offers are left out (AT-9); arkiv.matches is the Buy gate (FR-ARK-2, FR-ARK-3).
import { offerBook } from "../../../../../lib/server/capital-arkiv.ts";
import { clientIp, handle, ok, rateLimit } from "../../../../../lib/server/http.ts";

export async function GET(request: Request) {
  return handle(async () => {
    rateLimit(`capital-read:${clientIp(request)}`, 60, 60_000); // each call is chain + Arkiv reads
    return ok({ offers: await offerBook() });
  });
}
