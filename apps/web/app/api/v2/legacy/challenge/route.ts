// POST /api/v2/legacy/challenge {address} (batch 051, Owner, same origin) → {nonce, message, expiresAt, address}: the
// EIP-4361 message the legacy merchant wallet signs to link it to the active workspace (single use, 10 minutes).
import { mutationContext } from "../../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { issueClaimChallenge } from "../../../../../lib/server/legacy.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const input = await body(request);
    return ok(await issueClaimChallenge(ctx, { address: input.address }));
  });
