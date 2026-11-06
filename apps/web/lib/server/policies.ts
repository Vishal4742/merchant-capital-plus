// Receiving wallet and settlement policy (batch 050, SRS FR-BIZ-3, FR-BIZ-4, FR-BIZ-5, CON-11), per the snapshot's frozen
// batch-032 design (Correction C, R1-1, R1-6, R1-7, R1-9, R2-7) with the Privy-era step-up:
// - receiving proof (CONTROL): an EIP-4361 message the server builds, signed by the receiving wallet (EOA only).
// - Owner approval (AUTHORITY): a fresh (≤ 5 min) purpose-bound message signed by a wallet Privy verified for the acting
//   Owner (wf_principal_wallets). The session alone never approves; a proof signature never approves.
// - Activation is ONE statement: both challenges consumed (each gated on the other being valid too), the next version
//   inserted only if the current version is the one the Owner saw, other Owners notified, audit written.
// Policy versions are insert-only: nothing here updates or deletes one (FR-BIZ-4).
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { USDT } from "../usdt.ts";
import { merchantAdvance } from "./capital.ts";
import { query } from "./db.ts";
import { HttpError, sharedRateLimit } from "./http.ts";
import { Forbidden, concurrencyConflict, requireScope, type AuthContext } from "./identity.ts";
import { newId, publicOrigin, sha256 } from "./auth-sessions.ts";

export const POLICY_CHAIN_ID = 1874; // Whitechain Testnet — the only supported chain (FR-RTE-1 registry, testnet)
export const POLICY_TOKEN = USDT.toLowerCase() as Address; // Whitechain test USDT (packages/shared addresses.usdt)
export const PROOF_TTL_MS = 10 * 60 * 1000;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
const CHALLENGES_PER_MINUTE = 20; // per principal
const EXPIRED = "That confirmation expired or was already used. Start again.";

export interface SettlementPolicy {
  version: number;
  chainId: number;
  token: string;
  recipient: string;
  policyHash: string;
  approvedBy: string;
  approvalWallet: string;
  v1Obligations: boolean;
  approvedAt: number;
}

/** sha256 over the policy's canonical terms: what the Owner approves and what invoices bind to later (FR-BILL-2). */
export const policyHash = (p: { businessId: string; version: number; chainId: number; token: string; recipient: string }) =>
  `0x${sha256(JSON.stringify({ businessId: p.businessId, chainId: p.chainId, recipient: p.recipient.toLowerCase(), token: p.token.toLowerCase(), version: p.version }))}`;

const toPolicy = (r: Record<string, unknown>): SettlementPolicy => ({
  version: Number(r.version), chainId: Number(r.chain_id), token: String(r.token_address), recipient: String(r.recipient),
  policyHash: String(r.policy_hash), approvedBy: String(r.approved_by), approvalWallet: String(r.approval_wallet),
  v1Obligations: r.v1_obligations === true, approvedAt: Number(r.created_at),
});

const POLICY_COLUMNS = "version, chain_id, token_address, recipient, policy_hash, approved_by, approval_wallet, v1_obligations, created_at::text";

/** The workspace's current policy, or null before activation (FR-BIZ-5: collection starts only with one). */
export async function currentPolicy(ctx: AuthContext): Promise<SettlementPolicy | null> {
  requireScope(ctx, "account:read");
  const [row] = await query(`SELECT ${POLICY_COLUMNS} FROM wf_settlement_policies WHERE business_id = $1 ORDER BY version DESC LIMIT 1`, [ctx.businessId]);
  return row ? toPolicy(row) : null;
}

/** Every version, newest first (immutable history). */
export async function policyHistory(ctx: AuthContext): Promise<SettlementPolicy[]> {
  requireScope(ctx, "account:read");
  return (await query(`SELECT ${POLICY_COLUMNS} FROM wf_settlement_policies WHERE business_id = $1 ORDER BY version DESC`, [ctx.businessId])).map(toPolicy);
}

async function currentVersion(businessId: string): Promise<number> {
  const [r] = await query<{ v: number }>("SELECT coalesce(max(version), 0)::int AS v FROM wf_settlement_policies WHERE business_id = $1", [businessId]);
  return r.v;
}

