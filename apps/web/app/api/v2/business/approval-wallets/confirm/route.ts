// POST /api/v2/business/approval-wallets/confirm { nonce, signature } (the Owner who asked, same origin): the endorsing
// wallet's signature enrolls the wallet as an approval wallet; every Owner is notified (batch 050 round 2, H1).
import { mutationContext } from "../../../../../../lib/server/auth-sessions.ts";
import { confirmEnrollment } from "../../../../../../lib/server/approval-wallets.ts";
import { ok } from "../../../../../../lib/server/http.ts";
import { body, v2 } from "../../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    return ok(await confirmEnrollment(ctx, { nonce: b.nonce, signature: b.signature }));
  });
