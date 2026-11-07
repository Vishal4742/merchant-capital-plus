// GET /api/v2/me/notifications: the signed-in person's notices (new linked wallets, approval-wallet changes, policy
// activations), newest first (batch 050 round 3, review S-M1).
import { contextFromRequest } from "../../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { listNotices } from "../../../../../lib/server/notifications.ts";
import { v2 } from "../../../../../lib/server/v2.ts";

export const GET = (request: Request) => v2(async () => ok({ notifications: await listNotices(await contextFromRequest(request)) }));
