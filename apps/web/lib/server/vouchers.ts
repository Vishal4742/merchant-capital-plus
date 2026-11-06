// Server-only vouchers (SRS FR-GW-12): percent or fixed USDT off, expiry, usage limit, minimum amount. Redemptions are
// counted on our server: reserved when a payer applies a code, counted once when the session is paid. Each code is
// mirrored to Arkiv as mcplus.voucher.v1 with only an HMAC of the code (FR-ARK-4: no plain code, no personal data).
import { createHmac } from "node:crypto";
import { ExpirationTime } from "@arkiv-network/sdk";
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
 *  Measured from the checkout's start, never from a re-apply. A frozen hold (being paid) counts until it is confirmed. */
export const HOLD_MS = SESSION_TTL_MS + 15 * 60_000;
const BEING_PAID = "This checkout is being paid.";

type VoucherRow = { id: string; merchant: string; code: string; kind: VoucherKind; value: string; expires_at: string; max_redemptions: number; times_redeemed: number; min_amount: string | null; active: boolean; arkiv_entity_key: string | null; created_at: string };
const COLUMNS = "id, merchant, code, kind, value::text, expires_at::text, max_redemptions, times_redeemed, min_amount::text, active, arkiv_entity_key, created_at::text";
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
  arkiv_entity_key: v.arkivEntityKey,
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

/** Writes the Arkiv mirror; null (and a redacted log line) when it isn't configured or the write fails. */
async function mirrorToArkiv(v: Voucher): Promise<string | null> {
  const secret = process.env.VOUCHER_HASH_SECRET;
  if (!secret) {
    console.error("voucher not mirrored to Arkiv: VOUCHER_HASH_SECRET is missing");
    return null;
  }
  try {
    const { writer } = arkivClients();
    const values = { type: VOUCHER_TYPE, merchant: v.merchant, code_hash: codeHash(v.merchant, v.code, secret), kind: v.kind, value: formatValue(v.kind, v.value), expires_at: u64(BigInt(Math.floor(v.expiresAt / 1000))) }; // unix s, like the chain
    const { entityKey } = await writer.createEntity(VoucherEntity, values, { expiration: ExpirationTime.atDate(new Date(v.expiresAt)) });
    return entityKey;
  } catch (err) {
    console.error(`voucher not mirrored to Arkiv: ${redactArkivError(err, process.env.ARKIV_ACCESS_KEY)}`);
    return null;
  }
}

