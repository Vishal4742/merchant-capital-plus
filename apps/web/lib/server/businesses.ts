// Workspaces and team (batch 050, SRS FR-BIZ-1, FR-BIZ-2, FR-AUTH-4, FR-AUTH-5), per the snapshot's frozen batch-032
// design (whiteflow-ef): every membership change that adds or removes an Owner moves wf_businesses.owner_count in the
// SAME statement, so the CHECK (owner_count >= 1) makes "no Owner left" impossible even for concurrent self-demotions
// (Correction A, R1-2, R2-3). The actor's own Owner membership is locked FOR SHARE and re-checked inside each statement
// (R1-7, R2-6). Idempotency is a plain INSERT into wf_idempotency in the same statement; a 23505 on its primary key is
// read back: same request hash → the stored answer, different → 409 (R2-4).
import { query } from "./db.ts";
import { HttpError, textField } from "./http.ts";
import { Forbidden, concurrencyConflict, notFound, requireScope, type AuthContext, type Role } from "./identity.ts";
import { newId, sha256 } from "./auth-sessions.ts";

export interface Business {
  id: string;
  displayName: string;
  timezone: string;
  createdAt: number;
}
export interface Member {
  principalId: string;
  email: string | null;
  wallets: string[];
  role: Role;
  since: number;
}

const ROLES: readonly Role[] = ["owner", "operator", "viewer"];
const LAST_OWNER = "A workspace needs at least one Owner. Make someone else an Owner first.";
const IDEM_KEY = /^[A-Za-z0-9_.:-]{1,255}$/;

/** Sorted-key JSON, SHA-256 (FR-AUTH-4 engineering choice): the canonical request hash. */
export function requestHash(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return sha256(JSON.stringify(canon(value)));
}

export function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEM_KEY.test(value)) throw new HttpError(400, "idempotencyKey must be 1–255 letters, digits or _.:-");
  return value;
}

export function roleField(value: unknown): Role {
  if (typeof value !== "string" || !ROLES.includes(value as Role)) throw new HttpError(400, "role must be owner, operator or viewer.");
  return value as Role;
}

function timezoneField(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) throw new HttpError(400, "timezone must be an IANA time zone like Asia/Kolkata.");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new HttpError(400, "timezone must be an IANA time zone like Asia/Kolkata.");
  }
}

const pgCode = (err: unknown) => (err as { code?: unknown })?.code;
const pgConstraint = (err: unknown) => (err as { constraint?: unknown })?.constraint;

/** Runs a statement that also inserts its wf_idempotency row. On a replay of the same key, returns the stored answer
 *  (same hash) or 409 (different hash). Other errors map: 23514 owner_count CHECK → 409 last Owner; 40P01/40001 → 409. */
async function withIdempotency<T>(
  run: () => Promise<T>,
  replay: { businessId: string; principalId: string; operation: string; key: string; hash: string },
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (pgCode(err) === "23505" && pgConstraint(err) === "wf_idempotency_pkey") {
      const [row] = await query<{ request_hash: string; response: T }>(
        "SELECT request_hash, response FROM wf_idempotency WHERE business_id = $1 AND principal_id = $2 AND operation = $3 AND key = $4",
        [replay.businessId, replay.principalId, replay.operation, replay.key],
      );
      if (row && row.request_hash === replay.hash) return row.response;
      throw new HttpError(409, "That idempotency key was already used for a different request.");
    }
    if (pgCode(err) === "23514") throw new HttpError(409, LAST_OWNER);
    throw concurrencyConflict(err);
  }
}

const toBusiness = (r: { id: string; display_name: string; timezone: string; created_at: string | number }): Business => ({
  id: r.id, displayName: r.display_name, timezone: r.timezone, createdAt: Number(r.created_at),
});

