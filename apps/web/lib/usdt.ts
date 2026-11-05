// The prize USDT on Whitechain Sepolia (ARCHITECTURE.md §7) and its EIP-3009 typed data.
import { formatUnits, parseUnits } from "viem";
import { whitechainSepolia } from "viem/chains";

export const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
export const USDT_DECIMALS = 6;
export const EXPLORER = "https://explorer.testnet.whitechain.io";

/** EIP-712 domain read on-chain: name "Tether USD", version "1" (version() reverts, so it is hard-coded). */
export const usdtDomain = { name: "Tether USD", version: "1", chainId: whitechainSepolia.id, verifyingContract: USDT } as const;

export const receiveTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** "25" or "25.00" → 25000000n. Throws on anything that isn't a positive amount with at most 6 decimals. */
export function parseUsdt(text: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(text.trim())) throw new Error("Enter an amount like 25.00");
  return parseUnits(text.trim(), USDT_DECIMALS);
}

/** 25000000n → "25.00", 1234560000n → "1,234.56", 123456n → "0.123456": two decimals at least, never rounded. */
export function formatUsdt(units: bigint): string {
  const [whole, frac = ""] = formatUnits(units, USDT_DECIMALS).split(".");
  return `${BigInt(whole).toLocaleString("en-US")}.${frac.padEnd(2, "0")}`;
}
