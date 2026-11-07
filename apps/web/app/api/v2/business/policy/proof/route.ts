// POST /api/v2/business/policy/proof { address }: the receiving-wallet proof message to sign (Owner, FR-BIZ-3).
import { mutationContext } from "../../../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../../../lib/server/http.ts";
import { issueReceivingProof } from "../../../../../../lib/server/policies.ts";
import { body, v2 } from "../../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    return ok(await issueReceivingProof(ctx, { address: (await body(request)).address }));
  });
