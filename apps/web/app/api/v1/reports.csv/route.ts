// GET /api/v1/reports.csv?from=YYYY-MM-DD&to=YYYY-MM-DD → the report's payments, one CSV row each (SRS FR-GW-9).
// Batch 051 R2-1 payments:read (any member of the workspace that linked the merchant wallet).
import { handle } from "../../../../lib/server/http.ts";
import { legacyAccess } from "../../../../lib/server/legacy.ts";
import { merchantHistory, merchantPayAddress, rangeOf, reportCsv } from "../../../../lib/server/reports.ts";

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "payments:read");
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
