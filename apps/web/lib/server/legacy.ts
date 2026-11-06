// Batch 051 (Stage 3, SRS v3.1 FR-BIZ-1..3, FR-AUTH-1..3, FR-AUTH-5, CON-11, NFR-17): a legacy merchant wallet joins a
// WhiteFlow workspace, and the v1 gateway answers to workspace roles instead of the retired wallet cookie.
// - Claim: an Owner proves control of the legacy merchant wallet by signing a fresh, single-use EIP-4361 message the
//   server built for this principal and workspace. Linking the workspace, consuming the challenge, moving the wallet's
//   API keys into the workspace, the Owners' notices and the audit row are ONE statement. A wrong signature or a failed
//   obligations read never consumes the challenge. Signatures and messages are never logged or audited.
// - legacyAccess(): who may act on the linked wallet's gateway records (032 R2-1 route → scope map). The services keep
//   taking the merchant wallet; only who is calling changes.
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { cookieFrom } from "../auth.ts";
import { WF_SESSION_COOKIE, contextFromRequest, mutationContext, newId, publicOrigin, requestIdOf } from "./auth-sessions.ts";
import { query } from "./db.ts";
import { HttpError, sharedRateLimit } from "./http.ts";
import { AuthError, Forbidden, SECRET_KEY_SCOPES, concurrencyConflict, requireScope, type AuthContext, type Role, type Scope } from "./identity.ts";
import { authenticateKey } from "./keys.ts";
import { readV1Obligations, type ObligationsRead } from "./policies.ts";

