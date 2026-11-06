-- FR-INV-8 (batch 047): each key's acknowledgement of an invoice, an EIP-712 message our server verified
-- (lib/invoice-ack.ts). One row per (MerchantPay, invoice, debtor): ids restart on a MerchantPay redeploy, and every
-- key keeps its own first ack, so an early one can't squat the invoice (security 047 M1). merchant, amount and due_date
-- are the terms it signed, matched against an offer before it is shown (L1). customer_bound: the invoice names this
-- debtor as its customer on chain, so the ack is the named customer's (H1). Never mirrored to Arkiv (FR-ARK-4).
-- House rules (lib/server/db.ts): signed_at BIGINT unix ms; due_date unix seconds, as on chain. Idempotent.
CREATE TABLE IF NOT EXISTS app_gw_invoice_acks (
  merchant_pay TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  debtor TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount BIGINT NOT NULL,
  due_date BIGINT NOT NULL,
  customer_bound BOOLEAN NOT NULL,
  signature TEXT NOT NULL,
  signed_at BIGINT NOT NULL,
  PRIMARY KEY (merchant_pay, invoice_id, debtor)
);
