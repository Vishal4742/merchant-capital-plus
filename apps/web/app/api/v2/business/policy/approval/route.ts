// POST /api/v2/business/policy/approval { proofNonce, wallet }: the Owner approval message to sign with a wallet
// linked to your WhiteFlow sign-in (step-up, FR-BIZ-4).
import { mutationContext } from "../../../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../../../lib/server/http.ts";
import { issueOwnerApproval } from "../../../../../../lib/server/policies.ts";
import { body, v2 } from "../../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    return ok(await issueOwnerApproval(ctx, { proofNonce: b.proofNonce, wallet: b.wallet }));
  });
