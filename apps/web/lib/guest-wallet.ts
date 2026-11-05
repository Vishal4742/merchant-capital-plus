// Browser-only guest wallet for customers (DEP-3: Privy failed NFR-8, decided 2026-11-05 20:31).
import { isHex, verifyTypedData, zeroHash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { receiveTypes, usdtDomain } from "./usdt.ts";

const STORAGE_KEY = "mcplus.guestKey";
const UNREADABLE = "The saved guest wallet is unreadable.";

// ponytail: the key lives in this browser's localStorage, so clearing site data loses it and any XSS
// could read it. Stated in the README limitations; upgrade to a passkey-wrapped key if this ships.
export function getGuestAccount() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    // Never overwrite an existing value: it may be the only copy of a funded key.
    if (!isHex(stored) || stored.length !== 66) throw new Error(UNREADABLE);
    try {
      return privateKeyToAccount(stored);
    } catch {
      throw new Error(UNREADABLE); // the library's message would echo the stored value
    }
  }
  const key = generatePrivateKey();
  localStorage.setItem(STORAGE_KEY, key);
  return privateKeyToAccount(key);
}

/**
 * DEP-3 proof: sign the USDT ReceiveWithAuthorization shape on chain 1874 and verify it locally.
 * The message can never move funds: value 0, payee is the signer itself, and validBefore 0 has passed.
 */
export async function proveTypedDataSigning(): Promise<{ address: Hex; valid: boolean }> {
  const account = getGuestAccount();
  const typedData = {
    domain: usdtDomain,
    types: receiveTypes,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: account.address,
      to: account.address,
      value: 0n,
      validAfter: 0n,
      validBefore: 0n,
      nonce: zeroHash,
    },
  } as const;
  const signature = await account.signTypedData(typedData);
  const valid = await verifyTypedData({ ...typedData, address: account.address, signature });
  return { address: account.address, valid };
}
