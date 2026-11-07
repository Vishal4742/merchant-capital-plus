// "Pay with your wallet" through Privy (batch 046, FR-PAY-16): the public IDs and the modal's settings. Pure (viem's
// defineChain only), so node:test covers it; components/PrivyPay.tsx hands this to PrivyProvider on the press.
// Both IDs are public (NEXT_PUBLIC_, inlined into the browser bundle at build): they name our Privy app and our
// WalletConnect project, they grant nothing. Unset or malformed → null, and the option isn't shown.
import { defineChain } from "viem";
import { WHITECHAIN_TESTNET } from "./onboarding.ts";

const PRIVY_APP_ID = /^[a-z0-9]{20,40}$/i; // e.g. "cl" + 23 lowercase letters and digits
const WALLETCONNECT_PROJECT_ID = /^[0-9a-f]{32}$/i;

const pick = (raw: string | undefined, shape: RegExp): string | null => {
  const id = raw?.trim();
  return id && shape.test(id) ? id : null;
};

/** Our Privy app ID, or null: then the Privy option is hidden. (The literal env name lets Next inline it.) */
export const privyAppId = (raw = process.env.NEXT_PUBLIC_PRIVY_APP_ID): string | null => pick(raw, PRIVY_APP_ID);

/** Optional: our own WalletConnect project for phone wallets; without it Privy uses its default project. */
export const walletConnectProjectId = (raw = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID): string | null => pick(raw, WALLETCONNECT_PROJECT_ID);

/** Whitechain Testnet as viem names it for Privy: chain 1874, WBT, our RPC (the one the merchant onboarding adds). */
export const whitechainTestnet = defineChain({
  id: 1874,
  name: WHITECHAIN_TESTNET.chainName,
  nativeCurrency: WHITECHAIN_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [WHITECHAIN_TESTNET.rpcUrls[0]] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: WHITECHAIN_TESTNET.blockExplorerUrls[0] } },
  testnet: true,
});

/** PrivyProvider's config: chain 1874 only; a wallet (browser, or a phone app over WalletConnect) or email. A wallet is
 *  only connected (no sign-in message); an email customer gets Privy's wallet for this app. No Coinbase: its relay
 *  isn't in the pay pages' CSP. */
export function privyConfig(wcProjectId: string | null) {
  return {
    loginMethods: ["wallet", "email"] as ("wallet" | "email")[],
    supportedChains: [whitechainTestnet],
    defaultChain: whitechainTestnet,
    embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" as const } },
    appearance: {
      walletChainType: "ethereum-only" as const,
      walletList: ["detected_ethereum_wallets", "metamask", "rainbow", "wallet_connect"] as ("detected_ethereum_wallets" | "metamask" | "rainbow" | "wallet_connect")[],
      landingHeader: "Pay with your wallet",
      showWalletLoginFirst: true,
    },
    // the modal's footer links what we share with Privy (security 046 M2); /docs has no #privacy anchor yet
    legal: { privacyPolicyUrl: "https://whiteflow.org/docs" },
    ...(wcProjectId ? { walletConnectCloudProjectId: wcProjectId } : {}),
  };
}
