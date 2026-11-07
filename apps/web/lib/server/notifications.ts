// In-app notices for the signed-in person (batch 050 round 3, review S-M1): the H1 decision says every Owner is told
// about new linked wallets and approval-wallet changes, so the notices written by those statements must be readable.
// Newest first, at most 50, across the person's workspaces; each with a plain sentence. No email (out of scope).
import { query } from "./db.ts";
import { AuthError, type AuthContext } from "./identity.ts";

const LIMIT = 50;

export interface Notice {
  id: string;
  businessId: string;
  kind: string;
  text: string;
  at: number;
  read: boolean;
}

const short = (w: unknown) => (typeof w === "string" && w.length > 12 && !w.includes("...") ? `${w.slice(0, 6)}...${w.slice(-4)}` : String(w ?? ""));

/** One plain sentence per kind; unknown kinds still show, generically. */
function textOf(kind: string, d: Record<string, unknown>): string {
  switch (kind) {
    case "wallet.linked":
      return `A member linked a new wallet (${short(d.wallet)}) to their sign-in. It can't approve payouts unless an approval wallet endorses it.`;
    case "approval_wallet.pinned":
      return `The workspace's first approval wallet was pinned: ${short(d.wallet)}.`;
    case "approval_wallet.enrolled":
      return `A new approval wallet (${short(d.wallet)}) was enrolled, endorsed by ${short(d.endorsedBy)}.`;
    case "approval_wallet.revoked":
      return "A member was removed or is no longer an Owner, so their approval wallets were revoked.";
    case "policy.activated":
      return `Receiving policy version ${String(d.version)} was activated: check where this workspace is paid.`;
    default:
      return "Something changed in this workspace.";
  }
}

export async function listNotices(ctx: AuthContext): Promise<Notice[]> {
  if (ctx.source !== "session" || !ctx.principalId) throw new AuthError();
  const rows = await query<{ id: string; business_id: string; kind: string; detail: Record<string, unknown>; created_at: string; read_at: string | null }>(
    `SELECT id, business_id, kind, detail, created_at::text, read_at::text FROM wf_notifications
     WHERE principal_id = $1 ORDER BY created_at DESC, id LIMIT ${LIMIT}`,
    [ctx.principalId],
  );
  return rows.map((r) => ({ id: r.id, businessId: r.business_id, kind: r.kind, text: textOf(r.kind, r.detail ?? {}), at: Number(r.created_at), read: r.read_at !== null }));
}
