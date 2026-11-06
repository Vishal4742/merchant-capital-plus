// Batch 050 round 2, H1 (owner decision 2026-11-06): pinned approval wallets. Only an enrolled approval wallet signs an
// Owner's receiving-policy approval (policies.ts). The workspace's first activation pins its approval wallet; every
// later one is enrolled here: the requesting Owner names one of their Privy-verified wallets, and an already-enrolled
// approval wallet of a current Owner signs a server-built EIP-4361 endorsement. Consuming the challenge, the enrollment,
// the notices to every Owner (the requester included) and the audit row are ONE statement. Enrollments are never
// deleted when Privy's linked set changes: a wallet linked later (e.g. after an email takeover) can't approve.
// Disclosed limit: a solo Owner who loses every enrolled approval wallet needs support to change the policy.
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { newId, publicOrigin } from "./auth-sessions.ts";
import { query } from "./db.ts";
import { HttpError, sharedRateLimit } from "./http.ts";
import { memberLabel } from "./businesses.ts";
import { Forbidden, concurrencyConflict, requireScope, type AuthContext } from "./identity.ts";
import { promptSafe } from "./policies.ts";

const ENROLL_TTL_MS = 10 * 60 * 1000;
const REQUESTS_PER_MINUTE = 10; // per principal
const NONCE = /^[A-Za-z0-9]{8,128}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const EXPIRED = "That endorsement request expired or was already used. Start again.";
const NOT_ENDORSER = "The endorsing wallet must be an enrolled approval wallet of a current Owner of this workspace.";

type OwnerCtx = AuthContext & { businessId: string; principalId: string };
function ownerCtx(ctx: AuthContext): OwnerCtx {
  requireScope(ctx, "policy:activate");
  if (ctx.source !== "session" || !ctx.principalId) throw new Forbidden();
  return ctx as OwnerCtx;
}

export interface ApprovalWallet {
  wallet: Address;
  you: boolean;
  enrolledAt: number;
  endorsedBy: Address | null; // null: pinned by the first activation
}

/** The workspace's enrolled approval wallets (Owners only) and whether the first one is still open to pin. */
export async function listApprovalWallets(ctx: AuthContext): Promise<{ wallets: ApprovalWallet[]; firstPinOpen: boolean }> {
  const owner = ownerCtx(ctx);
  // active wallets of current Owners only (round 3, review C-L3: revoked or ex-Owners' wallets can't approve or endorse)
  const rows = await query<{ wallet: string; principal_id: string; enrolled_at: string; endorsed_by: string | null }>(
    `SELECT w.wallet, w.principal_id, w.enrolled_at::text, w.endorsed_by FROM wf_approval_wallets w
     JOIN wf_memberships m ON m.business_id = w.business_id AND m.principal_id = w.principal_id AND m.role = 'owner'
     WHERE w.business_id = $1 AND w.revoked_at IS NULL ORDER BY w.enrolled_at, w.wallet`,
    [owner.businessId],
  );
  // the first pin is open only while nothing was ever enrolled (revoked rows count) and no policy exists
  const [{ ever, policies }] = await query<{ ever: number; policies: number }>(
    "SELECT (SELECT count(*)::int FROM wf_approval_wallets WHERE business_id = $1) AS ever, (SELECT count(*)::int FROM wf_settlement_policies WHERE business_id = $1) AS policies",
    [owner.businessId],
  );
  return {
    wallets: rows.map((r) => ({ wallet: getAddress(r.wallet), you: r.principal_id === owner.principalId, enrolledAt: Number(r.enrolled_at), endorsedBy: r.endorsed_by ? getAddress(r.endorsed_by) : null })),
    firstPinOpen: ever === 0 && policies === 0,
  };
}

/** Step 1 (Owner): the endorsement the enrolled wallet `endorser` signs to enroll `wallet` (one of the caller's
 *  Privy-verified wallets) as the caller's approval wallet in this workspace. */
