// GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD → per UTC day gross, fees, net, refunds and count, the totals, and
// new vs returning payers, from MerchantPay's on-chain logs (SRS FR-GW-9). Batch 051 R2-1 payments:read (any member of
// the workspace that linked the merchant wallet).
import { handle, ok } from "../../../../lib/server/http.ts";
import { legacyAccess } from "../../../../lib/server/legacy.ts";
import { merchantHistory, merchantPayAddress, rangeOf, report } from "../../../../lib/server/reports.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "payments:read");
    const range = rangeOf(request);
    return ok(report(await merchantHistory(merchantPayAddress(), merchant), range));
  });
}
