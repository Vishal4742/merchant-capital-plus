// PATCH /api/v2/business/members/:principalId { role, idempotencyKey }: change a role (Owner).
// DELETE /api/v2/business/members/:principalId?idempotencyKey=...: remove a member (Owner). Last Owner -> 409.
import { mutationContext } from "../../../../../../lib/server/auth-sessions.ts";
import { removeMember, setMemberRole } from "../../../../../../lib/server/businesses.ts";
import { ok } from "../../../../../../lib/server/http.ts";
import { body, v2 } from "../../../../../../lib/server/v2.ts";

type Params = { params: Promise<{ principalId: string }> };

export const PATCH = (request: Request, { params }: Params) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    return ok(await setMemberRole(ctx, { principalId: (await params).principalId, role: b.role, idempotencyKey: b.idempotencyKey }));
  });

export const DELETE = (request: Request, { params }: Params) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const key = new URL(request.url).searchParams.get("idempotencyKey");
    return ok(await removeMember(ctx, { principalId: (await params).principalId, idempotencyKey: key }));
  });
