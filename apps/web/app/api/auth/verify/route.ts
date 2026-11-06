// POST /api/auth/verify {message, signature}: checks the signed SIWE message against the nonce cookie and our
// domain, then sets the session cookie. The nonce is single use: it is cleared whether or not sign-in succeeds.
import { isHex } from "viem";
import { NONCE_COOKIE, SESSION_COOKIE, SESSION_TTL_S, authSecret, consumeNonce, cookieFrom, readNonce, setCookie, signInDomains, signSession, verifySignIn } from "../../../../lib/auth.ts";

export async function POST(request: Request) {
  const secret = authSecret();
  if (!secret) return Response.json({ error: "Sign-in isn't set up on this server." }, { status: 503 });
  const url = new URL(request.url), secure = url.protocol === "https:";
  const clearNonce = setCookie(NONCE_COOKIE, "", 0, secure);
  const nonce = readNonce(cookieFrom(request, NONCE_COOKIE), secret); // only a nonce we issued, recently
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (!nonce || typeof body?.message !== "string" || typeof body.signature !== "string" || !isHex(body.signature)) {
    return Response.json({ error: "Sign-in expired. Try again." }, { status: 401, headers: { "set-cookie": clearNonce } });
  }
  const address = await verifySignIn({ message: body.message, signature: body.signature, nonce, domains: signInDomains(request.url) });
  // single use on the server too: the browser drops the cookie, but a captured request could be sent again
  if (address && !consumeNonce(nonce)) return Response.json({ error: "Sign-in expired. Try again." }, { status: 401, headers: { "set-cookie": clearNonce } });
  if (!address) return Response.json({ error: "That signature didn't check out. Try again." }, { status: 401, headers: { "set-cookie": clearNonce } });
  const headers = new Headers();
  headers.append("set-cookie", clearNonce);
  headers.append("set-cookie", setCookie(SESSION_COOKIE, signSession(address, secret), SESSION_TTL_S, secure));
  return Response.json({ address }, { headers });
}
