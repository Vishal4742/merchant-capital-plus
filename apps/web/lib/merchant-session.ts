// Server-only: who is using the merchant dashboard (batch 051). The Whiteflow session cookie → the active workspace
// membership, re-read on every request → the legacy merchant wallet that workspace linked. The pre-051 wallet cookie
// (mc_session) is not read. Null when signed out, without a linked workspace, or when the read fails (fail closed).
import { cookies } from "next/headers";
import type { Address } from "viem";
import { WF_SESSION_COOKIE } from "./server/auth-sessions.ts";
import { dashboardWorkspace, type DashboardWorkspace } from "./server/legacy.ts";

export async function currentWorkspace(): Promise<DashboardWorkspace | null> {
  return dashboardWorkspace((await cookies()).get(WF_SESSION_COOKIE)?.value);
}

export async function currentMerchant(): Promise<Address | null> {
  return (await currentWorkspace())?.merchant ?? null;
}
