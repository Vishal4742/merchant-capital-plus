// GET /api/v1/settlements?from=YYYY-MM-DD&to=YYYY-MM-DD → the merchant wallet's USDT balance and one row per payment
// (gross, fee, investors' share, net, tx), newest first (SRS FR-GW-10). Dashboard only: the SIWE session cookie.
import { handle, ok, signedInMerchant } from "../../../../lib/server/http.ts";
import { merchantPayAddress, rangeOf } from "../../../../lib/server/reports.ts";
import { settlements } from "../../../../lib/server/settlements.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const range = rangeOf(request);
    return ok(await settlements(merchantPayAddress(), merchant, range));
  });
}
