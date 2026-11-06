// GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=… → per day gross, fees, net, refunds and count, the totals, and
// new vs returning payers, from MerchantPay's on-chain logs (SRS FR-GW-9). The dashboard session, or (batch 052,
// FR-GW-16 proposed) the merchant's secret key for the assistant connector's collection summary; pk_ keys get 403.
import { handle, ok } from "../../../../lib/server/http.ts";
import { callerMerchant } from "../../../../lib/server/keys.ts";
import { merchantHistory, merchantPayAddress, rangeOf, report } from "../../../../lib/server/reports.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await callerMerchant(request);
    const range = rangeOf(request);
    return ok(report(await merchantHistory(merchantPayAddress(), merchant), range));
  });
}
