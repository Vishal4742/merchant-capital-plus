// POST /api/v2/auth/privy: business sign-in (FR-BIZ-6 v3.1). Privy access token (Authorization: Bearer) + identity
// token in the body -> a WhiteFlow session cookie. Nothing about the tokens is echoed.
import { signInWithPrivy } from "../../../../../lib/server/auth-sessions.ts";
import { body, v2 } from "../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => {
    const { cookie, principal } = await signInWithPrivy(request, await body(request));
    return Response.json(
      { principal: { id: principal.id, email: principal.email, wallets: principal.wallets } },
      { headers: { "set-cookie": cookie, "cache-control": "no-store" } },
    );
  });