/** Creates a workspace with the caller as its only Owner and makes it the session's active workspace (one statement). */
export async function createBusiness(ctx: AuthContext, input: { displayName: unknown; timezone: unknown; idempotencyKey: unknown }, now = Date.now()): Promise<Business> {
  if (ctx.source !== "session" || !ctx.principalId) throw new Forbidden();
  const displayName = textField(input.displayName, "displayName", { max: 80 });
  const timezone = timezoneField(input.timezone);
  const key = idempotencyKey(input.idempotencyKey);
  const hash = requestHash({ displayName, timezone });
  const id = newId("biz");
  const rows = await query<{ id: string }>(
    `WITH b AS (
       INSERT INTO wf_businesses (id, display_name, timezone, created_by, idem_key, request_hash, owner_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7) ON CONFLICT (created_by, idem_key) DO NOTHING RETURNING id
     ), m AS (
       INSERT INTO wf_memberships (business_id, principal_id, role, created_at) SELECT id, $4, 'owner', $7 FROM b
     ), s AS (
       UPDATE wf_sessions SET active_business_id = b.id FROM b WHERE wf_sessions.id = $8
     ), a AS (
       INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, outcome, at)
       SELECT $9, id, $4, 'owner', 'session', $8, $10, 'business.create', id, 'ok', $7 FROM b
     )
     SELECT id FROM b`,
    [id, displayName, timezone, ctx.principalId, key, hash, now, ctx.credentialId, newId("aud"), ctx.requestId],
  ).catch((err) => Promise.reject(concurrencyConflict(err)));
  const [row] = await query<{ id: string; display_name: string; timezone: string; created_at: string; request_hash: string }>(
    "SELECT id, display_name, timezone, created_at::text, request_hash FROM wf_businesses WHERE created_by = $1 AND idem_key = $2",
    [ctx.principalId, key],
  );
  if (!row) throw new HttpError(503, "We couldn't create the workspace. Try again.");
  if (rows.length === 0 && row.request_hash !== hash) throw new HttpError(409, "That idempotency key was already used for a different workspace.");
  return toBusiness(row);
}

/** The caller's workspaces and roles. */
export async function listMyBusinesses(ctx: AuthContext): Promise<Array<{ business: Business; role: Role }>> {
  if (!ctx.principalId) return [];
  const rows = await query<{ id: string; display_name: string; timezone: string; created_at: string; role: Role }>(
    `SELECT b.id, b.display_name, b.timezone, b.created_at::text, m.role FROM wf_memberships m JOIN wf_businesses b ON b.id = m.business_id
     WHERE m.principal_id = $1 ORDER BY m.created_at, b.id`,
    [ctx.principalId],
  );
  return rows.map((r) => ({ business: toBusiness(r), role: r.role }));
}

/** Switches the session's workspace; only to one the caller is a member of (else 404, FR-AUTH-1). */
export async function setActiveBusiness(ctx: AuthContext, businessId: unknown): Promise<void> {
  if (ctx.source !== "session" || !ctx.principalId) throw new Forbidden();
  if (typeof businessId !== "string" || businessId.length > 64) throw notFound();
  const rows = await query(
    `UPDATE wf_sessions SET active_business_id = $2 WHERE id = $1
       AND EXISTS (SELECT 1 FROM wf_memberships WHERE business_id = $2 AND principal_id = $3) RETURNING id`,
    [ctx.credentialId, businessId, ctx.principalId],
  );
  if (rows.length === 0) throw notFound();
}

/** Team list (account:read): every member's role, verified email and Privy-verified wallets. */
export async function listMembers(ctx: AuthContext): Promise<Member[]> {
  requireScope(ctx, "account:read");
  const rows = await query<{ id: string; email: string | null; role: Role; created_at: string; wallets: string[] | null }>(
    `SELECT p.id, p.email, m.role, m.created_at::text,
       (SELECT array_agg(w.address ORDER BY w.address) FROM wf_principal_wallets w WHERE w.principal_id = p.id) AS wallets
     FROM wf_memberships m JOIN wf_principals p ON p.id = m.principal_id WHERE m.business_id = $1 ORDER BY m.created_at, p.id`,
    [ctx.businessId],
  );
  return rows.map((r) => ({ principalId: r.id, email: r.email, wallets: r.wallets ?? [], role: r.role, since: Number(r.created_at) }));
}

