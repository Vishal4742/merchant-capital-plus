// What a customer signs to pay a checkout sale (ARCHITECTURE.md §2, MerchantPay.paySale).
// Pure: no DOM, no network. The server rebuilds the same message from its own session record,
// so a customer can never change the amount, the merchant or the order by editing the request.
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { receiveTypes, usdtDomain } from "./usdt.ts";

// MerchantPay's payment kind in the nonce (deployed 0x83b5…73b7, ARCHITECTURE §2). A wrong value makes every
// signature fail on-chain with "auth invalid".
export const KIND_SALE = 2; // MerchantPay.sol KIND_SALE (INVOICE = 1); pinned by the on-chain vector test

/** Longest a signed payment stays valid; the relayer refuses validBefore > now + 15 min (ARCHITECTURE §3). */
export const SIGNATURE_WINDOW_S = 465; // centred in the relayer's now+30 s … now+900 s window: tolerates a phone clock off by about ±7 min

export interface Sale {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex; // bytes32
  amount: bigint; // USDT units, 6 decimals
}

/** nonce = keccak256(abi.encode(chainid, MerchantPay, kind, merchant, orderRef, amount, salt)), recomputed on-chain. */
export function saleNonce(sale: Sale, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint8" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [BigInt(whitechainSepolia.id), sale.merchantPay, KIND_SALE, sale.merchant, sale.orderRef, sale.amount, salt],
    ),
  );
}

/** The USDT ReceiveWithAuthorization the customer signs: from the customer to MerchantPay, bound to this sale. */
export function saleAuthorization(sale: Sale, from: Address, salt: Hex, validBefore: bigint) {
  return {
    domain: usdtDomain,
    types: receiveTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: { from, to: sale.merchantPay, value: sale.amount, validAfter: 0n, validBefore, nonce: saleNonce(sale, salt) },
  };
}