const CLAIM_TTL_MS = 10 * 60 * 1000;
const CLAIMS_PER_MINUTE = 10; // per principal, for issuing and (separately) for submitting
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const NONCE = /^[A-Za-z0-9]{8,128}$/; // viem's SIWE nonces are 96 characters
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
// line breaks, NEL, Unicode line/paragraph separators and bidi controls: a quoted name must not reshape the wallet
// prompt. Code points, so the source holds no invisible characters.
const PROMPT_UNSAFE: ReadonlySet<number> = new Set([0x0a, 0x0d, 0x85, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
const promptSafe = (text: string) => Array.from(text, (c) => (PROMPT_UNSAFE.has(c.charCodeAt(0)) ? " " : c)).join("");

const NOT_LINKED = "This workspace isn't linked to a merchant account yet. An Owner can link it in Settings.";
const EXPIRED = "That link request expired or was already used. Start again.";
const ALREADY_LINKED = "This workspace is already linked to a merchant account.";
const TAKEN = "That merchant account is already linked to another workspace.";
const NOT_SIGNER = "That signature isn't from this wallet. Sign with the merchant wallet you entered.";
const BAD_SIGNATURE = "That signature isn't valid.";
const OBLIGATIONS_DOWN = "We couldn't check this wallet's Capital obligations, so nothing was linked. Try again in a minute.";
const KEY_NOT_LINKED = "This API key's merchant account isn't linked to a WhiteFlow workspace yet. An Owner can link it in Settings.";

type OwnerContext = AuthContext & { principalId: string; businessId: string };
function ownerContext(ctx: AuthContext): OwnerContext {
  if (ctx.source !== "session" || ctx.principalId === null) throw new Forbidden();
  requireScope(ctx, "business:manage");
  return ctx as OwnerContext;
}

/** The legacy merchant wallet a workspace linked, or null. */
async function linkedMerchantOf(businessId: string): Promise<Address | null> {
  const [b] = await query<{ legacy_merchant: string | null }>("SELECT legacy_merchant FROM wf_businesses WHERE id = $1", [businessId]);
  return b?.legacy_merchant ? getAddress(b.legacy_merchant) : null;
}

export interface LegacyStatus {
  workspace: { id: string; displayName: string; role: Role } | null;
  linked?: Address | null;
  v1Obligations?: boolean;
}

/** GET /api/v2/legacy: the active workspace, the caller's role and the linked wallet (any role). */
export async function legacyStatus(ctx: AuthContext): Promise<LegacyStatus> {
  if (ctx.businessId === null || ctx.role === null) return { workspace: null };
  const [b] = await query<{ display_name: string; legacy_merchant: string | null; v1_obligations: boolean }>(
    "SELECT display_name, legacy_merchant, v1_obligations FROM wf_businesses WHERE id = $1",
    [ctx.businessId],
  );
  if (!b) return { workspace: null };
  return {
    workspace: { id: ctx.businessId, displayName: b.display_name, role: ctx.role },
    linked: b.legacy_merchant ? getAddress(b.legacy_merchant) : null,
    v1Obligations: b.v1_obligations,
  };
}

export interface ClaimChallenge {
  nonce: string;
  message: string;
  expiresAt: number;
  address: Address;
}

/** Step 1 (Owner): the message the legacy merchant wallet signs to link it to the active workspace. */
export async function issueClaimChallenge(ctx: AuthContext, input: { address: unknown }, now = Date.now()): Promise<ClaimChallenge> {
  const owner = ownerContext(ctx);
  if (typeof input.address !== "string" || !isAddress(input.address, { strict: false })) throw new HttpError(400, "That isn't a wallet address.");
  const wallet = getAddress(input.address);
  await sharedRateLimit(`legacy-claim:${owner.principalId}`, CLAIMS_PER_MINUTE, 60_000, "closed");
  const [biz] = await query<{ display_name: string; legacy_merchant: string | null }>(
    "SELECT display_name, legacy_merchant FROM wf_businesses WHERE id = $1",
    [owner.businessId],
  );
  if (!biz) throw new AuthError("Choose a workspace first.");
  if (biz.legacy_merchant !== null) throw new HttpError(409, ALREADY_LINKED);
  const origin = publicOrigin();
  const nonce = generateSiweNonce();
  const expiresAt = now + CLAIM_TTL_MS;
  const name = promptSafe(biz.display_name);
  const message = createSiweMessage({
    domain: origin.host,
    address: wallet,
    statement: `WhiteFlow merchant-account link: this wallet's existing gateway records (links, pages, vouchers, keys, webhooks, payments) will be managed by the members of "${name}" by role. It moves no funds.`,
    uri: origin.origin,
    version: "1",
    chainId: whitechainSepolia.id,
    nonce,
    issuedAt: new Date(now),
    expirationTime: new Date(expiresAt),
    resources: [`urn:whiteflow:business:${owner.businessId}`, `urn:whiteflow:principal:${owner.principalId}`],
  });
  await query("DELETE FROM wf_legacy_claim_challenges WHERE expires_at < $1", [now - PRUNE_AFTER_MS]);
  await query(
    "INSERT INTO wf_legacy_claim_challenges (nonce, principal_id, business_id, address, message, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [nonce, owner.principalId, owner.businessId, wallet.toLowerCase(), message, now, expiresAt],
  );
  return { nonce, message, expiresAt, address: wallet };
}

/** The claim in one statement. Lock order: the actor's membership (FOR SHARE),
 *  then the business row: the same order as every membership change, so no new deadlock pair.
 *  $1 business, $2 principal, $3 nonce, $4 now, $5 wallet (lowercase), $6 V1 obligations, $7 notice id prefix,
 *  $8 audit id, $9 session id, $10 request id. */
const SQL_CLAIM = `WITH actor AS (
    SELECT 1 FROM wf_memberships WHERE business_id = $1 AND principal_id = $2 AND role = 'owner' FOR SHARE
  ), b AS (
    UPDATE wf_businesses SET legacy_merchant = $5, v1_obligations = $6
    WHERE id = $1 AND legacy_merchant IS NULL AND EXISTS (SELECT 1 FROM actor)
      AND EXISTS (SELECT 1 FROM wf_legacy_claim_challenges WHERE nonce = $3 AND principal_id = $2 AND business_id = $1
                  AND address = $5 AND consumed_at IS NULL AND expires_at > $4::bigint)
    RETURNING id
  ), c AS (
    UPDATE wf_legacy_claim_challenges SET consumed_at = $4::bigint WHERE nonce = $3 AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM b)
    RETURNING nonce
  ), k AS (
    UPDATE app_gw_keys SET business_id = $1 WHERE merchant = $5 AND business_id IS NULL AND EXISTS (SELECT 1 FROM c)
    RETURNING id
  ), n AS (
    INSERT INTO wf_notifications (id, business_id, principal_id, kind, detail, created_at)
    SELECT $7 || '_' || m.principal_id, $1, m.principal_id, 'legacy.linked', jsonb_build_object('merchant', $5::text), $4::bigint
    FROM wf_memberships m WHERE m.business_id = $1 AND m.role = 'owner' AND EXISTS (SELECT 1 FROM c)
  ), a AS (
    INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, outcome, detail, at)
    SELECT $8, $1, $2, 'owner', 'session', $9, $10, 'legacy.claim', $5, 'ok',
           jsonb_build_object('v1Obligations', $6::boolean, 'keysLinked', (SELECT count(*) FROM k)), $4::bigint
    WHERE EXISTS (SELECT 1 FROM c)
  )
  SELECT (SELECT count(*) FROM actor)::int AS is_owner, (SELECT count(*) FROM c)::int AS claimed`;

const pgCode = (err: unknown) => (err as { code?: unknown })?.code;
const pgConstraint = (err: unknown) => (err as { constraint?: unknown })?.constraint;

export interface ClaimResult {
  merchant: Address;
  v1Obligations: boolean;
}

/** The answer for a challenge that was already used: the same result if it linked this wallet here, else 409. */
async function replay(businessId: string, address: string): Promise<ClaimResult> {
  const [b] = await query<{ legacy_merchant: string | null; v1_obligations: boolean }>("SELECT legacy_merchant, v1_obligations FROM wf_businesses WHERE id = $1", [businessId]);
  if (b?.legacy_merchant !== address) throw new HttpError(409, EXPIRED);
  return { merchant: getAddress(address), v1Obligations: b.v1_obligations };
}

async function recoverSigner(message: string, signature: string): Promise<string> {
  try {
    return (await recoverMessageAddress({ message, signature: signature as Hex })).toLowerCase();
  } catch {
    throw new HttpError(400, BAD_SIGNATURE);
  }
}

/** Step 2 (Owner): the wallet's signature over its challenge links the wallet to the active workspace. */
export async function claimLegacyMerchant(
  ctx: AuthContext,
  input: { nonce: unknown; signature: unknown },
  { now = Date.now(), obligations = readV1Obligations }: { now?: number; obligations?: ObligationsRead } = {},
): Promise<ClaimResult> {
  const owner = ownerContext(ctx);
  const { nonce, signature } = input;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new HttpError(409, EXPIRED);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) throw new HttpError(400, BAD_SIGNATURE);
  const [c] = await query<{ address: string; message: string; expires_at: string; consumed_at: string | null }>(
    "SELECT address, message, expires_at::text, consumed_at::text FROM wf_legacy_claim_challenges WHERE nonce = $1 AND principal_id = $2 AND business_id = $3",
    [nonce, owner.principalId, owner.businessId],
  );
  if (!c) throw new HttpError(409, EXPIRED); // unknown, or another principal's or workspace's: one answer
  if (c.consumed_at !== null) return replay(owner.businessId, c.address);
  if (Number(c.expires_at) <= now) throw new HttpError(409, EXPIRED);
  // a refused claim leaves its challenge usable, so each attempt is limited: it costs a signature recovery and a chain read
  await sharedRateLimit(`legacy-claim-submit:${owner.principalId}`, CLAIMS_PER_MINUTE, 60_000, "closed");
  if ((await recoverSigner(c.message, signature)) !== c.address) throw new Forbidden(NOT_SIGNER); // challenge NOT consumed
  // cheap refusals before the chain read (the statement below still enforces both under concurrency)
  const links = await query<{ id: string; legacy_merchant: string | null }>(
    "SELECT id, legacy_merchant FROM wf_businesses WHERE id = $1 OR legacy_merchant = $2",
    [owner.businessId, c.address],
  );
  const holder = links.find((b) => b.legacy_merchant === c.address);
  if (holder) {
    if (holder.id === owner.businessId) return replay(owner.businessId, c.address); // already linked here: same answer
    throw new HttpError(409, TAKEN);
  }
  if (links.some((b) => b.id === owner.businessId && b.legacy_merchant !== null)) throw new HttpError(409, ALREADY_LINKED);
  let v1Obligations: boolean;
  try {
    v1Obligations = await obligations(getAddress(c.address));
  } catch (err) {
    console.error("legacy claim: V1 obligations read failed:", err instanceof Error ? err.name : typeof err); // fail closed (CON-11)
    throw new HttpError(503, OBLIGATIONS_DOWN);
  }
  let rows: Array<{ is_owner: number; claimed: number }>;
  try {
    rows = await query(SQL_CLAIM, [
      owner.businessId, owner.principalId, nonce, now, c.address, v1Obligations, newId("ntf"), newId("aud"), owner.credentialId, owner.requestId,
    ]);
  } catch (err) {
    if (pgCode(err) === "23505" && pgConstraint(err) === "wf_businesses_legacy_merchant_key") throw new HttpError(409, TAKEN);
    throw concurrencyConflict(err);
  }
  const [r] = rows;
  if (r?.claimed === 1) return { merchant: getAddress(c.address), v1Obligations };
  if (r?.is_owner === 0) throw new Forbidden(); // a concurrent change removed the caller's Owner role (R2-2)
  // nothing claimed: a concurrent submission of this challenge won (same answer), or the workspace was linked meanwhile
  const [after] = await query<{ consumed_at: string | null }>("SELECT consumed_at::text FROM wf_legacy_claim_challenges WHERE nonce = $1", [nonce]);
  if (after?.consumed_at) return replay(owner.businessId, c.address);
  throw new HttpError(409, ALREADY_LINKED);
}

export interface LegacyCaller {
  ctx: AuthContext & { businessId: string };
  merchant: Address;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** v1 gateway routes after the cutover (032 R2-1): the caller's workspace role must hold `scope`, and the workspace
 *  must have linked a legacy merchant wallet (409 otherwise). Unsafe methods also require our own origin (CSRF).
 *  `secretKey: true` (webhooks GET/POST only) also takes a live sk_ key whose merchant is linked to a workspace. */
export async function legacyAccess(request: Request, scope: Scope, { secretKey = false }: { secretKey?: boolean } = {}): Promise<LegacyCaller> {
  if (secretKey && (request.headers.get("authorization") ?? "").startsWith("Bearer ")) return keyAccess(request, scope);
  // CSRF only matters when the browser sends the session cookie; without one the caller is simply not signed in (401)
  const csrf = !SAFE_METHODS.has(request.method.toUpperCase()) && cookieFrom(request, WF_SESSION_COOKIE) !== undefined;
  const ctx = csrf ? await mutationContext(request) : await contextFromRequest(request);
  requireScope(ctx, scope);
  const merchant = await linkedMerchantOf(ctx.businessId);
  if (!merchant) throw new HttpError(409, NOT_LINKED);
  return { ctx, merchant };
}

async function keyAccess(request: Request, scope: Scope): Promise<LegacyCaller> {
  const key = await authenticateKey(request);
  if (!key || key.kind !== "sk") throw new AuthError("Sign in to your WhiteFlow workspace, or send your secret API key.");
  if (!SECRET_KEY_SCOPES.has(scope)) throw new Forbidden("API keys can't do that.");
  if (key.businessId === null) throw new HttpError(409, KEY_NOT_LINKED);
  const merchant = await linkedMerchantOf(key.businessId);
  if (!merchant || merchant !== key.merchant) throw new HttpError(409, KEY_NOT_LINKED);
  const ctx = { principalId: null, businessId: key.businessId, role: null, scopes: SECRET_KEY_SCOPES, source: "api_key" as const, credentialId: key.keyId, requestId: requestIdOf(request) };
  return { ctx, merchant };
}

export interface DashboardWorkspace {
  businessId: string;
  merchant: Address;
  role: Role;
  scopes: ReadonlySet<Scope>;
}

/** The dashboard pages' caller: the WhiteFlow session token → the active workspace membership (re-read now) → the
 *  legacy wallet it linked. Null when signed out, without a linked workspace, or on any failure (fail closed: the page
 *  renders no merchant data). lib/merchant-session.ts passes the cookie. */
export async function dashboardWorkspace(token: string | undefined): Promise<DashboardWorkspace | null> {
  if (!token) return null;
  try {
    const ctx = await contextFromRequest(new Request("http://dashboard.invalid/", { headers: { cookie: `${WF_SESSION_COOKIE}=${token}` } }));
    if (ctx.businessId === null || ctx.role === null) return null;
    const merchant = await linkedMerchantOf(ctx.businessId);
    return merchant ? { businessId: ctx.businessId, merchant, role: ctx.role, scopes: ctx.scopes } : null;
  } catch (err) {
    if (!(err instanceof AuthError)) console.error("dashboard workspace read failed:", err instanceof Error ? err.name : typeof err);
    return null;
  }
}

/** FR-AUTH-5 for a v1 mutation, written after it succeeded (a separate statement: the Stage 4 services make it atomic).
 *  A failed audit write is logged, never turned into an error for a write that already happened. */
export async function auditV1(access: LegacyCaller, action: string, target: string | null, now = Date.now()): Promise<void> {
  const { ctx } = access;
  try {
    await query(
      `INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, outcome, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ok', $10)`,
      [newId("aud"), ctx.businessId, ctx.principalId, ctx.role, ctx.source, ctx.credentialId, ctx.requestId, `v1.${action}`, target, now],
    );
  } catch (err) {
    console.error(`audit write failed for v1.${action}:`, err instanceof Error ? err.name : typeof err);
  }
}
