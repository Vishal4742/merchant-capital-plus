// Privy server-side token verification (batch 050, FR-BIZ-6, FR-AUTH-1, FR-AUTH-2).
// Verifies user tokens against Privy's REST API using PRIVY_APP_ID and PRIVY_APP_SECRET.
// Server-only. Never imports client packages or leaks secrets.
import { getAddress, isAddress, type Address } from "viem";
import { serverPrivyConfig } from "../privy-config.ts";

export interface PrivyUser {
  id: string;
  walletAddress: Address | null;
  email?: string;
}

/** Verify a Privy auth / identity token via Privy's REST API using Basic auth (appId:appSecret). */
export async function verifyPrivyToken(token: string): Promise<PrivyUser | null> {
  const config = serverPrivyConfig();
  if (!config) return null;
  const cleanToken = token?.trim();
  if (!cleanToken) return null;

  try {
    const auth = Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64");
    const res = await fetch("https://auth.privy.io/api/v1/users/me", {
      headers: {
        Authorization: `Basic ${auth}`,
        "privy-app-id": config.appId,
        "privy-id-token": cleanToken,
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      id?: string;
      linked_accounts?: Array<{
        type?: string;
        address?: string;
        chain_type?: string;
        email?: string;
      }>;
    } | null;

    if (!data?.id) return null;

    let walletAddress: Address | null = null;
    let email: string | undefined = undefined;

    for (const acc of data.linked_accounts ?? []) {
      if (acc.type === "wallet" && acc.address && isAddress(acc.address)) {
        if (!walletAddress || acc.chain_type === "ethereum") {
          walletAddress = getAddress(acc.address);
        }
      }
      if (acc.type === "email" && acc.email) {
        email = acc.email;
      }
    }

    return {
      id: data.id,
      walletAddress,
      email,
    };
  } catch {
    return null;
  }
}

