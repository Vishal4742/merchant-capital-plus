// Stage 3 shared contract (batch 050, from whiteflow-ef's frozen batch-032 draft) — SRS v3.1 FR-BIZ-1..2, FR-AUTH-1
// (032 spec "Frozen shared contract", R2-1). One AuthContext for session and API-key callers, built ONLY on the server from
// verified credentials and membership rows; a client-supplied business id is a requested context, never authorization.
// Services re-read membership on every request (no cross-request authorization cache).
import { HttpError } from "./http.ts";

export type Role = "owner" | "operator" | "viewer";

export type Scope =
  | "account:read"
  | "business:manage"
  | "members:manage"
  | "policy:propose"
  | "policy:activate"
  | "invoices:read"
  | "invoices:draft"
  | "payments:read"
  | "refunds:propose"
  | "keys:manage"
  | "webhooks:manage"
  | "checkout:create";

/** FR-BIZ-2: Owner manages everything; Operator drafts, inspects payments and prepares links/refund proposals but has no
 *  receiving-policy, member or key rights; Viewer reads only. Financial execution is never a dashboard scope. */
export const ROLE_SCOPES: Readonly<Record<Role, ReadonlySet<Scope>>> = {
  owner: new Set<Scope>([
    "account:read",
    "business:manage",
    "members:manage",
    "policy:propose",
    "policy:activate",
    "invoices:read",
    "invoices:draft",
    "payments:read",
    "refunds:propose",
    "keys:manage",
    "webhooks:manage",
  ]),
  operator: new Set<Scope>(["account:read", "invoices:read", "invoices:draft", "payments:read", "refunds:propose"]),
  viewer: new Set<Scope>(["account:read", "invoices:read", "payments:read"]),
};

/** R2-1: API keys carry a fixed scope set; they never manage members, policy, keys or the business. invoices:draft
 *  (approved, R2-1): main's assistant connector creates payment links with a secret key (POST /api/v1/links). */
export const SECRET_KEY_SCOPES: ReadonlySet<Scope> = new Set<Scope>(["checkout:create", "payments:read", "invoices:read", "invoices:draft", "webhooks:manage"]);

/** The signed-in person: a Privy user (FR-BIZ-6 v3.1), never a wallet. `wallets` are the external wallets Privy verified
 *  for them (lowercase); only these can sign an Owner's policy approval. */
export interface Principal {
  id: string;
  privyDid: string;
  email: string | null;
  wallets: readonly `0x${string}`[];
}

export interface AuthContext {
  principalId: string | null; // null for an API key (it acts for its business, not a person)
  businessId: string | null; // null while a signed-in principal has no active workspace
  role: Role | null;
  scopes: ReadonlySet<Scope>;
  source: "session" | "api_key";
  credentialId: string; // session id or API key id (never the secret itself)
  requestId: string;
}

/** 401: not signed in, or the session expired or was revoked. */
export class AuthError extends HttpError {
  constructor(message = "Sign in to continue.") {
    super(401, message);
  }
}

/** 403: signed in, but this role may not do that. Never reveals whether another tenant's record exists. */
export class Forbidden extends HttpError {
  constructor(message = "Your role in this workspace can't do that.") {
    super(403, message);
  }
}

/** 404 for foreign or guessed ids (FR-AUTH-1): the same answer as a record that doesn't exist. */
export const notFound = (what = "Not found.") => new HttpError(404, what);

/** 409 for a concurrent change that lost (Postgres 40P01 deadlock / 40001 serialization) — safe to retry (R2-2). */
export const CONCURRENT_CHANGE = "Someone else changed this at the same time. Try again.";

/** Throws Forbidden unless the context holds `scope`; AuthError if there is no business context at all. */
export function requireScope(ctx: AuthContext, scope: Scope): asserts ctx is AuthContext & { businessId: string } {
  if (ctx.businessId === null) throw new AuthError("Choose a workspace first.");
  if (!ctx.scopes.has(scope)) throw new Forbidden();
}

/** The scopes a membership role grants. */
export const scopesFor = (role: Role): ReadonlySet<Scope> => ROLE_SCOPES[role];

/** Maps Postgres concurrency failures to a retryable 409; anything else is returned unchanged. */
export function concurrencyConflict(err: unknown): unknown {
  const code = (err as { code?: unknown })?.code;
  return code === "40P01" || code === "40001" ? new HttpError(409, CONCURRENT_CHANGE) : err;
}
