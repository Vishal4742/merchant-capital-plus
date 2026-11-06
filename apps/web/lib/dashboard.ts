// The merchant home's numbers (FR-PAY-15): which payments it shows, today's figures and the gross-volume series.
// Pure: the page passes in what it read, so node:test covers the money rules (security review 005 F-N6).
import type { PaidLog, PaymentRecord } from "./onchain.ts";
import type { Payment, Session } from "./sessions.ts";

export interface PaymentRow {
  key: string;
  paymentId: string | null;
  label: string;
  txHash: string | null;
  paidAt: number;
  amount: bigint; // what the customer paid (an invoice's includes the fee), from payments(id) once read
  /** Our own checkout record; a row only the log index knows needs the chain to confirm it. */
  ours: boolean;
}

/** This merchant's payment candidates: checkouts our server recorded, plus every Paid log the index has (invoices,
 *  and sales from before a restart), one row per payment id, newest first. */
export function paymentRows(sessions: { session: Session; payment: Payment }[], logs: PaidLog[]): PaymentRow[] {
  const rows = new Map<string, PaymentRow>();
  for (const log of logs) {
    const id = log.paymentId.toString();
    rows.set(id, { key: id, paymentId: id, label: log.invoiceId ? `Invoice ${log.invoiceId}` : `Payment ${id}`, txHash: log.txHash, paidAt: log.time, amount: log.gross, ours: false });
  }
  for (const { session, payment } of sessions) {
    const key = payment.paymentId ?? session.id;
    rows.set(key, { key, paymentId: payment.paymentId, label: session.reference || `Payment ${payment.paymentId}`, txHash: payment.txHash ?? rows.get(key)?.txHash ?? null, paidAt: payment.paidAt, amount: session.amount, ours: true });
  }
  return [...rows.values()].sort((a, b) => b.paidAt - a.paidAt);
}

export interface Confirmed {
  row: PaymentRow;
  record: PaymentRecord | null;
}

/** The chain decides what is shown (security review 005 F5): the amount is payments(id).gross, a row the chain says
 *  is another merchant's is dropped, and an index-only row is shown only once the chain confirms it. */
export function confirmed(rows: PaymentRow[], records: (PaymentRecord | null)[], merchant: string): Confirmed[] {
  return rows.flatMap((row, i) => {
    const record = records[i] ?? null;
    if (record ? record.merchant.toLowerCase() !== merchant.toLowerCase() : !row.ours) return [];
    return [{ row: record ? { ...row, amount: record.gross } : row, record }];
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India has no daylight saving
/** The IST calendar day of a time, as a day number. */
export const istDay = (ms: number) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS);

/** Gross per IST day for the last `days` days, oldest first; the last entry is today. */
export function dailyGross(rows: PaymentRow[], days: number, now: number): bigint[] {
  const today = istDay(now);
  const out = Array.from({ length: days }, () => 0n);
  for (const row of rows) {
    const back = today - istDay(row.paidAt);
    if (back >= 0 && back < days) out[days - 1 - back] += row.amount;
  }
  return out;
}

export interface Figures {
  grossToday: bigint;
  grossYesterday: bigint;
  countToday: number;
  countYesterday: number;
  /** Refunded so far across the payments listed, read on chain (null when no record could be read). */
  refunded: bigint | null;
  refundedPayments: number;
}

export function figures(payments: Confirmed[], now: number): Figures {
  const today = istDay(now);
  const on = (day: number) => payments.filter(({ row }) => istDay(row.paidAt) === day);
  const sum = (list: Confirmed[]) => list.reduce((total, { row }) => total + row.amount, 0n);
  const read = payments.flatMap(({ record }) => (record ? [record] : []));
  return {
    grossToday: sum(on(today)),
    grossYesterday: sum(on(today - 1)),
    countToday: on(today).length,
    countYesterday: on(today - 1).length,
    refunded: read.length ? read.reduce((total, record) => total + record.refunded, 0n) : null,
    refundedPayments: read.filter((record) => record.refunded > 0n).length,
  };
}

/** Whole-percent change from `before` to `now`, or null when there is nothing to compare with. */
export function change(now: bigint, before: bigint): number | null {
  if (before === 0n) return null;
  return Number(((now - before) * 100n) / before);
}

/** The line and the area under it for an SVG chart of `values` in a w × h box with padding p. */
export function chartPaths(values: number[], w: number, h: number, p: number) {
  const max = Math.max(...values, 1) * 1.15, step = (w - p * 2) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => [p + i * step, h - p - (v / max) * (h - p * 2)] as const);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return { line, area: `${line} L${lastX.toFixed(1)} ${h - p} L${p} ${h - p} Z`, last: { x: lastX, y: lastY } };
}
