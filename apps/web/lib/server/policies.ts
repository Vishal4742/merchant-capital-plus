// Receiving wallet and settlement policy (batch 050, SRS FR-BIZ-3, FR-BIZ-4, FR-BIZ-5, CON-11), per the snapshot's frozen
// batch-032 design (Correction C, R1-1, R1-6, R1-7, R1-9, R2-7) with the Privy-era step-up:
// - receiving proof (CONTROL): an EIP-4361 message the server builds, signed by the receiving wallet (EOA only).
// - Owner approval (AUTHORITY): a fresh (≤ 5 min) purpose-bound message signed by a wallet Privy verified for the acting
//   Owner (wf_principal_wallets). The session alone never approves; a proof signature never approves.
// - Activation is ONE statement: both challenges consumed (each gated on the other being valid too), the next version
//   inserted only if the current version is the one the Owner saw, other Owners notified, audit written.
// Policy versions are insert-only: nothing here updates or deletes one (FR-BIZ-4).
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { USDT } from "../usdt.ts";
import { idempotencyKey, requestHash, storedAnswer } from "./businesses.ts";
import { v1Obligations } from "./capital.ts";
import { query } from "./db.ts";
import { HttpError, sharedRateLimit } from "./http.ts";
import { Forbidden, concurrencyConflict, requireScope, type AuthContext } from "./identity.ts";
import { newId, publicOrigin, sha256 } from "./auth-sessions.ts";

export const POLICY_CHAIN_ID = whitechainSepolia.id; // 1874, Whitechain Testnet: the only supported chain (FR-RTE-1, testnet)
export const POLICY_TOKEN = USDT.toLowerCase() as Address; // Whitechain test USDT (packages/shared addresses.usdt)
export const PROOF_TTL_MS = 10 * 60 * 1000;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
const CHALLENGES_PER_MINUTE = 20; // per principal
const EXPIRED = "That confirmation expired or was already used. Start again.";
// every control, format (bidi, zero-width, tags) and line/paragraph separator character: a quoted workspace name must
// not reshape a wallet prompt (round 2; the same rule as batch 051's legacy claim). Property classes, no raw characters.
const PROMPT_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export const promptSafe = (text: string) => text.replace(PROMPT_UNSAFE, " ");

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
export const policyHash = (p: { businessId: string; version: number; token: string; recipient: string }) =>
  `0x${sha256(JSON.stringify({ businessId: p.businessId, chainId: whitechainSepolia.id, recipient: p.recipient.toLowerCase(), token: p.token.toLowerCase(), version: p.version }))}`;

// a stored policy on any other chain is never served as a payable destination (FR-OPS-8 environment pinning)
function toPolicy(r: Record<string, unknown>): SettlementPolicy {
  if (Number(r.chain_id) !== POLICY_CHAIN_ID) throw new HttpError(500, "A stored receiving policy names an unsupported network.");
  return policyFrom(r);
}
const policyFrom = (r: Record<string, unknown>): SettlementPolicy => ({
  version: Number(r.version), chainId: whitechainSepolia.id, token: String(r.token_address), recipient: String(r.recipient),
  policyHash: String(r.policy_hash), approvedBy: String(r.approved_by), approvalWallet: String(r.approval_wallet),
  v1Obligations: r.v1_obligations === true, approvedAt: Number(r.created_at),
});

const POLICY_COLUMNS = "version, chain_id, token_address, recipient, policy_hash, approved_by, approval_wallet, v1_obligations, created_at::text";

/** The workspace's current policy, or null before activation (FR-BIZ-5: collection starts only with one). */
/** Owners see the approving wallet in full; other roles a short form (round 3, review S-L2: an approval wallet is an
 *  Owner's security credential, not team information). */
const shownTo = (ctx: AuthContext) => (p: SettlementPolicy): SettlementPolicy =>
  ctx.role === "owner" ? p : { ...p, approvalWallet: `${p.approvalWallet.slice(0, 6)}...${p.approvalWallet.slice(-4)}` };

export async function currentPolicy(ctx: AuthContext): Promise<SettlementPolicy | null> {
  requireScope(ctx, "account:read");
  const [row] = await query(`SELECT ${POLICY_COLUMNS} FROM wf_settlement_policies WHERE business_id = $1 ORDER BY version DESC LIMIT 1`, [ctx.businessId]);
  return row ? shownTo(ctx)(toPolicy(row)) : null;
}

