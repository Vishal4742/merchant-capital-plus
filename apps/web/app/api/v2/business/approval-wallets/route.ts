// GET /api/v2/business/approval-wallets (Owner): the workspace's enrolled approval wallets and whether the first one is
// still open to pin (the first activation pins it). POST { wallet, endorser } (Owner, same origin): the EIP-4361
// endorsement that an enrolled approval wallet of a current Owner signs to enroll `wallet`, one of the caller's
// Privy-verified wallets (batch 050 round 2, H1).
import { contextFromRequest, mutationContext } from "../../../../../lib/server/auth-sessions.ts";
import { listApprovalWallets, requestEnrollment } from "../../../../../lib/server/approval-wallets.ts";
import { ok } from "../../../../../lib/server/http.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const GET = (request: Request) => v2(async () => ok(await listApprovalWallets(await contextFromRequest(request))));

export const POST = (request: Request) =>
  v2(async () => {
    const ctx = await mutationContext(request);
    const b = await body(request);
    return ok(await requestEnrollment(ctx, { wallet: b.wallet, endorser: b.endorser }));
  });
