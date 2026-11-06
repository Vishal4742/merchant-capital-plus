-- FR-INV-8 (batch 047): the debtor's acknowledgement of an invoice, an EIP-712 message our server verified
-- (lib/invoice-ack.ts). Keyed by MerchantPay and invoice id: ids restart at 1 on a MerchantPay redeploy. The first valid
-- ack wins (INSERT ... ON CONFLICT DO NOTHING). Never mirrored to Arkiv (FR-ARK-4).
-- House rules (lib/server/db.ts): times BIGINT unix ms. Idempotent: safe to re-run on Neon.
CREATE TABLE IF NOT EXISTS app_gw_invoice_acks (
  merchant_pay TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  debtor TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_at BIGINT NOT NULL,
  PRIMARY KEY (merchant_pay, invoice_id)
);