/** Every version, newest first (immutable history). */
export async function policyHistory(ctx: AuthContext): Promise<SettlementPolicy[]> {
  requireScope(ctx, "account:read");
  return (await query(`SELECT ${POLICY_COLUMNS} FROM wf_settlement_policies WHERE business_id = $1 ORDER BY version DESC`, [ctx.businessId])).map(toPolicy).map(shownTo(ctx));
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
  const hash = policyHash({ businessId: ctx.businessId, version, token: POLICY_TOKEN, recipient });
  const nonce = generateSiweNonce();
  const expiresAt = now + PROOF_TTL_MS;
  const message = createSiweMessage({
    domain: origin.host,
    address: recipient,
    statement: `Whiteflow receiving-wallet proof: this wallet will receive USDT for "${promptSafe(biz.display_name)}" on Whitechain Testnet. It proves control of this wallet only; it moves no funds.`,
    uri: origin.origin,
    version: "1",
    chainId: whitechainSepolia.id,
    nonce,
    issuedAt: new Date(now),
    expirationTime: new Date(expiresAt),
    resources: [`urn:whiteflow:business:${ctx.businessId}`, `urn:whiteflow:token:${POLICY_TOKEN}`, `urn:whiteflow:policy:${hash}`],
  });
  // prune unused challenges a day past expiry (round 2, L5); used ones stay: policy versions reference them
  await query("DELETE FROM wf_challenges WHERE consumed_at IS NULL AND expires_at < $1", [now - 24 * 60 * 60 * 1000]);
  await query(
    `INSERT INTO wf_challenges (nonce, purpose, principal_id, business_id, address, chain_id, payload, message, created_at, expires_at)
     VALUES ($1, 'receiving', $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [nonce, ctx.principalId, ctx.businessId, recipient.toLowerCase(), POLICY_CHAIN_ID, JSON.stringify({ proposedVersion: version, token: POLICY_TOKEN, policyHash: hash }), message, now, expiresAt],
  );
  return { nonce, message, expiresAt, recipient, version, policyHash: hash, chainId: whitechainSepolia.id, token: POLICY_TOKEN };
}

type Challenge = { nonce: string; purpose: string; principal_id: string | null; business_id: string | null; address: string; message: string; payload: Record<string, unknown>; expires_at: string; consumed_at: string | null };
async function challenge(nonce: unknown, purpose: "receiving" | "approval", businessId: string, now: number): Promise<Challenge> {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9]{8,128}$/.test(nonce)) throw new HttpError(409, EXPIRED); // viem's SIWE nonces are 96 chars
  const [c] = await query<Challenge>(
    "SELECT nonce, purpose, principal_id, business_id, address, message, payload, expires_at::text, consumed_at::text FROM wf_challenges WHERE nonce = $1",
    [nonce],
  );
  if (!c || c.purpose !== purpose || c.business_id !== businessId || c.consumed_at !== null || Number(c.expires_at) <= now) throw new HttpError(409, EXPIRED);
  return c;
}

const NOT_ENROLLED =
  "Approve with an enrolled approval wallet for this workspace. A wallet you linked later must first be endorsed by an enrolled approval wallet of an Owner (Settings, Approval wallets).";

/** H1: may this Owner approve with `wallet`? Only an enrolled approval wallet of theirs, or any of their Privy wallets
 *  for the workspace's first activation (no policy, none enrolled: that activation pins it). SQL_ACTIVATE re-checks. */
async function approvalWalletAllowed(businessId: string, principalId: string, wallet: string): Promise<boolean> {
  const [r] = await query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM wf_approval_wallets WHERE business_id = $1 AND principal_id = $2 AND wallet = $3 AND revoked_at IS NULL)
       OR (NOT EXISTS (SELECT 1 FROM wf_approval_wallets WHERE business_id = $1)
           AND NOT EXISTS (SELECT 1 FROM wf_settlement_policies WHERE business_id = $1)) AS ok`,
    [businessId, principalId, wallet],
  );
  return r?.ok === true;
}

