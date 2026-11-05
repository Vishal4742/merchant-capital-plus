// What a customer signs to pay a checkout sale or an invoice (ARCHITECTURE.md §2, MerchantPay.paySale / payInvoice),
// and the checks both pay routes run on what the browser sends. Pure: no DOM, no network. The server rebuilds the same
// message from its own record (the session, or the invoice and fee read on chain), so a customer can never change the
// amount, the fee, the merchant, the order or the invoice by editing the request.
import { encodeAbiParameters, isAddress, isHex, keccak256, zeroHash, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { receiveTypes, usdtDomain } from "./usdt.ts";

// MerchantPay's payment kinds in the nonce (final 0xab81…4251, ARCHITECTURE §2). A wrong value makes every
// signature fail on-chain with "auth invalid". Both are pinned by on-chain vector tests.
export const KIND_INVOICE = 1;
export const KIND_SALE = 2;

/** Longest a signed payment stays valid; the relayer refuses validBefore > now + 15 min (ARCHITECTURE §3). */
export const SIGNATURE_WINDOW_S = 465; // centred in the relayer's now+30 s … now+900 s window: tolerates a phone clock off by about ±7 min
const MAX_RELAYER_WINDOW_S = 15 * 60;
const MIN_RELAYER_WINDOW_S = 30;

export interface Sale {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex; // bytes32
  amount: bigint; // USDT units, 6 decimals; the 0.10 fee comes out of it
}

export interface InvoiceTerms {
  merchantPay: Address;
  invoiceId: bigint;
  /** The credited amount: what is still owed (invoice.amount − invoice.paid). The nonce covers only this. */
  amount: bigint;
  /** MerchantPay.relayFee(), read on chain by our server: paid on top of the invoice. */
  fee: bigint;
}

/** nonce = keccak256(abi.encode(chainid, MerchantPay, kind, ref, orderRef, amount, salt)), recomputed on-chain. */
function paymentNonce(merchantPay: Address, kind: number, ref: bigint, orderRef: Hex, amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [BigInt(whitechainSepolia.id), merchantPay, kind, ref, orderRef, amount, salt],
    ),
  );
}

/** Sale: ref = the merchant, orderRef = the checkout's random 32 bytes, amount = the price. */
export const saleNonce = (sale: Sale, salt: Hex): Hex => paymentNonce(sale.merchantPay, KIND_SALE, BigInt(sale.merchant), sale.orderRef, sale.amount, salt);

/** Invoice: ref = the invoice id, orderRef = 0, amount = the credited amount (without the fee). */
export const invoiceNonce = (terms: InvoiceTerms, salt: Hex): Hex => paymentNonce(terms.merchantPay, KIND_INVOICE, terms.invoiceId, zeroHash, terms.amount, salt);

/** The USDT ReceiveWithAuthorization the customer signs: from the customer to MerchantPay, bound by `nonce`. */
function authorization(merchantPay: Address, value: bigint, nonce: Hex, from: Address, validBefore: bigint) {
  return {
    domain: usdtDomain,
    types: receiveTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: { from, to: merchantPay, value, validAfter: 0n, validBefore, nonce },
  };
}

/** A sale: the customer signs exactly the price. */
export const saleAuthorization = (sale: Sale, from: Address, salt: Hex, validBefore: bigint) => authorization(sale.merchantPay, sale.amount, saleNonce(sale, salt), from, validBefore);

/** An invoice: the customer signs the credited amount plus the fee (MerchantPay pulls amount + relayFee). */
export const invoiceAuthorization = (terms: InvoiceTerms, from: Address, salt: Hex, validBefore: bigint) =>
  authorization(terms.merchantPay, terms.amount + terms.fee, invoiceNonce(terms, salt), from, validBefore);

export interface Approval {
  from: Address;
  salt: Hex;
  validBefore: bigint;
  signature: Hex;
}

/** The body of POST …/pay (checkout and invoice): its shape, and a validBefore inside the relayer's window. */
export function parseApproval(body: unknown, nowS = BigInt(Math.floor(Date.now() / 1000))): Approval | { error: string } {
  const { from, salt, signature, validBefore } = (body ?? {}) as { from?: unknown; salt?: unknown; validBefore?: unknown; signature?: unknown };
  if (typeof from !== "string" || !isAddress(from)) return { error: "from must be an address." };
  if (typeof salt !== "string" || !isHex(salt) || salt.length !== 66) return { error: "salt must be 32 bytes of hex." };
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) return { error: "signature must be 65 bytes of hex." };
  if (typeof validBefore !== "string" || !/^\d{1,12}$/.test(validBefore)) return { error: "validBefore must be a unix time." };
  const until = BigInt(validBefore);
  if (until <= nowS + BigInt(MIN_RELAYER_WINDOW_S) || until > nowS + BigInt(MAX_RELAYER_WINDOW_S)) return { error: "This payment window is out of range. Please start again." };
  return { from, salt, validBefore: until, signature };
}
