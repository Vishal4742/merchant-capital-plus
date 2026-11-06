// Server-only vouchers (SRS FR-GW-12): percent or fixed USDT off, expiry, usage limit, minimum amount. Redemptions are
// counted on our server: reserved when a payer applies a code, counted once when the session is paid. Each code is
// mirrored to Arkiv as mcplus.voucher.v1 with only an HMAC of the code (FR-ARK-4: no plain code, no personal data).
import { createHmac } from "node:crypto";
import { ExpirationTime } from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import { defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { formatUnits, type Address } from "viem";
import { arkivClients, redactArkivError } from "../arkiv.ts";
import { SESSION_TTL_MS } from "../sessions.ts";
import { parseUsdt } from "../usdt.ts";
import { checkoutOf } from "./checkouts.ts";
import { query, transaction } from "./db.ts";
import { QUOTE_TTL_MS } from "./quotes.ts";
import { HttpError, MAX_PAYMENT, MIN_PAYMENT, futureTime, newId, usdtField } from "./http.ts";

export type VoucherKind = "percent" | "fixed";
export interface Voucher {
  id: string;
  merchant: string; // lowercase address
  code: string; // uppercase
  kind: VoucherKind;
  value: bigint; // whole percent, or USDT units
  expiresAt: number;
  maxRedemptions: number;
  timesRedeemed: number;
  minAmount: bigint | null;
  active: boolean;
  arkivEntityKey: string | null;
  arkivTxHash: string | null; // the Arkiv create tx (batch 018)
  arkivError: string | null; // why the last mirror attempt failed: a fixed, secret-free reason
  createdAt: number;
}
export type ApplyResult = { ok: true; discount: bigint; usdtAmount: bigint } | { ok: false; reason: string };

const VOUCHER_TYPE = "mcplus.voucher.v1";
const VoucherEntity = defineSchema(VOUCHER_TYPE, {
  type: str().indexed(),
  merchant: str().indexed(),
  code_hash: str().indexed(),
  kind: str().indexed(),
  value: str(),
  expires_at: u64().indexed(),
});
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const MAX_REDEMPTIONS = 100_000;
const LINKS_AND_PAGES_ONLY = "Vouchers work on payment links and pages only.";
/** How long a hold counts against the usage limit: the checkout session's life plus a grace for a payment signed just
 *  before it expired that is still settling (security R2-L2, S2: the relayer accepts signatures valid for up to 900 s).
 *  Measured from the checkout's start, never from a re-apply. A frozen hold also counts for FREEZE_MS after its claim. */
export const HOLD_MS = SESSION_TTL_MS + 15 * 60_000;
/** How long a claim (claimAmountDue) counts as mid-payment: the relayer's 15-min signature window (lib/pay.ts refuses a
 *  longer validBefore) + 5 min. After it the claimed payment can't land, so an abandoned claim stops holding a voucher
 *  use (F2) or a single-use link (M3). A paid checkout's frozen hold counts until confirmRedemption counts it. */
export const FREEZE_MS = 20 * 60_000;
const BEING_PAID = "This checkout is being paid.";
const PAID_ONCE = "This payment link has already been paid.";

type VoucherRow = { id: string; merchant: string; code: string; kind: VoucherKind; value: string; expires_at: string; max_redemptions: number; times_redeemed: number; min_amount: string | null; active: boolean; arkiv_entity_key: string | null; arkiv_tx_hash: string | null; arkiv_error: string | null; created_at: string };
const COLUMNS = "id, merchant, code, kind, value::text, expires_at::text, max_redemptions, times_redeemed, min_amount::text, active, arkiv_entity_key, arkiv_tx_hash, arkiv_error, created_at::text";
const fromRow = (r: VoucherRow): Voucher => ({
  id: r.id,
  merchant: r.merchant,
  code: r.code,
  kind: r.kind,
  value: BigInt(r.value),
  expiresAt: Number(r.expires_at),
  maxRedemptions: Number(r.max_redemptions),
  timesRedeemed: Number(r.times_redeemed),
  minAmount: r.min_amount === null ? null : BigInt(r.min_amount),
  active: r.active,
  arkivEntityKey: r.arkiv_entity_key,
  arkivTxHash: r.arkiv_tx_hash,
  arkivError: r.arkiv_error,
  createdAt: Number(r.created_at),
});

const usdt = (units: bigint) => formatUnits(units, 6);
const formatValue = (kind: VoucherKind, value: bigint) => (kind === "percent" ? value.toString() : usdt(value));

export const voucherJson = (v: Voucher) => ({
  id: v.id,
  code: v.code,
  kind: v.kind,
  value: formatValue(v.kind, v.value),
  expires_at: new Date(v.expiresAt).toISOString(),
  max_redemptions: v.maxRedemptions,
  times_redeemed: v.timesRedeemed,
  min_amount: v.minAmount === null ? null : usdt(v.minAmount),
  active: v.active,
  arkiv_status: v.arkivEntityKey ? ("on_arkiv" as const) : ("not_on_arkiv" as const),
  arkiv_entity_key: v.arkivEntityKey,
  arkiv_tx_hash: v.arkivTxHash,
  arkiv_error: v.arkivEntityKey ? null : (arkivConfigProblem() ?? v.arkivError), // a server-wide setting problem first
  created_at: new Date(v.createdAt).toISOString(),
});

/** hex HMAC-SHA256(secret, merchant + ":" + CODE): what Arkiv holds instead of the code. */
export const codeHash = (merchant: string, code: string, secret: string) => createHmac("sha256", secret).update(`${merchant.toLowerCase()}:${code}`).digest("hex");

function percentValue(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value.trim())) throw new HttpError(400, 'value must be a whole percent like "10".');
  const pct = BigInt(value.trim());
  if (pct < 1n || pct > 100n) throw new HttpError(400, "value must be between 1 and 100 percent.");
  return pct;
}

