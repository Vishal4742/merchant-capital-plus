// GET /api/v2/business/members: the team (any member). POST { wallet | email, role, idempotencyKey }: add (Owner).
import { contextFromRequest, mutationContext } from "../../../../../lib/server/auth-sessions.ts";
import { addMember, listMembers } from "../../../../../lib/server/businesses.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const GET = (request: Request) => v2(async () => ok({ members: await listMembers(await contextFromRequest(request)) }));

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    return ok(await addMember(ctx, { wallet: b.wallet, email: b.email, role: b.role, idempotencyKey: b.idempotencyKey }), 201);
  });
