// POST /api/auth/logout: clears the session cookie.
import { SESSION_COOKIE, setCookie } from "../../../../lib/auth.ts";

export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ ok: true }, { headers: { "set-cookie": setCookie(SESSION_COOKIE, "", 0, secure) } });
}
