// POST /api/v2/auth/signout: revokes the session server-side (a copied cookie stops working, FR-AUTH-2).
import { signOut } from "../../../../../lib/server/auth-sessions.ts";
import { v2 } from "../../../../../lib/server/v2.ts";

export const POST = (request: Request) =>
  v2(async () => Response.json({ signedOut: true }, { headers: { "set-cookie": await signOut(request), "cache-control": "no-store" } }));
