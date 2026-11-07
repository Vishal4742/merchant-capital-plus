// GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=… → per day gross, fees, net, refunds and count, the totals, and
// new vs returning payers, from MerchantPay's on-chain logs (SRS FR-GW-9). Batch 051 R2-1 payments:read (any member of
// the workspace that linked the merchant wallet), or (batch 052, FR-GW-16 proposed) that workspace's secret key for the
// assistant connector's collection summary; pk_ keys get 403.
import { handle, ok, sharedRateLimit } from "../../../../lib/server/http.ts";
import { legacyAccess } from "../../../../lib/server/legacy.ts";
import { merchantHistory, merchantPayAddress, rangeOf, report } from "../../../../lib/server/reports.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "payments:read", { secretKey: true, publishableForbidden: true });
    await sharedRateLimit(`reports:${merchant.toLowerCase()}`, 30, 60_000, "memory"); // a read, so it stays up without the DB. Each call reads 2-20 Blockscout pages; a looping key must not get our IP throttled (054 review M1)
    const range = rangeOf(request);
    return ok(report(await merchantHistory(merchantPayAddress(), merchant), range));
  });
}
