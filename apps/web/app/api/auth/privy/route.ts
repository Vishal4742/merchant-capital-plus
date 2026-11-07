// POST /api/auth/privy { token: string, address?: string } (batch 050, FR-AUTH-1, FR-AUTH-2, FR-BIZ-6)
// Verifies a Privy auth/identity token on the server using PRIVY_APP_ID & PRIVY_APP_SECRET,
// establishes the authenticated session, and sets the mc_session cookie.
import { isAddress, getAddress, type Address } from "viem";
import { authSecret, setCookie, SESSION_COOKIE, SESSION_TTL_S, signSession } from "../../../../lib/auth.ts";
import { verifyPrivyToken } from "../../../../lib/server/privy-auth.ts";

export async function POST(request: Request) {
  const secret = authSecret();
  if (!secret) return Response.json({ error: "Sign-in isn't set up on this server." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { token?: unknown; address?: unknown } | null;
  if (!body?.token || typeof body.token !== "string") {
    return Response.json({ error: "Missing Privy auth token." }, { status: 400 });
  }

  const user = await verifyPrivyToken(body.token);
  if (!user) {
    return Response.json({ error: "Privy verification failed. Please try signing in again." }, { status: 401 });
  }

  let targetAddress: Address | null = user.walletAddress;
  if (typeof body.address === "string" && isAddress(body.address)) {
    targetAddress = getAddress(body.address);
  }

  if (!targetAddress) {
    return Response.json({ error: "No wallet address associated with this Privy account." }, { status: 422 });
  }

  const url = new URL(request.url), secure = url.protocol === "https:";
  const headers = new Headers();
  headers.append("set-cookie", setCookie(SESSION_COOKIE, signSession(targetAddress, secret), SESSION_TTL_S, secure));

  return Response.json({ address: targetAddress, userId: user.id }, { headers });
}

