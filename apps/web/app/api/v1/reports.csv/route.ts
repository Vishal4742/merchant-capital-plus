// GET /api/v1/reports.csv?from=YYYY-MM-DD&to=YYYY-MM-DD → the report's payments, one CSV row each (SRS FR-GW-9).
// Dashboard only: the SIWE session cookie.
import { handle, signedInMerchant } from "../../../../lib/server/http.ts";
import { merchantHistory, merchantPayAddress, rangeOf, reportCsv } from "../../../../lib/server/reports.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const range = rangeOf(request);
    const csv = reportCsv(await merchantHistory(merchantPayAddress(), merchant), range);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payments-${range.from}-${range.to}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
}