function fixedValue(value: unknown): bigint {
  let units: bigint;
  try {
    units = parseUsdt(typeof value === "string" ? value : "");
  } catch {
    throw new HttpError(400, 'value must be a USDT amount like "5.00" (at most 6 decimals).');
  }
  if (units <= 0n || units > MAX_PAYMENT) throw new HttpError(400, "value must be more than 0 and at most 1,000 USDT.");
  return units;
}

function maxRedemptionsField(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_REDEMPTIONS) throw new HttpError(400, "max_redemptions must be a whole number from 1 to 100,000.");
  return n;
}

/** The POST body checked: code, kind, value, expires_at, max_redemptions, min_amount?. */
export function voucherInput(body: Record<string, unknown>, now = Date.now()) {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) throw new HttpError(400, "code must be 3 to 32 letters, digits, - or _.");
  const kind = body.kind;
  if (kind !== "percent" && kind !== "fixed") throw new HttpError(400, 'kind must be "percent" or "fixed".');
  const value = kind === "percent" ? percentValue(body.value) : fixedValue(body.value);
  const expiresAt = futureTime(body.expires_at, "expires_at", now);
  const maxRedemptions = maxRedemptionsField(body.max_redemptions);
  const hasMin = body.min_amount !== undefined && body.min_amount !== null && body.min_amount !== "";
  const minAmount = hasMin ? usdtField(body.min_amount, "min_amount") : null;
  return { code, kind: kind as VoucherKind, value, expiresAt, maxRedemptions, minAmount };
}

type Mirror = { entityKey: string; txHash: string | null } | { error: string };
const MAX_REASON = 200;
// outlasts one attempt: the existing-entity query plus the SDK's 180 s receipt wait (021 review M1: 3 min was a tie)
const PUBLISH_LEASE_MS = 5 * 60_000;

/** Why this server can't mirror vouchers to Arkiv at all, or null: checks only that the settings exist (names, never
 *  values). Shown on every read of a voucher that isn't on Arkiv, so a misconfigured server is visible at once. */
export function arkivConfigProblem(env: Record<string, string | undefined> = process.env): string | null {
  if (!env.VOUCHER_HASH_SECRET?.trim()) return "VOUCHER_HASH_SECRET isn't set on this server.";
  if (!env.ARKIV_ACCESS_KEY?.trim()) return "ARKIV_ACCESS_KEY isn't set on this server.";
  if (!env.ARKIV_PRIVATE_KEY?.trim()) return "ARKIV_PRIVATE_KEY isn't set on this server.";
  return null;
}

