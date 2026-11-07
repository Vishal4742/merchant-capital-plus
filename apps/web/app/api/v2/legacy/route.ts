// GET /api/v2/legacy (batch 051): the active workspace, the caller's role and the legacy merchant wallet it linked
// (any role). The dashboard's signed-out panel uses it to offer sign-in, a workspace, or the link step.
import { contextFromRequest } from "../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../lib/server/http.ts";
import { legacyStatus } from "../../../../lib/server/legacy.ts";
import { v2 } from "../../../../lib/server/v2.ts";

export const GET = (request: Request) => v2(async () => ok(await legacyStatus(await contextFromRequest(request))));
