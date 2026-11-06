// GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD → per UTC day gross, fees, net, refunds and count, the totals, and
// new vs returning payers, from MerchantPay's on-chain logs (SRS FR-GW-9). Dashboard only: the SIWE session cookie.
import { handle, ok, signedInMerchant } from "../../../../lib/server/http.ts";
import { merchantHistory, merchantPayAddress, rangeOf, report } from "../../../../lib/server/reports.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const range = rangeOf(request);
    return ok(report(await merchantHistory(merchantPayAddress(), merchant), range));
  });
}