/** Writes the Arkiv mirror and returns the outcome; a failure's reason is a fixed string or the redacted SDK error. */
async function mirrorToArkiv(v: Voucher): Promise<Mirror> {
  const problem = arkivConfigProblem();
  if (problem) return { error: problem };
  const secret = process.env.VOUCHER_HASH_SECRET as string;
  let clients;
  try {
    clients = arkivClients();
  } catch (err) {
    // arkivClients' own messages name no value; redacted and capped anyway (batch 018 review L2)
    const reason = err instanceof Error ? err.message : "Arkiv isn't configured on this server.";
    return { error: redactArkivError(reason, process.env.ARKIV_ACCESS_KEY).slice(0, MAX_REASON) };
  }
  const hash = codeHash(v.merchant, v.code, secret);
  try {
    // 021 review M1: an earlier write that timed out may still have landed: adopt it rather than write a second entity.
    // ownedBy: code_hash is public on Arkiv, so only our writer's entities count. A failed query writes nothing.
    // ponytail: a timed-out tx landing after this query still duplicates; hold the lease on a timeout if that's seen.
    const found = await clients.reader.select({ $key: true }).from(VoucherEntity).where(eq("code_hash", hash)).ownedBy(clients.address).limit(1).fetch();
    const existing = found.entities[0]?.$key;
    if (existing) return { entityKey: existing, txHash: null };
    const values = { type: VOUCHER_TYPE, merchant: v.merchant, code_hash: hash, kind: v.kind, value: formatValue(v.kind, v.value), expires_at: u64(BigInt(Math.floor(v.expiresAt / 1000))) }; // unix s, like the chain
    const created = await clients.writer.createEntity(VoucherEntity, values, { expiration: ExpirationTime.atDate(new Date(v.expiresAt)) });
    return { entityKey: created.entityKey, txHash: typeof created.txHash === "string" ? created.txHash : null };
  } catch (err) {
    return { error: `Arkiv refused or timed out: ${redactArkivError(err, process.env.ARKIV_ACCESS_KEY)}`.slice(0, MAX_REASON) };
  }
}

// the attempt is over: frees the lease only if this attempt still holds it (021 review M1: a slow attempt whose lease
// lapsed must not free the next attempt's)
const releaseLease = (param: string) => `arkiv_attempted_at = CASE WHEN arkiv_attempted_at = ${param} THEN NULL ELSE arkiv_attempted_at END`;

/** Stores a mirror attempt's outcome on the voucher (batch 018: never silent) and returns the updated voucher. `lease`
 *  is the arkiv_attempted_at this attempt set, or null when nothing was attempted. */
async function recordMirror(v: Voucher, mirror: Mirror, lease: number | null): Promise<Voucher> {
  if ("error" in mirror) {
    console.error(`voucher ${v.id} not mirrored to Arkiv: ${mirror.error}`);
    // no lease = a missing setting: the server's state, not this voucher's, shown on every read (arkivConfigProblem)
    if (lease === null) return { ...v, arkivError: mirror.error };
    await query(`UPDATE app_gw_vouchers SET arkiv_error = $2, ${releaseLease("$3")} WHERE id = $1 AND arkiv_entity_key IS NULL`, [v.id, mirror.error, lease]);
    return { ...v, arkivError: mirror.error };
  }
  await query(`UPDATE app_gw_vouchers SET arkiv_entity_key = $2, arkiv_tx_hash = $3, arkiv_error = NULL, ${releaseLease("$4")} WHERE id = $1`, [v.id, mirror.entityKey, mirror.txHash, lease]);
  return { ...v, arkivEntityKey: mirror.entityKey, arkivTxHash: mirror.txHash, arkivError: null };
}

/** The merchant's "Publish to Arkiv": retries the mirror of a voucher that isn't on Arkiv yet. Idempotent: a voucher
 *  already on Arkiv is returned as is (no second entity). 404 for another merchant's id; 409 once it has expired. */
