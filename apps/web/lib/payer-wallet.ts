// Browser-only: "Pay with your wallet" (FR-PAY-16). The customer's own injected wallet (MetaMask or similar) signs the
// same USDT ReceiveWithAuthorization the guest key signs (lib/pay.ts), with eth_signTypedData_v4: one message, never a
// transaction, so the customer pays no gas and the pay routes are unchanged (they check any signer against `from`).
// Loaded on the press, so viem's wallet code stays out of the pay pages' first load (NFR-12). The network is the one the
// merchant onboarding adds (lib/onboarding.ts, batch 029). Every failure comes out as one plain sentence.
import { BaseError, createWalletClient, custom, type EIP1193Provider } from "viem";
import { whitechainSepolia } from "viem/chains";
import { WHITECHAIN_TESTNET } from "./onboarding.ts";
import { WALLET_CANCELLED as CANCELLED } from "./outcome.ts";
import type { Payer } from "./sign-sale.ts";

const USER_REJECTED = 4001; // EIP-1193
const UNKNOWN_CHAIN = 4902; // EIP-3085: the wallet doesn't know chain 1874 yet
const REQUEST_PENDING = -32002; // MetaMask: a request of this kind is already open

export const NO_WALLET = "No wallet in this browser. Install MetaMask, then reload this page.";
const NO_ACCOUNT = "Your wallet didn't share an account. Unlock it, pick an account, then try again.";
const PENDING = "Your wallet already has a request open. Open the wallet, finish or close it, then try again.";
const WRONG_NETWORK = "Switch your wallet to Whitechain Testnet (chain 1874), then try again. Nothing was charged.";
const FAILED = "Your wallet couldn't do this. Nothing was charged. Try again.";

/** Already worded for the customer. */
class Plain extends Error {}

/** The EIP-1193 code of a wallet error, raw (provider.request) or wrapped by viem; MetaMask mobile nests it. */
function codeOf(error: unknown): number | undefined {
  const found = error instanceof BaseError ? error.walk((e) => typeof (e as { code?: unknown }).code === "number") : error;
  const { code, data } = (found ?? {}) as { code?: unknown; data?: { originalError?: { code?: unknown } } };
  if (typeof code === "number") return code;
  const nested = data?.originalError?.code;
  return typeof nested === "number" ? nested : undefined;
}

function plain(error: unknown): Error {
  if (error instanceof Plain) return error;
  const code = codeOf(error);
  return new Plain(code === USER_REJECTED ? CANCELLED : code === REQUEST_PENDING ? PENDING : FAILED);
}

async function toWhitechain(provider: EIP1193Provider, current: () => Promise<number>): Promise<void> {
  if ((await current()) === whitechainSepolia.id) return;
  const switchChain = () => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: WHITECHAIN_TESTNET.chainId }] });
  await switchChain().catch(async (error: unknown) => {
    if (codeOf(error) !== UNKNOWN_CHAIN) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [WHITECHAIN_TESTNET] });
    await switchChain();
  });
  // the domain names chain 1874 and MetaMask refuses typed data for another chain: say so before the prompt
  if ((await current()) !== whitechainSepolia.id) throw new Plain(WRONG_NETWORK);
}

/** A wallet connected through Privy (batch 046: a phone wallet over WalletConnect, a browser wallet, or the email
 *  wallet): its EIP-1193 provider takes the same path as an injected one. Throws plain copy. */
export async function privyPayer(wallet: { getEthereumProvider: () => Promise<unknown> }): Promise<Payer> {
  const provider = await wallet.getEthereumProvider().catch((error: unknown) => Promise.reject(plain(error)));
  // Privy types its provider's events loosely; viem's custom() transport only ever calls request()
  if (typeof (provider as { request?: unknown } | null)?.request !== "function") throw new Plain(FAILED);
  return connectPayer(provider as EIP1193Provider);
}

/** The customer's wallet: one account, on chain 1874, ready to approve one payment. Throws plain copy. */
export async function connectPayer(provider: EIP1193Provider | undefined): Promise<Payer> {
  if (!provider) throw new Plain(NO_WALLET);
  try {
    const wallet = createWalletClient({ chain: whitechainSepolia, transport: custom(provider) });
    const [address] = await wallet.requestAddresses();
    if (!address) throw new Plain(NO_ACCOUNT);
    await toWhitechain(provider, () => wallet.getChainId());
    return {
      address,
      // eth_signTypedData_v4 (viem serializes the typed data and adds EIP712Domain): a message, not a transaction
      signTypedData: (typedData) => wallet.signTypedData({ account: address, ...typedData }).catch((error: unknown) => Promise.reject(plain(error))),
    };
  } catch (error) {
    throw plain(error);
  }
}
