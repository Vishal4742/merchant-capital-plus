// GET /api/v2/me: who is signed in, their workspaces and roles, the active one, and when the session ends.
import { contextFromRequest } from "../../../../lib/server/auth-sessions.ts";
import { query } from "../../../../lib/server/db.ts";
import { listMyBusinesses } from "../../../../lib/server/businesses.ts";
import { ok } from "../../../../lib/server/http.ts";
import { v2 } from "../../../../lib/server/v2.ts";

export const GET = (request: Request) =>
  v2(async () => {
    const ctx = await contextFromRequest(request);
    const [[p], [s], mine] = await Promise.all([
      query<{ email: string | null; wallets: string[] | null }>(
        "SELECT email, (SELECT array_agg(address ORDER BY address) FROM wf_principal_wallets WHERE principal_id = $1) AS wallets FROM wf_principals WHERE id = $1",
        [ctx.principalId],
      ),
      query<{ expires_at: string }>("SELECT expires_at::text FROM wf_sessions WHERE id = $1", [ctx.credentialId]),
      listMyBusinesses(ctx),
    ]);
    return ok({
      principal: { id: ctx.principalId, email: p?.email ?? null, wallets: p?.wallets ?? [] },
      businesses: mine.map(({ business, role }) => ({ id: business.id, displayName: business.displayName, timezone: business.timezone, role })),
      active: ctx.businessId ? { id: ctx.businessId, role: ctx.role } : null,
      session: { expiresAt: Number(s?.expires_at ?? 0) },
    });
  });
