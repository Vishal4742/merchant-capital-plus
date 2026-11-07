// FR-INV-8 (batch 047): the invoice acknowledgements our server verified (app_gw_invoice_acks, db/051), one per key.
// Keyed by MerchantPay, invoice id and debtor (ids restart on a redeploy; every key keeps its own first ack, security
// 047 M1). Only our database holds them, never Arkiv (FR-ARK-4).
import type { Address, Hex } from "viem";
import { query } from "./db.ts";

export interface InvoiceAck {
  debtor: Address;
  /** The terms it signed (the invoice as read on chain then). */
  merchant: Address;
  amount: bigint;
  dueDate: bigint;
  /** The invoice names this debtor as its customer on chain: the named customer's ack (security 047 H1). */
  bound: boolean;
  /** When our server accepted it, unix ms. */
  signedAt: number;
}

/** One ack as a page shows it: the short address and the time, never the signature. */
export interface AckEntry {
  debtor: string;
  signed_at: string;
}

/** What investors and the merchant see for one invoice: the named customer's ack if there is one (verified), else the
 *  first pay-link holder's, and how many keys acknowledged it. */
export interface DebtorAckView extends AckEntry {
  verified: boolean;
  count: number;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const ackEntry = (ack: InvoiceAck): AckEntry => ({ debtor: short(ack.debtor), signed_at: new Date(ack.signedAt).toISOString() });

/** The acks signed for exactly these terms (security 047 L1: same merchant, amount and due date as what they're shown
 *  next to), or null if none. */
export function ackView(acks: readonly InvoiceAck[], terms: { merchant: Address; amount: bigint; dueDate: bigint }): DebtorAckView | null {
  const matching = acks.filter((a) => a.merchant.toLowerCase() === terms.merchant.toLowerCase() && a.amount === terms.amount && a.dueDate === terms.dueDate);
  const shown = matching.find((a) => a.bound) ?? matching[0];
  return shown ? { ...ackEntry(shown), verified: shown.bound, count: matching.length } : null;
}

type AckRow = { invoice_id: string; debtor: Address; merchant: Address; amount: string; due_date: string; customer_bound: boolean; signed_at: string };
const toAck = (r: AckRow): InvoiceAck => ({ debtor: r.debtor, merchant: r.merchant, amount: BigInt(r.amount), dueDate: BigInt(r.due_date), bound: r.customer_bound, signedAt: Number(r.signed_at) });
const COLUMNS = "invoice_id, debtor, merchant, amount::text AS amount, due_date::text AS due_date, customer_bound, signed_at::text AS signed_at";

/** Unchecked acks one invoice keeps (security re-review 047, LOW); a named customer's invoice takes one wallet anyway. */
export const MAX_UNBOUND_ACKS = 5;

/** Stores this key's ack unless it already has one (its first ack stays) and returns the stored one; null when the
 *  invoice already holds MAX_UNBOUND_ACKS unchecked acks and this key isn't one of them.
 *  ponytail: the count and the insert are one statement, but two concurrent inserts can both see 4 and make 6;
 *  acksFor's LIMIT leaves room for that. A per-invoice lock if it ever matters. */
export async function saveAck(merchantPay: Address, invoiceId: bigint, ack: Omit<InvoiceAck, "signedAt">, signature: Hex, now = Date.now()): Promise<InvoiceAck | null> {
  const key = [merchantPay.toLowerCase(), invoiceId.toString(), ack.debtor];
  await query(
    `INSERT INTO app_gw_invoice_acks (merchant_pay, invoice_id, debtor, merchant, amount, due_date, customer_bound, signature, signed_at)
     SELECT $1::text, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7::boolean, $8::text, $9::bigint
     WHERE $7::boolean OR (SELECT count(*) FROM app_gw_invoice_acks WHERE merchant_pay = $1::text AND invoice_id = $2::text) < $10
     ON CONFLICT (merchant_pay, invoice_id, debtor) DO NOTHING`,
    [...key, ack.merchant, ack.amount.toString(), ack.dueDate.toString(), ack.bound, signature, now, MAX_UNBOUND_ACKS],
  );
  const [row] = await query<AckRow>(`SELECT ${COLUMNS} FROM app_gw_invoice_acks WHERE merchant_pay = $1 AND invoice_id = $2 AND debtor = $3`, key);
  return row ? toAck(row) : null;
}

/** Every key's ack for these invoices, by invoice id (decimal), oldest first. At most the cap per invoice plus one (a
 *  race past the cap) in all, so a read stays bounded. */
export async function acksFor(merchantPay: Address, invoiceIds: readonly bigint[]): Promise<Map<string, InvoiceAck[]>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await query<AckRow>(`SELECT ${COLUMNS} FROM app_gw_invoice_acks WHERE merchant_pay = $1 AND invoice_id = ANY($2::text[]) ORDER BY signed_at, debtor LIMIT $3`, [
    merchantPay.toLowerCase(),
    invoiceIds.map(String),
    invoiceIds.length * (MAX_UNBOUND_ACKS + 1),
  ]);
  const byId = new Map<string, InvoiceAck[]>();
  for (const r of rows) byId.set(r.invoice_id, [...(byId.get(r.invoice_id) ?? []), toAck(r)]);
  return byId;
}