export async function publishVoucher(merchant: Address, id: string, now = Date.now()): Promise<Voucher> {
  const rows = await query<VoucherRow>(`SELECT ${COLUMNS} FROM app_gw_vouchers WHERE id = $1 AND merchant = $2`, [id, merchant.toLowerCase()]);
  if (!rows[0]) throw new HttpError(404, "No such voucher.");
  const voucher = fromRow(rows[0]);
  if (voucher.arkivEntityKey) return voucher;
  if (voucher.expiresAt <= now) throw new HttpError(409, "This voucher has expired, so it isn't published.");
  if (!voucher.active) throw new HttpError(409, "This voucher is deactivated, so it isn't published."); // 018 review L1
  const problem = arkivConfigProblem();
  if (problem) return { ...voucher, arkivError: problem }; // nothing to attempt: no lease, no write
  // 018 review M1: one attempt at a time. The lease outlasts one Arkiv write (receipt wait included); the attempt
  // releases it when it ends, so only a crashed attempt makes the next publish wait PUBLISH_LEASE_MS.
  const leased = await query(
    "UPDATE app_gw_vouchers SET arkiv_attempted_at = $2 WHERE id = $1 AND arkiv_entity_key IS NULL AND (arkiv_attempted_at IS NULL OR arkiv_attempted_at <= $3) RETURNING id",
    [id, now, now - PUBLISH_LEASE_MS],
  );
  if (leased.length === 0) throw new HttpError(409, "Publishing to Arkiv already, try again in a minute.");
  return recordMirror(voucher, await mirrorToArkiv(voucher), now);
}

/** Creates the voucher (409 if the merchant already has the code), then mirrors it to Arkiv. */
export async function createVoucher(merchant: Address, input: ReturnType<typeof voucherInput>, now = Date.now()): Promise<Voucher> {
  const lease = arkivConfigProblem() ? null : now;
  const rows = await query<VoucherRow>(
    `INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, min_amount, created_at, arkiv_attempted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (merchant, code) DO NOTHING RETURNING ${COLUMNS}`,
    // create's own mirror attempt holds the publish lease from the start (018 review M1); none when nothing will be tried
    [newId("vch"), merchant.toLowerCase(), input.code, input.kind, input.value.toString(), input.expiresAt, input.maxRedemptions, input.minAmount?.toString() ?? null, now, lease],
  );
  if (!rows[0]) throw new HttpError(409, `You already have a voucher with the code ${input.code}.`);
  const voucher = fromRow(rows[0]);
  return recordMirror(voucher, await mirrorToArkiv(voucher), lease);
}

export async function listVouchers(merchant: Address): Promise<Voucher[]> {
  const rows = await query<VoucherRow>(`SELECT ${COLUMNS} FROM app_gw_vouchers WHERE merchant = $1 ORDER BY created_at DESC, id`, [merchant.toLowerCase()]);
  return rows.map(fromRow);
}

/** True if the merchant had this voucher (it is now inactive). */
export async function deactivateVoucher(merchant: Address, id: string): Promise<boolean> {
  const rows = await query("UPDATE app_gw_vouchers SET active = FALSE WHERE id = $1 AND merchant = $2 RETURNING id", [id, merchant.toLowerCase()]);
  return rows.length === 1;
}

function refusal(v: Voucher, base: bigint, now: number): string | null {
  if (!v.active) return "That code isn't valid.";
  if (v.expiresAt <= now) return "That code has expired.";
  if (v.timesRedeemed >= v.maxRedemptions) return "That code has been used up.";
  if (v.minAmount !== null && base < v.minAmount) return `That code needs an order of at least ${usdt(v.minAmount)} USDT.`;
  return null;
}

/**
 * Reserves `code` for a link or page session (re-applying replaces the session's previous code). The discount is taken
 * off the checkout's recorded amount, which `usdtAmount` must equal (so a discount is never stacked on a discount).
 */
