// Browser-only: the customer's approval for one checkout sale or one invoice. Loaded lazily by the checkout and the
// invoice page (after first paint, when the browser is idle), so viem's signing code stays out of their first load (NFR-12).
// The guest key signs by default; "Pay with your wallet" passes the customer's own wallet instead (lib/payer-wallet.ts,
// FR-PAY-16): the same typed data, the same body, the same route.
import { toHex, type Address, type Hex } from "viem";
import { getGuestAccount } from "./guest-wallet.ts";
import { SIGNATURE_WINDOW_S, invoiceAuthorization, saleAuthorization } from "./pay.ts";

// A fresh salt per attempt. MerchantPay refuses a second payment for the same order on-chain (OrderPaid; for an
// invoice, InvoiceNotOpen once it is paid, and WrongAmount above what is still owed), so
// reusing one nonce per checkout no longer protects anything, and it let anyone who burned that nonce lock the
// checkout (security review, batch 004 round 1, S2).
const freshSalt = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** Who approves: this browser's guest key, or the customer's own wallet (eth_signTypedData_v4, lib/payer-wallet.ts). */
export interface Payer {
  address: Address;
  signTypedData: (typedData: ReturnType<typeof saleAuthorization>) => Promise<Hex>;
}

/** This browser's guest address, for the balance check before the hold (FR-PAY-16). Creates the key on first use. */
export const guestAddress = (): Address => getGuestAccount().address;

export interface SaleTerms {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex;
  amount: string; // USDT units as a decimal string (from the server)
}

/** Signs the sale (the guest key unless `account` is given) and returns the body for POST /api/v1/sessions/:id/pay. The
 *  approval ends when the checkout does, if that is sooner (ARCHITECTURE §4b), so nothing can settle after the sheet
 *  says "expired". */
export async function signSale(sale: SaleTerms, checkoutExpiresAt: number, account: Payer = getGuestAccount()) {
  const salt = freshSalt();
  const validBefore = BigInt(Math.min(Math.floor(Date.now() / 1000) + SIGNATURE_WINDOW_S, Math.floor(checkoutExpiresAt / 1000)));
  const signature = await account.signTypedData(saleAuthorization({ ...sale, amount: BigInt(sale.amount) }, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}

export interface InvoicePayTerms {
  merchantPay: Address;
  invoiceId: string; // decimal (from the server)
  amount: string; // the credited amount in USDT units, read on chain by the server
  fee: string; // MerchantPay.relayFee(), read on chain by the server: paid on top
}

/** Signs the invoice payment (amount + fee), the guest key unless `account` is given; returns the body for
 *  POST /api/v1/invoices/:id/pay. */
export async function signInvoice(terms: InvoicePayTerms, account: Payer = getGuestAccount()) {
  const salt = freshSalt();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_WINDOW_S);
  const invoice = { merchantPay: terms.merchantPay, invoiceId: BigInt(terms.invoiceId), amount: BigInt(terms.amount), fee: BigInt(terms.fee) };
  const signature = await account.signTypedData(invoiceAuthorization(invoice, account.address, salt, validBefore));
  return { from: account.address, salt, validBefore: validBefore.toString(), signature };
}
