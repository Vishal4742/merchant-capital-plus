// FR-INV-8 (batch 047): the debtor acknowledgements our server verified (app_gw_invoice_acks, db/051). Keyed by
// MerchantPay and invoice id (ids restart on a redeploy). Only our database holds them, never Arkiv (FR-ARK-4).
import type { Address, Hex } from "viem";
import { query } from "./db.ts";

export interface InvoiceAck {
  debtor: Address;
  /** When our server accepted it, unix ms. */
  signedAt: number;
}

/** What investors and the merchant see: the short debtor address and the time, never the signature. */
export interface DebtorAckView {
  debtor: string;
  signed_at: string;
}

export const ackView = (ack: InvoiceAck): DebtorAckView => ({ debtor: `${ack.debtor.slice(0, 6)}…${ack.debtor.slice(-4)}`, signed_at: new Date(ack.signedAt).toISOString() });

type AckRow = { invoice_id: string; debtor: Address; signed_at: string };
const toAck = (r: AckRow): InvoiceAck => ({ debtor: r.debtor, signedAt: Number(r.signed_at) });

/** Stores the ack unless the invoice already has one (the first valid ack wins) and returns the stored one. */
export async function saveAck(merchantPay: Address, invoiceId: bigint, debtor: Address, signature: Hex, now = Date.now()): Promise<InvoiceAck> {
  const key = [merchantPay.toLowerCase(), invoiceId.toString()];
  await query(
    "INSERT INTO app_gw_invoice_acks (merchant_pay, invoice_id, debtor, signature, signed_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (merchant_pay, invoice_id) DO NOTHING",
    [...key, debtor, signature, now],
  );
  const [row] = await query<AckRow>("SELECT invoice_id, debtor, signed_at::text AS signed_at FROM app_gw_invoice_acks WHERE merchant_pay = $1 AND invoice_id = $2", key);
  return toAck(row);
}

/** The acks for these invoices, by invoice id (decimal). */
export async function acksFor(merchantPay: Address, invoiceIds: readonly bigint[]): Promise<Map<string, InvoiceAck>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await query<AckRow>(
    "SELECT invoice_id, debtor, signed_at::text AS signed_at FROM app_gw_invoice_acks WHERE merchant_pay = $1 AND invoice_id = ANY($2::text[])",
    [merchantPay.toLowerCase(), invoiceIds.map(String)],
  );
  return new Map(rows.map((r) => [r.invoice_id, toAck(r)]));
}