/** Creates the voucher (409 if the merchant already has the code), then mirrors it to Arkiv. */
export async function createVoucher(merchant: Address, input: ReturnType<typeof voucherInput>, now = Date.now()): Promise<Voucher> {
  const rows = await query<VoucherRow>(
    `INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, min_amount, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (merchant, code) DO NOTHING RETURNING ${COLUMNS}`,
    [newId("vch"), merchant.toLowerCase(), input.code, input.kind, input.value.toString(), input.expiresAt, input.maxRedemptions, input.minAmount?.toString() ?? null, now],
  );
  if (!rows[0]) throw new HttpError(409, `You already have a voucher with the code ${input.code}.`);
  const voucher = fromRow(rows[0]);
  const entityKey = await mirrorToArkiv(voucher);
  if (!entityKey) return voucher;
  await query("UPDATE app_gw_vouchers SET arkiv_entity_key = $2 WHERE id = $1", [voucher.id, entityKey]);
  return { ...voucher, arkivEntityKey: entityKey };
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
  const frozen = await query("SELECT 1 FROM app_gw_redemptions WHERE session_id = $1 AND frozen_at IS NOT NULL", [sessionId]);
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
  // one code with 1 use could be applied to many open checkouts and all of them paid at the discount). The advisory
  // lock runs first in the same transaction, so the insert's snapshot sees every other session's committed hold.
  const [, reserved] = await transaction([
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [voucher.id] },
    {
      text: `INSERT INTO app_gw_redemptions (session_id, voucher_id, discount, usdt_amount, created_at)
             SELECT $1, v.id, $3, $4, $5 FROM app_gw_vouchers v
             WHERE v.id = $2 AND v.times_redeemed + (
               SELECT count(*) FROM app_gw_redemptions r
               WHERE r.voucher_id = v.id AND r.confirmed_at IS NULL AND r.session_id <> $1 AND (r.frozen_at IS NOT NULL OR r.created_at > $6)
             ) < v.max_redemptions
             AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)
             ON CONFLICT (session_id) DO UPDATE SET voucher_id = EXCLUDED.voucher_id, discount = EXCLUDED.discount,
               usdt_amount = EXCLUDED.usdt_amount, created_at = EXCLUDED.created_at
             WHERE app_gw_redemptions.confirmed_at IS NULL AND app_gw_redemptions.frozen_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)
             RETURNING session_id`,
      // NOT EXISTS (… paid_at …) in both places (batch 012 review N2): the read above can be stale if the payment was
      // recorded in between, so the statement itself refuses a paid checkout.
      // the hold starts when the checkout did ($5), so re-applying can't keep a code locked (R2-M2)
      params: [sessionId, voucher.id, discount.toString(), total.toString(), checkout.createdAt, now - HOLD_MS],
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
    "SELECT usdt_amount::text FROM app_gw_redemptions WHERE session_id = $1 AND (confirmed_at IS NOT NULL OR frozen_at IS NOT NULL OR created_at > $2)",
    [sessionId, now - HOLD_MS],
  );
  return rows[0] ? BigInt(rows[0].usdt_amount) : checkout.usdtAmount;
}

/**
 * The pay route's price (security S1): freezes the session's live voucher hold and returns its total in one statement,
 * so no re-apply can switch the code while the payment relays; no live hold → the checkout's amount (nothing frozen);
 * null for a shop's own session. Idempotent: a second claim returns the same amount and keeps the first freeze time.
 * Relay exactly this amount and pass it to `confirmRedemption`.
 */
export async function claimAmountDue(sessionId: string, now = Date.now()): Promise<bigint | null> {
  const checkout = await checkoutOf(sessionId);
  if (!checkout) return null;
  const rows = await query<{ usdt_amount: string }>(
    `UPDATE app_gw_redemptions SET frozen_at = COALESCE(frozen_at, $2)
     WHERE session_id = $1 AND confirmed_at IS NULL AND (frozen_at IS NOT NULL OR created_at > $3)
     RETURNING usdt_amount::text`,
    [sessionId, now, now - HOLD_MS],
  );
  return rows[0] ? BigInt(rows[0].usdt_amount) : checkout.usdtAmount;
}

/**
 * Unfreezes the hold of an UNPAID checkout so a failed payment doesn't keep a use locked. True if a hold was unfrozen.
 * Call it ONLY from the attempt that made the claim (under its lock), and only when (batch-009 review F1):
 *   - the attempt stops before relaying (bad signature, low balance, expired), or the relayer answers BUSY / 4xx;
 *   - the relayer answers 422 AND `findPayment` returned exactly null (anyone can call paySale, so a 422 alone isn't
 *     proof the order is unpaid);
 *   - settlePending's "open" branch (the chain shows no payment and the authorization has expired).
 * NEVER on an unknown outcome (timeout, 5xx, dropped connection), a 409, STILL_PENDING, or a paid checkout: the chain
 * decides then, and the frozen hold must keep counting. A paid checkout is refused here anyway (F1).
 */
export async function releaseHold(sessionId: string): Promise<boolean> {
  // never on a paid checkout (batch-009 review F1): a late or mistaken release would free a use that was paid for
  const rows = await query(
    `UPDATE app_gw_redemptions r SET frozen_at = NULL FROM app_gw_checkouts c
     WHERE r.session_id = $1 AND c.session_id = r.session_id AND c.paid_at IS NULL AND r.confirmed_at IS NULL AND r.frozen_at IS NOT NULL
     RETURNING r.session_id`,
    [sessionId],
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
