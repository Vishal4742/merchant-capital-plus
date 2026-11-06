// Server-only: which checkout session came from which payment link or page (table app_gw_checkouts).
// Links and pages record a row when they create a session; vouchers, single-use links and webhooks read it back,
// and the hosted checkout reads `fx` to show the price, the rate and its time (SRS FR-GW-11, AT-13).
import type { Address } from "viem";
import { query } from "./db.ts";

export type CheckoutKind = "link" | "page";

/** The fiat price behind a checkout and the rate that converted it (USD/USDT: rate "1"). */
export interface Fx {
  currency: string;
  amount: bigint; // in `currency`, 6 decimals
  rate: string; // units of `currency` per 1 USD (packages/sdk's priced.rate)
  rateAt: string | null; // the source's publish date (YYYY-MM-DD); null on rows from before batch 008
  source: string;
  fetchedAt: number;
}

export interface Checkout {
  sessionId: string;
  kind: CheckoutKind;
  refId: string;
  merchant: string; // lowercase address
  usdtAmount: bigint;
  fx: Fx | null;
  createdAt: number;
  paidAt: number | null;
}

export async function recordCheckout(
  sessionId: string,
  kind: CheckoutKind,
  refId: string,
  merchant: Address,
  usdtAmount: bigint,
  { fx = null, now = Date.now() }: { fx?: Fx | null; now?: number } = {},
): Promise<void> {
  await query(
    `INSERT INTO app_gw_checkouts (session_id, kind, ref_id, merchant, usdt_amount, fx_currency, fx_amount, fx_rate, fx_rate_at, fx_source, fx_fetched_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [sessionId, kind, refId, merchant.toLowerCase(), usdtAmount.toString(), fx?.currency ?? null, fx?.amount.toString() ?? null, fx?.rate ?? null, fx?.rateAt ?? null, fx?.source ?? null, fx?.fetchedAt ?? null, now],
  );
}

type CheckoutRow = {
  session_id: string;
  kind: CheckoutKind;
  ref_id: string;
  merchant: string;
  usdt_amount: string;
  fx_currency: string | null;
  fx_amount: string | null;
  fx_rate: string | null;
  fx_rate_at: string | null;
  fx_source: string | null;
  fx_fetched_at: string | null;
  created_at: string;
  paid_at: string | null;
};

/** The link or page a session came from, or null for a shop's own session (created with its sk_ key). */
export async function checkoutOf(sessionId: string): Promise<Checkout | null> {
  const rows = await query<CheckoutRow>(
    `SELECT session_id, kind, ref_id, merchant, usdt_amount::text, fx_currency, fx_amount::text, fx_rate, fx_rate_at, fx_source, fx_fetched_at::text,
            created_at::text, paid_at::text
     FROM app_gw_checkouts WHERE session_id = $1`,
    [sessionId],
  );
  const r = rows[0];
  if (!r) return null;
  const fx =
    r.fx_currency && r.fx_amount && r.fx_rate && r.fx_source && r.fx_fetched_at
      ? { currency: r.fx_currency, amount: BigInt(r.fx_amount), rate: r.fx_rate, rateAt: r.fx_rate_at, source: r.fx_source, fetchedAt: Number(r.fx_fetched_at) }
      : null;
  return {
    sessionId: r.session_id,
    kind: r.kind,
    refId: r.ref_id,
    merchant: r.merchant,
    usdtAmount: BigInt(r.usdt_amount),
    fx,
    createdAt: Number(r.created_at),
    paidAt: r.paid_at === null ? null : Number(r.paid_at),
  };
}

/** Marks the checkout paid. True only the first time, so the caller's follow-ups (link status, voucher) run once. */
export async function markCheckoutPaid(sessionId: string, now = Date.now()): Promise<boolean> {
  const rows = await query("UPDATE app_gw_checkouts SET paid_at = $2 WHERE session_id = $1 AND paid_at IS NULL RETURNING session_id", [sessionId, now]);
  return rows.length === 1;
}

/** Paid checkouts per link or page id, for the list screens' payment counts. */
export async function paidCounts(kind: CheckoutKind, refIds: string[]): Promise<Map<string, number>> {
  if (refIds.length === 0) return new Map();
  const rows = await query<{ ref_id: string; n: string }>(
    "SELECT ref_id, count(*)::text AS n FROM app_gw_checkouts WHERE kind = $1 AND ref_id = ANY($2) AND paid_at IS NOT NULL GROUP BY ref_id",
    [kind, refIds],
  );
  return new Map(rows.map((r) => [r.ref_id, Number(r.n)]));
}
