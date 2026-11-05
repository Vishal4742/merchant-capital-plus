// Browser-only: the customer's approval for one checkout sale. Loaded lazily by the checkout (after first paint,
// when the browser is idle), so viem's signing code stays out of the pay page's first load (NFR-12).
import { toHex, type Address, type Hex } from "viem";
import { getGuestAccount } from "./guest-wallet.ts";
import { SIGNATURE_WINDOW_S, saleAuthorization } from "./pay.ts";

// A fresh salt per attempt. MerchantPay refuses a second payment for the same order on-chain (OrderPaid), so
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
