// GET /api/v2/business/policy: the current receiving policy (null before activation) and its immutable history.
// POST /api/v2/business/policy { proofNonce, proofSignature, approvalNonce, approvalSignature, expectedCurrentVersion }:
// activate the next version (Owner, both signatures, one statement).
import { contextFromRequest, mutationContext } from "../../../../../lib/server/auth-sessions.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { activatePolicy, currentPolicy, policyHistory } from "../../../../../lib/server/policies.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const GET = (request: Request) =>
  v2(async () => {
    const ctx = await contextFromRequest(request);
    const [current, history] = await Promise.all([currentPolicy(ctx), policyHistory(ctx)]);
    return ok({ current, history });
  });

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    const { proofNonce, proofSignature, approvalNonce, approvalSignature, expectedCurrentVersion } = b;
    return ok(await activatePolicy(ctx, { proofNonce, proofSignature, approvalNonce, approvalSignature, expectedCurrentVersion }), 201);
  });
