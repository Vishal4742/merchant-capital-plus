// GET /api/v1/capital/quote?claim=&units= → {cost}: CapitalMarket.quote, the USDT shown before the investor signs (FR-ADV-6).
import { quoteCost, uintField } from "../../../../../lib/server/capital.ts";
import { clientIp, handle, ok, sharedRateLimit } from "../../../../../lib/server/http.ts";

export async function GET(request: Request) {
  return handle(async () => {
    await sharedRateLimit(`capital-read:${clientIp(request)}`, 60, 60_000, "memory");
    const q = new URL(request.url).searchParams;
    const claimId = uintField(q.get("claim"), "claim", { positive: true });
    const units = uintField(q.get("units"), "units", { positive: true });
    return ok({ cost: await quoteCost(claimId, units) });
  });
}