// The actor CTE every member-management statement starts with (R1-7, R2-6): the caller's own Owner membership, locked.
const ACTOR = `actor AS (SELECT 1 FROM wf_memberships WHERE business_id = $1 AND principal_id = $2 AND role = 'owner' FOR SHARE)`;
const IDEM = (op: string) =>
  `INSERT INTO wf_idempotency (business_id, principal_id, operation, key, request_hash, response, created_at)
   SELECT $1, $2, '${op}', $3, $4, $5::jsonb, $6 FROM done`;
const AUDIT = (action: string) =>
  `INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, outcome, at)
   SELECT $7, $1, $2, 'owner', 'session', $8, $9, '${action}', $10, 'ok', $6 FROM done`;

function ownerCtx(ctx: AuthContext): asserts ctx is AuthContext & { businessId: string; principalId: string } {
  requireScope(ctx, "members:manage");
  if (!ctx.principalId) throw new Forbidden();
}

/** Adds a person who has signed in to WhiteFlow at least once, found by a wallet Privy verified for them or their
 *  verified email (Owner only). An Owner added this way increments owner_count in the same statement. */
export async function addMember(ctx: AuthContext, input: { wallet?: unknown; email?: unknown; role: unknown; idempotencyKey: unknown }, now = Date.now()): Promise<{ principalId: string; role: Role }> {
  ownerCtx(ctx);
  const role = roleField(input.role);
  const key = idempotencyKey(input.idempotencyKey);
  const wallet = typeof input.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(input.wallet) ? input.wallet.toLowerCase() : null;
  const email = !wallet && typeof input.email === "string" && input.email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(input.email) ? input.email.toLowerCase() : null;
  if (!wallet && !email) throw new HttpError(400, "Give the wallet or the email the person signs in with.");
  const [target] = wallet
    ? await query<{ id: string }>("SELECT principal_id AS id FROM wf_principal_wallets WHERE address = $1 ORDER BY updated_at DESC LIMIT 1", [wallet])
    : await query<{ id: string }>("SELECT id FROM wf_principals WHERE lower(email) = $1 ORDER BY last_sign_in_at DESC LIMIT 1", [email]);
  if (!target) throw new HttpError(404, "Nobody has signed in to WhiteFlow with that yet. Ask them to sign in once, then add them.");
  const hash = requestHash({ op: "add", target: target.id, role });
  const response = { principalId: target.id, role };
  return withIdempotency(async () => {
    const [r] = await query<{ is_owner: number; done: number }>(
      `WITH ${ACTOR},
       done AS (INSERT INTO wf_memberships (business_id, principal_id, role, created_at) SELECT $1, $10, $11, $6 WHERE EXISTS (SELECT 1 FROM actor) RETURNING 1),
       c AS (UPDATE wf_businesses SET owner_count = owner_count + 1 WHERE id = $1 AND $11 = 'owner' AND EXISTS (SELECT 1 FROM done)),
       i AS (${IDEM("members.add")}),
       a AS (${AUDIT("members.add")})
       SELECT (SELECT count(*) FROM actor)::int AS is_owner, (SELECT count(*) FROM done)::int AS done`,
      [ctx.businessId, ctx.principalId, key, hash, JSON.stringify(response), now, newId("aud"), ctx.credentialId, ctx.requestId, target.id, role],
    ).catch((err) => {
      if (pgCode(err) === "23505" && pgConstraint(err) === "wf_memberships_pkey") throw new HttpError(409, "That person is already in this workspace.");
      throw err;
    });
    if (r.is_owner === 0) throw new Forbidden();
    return response;
  }, { businessId: ctx.businessId, principalId: ctx.principalId, operation: "members.add", key, hash });
}

/** Changes a member's role (Owner only). Demote form first, then the non-owner form, or the promote form (R2-3); never a
 *  generic SET role. Demoting the last Owner fails on the owner_count CHECK (409). */
