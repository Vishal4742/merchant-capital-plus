// POST /api/v2/legacy/claim {nonce, signature} (batch 051, Owner, same origin) → {merchant, v1Obligations}: the
// wallet's signature links it to the active workspace; its gateway records and API keys follow. A replay of a used
// challenge that linked this wallet here returns the same answer.
import { mutationContext } from "../../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { claimLegacyMerchant } from "../../../../../lib/server/legacy.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const input = await body(request);
    return ok(await claimLegacyMerchant(ctx, { nonce: input.nonce, signature: input.signature }));
  });
