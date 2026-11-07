// POST /api/v2/me/active-business { businessId }: switch workspace; only to one you belong to (else 404).
import { mutationContext } from "../../../../../lib/server/auth-sessions.ts";
import { setActiveBusiness } from "../../../../../lib/server/businesses.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    await setActiveBusiness(ctx, (await body(request)).businessId);
    return ok({ active: true });
  });
