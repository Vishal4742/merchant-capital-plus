// GET /api/v1/capital/transfer-check?from=&to=&claim=&amount= → {allowed, reason|null} in ClaimToken's own check order,
// so the screen shows why before any wallet prompt (FR-TOK-8, the AT-8 UI half).
import { addressField, transferCheck, uintField } from "../../../../../lib/server/capital.ts";
import { clientIp, handle, ok, rateLimit } from "../../../../../lib/server/http.ts";

export async function GET(request: Request) {
  return handle(async () => {
    rateLimit(`capital-read:${clientIp(request)}`, 60, 60_000);
    const q = new URL(request.url).searchParams;
    const from = addressField(q.get("from"), "from");
    const to = addressField(q.get("to"), "to");
    const claimId = uintField(q.get("claim"), "claim", { positive: true });
    const amount = uintField(q.get("amount"), "amount", { positive: true });
    return ok(await transferCheck({ from, to, claimId, amount }));
  });
}