export async function setMemberRole(ctx: AuthContext, input: { principalId: unknown; role: unknown; idempotencyKey: unknown }, now = Date.now()): Promise<{ principalId: string; role: Role }> {
  ownerCtx(ctx);
  const role = roleField(input.role);
  const key = idempotencyKey(input.idempotencyKey);
  if (typeof input.principalId !== "string" || input.principalId.length > 64) throw notFound();
  const target = input.principalId;
  const hash = requestHash({ op: "role", target, role });
  const response = { principalId: target, role };
  const forms =
    role === "owner"
      ? [`done AS (UPDATE wf_memberships SET role = 'owner' WHERE business_id = $1 AND principal_id = $10 AND role <> 'owner' AND EXISTS (SELECT 1 FROM actor) RETURNING 1),
          c AS (UPDATE wf_businesses SET owner_count = owner_count + 1 WHERE id = $1 AND EXISTS (SELECT 1 FROM done))`]
      : [
          `done AS (UPDATE wf_memberships SET role = $11 WHERE business_id = $1 AND principal_id = $10 AND role = 'owner' AND EXISTS (SELECT 1 FROM actor) RETURNING 1),
           c AS (UPDATE wf_businesses SET owner_count = owner_count - 1 WHERE id = $1 AND EXISTS (SELECT 1 FROM done))`,
          `done AS (UPDATE wf_memberships SET role = $11 WHERE business_id = $1 AND principal_id = $10 AND role <> 'owner' AND EXISTS (SELECT 1 FROM actor) RETURNING 1),
           c AS (SELECT 1)`,
        ];
  return withIdempotency(async () => {
    for (const form of forms) {
      const [r] = await query<{ is_owner: number; done: number }>(
        `WITH ${ACTOR}, ${form}, i AS (${IDEM("members.role")}), a AS (${AUDIT("members.role")})
         SELECT (SELECT count(*) FROM actor)::int AS is_owner, (SELECT count(*) FROM done)::int AS done`,
        [ctx.businessId, ctx.principalId, key, hash, JSON.stringify(response), now, newId("aud"), ctx.credentialId, ctx.requestId, target, role],
      );
      if (r.is_owner === 0) throw new Forbidden();
      if (r.done === 1) return response;
    }
    // the member isn't in this workspace, or already has that role: one answer for both is enough here
    const [m] = await query<{ role: Role }>("SELECT role FROM wf_memberships WHERE business_id = $1 AND principal_id = $2", [ctx.businessId, target]);
    if (m?.role === role) return response;
    throw notFound();
  }, { businessId: ctx.businessId, principalId: ctx.principalId, operation: "members.role", key, hash });
}

/** Removes a member (Owner only); removing an Owner decrements owner_count in the same statement (last Owner → 409). */
export async function removeMember(ctx: AuthContext, input: { principalId: unknown; idempotencyKey: unknown }, now = Date.now()): Promise<{ principalId: string; removed: true }> {
  ownerCtx(ctx);
  const key = idempotencyKey(input.idempotencyKey);
  if (typeof input.principalId !== "string" || input.principalId.length > 64) throw notFound();
  const target = input.principalId;
  const hash = requestHash({ op: "remove", target });
  const response = { principalId: target, removed: true as const };
  return withIdempotency(async () => {
    const [r] = await query<{ is_owner: number; done: number }>(
      `WITH ${ACTOR},
       done AS (DELETE FROM wf_memberships WHERE business_id = $1 AND principal_id = $10 AND EXISTS (SELECT 1 FROM actor) RETURNING role),
       c AS (UPDATE wf_businesses SET owner_count = owner_count - 1 WHERE id = $1 AND EXISTS (SELECT 1 FROM done WHERE role = 'owner')),
       s AS (UPDATE wf_sessions SET active_business_id = NULL WHERE principal_id = $10 AND active_business_id = $1 AND EXISTS (SELECT 1 FROM done)),
       i AS (${IDEM("members.remove")}),
       a AS (${AUDIT("members.remove")})
       SELECT (SELECT count(*) FROM actor)::int AS is_owner, (SELECT count(*) FROM done)::int AS done`,
      [ctx.businessId, ctx.principalId, key, hash, JSON.stringify(response), now, newId("aud"), ctx.credentialId, ctx.requestId, target],
    );
    if (r.is_owner === 0) throw new Forbidden();
    if (r.done === 0) throw notFound();
    return response;
  }, { businessId: ctx.businessId, principalId: ctx.principalId, operation: "members.remove", key, hash });
}