export async function applyVoucher(merchant: string, code: string, sessionId: string, usdtAmount: bigint, now = Date.now()): Promise<ApplyResult> {
  const checkout = await checkoutOf(sessionId);
  if (!checkout || checkout.merchant !== merchant.toLowerCase()) return { ok: false, reason: LINKS_AND_PAGES_ONLY };
  if (checkout.paidAt !== null) return { ok: false, reason: "This checkout is already paid." };
  // S1: the pay route claimed the price; the upsert below re-checks this, so a claim racing this read still wins
  const frozen = await query("SELECT 1 FROM app_gw_redemptions WHERE session_id = $1 AND frozen_at > $2", [sessionId, now - FREEZE_MS]);
  if (frozen.length) return { ok: false, reason: BEING_PAID };
  // R2-M2 + F4: a fiat checkout lives as long as its 10-min quote lock, USD/USDT as long as the 30-min session
  const ttl = checkout.fx && checkout.fx.currency !== "USD" && checkout.fx.currency !== "USDT" ? QUOTE_TTL_MS : SESSION_TTL_MS;
  if (now - checkout.createdAt >= ttl) return { ok: false, reason: "This checkout has expired." };
  if (usdtAmount !== checkout.usdtAmount) return { ok: false, reason: "The amount doesn't match this checkout." };
  const normalized = code.trim().toUpperCase();
  if (!CODE_RE.test(normalized)) return { ok: false, reason: "That code isn't valid." };
  const rows = await query<VoucherRow>(`SELECT ${COLUMNS} FROM app_gw_vouchers WHERE merchant = $1 AND code = $2`, [checkout.merchant, normalized]);
  if (!rows[0]) return { ok: false, reason: "That code isn't valid." };
  const voucher = fromRow(rows[0]);
  const base = checkout.usdtAmount;
  const refused = refusal(voucher, base, now);
  if (refused) return { ok: false, reason: refused };
  const discount = voucher.kind === "percent" ? (base * voucher.value) / 100n : voucher.value; // floor: the merchant's favour
  const total = base - discount;
  if (total < MIN_PAYMENT) return { ok: false, reason: "The total after this code would be under 1 USDT." };
  // A hold counts against the usage limit for HOLD_MS from its checkout's start (security review H1: without this,
  // one code with 1 use could be applied to many open checkouts and all of them paid at the discount), and a frozen
  // one for FREEZE_MS after its claim, or until it is confirmed once its checkout is paid (F2). The advisory lock runs
  // first in the same transaction, so the insert's snapshot sees every other session's committed hold.
  const [, reserved] = await transaction([
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [voucher.id] },
    {
      text: `INSERT INTO app_gw_redemptions (session_id, voucher_id, discount, usdt_amount, created_at)
             SELECT $1, v.id, $3, $4, $5 FROM app_gw_vouchers v
             WHERE v.id = $2 AND v.times_redeemed + (
               SELECT count(*) FROM app_gw_redemptions r
               WHERE r.voucher_id = v.id AND r.confirmed_at IS NULL AND r.session_id <> $1 AND (r.created_at > $6 OR r.frozen_at > $7
                 OR (r.frozen_at IS NOT NULL AND EXISTS (SELECT 1 FROM app_gw_checkouts p WHERE p.session_id = r.session_id AND p.paid_at IS NOT NULL)))
             ) < v.max_redemptions
             AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)
             ON CONFLICT (session_id) DO UPDATE SET voucher_id = EXCLUDED.voucher_id, discount = EXCLUDED.discount,
               usdt_amount = EXCLUDED.usdt_amount, created_at = EXCLUDED.created_at, frozen_at = NULL
             WHERE app_gw_redemptions.confirmed_at IS NULL AND (app_gw_redemptions.frozen_at IS NULL OR app_gw_redemptions.frozen_at <= $7)
               AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)
             RETURNING session_id`,
      // NOT EXISTS (… paid_at …) in both places (batch 012 review N2): the read above can be stale if the payment was
      // recorded in between, so the statement itself refuses a paid checkout.
      // the hold starts when the checkout did ($5), so re-applying can't keep a code locked (R2-M2); a re-apply after
      // the freeze lapsed starts an unfrozen hold (its claimed payment can no longer land)
      params: [sessionId, voucher.id, discount.toString(), total.toString(), checkout.createdAt, now - HOLD_MS, now - FREEZE_MS],
    },
  ]);
  if (reserved.length !== 1) return { ok: false, reason: "That code has been used up." }; // (a paid checkout returned above)
  return { ok: true, discount, usdtAmount: total };
}

