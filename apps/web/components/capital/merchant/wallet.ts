// Browser-only: the merchant lists and cancels Capital offers from its own wallet on chain 1874 and pays its own WBT gas
// (CAPITAL-TAB §2.3, Q1: CapitalMarket has no signature variant). connectMerchant checks the wallet is the signed-in one
// and switches the chain; every call is simulated first, so CapitalMarket's errors read as copy before the wallet asks.
import { BaseError, ChainMismatchError, ContractFunctionRevertedError, SwitchChainError, UserRejectedRequestError, parseEventLogs, type Address, type Hex } from "viem";
import { SENT_UNCONFIRMED, connectMerchant, walletError, type MerchantWallet } from "@/lib/merchant-wallet";
import { CAPITAL_COPY, CAPITAL_MARKET, listingAbi, type AdvanceTerms } from "./terms";

export { SENT_UNCONFIRMED };
export type { MerchantWallet };

/** The merchant's wallet, checked and on chain 1874. connectMerchant's third argument only rides along. */
export const connectCapital = (merchant: Address) => connectMerchant(window.ethereum, merchant, CAPITAL_MARKET);

type Name = "listAdvance" | "listInvoice" | "cancelOffer";
type Simulate = Parameters<MerchantWallet["reader"]["simulateContract"]>[0];
type Write = Parameters<MerchantWallet["wallet"]["writeContract"]>[0];

/** Simulate → send → receipt, the lib/merchant-wallet.ts send() rule (it isn't exported): a receipt we can't read is
 *  SENT_UNCONFIRMED, so the merchant never lists twice (security review 027 F1). */
async function send(w: MerchantWallet, functionName: Name, args: readonly unknown[]) {
  const { request } = await w.reader.simulateContract({ address: CAPITAL_MARKET, abi: listingAbi, functionName, args, account: w.account } as Simulate);
  const hash = await w.wallet.writeContract(request as Write);
  const receipt = await w.reader.waitForTransactionReceipt({ hash }).catch(() => {
    throw new Error(SENT_UNCONFIRMED);
  });
  if (receipt.status !== "success") throw new Error("That didn't go through, and nothing changed. Try again.");
  return receipt;
}

export interface Listed {
  claimId: string;
  txHash: Hex;
}

function listed(receipt: Awaited<ReturnType<typeof send>>): Listed {
  const ours = receipt.logs.filter((log) => log.address.toLowerCase() === CAPITAL_MARKET.toLowerCase());
  const [event] = parseEventLogs({ abi: listingAbi, eventName: "OfferListed", logs: ours });
  if (!event) throw new Error("It's listed, but we couldn't read its number. Reload to see it under My live offers.");
  return { claimId: event.args.claimId.toString(), txHash: receipt.transactionHash };
}

export const listAdvance = async (w: MerchantWallet, t: AdvanceTerms): Promise<Listed> =>
  listed(await send(w, "listAdvance", [t.principal, t.cap, t.holdbackBps, t.term, t.offerDeadline]));

/** recourseBps is always 0: FR-INV-6 is cut (docs/SRS.md:6). */
export const listInvoice = async (w: MerchantWallet, invoiceId: bigint, price: bigint, offerDeadline: bigint): Promise<Listed> =>
  listed(await send(w, "listInvoice", [invoiceId, price, offerDeadline, 0]));

export const cancelOffer = async (w: MerchantWallet, claimId: bigint): Promise<void> => void (await send(w, "cancelOffer", [claimId]));

/** Any error from the calls above as one sentence: CapitalMarket's own errors, the wrong network, else walletError. */
export function capitalError(error: unknown): string {
  if (error instanceof BaseError && !error.walk((e) => e instanceof UserRejectedRequestError)) {
    if (error.walk((e) => e instanceof ChainMismatchError || e instanceof SwitchChainError)) return "Switch your wallet to Whitechain testnet (chain 1874), then try again.";
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
    if (name && name in CAPITAL_COPY) return CAPITAL_COPY[name];
  }
  return walletError(error);
}
