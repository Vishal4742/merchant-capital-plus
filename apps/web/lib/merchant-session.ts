// Server-only: who is signed in to the merchant dashboard (from the HMAC-signed session cookie).
import { cookies } from "next/headers";
import type { Address } from "viem";
import { SESSION_COOKIE, authSecret, readSession } from "./auth.ts";

export async function currentMerchant(): Promise<Address | null> {
  const secret = authSecret();
  if (!secret) return null;
  return readSession((await cookies()).get(SESSION_COOKIE)?.value, secret);
}