/**
 * Read-only: what a link or page session costs now: the live, frozen or confirmed voucher hold's total, else the
 * checkout's amount; null for a shop's own session (its amount is the session's). For display only; the pay route
 * charges `claimAmountDue` instead (security R2-M1, S1).
 */
export async function amountDue(sessionId: string, now = Date.now()): Promise<bigint | null> {
  const checkout = await checkoutOf(sessionId);
  if (!checkout) return null;
  const rows = await query<{ usdt_amount: string }>(
    "SELECT usdt_amount::text FROM app_gw_redemptions WHERE session_id = $1 AND (confirmed_at IS NOT NULL OR frozen_at > $3 OR created_at > $2)",
    [sessionId, now - HOLD_MS, now - FREEZE_MS],
  );
  return rows[0] ? BigInt(rows[0].usdt_amount) : checkout.usdtAmount;
}

/**
 * The pay route's price (security S1) and claim (M3), in one transaction under a per-link lock:
 *   1. claims the checkout (claimed_at = now), refused with HttpError 410 when it is paid, or when it is a single-use
 *      link's and another checkout of that link is paid or was claimed within FREEZE_MS (a page or a reusable link
 *      never blocks another checkout);
 *   2. only then freezes the session's live voucher hold and returns its total, so no re-apply can switch the code
 *      while the payment relays; no live hold → the checkout's amount (nothing frozen).
 * Null for a shop's own session. Idempotent in price: a second claim returns the same amount. Every claim moves both
 * claimed_at and the hold's frozen_at to now (batch 015 review M1): a later attempt relays a new signature, valid up to
 * 15 min after it, so the freeze must cover the latest one, not the first. Relay exactly this amount and pass it to
 * `confirmRedemption`; on a 410 relay nothing (and don't call releaseHold: the claim was never made).
 */
export async function claimAmountDue(sessionId: string, now = Date.now()): Promise<bigint | null> {
  const checkout = await checkoutOf(sessionId);
  if (!checkout) return null;
  // the lock serializes claims of one link or page: under READ COMMITTED the claim's snapshot is taken after it, so it
  // sees every other checkout's committed claim (two checkouts claiming at once: one wins). One statement claims and
  // freezes, so a refused claim freezes nothing.
  // ponytail: the sibling check sees a paid checkout only once onSessionPaid has run markCheckoutPaid for it; if that
  // call failed or ran late, the sibling relies on its claimed_at until FREEZE_MS ends. A retry of onSessionPaid (the
  // pay route re-announces) closes the gap; a DB-level paid flag fed by the chain would close it for good.
  const [, rows] = await transaction([
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [`link:${checkout.refId}`] },
    {
      text: `WITH claim AS (
               UPDATE app_gw_checkouts c SET claimed_at = $2
               WHERE c.session_id = $1 AND c.paid_at IS NULL AND NOT EXISTS (
                 SELECT 1 FROM app_gw_checkouts o JOIN app_gw_links l ON l.id = o.ref_id
                 WHERE c.kind = 'link' AND o.kind = 'link' AND o.ref_id = c.ref_id AND l.single_use AND o.session_id <> $1
                   AND (o.paid_at IS NOT NULL OR o.claimed_at > $3))
               RETURNING c.session_id
             ), frozen AS (
               UPDATE app_gw_redemptions r SET frozen_at = $2
               FROM claim WHERE r.session_id = claim.session_id AND r.confirmed_at IS NULL AND (r.frozen_at > $3 OR r.created_at > $4)
               RETURNING r.usdt_amount
             )
             SELECT (SELECT usdt_amount::text FROM frozen) AS usdt_amount FROM claim`,
      params: [sessionId, now, now - FREEZE_MS, now - HOLD_MS],
    },
  ]);
  const claimed = rows[0] as { usdt_amount: string | null } | undefined;
  if (!claimed) throw new HttpError(410, PAID_ONCE);
  return claimed.usdt_amount === null ? checkout.usdtAmount : BigInt(claimed.usdt_amount);
}