function ownerCtx(ctx: AuthContext): asserts ctx is AuthContext & { businessId: string; principalId: string } {
  requireScope(ctx, "policy:propose");
  if (!ctx.principalId || ctx.source !== "session") throw new Forbidden();
}

/** Step 1 (Owner): a receiving-wallet proof challenge for `address`, bound to this workspace, chain, token and the
 *  next version. The message is built here (never by the client); the recipient wallet signs it. */
export async function issueReceivingProof(ctx: AuthContext, input: { address: unknown }, now = Date.now()) {
  ownerCtx(ctx);
  if (typeof input.address !== "string" || !isAddress(input.address, { strict: false })) throw new HttpError(400, "That isn't a wallet address.");
  const recipient = getAddress(input.address);
  if (recipient.toLowerCase() === POLICY_TOKEN || /^0x0{40}$/i.test(recipient)) throw new HttpError(400, "Choose a wallet you control, not a token or the zero address.");
  await sharedRateLimit(`wf-challenge:${ctx.principalId}`, CHALLENGES_PER_MINUTE, 60_000, "closed");
  const origin = publicOrigin();
  const [biz] = await query<{ display_name: string }>("SELECT display_name FROM wf_businesses WHERE id = $1", [ctx.businessId]);
  const version = (await currentVersion(ctx.businessId)) + 1;
  const hash = policyHash({ businessId: ctx.businessId, version, chainId: POLICY_CHAIN_ID, token: POLICY_TOKEN, recipient });
  const nonce = generateSiweNonce();
  const expiresAt = now + PROOF_TTL_MS;
  const message = createSiweMessage({
    domain: origin.host,
    address: recipient,
    statement: `WhiteFlow receiving-wallet proof: this wallet will receive USDT for "${biz.display_name.replace(/[\r\n]/g, " ")}" on Whitechain Testnet. It proves control of this wallet only; it moves no funds.`,
    uri: origin.origin,
    version: "1",
    chainId: POLICY_CHAIN_ID,
    nonce,
    issuedAt: new Date(now),
    expirationTime: new Date(expiresAt),
    resources: [`urn:whiteflow:business:${ctx.businessId}`, `urn:whiteflow:token:${POLICY_TOKEN}`, `urn:whiteflow:policy:${hash}`],
  });
  await query(
    `INSERT INTO wf_challenges (nonce, purpose, principal_id, business_id, address, chain_id, payload, message, created_at, expires_at)
     VALUES ($1, 'receiving', $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [nonce, ctx.principalId, ctx.businessId, recipient.toLowerCase(), POLICY_CHAIN_ID, JSON.stringify({ proposedVersion: version, token: POLICY_TOKEN, policyHash: hash }), message, now, expiresAt],
  );
  return { nonce, message, expiresAt, recipient, version, policyHash: hash, chainId: POLICY_CHAIN_ID, token: POLICY_TOKEN };
}

type Challenge = { nonce: string; purpose: string; principal_id: string | null; business_id: string | null; address: string; message: string; payload: Record<string, unknown>; expires_at: string; consumed_at: string | null };
async function challenge(nonce: unknown, purpose: "receiving" | "approval", businessId: string, now: number): Promise<Challenge> {
  if (typeof nonce !== "string" || nonce.length > 64) throw new HttpError(409, EXPIRED);
  const [c] = await query<Challenge>(
    "SELECT nonce, purpose, principal_id, business_id, address, message, payload, expires_at::text, consumed_at::text FROM wf_challenges WHERE nonce = $1",
    [nonce],
  );
  if (!c || c.purpose !== purpose || c.business_id !== businessId || c.consumed_at !== null || Number(c.expires_at) <= now) throw new HttpError(409, EXPIRED);
  return c;
}

/** Step 2 (Owner): the approval challenge for a pending proof, to be signed by `wallet`, which must be one Privy
 *  verified for this Owner. Shows the exact terms the Owner approves. */
export async function issueOwnerApproval(ctx: AuthContext, input: { proofNonce: unknown; wallet: unknown }, now = Date.now()) {
  ownerCtx(ctx);
  const proof = await challenge(input.proofNonce, "receiving", ctx.businessId, now);
  if (typeof input.wallet !== "string" || !isAddress(input.wallet, { strict: false })) throw new HttpError(400, "Choose the wallet you approve with.");
  const wallet = input.wallet.toLowerCase();
  const [mine] = await query("SELECT 1 FROM wf_principal_wallets WHERE principal_id = $1 AND address = $2", [ctx.principalId, wallet]);
  if (!mine) throw new HttpError(403, "Approve with a wallet linked to your WhiteFlow sign-in. Link one in the sign-in dialog, then sign in again.");
  await sharedRateLimit(`wf-challenge:${ctx.principalId}`, CHALLENGES_PER_MINUTE, 60_000, "closed");
  const [biz] = await query<{ display_name: string }>("SELECT display_name FROM wf_businesses WHERE id = $1", [ctx.businessId]);
  const version = Number(proof.payload.proposedVersion);
  const nonce = generateSiweNonce();
  const expiresAt = now + APPROVAL_TTL_MS;
  const message = [
    "WhiteFlow: approve a receiving policy",
    "",
    `Workspace: ${biz.display_name.replace(/[\r\n]/g, " ")} (${ctx.businessId})`,
    `Pay out to: ${getAddress(proof.address)}`,
    `Token: USDT ${getAddress(POLICY_TOKEN)} on Whitechain Testnet (chain ${POLICY_CHAIN_ID})`,
    `Policy version: ${version}`,
    `Policy hash: ${String(proof.payload.policyHash)}`,
    `Receiving proof: ${proof.nonce}`,
    `Approver: ${getAddress(wallet)}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    "",
    "Signing approves where this workspace is paid. It moves no funds.",
  ].join("\n");
  await query(
    `INSERT INTO wf_challenges (nonce, purpose, principal_id, business_id, address, chain_id, payload, message, created_at, expires_at)
     VALUES ($1, 'approval', $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [nonce, ctx.principalId, ctx.businessId, wallet, POLICY_CHAIN_ID, JSON.stringify({ proofNonce: proof.nonce, policyHash: proof.payload.policyHash, version }), message, now, expiresAt],
  );
  return { nonce, message, expiresAt, wallet: getAddress(wallet) };
}

async function signer(message: string, signature: unknown): Promise<string> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new HttpError(400, "That signature isn't valid.");
  try {
    return (await recoverMessageAddress({ message, signature: signature as Hex })).toLowerCase();
  } catch {
    throw new HttpError(400, "That signature isn't valid.");
  }
}

/** CON-11: does this wallet carry V1 Capital obligations (a running advance)? A failed read refuses activation (503). */
export type ObligationsRead = (recipient: Address) => Promise<boolean>;
export const readV1Obligations: ObligationsRead = async (recipient) => (await merchantAdvance(recipient)) !== null;

const SQL_ACTIVATE = `WITH actor AS (
    SELECT 1 FROM wf_memberships WHERE business_id = $1 AND principal_id = $2 AND role = 'owner' FOR SHARE
  ), cur AS (
    SELECT coalesce(max(version), 0) AS v FROM wf_settlement_policies WHERE business_id = $1
  ), ok AS (
    SELECT 1 WHERE EXISTS (SELECT 1 FROM actor) AND (SELECT v FROM cur) = $3::int
      AND EXISTS (SELECT 1 FROM wf_challenges WHERE nonce = $4 AND purpose = 'receiving' AND business_id = $1 AND consumed_at IS NULL
                  AND expires_at > $6 AND (payload->>'proposedVersion')::int = $3::int + 1 AND address = $8)
      AND EXISTS (SELECT 1 FROM wf_challenges WHERE nonce = $5 AND purpose = 'approval' AND business_id = $1 AND principal_id = $2
                  AND consumed_at IS NULL AND expires_at > $6 AND payload->>'proofNonce' = $4 AND address = $11)
      AND EXISTS (SELECT 1 FROM wf_principal_wallets WHERE principal_id = $2 AND address = $11)
  ), used AS (
    UPDATE wf_challenges SET consumed_at = $6 WHERE nonce IN ($4, $5) AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM ok) RETURNING nonce
  ), pol AS (
    INSERT INTO wf_settlement_policies (business_id, version, chain_id, token_address, recipient, policy_hash, approved_by, proof_nonce,
                                        approval_nonce, approval_wallet, v1_obligations, created_at)
    SELECT $1, $3::int + 1, $7, $9, $8, $10, $2, $4, $5, $11, $12, $6 WHERE (SELECT count(*) FROM used) = 2
    RETURNING ${POLICY_COLUMNS}
  ), n AS (
    INSERT INTO wf_notifications (id, business_id, principal_id, kind, detail, created_at)
    SELECT $13 || '_' || m.principal_id, $1, m.principal_id, 'policy.activated', jsonb_build_object('version', $3::int + 1, 'policyHash', $10::text), $6
    FROM wf_memberships m WHERE m.business_id = $1 AND m.role = 'owner' AND m.principal_id <> $2 AND EXISTS (SELECT 1 FROM pol)
  ), a AS (
    INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, version_hash, outcome, detail, at)
    SELECT $14, $1, $2, 'owner', 'session', $15, $16, 'policy.activate', $8, $10, 'ok',
           jsonb_build_object('version', $3::int + 1, 'approvalWallet', $11::text, 'v1Obligations', $12::boolean), $6 FROM pol
  )
  SELECT (SELECT count(*) FROM actor)::int AS is_owner, p.* FROM (SELECT 1) one LEFT JOIN pol p ON true`;

/** Step 3 (Owner): verifies both signatures, re-checks everything inside one statement and inserts the next version. */
export async function activatePolicy(
  ctx: AuthContext,
  input: { proofNonce: unknown; proofSignature: unknown; approvalNonce: unknown; approvalSignature: unknown; expectedCurrentVersion: unknown },
  { now = Date.now(), obligations = readV1Obligations }: { now?: number; obligations?: ObligationsRead } = {},
): Promise<SettlementPolicy> {
  requireScope(ctx, "policy:activate");
  if (!ctx.principalId || ctx.source !== "session") throw new Forbidden();
  const expected = Number(input.expectedCurrentVersion);
  if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, "expectedCurrentVersion must be the version you saw (0 for none).");
  const proof = await challenge(input.proofNonce, "receiving", ctx.businessId, now);
  const approval = await challenge(input.approvalNonce, "approval", ctx.businessId, now);
  if (approval.principal_id !== ctx.principalId || approval.payload.proofNonce !== proof.nonce) throw new HttpError(409, EXPIRED);
  if ((await signer(proof.message, input.proofSignature)) !== proof.address) throw new HttpError(400, "The receiving proof wasn't signed by that receiving wallet.");
  if ((await signer(approval.message, input.approvalSignature)) !== approval.address) throw new HttpError(400, "The approval wasn't signed by your approval wallet.");
  let v1Obligations: boolean;
  try {
    v1Obligations = await obligations(getAddress(proof.address));
  } catch {
    throw new HttpError(503, "We couldn't check this wallet's existing Capital obligations. Nothing changed. Try again.");
  }
  const hash = String(proof.payload.policyHash);
  const rows = await query<Record<string, unknown> & { is_owner: number }>(SQL_ACTIVATE, [
    ctx.businessId, ctx.principalId, expected, proof.nonce, approval.nonce, now, POLICY_CHAIN_ID, proof.address, POLICY_TOKEN, hash,
    approval.address, v1Obligations, newId("ntf"), newId("aud"), ctx.credentialId, ctx.requestId,
  ]).catch((err) => {
    if ((err as { code?: unknown })?.code === "23505") throw new HttpError(409, "The receiving policy changed at the same time. Reload and try again.");
    throw concurrencyConflict(err);
  });
  const row = rows[0];
  if (!row || row.is_owner === 0) throw new Forbidden();
  if (row.version === null || row.version === undefined) throw new HttpError(409, "The receiving policy changed, or this confirmation expired. Reload and start again.");
  return toPolicy(row);
}