export async function requestEnrollment(ctx: AuthContext, input: { wallet: unknown; endorser: unknown }, now = Date.now()) {
  const owner = ownerCtx(ctx);
  if (typeof input.wallet !== "string" || !isAddress(input.wallet, { strict: false })) throw new HttpError(400, "Choose the wallet to enroll.");
  if (typeof input.endorser !== "string" || !isAddress(input.endorser, { strict: false })) throw new HttpError(400, "Choose the enrolled wallet that endorses it.");
  const wallet = input.wallet.toLowerCase(), endorser = input.endorser.toLowerCase();
  const [mine] = await query("SELECT 1 FROM wf_principal_wallets WHERE principal_id = $1 AND address = $2", [owner.principalId, wallet]);
  if (!mine) throw new HttpError(400, "Enroll a wallet linked to your WhiteFlow sign-in. Link it in the sign-in dialog, then sign in again.");
  // an active enrollment can't be repeated; a revoked one (its Owner was removed or demoted) needs this fresh endorsement
  const [taken] = await query("SELECT 1 FROM wf_approval_wallets WHERE business_id = $1 AND wallet = $2 AND revoked_at IS NULL", [owner.businessId, wallet]);
  if (taken) throw new HttpError(409, "That wallet is already an approval wallet of this workspace.");
  const [ok] = await query(
    `SELECT 1 FROM wf_approval_wallets w JOIN wf_memberships m ON m.business_id = w.business_id AND m.principal_id = w.principal_id AND m.role = 'owner'
     WHERE w.business_id = $1 AND w.wallet = $2 AND w.revoked_at IS NULL`,
    [owner.businessId, endorser],
  );
  if (!ok) throw new Forbidden(NOT_ENDORSER);
  await sharedRateLimit(`wf-enroll:${owner.principalId}`, REQUESTS_PER_MINUTE, 60_000, "closed");
  const origin = publicOrigin();
  const [biz] = await query<{ display_name: string }>("SELECT display_name FROM wf_businesses WHERE id = $1", [owner.businessId]);
  // who asks, as other members see them (round 3, review S-L3: the endorser must know whose wallet they vouch for)
  const [me] = await query<{ email: string | null; wallets: string[] | null }>(
    "SELECT email, (SELECT array_agg(address ORDER BY address) FROM wf_principal_wallets WHERE principal_id = $1) AS wallets FROM wf_principals WHERE id = $1",
    [owner.principalId],
  );
  const asker = promptSafe(memberLabel(me?.email ?? null, me?.wallets ?? []));
  const nonce = generateSiweNonce();
  const expiresAt = now + ENROLL_TTL_MS;
  const message = createSiweMessage({
    domain: origin.host,
    address: getAddress(endorser),
    statement: `WhiteFlow: endorse ${getAddress(wallet)} as an approval wallet of "${promptSafe(biz.display_name)}" for its Owner ${asker}. Approval wallets can approve where this workspace is paid. Sign only if you know this wallet belongs to that Owner. It moves no funds.`,
    uri: origin.origin,
    version: "1",
    chainId: whitechainSepolia.id,
    nonce,
    issuedAt: new Date(now),
    expirationTime: new Date(expiresAt),
    resources: [`urn:whiteflow:business:${owner.businessId}`, `urn:whiteflow:principal:${owner.principalId}`, `urn:whiteflow:wallet:${wallet}`],
  });
  await query("DELETE FROM wf_challenges WHERE purpose = 'enroll' AND consumed_at IS NULL AND expires_at < $1", [now - 24 * 60 * 60 * 1000]);
  await query(
    `INSERT INTO wf_challenges (nonce, purpose, principal_id, business_id, address, chain_id, payload, message, created_at, expires_at)
     VALUES ($1, 'enroll', $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [nonce, owner.principalId, owner.businessId, endorser, whitechainSepolia.id, JSON.stringify({ wallet }), message, now, expiresAt],
  );
  return { nonce, message, expiresAt, wallet: getAddress(wallet), endorser: getAddress(endorser) };
}

/** One statement. Lock order: the requester's membership (FOR SHARE), then the endorser's Owner membership (FOR SHARE),
 *  so a concurrent demotion or removal of either is serialized; no business-row lock, so no deadlock pair with member
 *  changes. $1 business, $2 principal, $3 nonce, $4 now, $5 endorser, $6 wallet, $7 notice id prefix, $8 audit id,
 *  $9 session id, $10 request id. */
const SQL_ENROLL = `WITH actor AS (
    SELECT 1 FROM wf_memberships WHERE business_id = $1 AND principal_id = $2 AND role = 'owner' FOR SHARE
  ), endorser AS (
    SELECT 1 FROM wf_memberships m WHERE m.business_id = $1 AND m.role = 'owner'
      AND m.principal_id = (SELECT principal_id FROM wf_approval_wallets WHERE business_id = $1 AND wallet = $5 AND revoked_at IS NULL) FOR SHARE
  ), w AS (
    -- a new enrollment, or (round 3, S-H1) the fresh endorsement of a revoked one; never over an active one
    INSERT INTO wf_approval_wallets (business_id, wallet, principal_id, enrolled_at, endorsed_by)
    SELECT $1, $6, $2, $4::bigint, $5
    WHERE EXISTS (SELECT 1 FROM actor) AND EXISTS (SELECT 1 FROM endorser)
      AND EXISTS (SELECT 1 FROM wf_principal_wallets WHERE principal_id = $2 AND address = $6)
      AND EXISTS (SELECT 1 FROM wf_challenges WHERE nonce = $3 AND purpose = 'enroll' AND business_id = $1 AND principal_id = $2 AND address = $5
                  AND payload->>'wallet' = $6 AND consumed_at IS NULL AND expires_at > $4::bigint)
    ON CONFLICT (business_id, wallet) DO UPDATE
      SET principal_id = EXCLUDED.principal_id, enrolled_at = EXCLUDED.enrolled_at, endorsed_by = EXCLUDED.endorsed_by, revoked_at = NULL
      WHERE wf_approval_wallets.revoked_at IS NOT NULL
    RETURNING wallet, enrolled_at
  ), c AS (
    UPDATE wf_challenges SET consumed_at = $4::bigint WHERE nonce = $3 AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM w)
    RETURNING nonce
  ), n AS (
    INSERT INTO wf_notifications (id, business_id, principal_id, kind, detail, created_at)
    SELECT $7 || '_' || m.principal_id, $1, m.principal_id, 'approval_wallet.enrolled',
           jsonb_build_object('wallet', $6::text, 'member', $2::text, 'endorsedBy', $5::text), $4::bigint
    FROM wf_memberships m WHERE m.business_id = $1 AND m.role = 'owner' AND EXISTS (SELECT 1 FROM w)
  ), a AS (
    INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, outcome, detail, at)
    SELECT $8, $1, $2, 'owner', 'session', $9, $10, 'approval_wallet.enroll', $6, 'ok', jsonb_build_object('endorsedBy', $5::text), $4::bigint FROM w
  )
  SELECT (SELECT count(*) FROM actor)::int AS is_owner, (SELECT count(*) FROM endorser)::int AS endorser_ok, (SELECT count(*) FROM w)::int AS enrolled`;

/** The answer for an enrollment of `wallet` that exists (a replay, or a concurrent duplicate that won), else null. */
async function enrolledAnswer(businessId: string, principalId: string, wallet: string) {
  const [r] = await query<{ enrolled_at: string; endorsed_by: string | null }>(
    "SELECT enrolled_at::text, endorsed_by FROM wf_approval_wallets WHERE business_id = $1 AND principal_id = $2 AND wallet = $3 AND revoked_at IS NULL",
    [businessId, principalId, wallet],
  );
  return r ? { wallet: getAddress(wallet), endorsedBy: r.endorsed_by ? getAddress(r.endorsed_by) : null, enrolledAt: Number(r.enrolled_at) } : null;
}

/** Step 2 (Owner who asked): the endorser's signature over its challenge enrolls the wallet. A wrong signature never
 *  consumes the challenge. A used challenge that enrolled this wallet answers the same again. */
export async function confirmEnrollment(ctx: AuthContext, input: { nonce: unknown; signature: unknown }, now = Date.now()) {
  const owner = ownerCtx(ctx);
  const { nonce, signature } = input;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new HttpError(409, EXPIRED);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) throw new HttpError(400, "That signature isn't valid.");
  const [c] = await query<{ address: string; message: string; payload: { wallet?: unknown }; expires_at: string; consumed_at: string | null }>(
    "SELECT address, message, payload, expires_at::text, consumed_at::text FROM wf_challenges WHERE nonce = $1 AND purpose = 'enroll' AND business_id = $2 AND principal_id = $3",
    [nonce, owner.businessId, owner.principalId],
  );
  const wallet = typeof c?.payload?.wallet === "string" ? c.payload.wallet : null;
  if (!c || !wallet) throw new HttpError(409, EXPIRED);
  if (c.consumed_at !== null) {
    const again = await enrolledAnswer(owner.businessId, owner.principalId, wallet);
    if (again) return again;
    throw new HttpError(409, EXPIRED);
  }
  if (Number(c.expires_at) <= now) throw new HttpError(409, EXPIRED);
  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message: c.message, signature: signature as Hex })).toLowerCase();
  } catch {
    throw new HttpError(400, "That signature isn't valid.");
  }
  if (signer !== c.address) throw new Forbidden("That endorsement wasn't signed by the endorsing wallet."); // NOT consumed
  // round 3 (review C-L6): say so plainly if the wallet was unlinked from the sign-in since the request (NOT consumed)
  const [linked] = await query("SELECT 1 FROM wf_principal_wallets WHERE principal_id = $1 AND address = $2", [owner.principalId, wallet]);
  if (!linked) throw new HttpError(400, "That wallet is no longer linked to your sign-in. Link it again, then ask for a new endorsement.");
  let rows: Array<{ is_owner: number; endorser_ok: number; enrolled: number }>;
  try {
    rows = await query(SQL_ENROLL, [owner.businessId, owner.principalId, nonce, now, c.address, wallet, newId("ntf"), newId("aud"), owner.credentialId, owner.requestId]);
  } catch (err) {
    if ((err as { code?: unknown; constraint?: unknown })?.code === "23505" && (err as { constraint?: unknown }).constraint === "wf_approval_wallets_pkey") {
      const raced = await enrolledAnswer(owner.businessId, owner.principalId, wallet);
      if (raced) return raced;
      throw new HttpError(409, "That wallet is already an approval wallet of this workspace.");
    }
    throw concurrencyConflict(err);
  }
  const [r] = rows;
  if (r?.enrolled === 1) {
    const done = await enrolledAnswer(owner.businessId, owner.principalId, wallet);
    if (done) return done;
  }
  if (r?.is_owner === 0) throw new Forbidden(); // the requester lost the Owner role meanwhile
  if (r?.endorser_ok === 0) throw new Forbidden(NOT_ENDORSER); // the endorser's Owner lost the role meanwhile
  const raced = await enrolledAnswer(owner.businessId, owner.principalId, wallet);
  if (raced) return raced;
  throw new HttpError(409, EXPIRED);
}
