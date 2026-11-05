// GET /api/auth/nonce: a one-time sign-in nonce, also kept in an HttpOnly cookie so only this browser can use it.
import { randomBytes } from "node:crypto";
import { NONCE_COOKIE, NONCE_TTL_S, authSecret, setCookie, signNonce } from "../../../../lib/auth.ts";

export async function GET(request: Request) {
  const secret = authSecret();
  if (!secret) return Response.json({ error: "Sign-in isn't set up on this server." }, { status: 503 });
  const nonce = randomBytes(16).toString("hex"); // CSPRNG; viem's generateSiweNonce uses Math.random (security R1)
  const secure = new URL(request.url).protocol === "https:";
  const cookie = setCookie(NONCE_COOKIE, signNonce(nonce, secret), NONCE_TTL_S, secure);
  return Response.json({ nonce }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}