/** Step 2 (Owner): the approval challenge for a pending proof, to be signed by `wallet`, which must be one Privy
 *  verified for this Owner and (H1) one of their enrolled approval wallets. Shows the exact terms approved. */
export async function issueOwnerApproval(ctx: AuthContext, input: { proofNonce: unknown; wallet: unknown }, now = Date.now()) {
  ownerCtx(ctx);
  const proof = await challenge(input.proofNonce, "receiving", ctx.businessId, now);
  if (typeof input.wallet !== "string" || !isAddress(input.wallet, { strict: false })) throw new HttpError(400, "Choose the wallet you approve with.");
  const wallet = input.wallet.toLowerCase();
  const [mine] = await query("SELECT 1 FROM wf_principal_wallets WHERE principal_id = $1 AND address = $2", [ctx.principalId, wallet]);
  if (!mine) throw new HttpError(403, "Approve with a wallet linked to your Whiteflow sign-in. Link one in the sign-in dialog, then sign in again.");
  if (!(await approvalWalletAllowed(ctx.businessId, ctx.principalId, wallet))) throw new HttpError(403, NOT_ENROLLED);
  await sharedRateLimit(`wf-challenge:${ctx.principalId}`, CHALLENGES_PER_MINUTE, 60_000, "closed");
  const origin = publicOrigin();
  const [biz] = await query<{ display_name: string }>("SELECT display_name FROM wf_businesses WHERE id = $1", [ctx.businessId]);
  const version = Number(proof.payload.proposedVersion);
  const nonce = generateSiweNonce();
  const expiresAt = now + APPROVAL_TTL_MS;
  // EIP-4361 like the proof (review L2): the wallet checks the domain and URI, so a phishing site can't reuse it
  const message = createSiweMessage({
    domain: origin.host,
    address: getAddress(wallet),
    statement: `Whiteflow: approve receiving policy version ${version} for "${promptSafe(biz.display_name)}": pay out to ${getAddress(proof.address)} in USDT ${getAddress(POLICY_TOKEN)} on Whitechain Testnet. Signing approves where this workspace is paid; it moves no funds.`,
    uri: origin.origin,
    version: "1",
    chainId: whitechainSepolia.id,
    nonce,
    issuedAt: new Date(now),
    expirationTime: new Date(expiresAt),
    resources: [`urn:whiteflow:business:${ctx.businessId}`, `urn:whiteflow:policy:${String(proof.payload.policyHash)}`, `urn:whiteflow:proof:${proof.nonce}`],
  });
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

/** CON-11: does this wallet carry V1 Capital obligations (an advance or an outstanding invoice claim; capital.ts
 *  v1Obligations)? A failed read throws, and activation refuses (503). */
export type ObligationsRead = (recipient: Address) => Promise<boolean>;
export const readV1Obligations: ObligationsRead = (recipient) => v1Obligations(recipient);

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
      -- H1: the approver is an enrolled approval wallet of this Owner, or this is the first activation (none enrolled)
      AND (EXISTS (SELECT 1 FROM wf_approval_wallets WHERE business_id = $1 AND principal_id = $2 AND wallet = $11 AND revoked_at IS NULL)
           OR ((SELECT v FROM cur) = 0 AND NOT EXISTS (SELECT 1 FROM wf_approval_wallets WHERE business_id = $1)))
  ), used AS (
    UPDATE wf_challenges SET consumed_at = $6 WHERE nonce IN ($4, $5) AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM ok) RETURNING nonce
  ), pol AS (
    INSERT INTO wf_settlement_policies (business_id, version, chain_id, token_address, recipient, policy_hash, approved_by, proof_nonce,
                                        approval_nonce, approval_wallet, v1_obligations, created_at)
    SELECT $1, $3::int + 1, $7, $9, $8, $10, $2, $4, $5, $11, $12, $6 WHERE (SELECT count(*) FROM used) = 2
    RETURNING ${POLICY_COLUMNS}
  ), pin AS (
    -- H1: the first activation pins its approval wallet (later ones need an endorsement: approval-wallets.ts)
    INSERT INTO wf_approval_wallets (business_id, wallet, principal_id, enrolled_at, endorsed_by)
    SELECT $1, $11, $2, $6, NULL FROM pol WHERE (SELECT v FROM cur) = 0 ON CONFLICT DO NOTHING
    RETURNING wallet
  ), pinn AS (
    -- round 3 (review S-M1): the pin is announced to every Owner, the actor included
    INSERT INTO wf_notifications (id, business_id, principal_id, kind, detail, created_at)
    SELECT $13 || '_pin_' || m.principal_id, $1, m.principal_id, 'approval_wallet.pinned', jsonb_build_object('wallet', $11::text), $6
    FROM wf_memberships m WHERE m.business_id = $1 AND m.role = 'owner' AND EXISTS (SELECT 1 FROM pin)
  ), n AS (
    INSERT INTO wf_notifications (id, business_id, principal_id, kind, detail, created_at)
    SELECT $13 || '_' || m.principal_id, $1, m.principal_id, 'policy.activated', jsonb_build_object('version', $3::int + 1, 'policyHash', $10::text), $6
    FROM wf_memberships m WHERE m.business_id = $1 AND m.role = 'owner' AND m.principal_id <> $2 AND EXISTS (SELECT 1 FROM pol)
  ), a AS (
    INSERT INTO wf_audit_events (id, business_id, actor_principal_id, role, source, credential_id, request_id, action, target, version_hash, outcome, detail, at)
    SELECT $14, $1, $2, 'owner', 'session', $15, $16, 'policy.activate', $8, $10, 'ok',
           jsonb_build_object('version', $3::int + 1, 'approvalWallet', $11::text, 'v1Obligations', $12::boolean), $6 FROM pol
  ), idem AS (
    INSERT INTO wf_idempotency (business_id, principal_id, operation, key, request_hash, response, created_at)
    SELECT $1, $2, 'policy.activate', $17, $18, to_jsonb(p), $6 FROM pol p
  )
  SELECT (SELECT count(*) FROM actor)::int AS is_owner, p.* FROM (SELECT 1) one LEFT JOIN pol p ON true`;

/** Step 3 (Owner): verifies both signatures, re-checks everything inside one statement and inserts the next version. */
export async function activatePolicy(
  ctx: AuthContext,
  input: { proofNonce: unknown; proofSignature: unknown; approvalNonce: unknown; approvalSignature: unknown; expectedCurrentVersion: unknown; idempotencyKey: unknown },
  { now = Date.now(), obligations = readV1Obligations }: { now?: number; obligations?: ObligationsRead } = {},
): Promise<SettlementPolicy> {
  requireScope(ctx, "policy:activate");
  if (!ctx.principalId || ctx.source !== "session") throw new Forbidden();
  const expected = Number(input.expectedCurrentVersion);
  if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, "expectedCurrentVersion must be the version you saw (0 for none).");
  // FR-AUTH-4 (review L3): the same request again returns the version it created, before the consumed challenges are
  // checked; the same key for a different request is 409
  const slot = {
    businessId: ctx.businessId, principalId: ctx.principalId, operation: "policy.activate", key: idempotencyKey(input.idempotencyKey),
    hash: requestHash({ proofNonce: input.proofNonce, approvalNonce: input.approvalNonce, expectedCurrentVersion: expected }),
  };
  const stored = await storedAnswer<Record<string, unknown>>(slot);
  if (stored !== undefined) return toPolicy(stored);
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
    approval.address, v1Obligations, newId("ntf"), newId("aud"), ctx.credentialId, ctx.requestId, slot.key, slot.hash,
  ]).catch(async (err) => {
    const e = err as { code?: unknown; constraint?: unknown };
    if (e?.code === "23505" && e.constraint === "wf_idempotency_pkey") return null; // a concurrent duplicate won: its answer below
    if (e?.code === "23505") throw new HttpError(409, "The receiving policy changed at the same time. Reload and try again.");
    throw concurrencyConflict(err);
  });
  const row = rows?.[0];
  if (!row || row.version === null || row.version === undefined) {
    // nothing inserted: a concurrent duplicate of this request may have won (same key, same hash) → its answer
    const raced = await storedAnswer<Record<string, unknown>>(slot);
    if (raced !== undefined) return toPolicy(raced);
  }
  if (!row || row.is_owner === 0) throw new Forbidden();
  if (row.version === null || row.version === undefined) throw new HttpError(409, "The receiving policy changed, or this confirmation expired. Reload and start again.");
  return toPolicy(row);
}
