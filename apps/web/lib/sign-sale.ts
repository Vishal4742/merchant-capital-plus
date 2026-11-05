// Browser-only: the customer's approval for one checkout sale or one invoice. Loaded lazily by the checkout and the
// invoice page (after first paint, when the browser is idle), so viem's signing code stays out of their first load (NFR-12).
import { toHex, type Address, type Hex } from "viem";
import { getGuestAccount } from "./guest-wallet.ts";
import { SIGNATURE_WINDOW_S, invoiceAuthorization, saleAuthorization } from "./pay.ts";

// A fresh salt per attempt. MerchantPay refuses a second payment for the same order on-chain (OrderPaid; for an
// invoice, InvoiceNotOpen once it is paid, and WrongAmount above what is still owed), so
// reusing one nonce per checkout no longer protects anything, and it let anyone who burned that nonce lock the
// checkout (security review, batch 004 round 1, S2).
const freshSalt = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

export interface SaleTerms {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex;
  amount: string; // USDT units as a decimal string (from the server)
}

/** Signs the sale with the guest key and returns the body for POST /api/v1/sessions/:id/pay. */
export async function signSale(sale: SaleTerms) {
  const account = getGuestAccount();
  const salt = freshSalt();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_WINDOW_S);
  const signature = await account.signTypedData(saleAuthorization({ ...sale, amount: BigInt(sale.amount) }, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}

export interface InvoicePayTerms {
  merchantPay: Address;
  invoiceId: string; // decimal (from the server)
  amount: string; // the credited amount in USDT units, read on chain by the server
  fee: string; // MerchantPay.relayFee(), read on chain by the server: paid on top
}

/** Signs the invoice payment (amount + fee) with the guest key; returns the body for POST /api/v1/invoices/:id/pay. */
export async function signInvoice(terms: InvoicePayTerms) {
  const account = getGuestAccount();
  const salt = freshSalt();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_WINDOW_S);
  const invoice = { merchantPay: terms.merchantPay, invoiceId: BigInt(terms.invoiceId), amount: BigInt(terms.amount), fee: BigInt(terms.fee) };
  const signature = await account.signTypedData(invoiceAuthorization(invoice, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}
