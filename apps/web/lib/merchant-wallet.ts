// Browser-only: the merchant acts with its own wallet (window.ethereum) on chain 1874 and pays its own gas, to create
// and cancel invoices (FR-PAY-1, FR-PAY-2) and refund payments (FR-PAY-8). Every call is simulated first, so MerchantPay's
// errors come back as plain merchant copy before the wallet asks for anything.
// ponytail: the simulation, allowance and receipt reads go through the merchant's own wallet provider (the one sending
// the transaction), not Anon-RPC; route them with the rest of FR-PRIV-1 in Phase 4.
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  keccak256,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  type Address,
  type EIP1193Provider,
} from "viem";
import { whitechainSepolia } from "viem/chains";
import { USDT } from "./usdt.ts";

// ponytail: copied from MerchantPay.sol; import packages/shared/contracts.ts once apps/web can (turbopack.root)
const merchantPayAbi = parseAbi([
  "function createInvoice(address customer, uint128 amount, uint64 dueDate, bytes32 refHash) returns (uint256 id)",
  "function cancelInvoice(uint256 id)",
  "function refund(uint256 paymentId, uint256 amount)",
  "event InvoiceCreated(uint256 indexed id, address indexed merchant, address indexed customer, uint256 amount, uint64 dueDate, bytes32 refHash)",
  "error NotMerchant()",
  "error RefundTooLarge()",
  "error InvoiceNotOpen()",
  "error InvalidDueDate()",
  "error WrongAmount()",
  "error InvoiceFinanced()",
]);
const usdtAbi = parseAbi(["function allowance(address owner, address spender) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"]);

const COPY: Record<string, string> = {
  NotMerchant: "Switch to the wallet that received this payment.",
  RefundTooLarge: "That's more than is left to refund on this payment.",
  // cancelInvoice refuses a paid, part-paid or cancelled invoice with the same error
  InvoiceNotOpen: "This invoice is already paid, part paid or cancelled, so it can't be cancelled.",
  InvoiceFinanced: "Investors have funded this invoice, so it can't be cancelled.",
  InvalidDueDate: "Pick a due date in the future.",
  WrongAmount: "Invoices start at 1.00 USDT.",
};
const UNKNOWN_CHAIN = 4902; // EIP-3085: the wallet doesn't know chain 1874 yet
const RECEIPT_POLL_MS = 1_000; // about a block

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The merchant's wallet on chain 1874, checked to be the signed-in merchant. */
export async function connectMerchant(provider: EIP1193Provider | undefined, merchant: Address, merchantPay: Address) {
  if (!provider) throw new Error("No browser wallet found. Install MetaMask or a similar wallet, then try again.");
  const wallet = createWalletClient({ chain: whitechainSepolia, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account || account.toLowerCase() !== merchant.toLowerCase()) throw new Error(`Switch your wallet to ${short(merchant)}, the one you signed in with.`);
  if ((await wallet.getChainId()) !== whitechainSepolia.id) {
    await wallet.switchChain({ id: whitechainSepolia.id }).catch(async (error: unknown) => {
      if (!(error instanceof BaseError) || !error.walk((e) => (e as { code?: number }).code === UNKNOWN_CHAIN)) throw error;
      await wallet.addChain({ chain: whitechainSepolia }); // adding switches to it
    });
  }
  // a revert is final: don't retry it (viem retries provider errors by default)
  const reader = createPublicClient({ chain: whitechainSepolia, transport: custom(provider, { retryCount: 0 }), pollingInterval: RECEIPT_POLL_MS });
  return { wallet, reader, account, merchantPay };
}

export type MerchantWallet = Awaited<ReturnType<typeof connectMerchant>>;
type Call = Parameters<MerchantWallet["reader"]["simulateContract"]>[0];

/** Simulate (MerchantPay's errors decoded), send from the merchant's wallet, wait for the receipt. */
async function send(w: MerchantWallet, call: Call) {
  const { request } = await w.reader.simulateContract({ ...call, account: w.account } as Call);
  const hash = await w.wallet.writeContract(request as Parameters<MerchantWallet["wallet"]["writeContract"]>[0]);
  const receipt = await w.reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("That didn't go through, and nothing changed. Try again.");
  return receipt;
}

/** createInvoice(no named customer, amount, dueDate, refHash) → the new invoice id, from InvoiceCreated.
 *  refHash is 32 random bytes, never a hash of the merchant's label (claude-contracts S6 d). */
export async function createInvoice(w: MerchantWallet, amount: bigint, dueDate: bigint): Promise<bigint> {
  const refHash = keccak256(crypto.getRandomValues(new Uint8Array(32)));
  const receipt = await send(w, { address: w.merchantPay, abi: merchantPayAbi, functionName: "createInvoice", args: [zeroAddress, amount, dueDate, refHash] });
  const ours = receipt.logs.filter((log) => log.address.toLowerCase() === w.merchantPay.toLowerCase());
  const [created] = parseEventLogs({ abi: merchantPayAbi, eventName: "InvoiceCreated", logs: ours });
  if (!created) throw new Error("The invoice was created, but we couldn't read its number. Reload to see it in the list.");
  return created.args.id;
}

export const cancelInvoice = (w: MerchantWallet, id: bigint) => send(w, { address: w.merchantPay, abi: merchantPayAbi, functionName: "cancelInvoice", args: [id] });

/** Returns `amount` of payment `paymentId` to its payer from the merchant's wallet. MerchantPay pulls it with
 *  transferFrom, so a short allowance is first raised by approving exactly this amount. */
export async function refund(w: MerchantWallet, paymentId: bigint, amount: bigint): Promise<void> {
  const call = { address: w.merchantPay, abi: merchantPayAbi, functionName: "refund", args: [paymentId, amount] } as const;
  const allowance = await w.reader.readContract({ address: USDT, abi: usdtAbi, functionName: "allowance", args: [w.account, w.merchantPay] });
  if (allowance < amount) {
    // Before an approval costs gas, the dry run must fail only for the missing allowance: MerchantPay checks the merchant
    // and the amount first, and USDT checks the balance before the allowance (security review 005 F2).
    await w.reader.simulateContract({ ...call, account: w.account }).catch((error: unknown) => {
      if (merchantPayError(error) || revertReason(error).includes("exceeds balance")) throw error;
    });
    await send(w, { address: USDT, abi: usdtAbi, functionName: "approve", args: [w.merchantPay, amount] });
  }
  await send(w, call);
}

function revertReason(error: unknown): string {
  const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  return reverted instanceof ContractFunctionRevertedError ? (reverted.reason ?? "") : "";
}

function merchantPayError(error: unknown): string | undefined {
  const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
  return name && name in COPY ? name : undefined;
}

/** Any error from the calls above, as one plain sentence for the merchant. */
export function walletError(error: unknown): string {
  if (!(error instanceof BaseError)) return error instanceof Error ? error.message : "Something went wrong. Try again.";
  if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";
  const name = merchantPayError(error);
  if (name) return COPY[name];
  if (revertReason(error).includes("exceeds balance")) return "Your wallet doesn't have enough USDT for this refund.";
  return "Your wallet couldn't send this. Check it has a little WBT for fees, then try again.";
}