/**
 * Gives back an UNPAID checkout's claim: clears claimed_at (another checkout of a single-use link may then claim) and
 * unfreezes its voucher hold, so a failed payment doesn't keep a use locked. True if a hold was unfrozen.
 * Call it ONLY from the attempt that made the claim (under its lock), and only when nothing can have been sent
 * (batch-009 review F1, batch-013 P1), in `relaySale`'s result shape (lib/relay.ts):
 *   - the attempt stops before relaySale is called (bad signature, low balance, expired, a too-long approval);
 *   - `{ ok: false }` with neither `unknown` nor `refused`: BUSY (503: refused before sending, rate-limited, or the
 *     connection never opened) or another relayer 4xx ("Nothing was charged");
 *   - `{ ok: false, refused: true }` (the relayer's 422) AND `findPayment` returned exactly null: anyone can call
 *     paySale, so a 422 alone isn't proof the order is unpaid (undefined = the chain read failed: don't release);
 *   - settlePending's "open" branch (the chain shows no payment and the authorization has expired), and only BEFORE
 *     this attempt's own claimAmountDue: releasing after it would drop the claim this attempt is about to relay on.
 * NEVER on `{ ok: false, unknown: true }` (timeout, 5xx, dropped connection: it may have been sent), on `{ ok: true }`,
 * on the pay route's 409s (already being paid, STILL_PENDING), or on a paid checkout: the chain decides then, and the
 * claim and the frozen hold must keep counting. A paid checkout is refused here anyway (F1).
 */
export async function releaseHold(sessionId: string): Promise<boolean> {
  // never on a paid checkout (batch-009 review F1): a late or mistaken release would free a use that was paid for.
  // The checkout row is unclaimed even without a hold, and a hold frozen before 048 (no claimed_at) still unfreezes.
  const rows = await query(
    `WITH released AS (
       UPDATE app_gw_checkouts SET claimed_at = NULL WHERE session_id = $1 AND paid_at IS NULL RETURNING session_id
     )
     UPDATE app_gw_redemptions r SET frozen_at = NULL FROM released
     WHERE r.session_id = released.session_id AND r.confirmed_at IS NULL AND r.frozen_at IS NOT NULL
     RETURNING r.session_id`,
    [sessionId],
  );
  return rows.length === 1;
}

/**
 * The payer removes the code from an open checkout (claude-frontend's DELETE /api/v1/sessions/:id/voucher). One
 * statement: removes the hold only while it isn't being paid (frozen within FREEZE_MS), confirmed, or on a paid
 * checkout, so a claimed price always stands. True if a hold was removed.
 */
export async function removeVoucher(sessionId: string, now = Date.now()): Promise<boolean> {
  const rows = await query(
    `DELETE FROM app_gw_redemptions r
     WHERE r.session_id = $1 AND r.confirmed_at IS NULL AND (r.frozen_at IS NULL OR r.frozen_at <= $2)
       AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)
     RETURNING r.session_id`,
    [sessionId, now - FREEZE_MS],
  );
  return rows.length === 1;
}

/**
 * Called once the session is paid: confirms its reservation and counts one use, in one statement. The redemption row is
 * claimed first (so the same session never counts twice), then the use is counted only while uses remain (so two
 * sessions racing for the last use: one wins). Returns the counted voucher, or null (no reservation, already
 * confirmed, or no uses left).
 */
export async function confirmRedemption(sessionId: string, paidAmount: bigint, now = Date.now()): Promise<{ voucherId: string; code: string } | null> {
  // Holds are counted at apply time, so the last-use guard here only matters for a hold that outlived its session.
  // A hold whose discounted total isn't what was paid (the code was dropped before paying) is never counted.
  // A hold confirms even if the voucher was deactivated or expired after the payer applied it: they signed that price.
  const rows = await query<{ id: string; code: string }>(
    `WITH claimed AS (
       UPDATE app_gw_redemptions SET confirmed_at = $2 WHERE session_id = $1 AND confirmed_at IS NULL AND usdt_amount = $3 RETURNING voucher_id
     )
     UPDATE app_gw_vouchers v SET times_redeemed = v.times_redeemed + 1 FROM claimed
     WHERE v.id = claimed.voucher_id AND v.times_redeemed < v.max_redemptions RETURNING v.id, v.code`,
    [sessionId, now, paidAmount.toString()],
  );
  return rows[0] ? { voucherId: rows[0].id, code: rows[0].code } : null;
}
