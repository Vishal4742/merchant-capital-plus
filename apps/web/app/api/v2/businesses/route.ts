// POST /api/v2/businesses { displayName, timezone, idempotencyKey }: create a workspace; you become its Owner.
import { mutationContext } from "../../../../lib/server/auth-sessions.ts";
import { createBusiness } from "../../../../lib/server/businesses.ts";
import { ok } from "../../../../lib/server/http.ts";
import { body, v2 } from "../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    return ok(await createBusiness(ctx, { displayName: b.displayName, timezone: b.timezone, idempotencyKey: b.idempotencyKey }), 201);
  });
