// Browser-only: the merchant acts with its own wallet (window.ethereum) on chain 1874 and pays its own gas, to create
// and cancel invoices (FR-PAY-1, FR-PAY-2) and refund payments (FR-PAY-8). Every call is simulated first, so MerchantPay's
// errors come back as plain merchant copy before the wallet asks for anything.
// The dry runs, allowance, balance and receipt reads go through Anon-RPC once it has booted (FR-PRIV-1), else at once
// through the wallet's own RPC, and the privacy meter counts each (FR-PRIV-3). Sending always goes through the wallet.
import {
  BaseError,
  ContractFunctionRevertedError,
  TimeoutError,
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
  type Hex,
} from "viem";
import { whitechainSepolia } from "viem/chains";
import { getChainClient } from "./anon.ts";
import { countRead, readMeter, setPrivateStatus } from "./read-meter.ts";
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
const usdtAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const NOT_ENOUGH_USDT = "Your wallet doesn't have enough USDT for this refund.";
/** The tx was sent but its receipt couldn't be read: it may still land, so the merchant must not simply send it again
 *  (security review 027 F1). */
export const SENT_UNCONFIRMED = "It was sent, but it isn't confirmed yet. Check the table before you try again.";

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
// a booted Nym read takes about 2 s; one that hangs past this goes to the wallet instead, so a refund never waits on Nym
const PRIVATE_READ_MS = 10_000;

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;

let privateReads: Awaited<ReturnType<typeof getChainClient>> | undefined; // the Anon-RPC client, once booted

/** Boots Anon-RPC in the background. Merchant pages call it after first paint (NFR-13); no read ever waits for it, and
 *  if it fails every read stays on the wallet's RPC, counted plain. */
export function startPrivateReads(): void {
  const { status } = readMeter();
  if (status === "connecting" || status === "ready") return;
  setPrivateStatus("connecting");
  getChainClient().then(
    (client) => {
      privateReads = client;
      setPrivateStatus("ready");
    },
    () => setPrivateStatus("failed"),
  );
}

function withDeadline<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError({ body: {}, url: "Anon-RPC" })), PRIVATE_READ_MS);
  });
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

const isRevert = (error: unknown): boolean =>
  (error as { code?: unknown }).code === 3 || /revert/i.test(error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? ""));

/** A read: through Anon-RPC when it has booted, else through the wallet's own RPC at once. A Nym transport failure or
 *  hang (not a revert, which is an answer) drops to the wallet's RPC for this read and the rest of the page. */
function readVia(provider: EIP1193Provider) {
  return custom({
    async request(args) {
      const anon = privateReads;
      if (anon) {
        try {
          const result = await withDeadline(anon.request(args as never, { retryCount: 0 }));
          countRead("private");
          return result;
        } catch (error) {
          // only a revert is an answer; anything else from Nym (a transport failure, a hang, a rate limit or other RPC
          // error) falls back to the wallet's RPC for this read and the rest of the page (security review 018 F3)
          if (isRevert(error)) {
            countRead("private");
            throw error;
          }
          if (privateReads === anon) privateReads = undefined;
          setPrivateStatus("failed");
        }
      }
      countRead("plain");
      return provider.request(args as never);
    },
  }, { retryCount: 0 }); // a revert is final: don't retry it (viem retries provider errors by default)
}

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
  const reader = createPublicClient({ chain: whitechainSepolia, transport: readVia(provider), pollingInterval: RECEIPT_POLL_MS });
  return { wallet, reader, account, merchantPay };
}

export type MerchantWallet = Awaited<ReturnType<typeof connectMerchant>>;
type Call = Parameters<MerchantWallet["reader"]["simulateContract"]>[0];

/** Simulate (MerchantPay's errors decoded), send from the merchant's wallet, wait for the receipt. */
async function send(w: MerchantWallet, call: Call) {
  const { request } = await w.reader.simulateContract({ ...call, account: w.account } as Call);
  const hash = await w.wallet.writeContract(request as Parameters<MerchantWallet["wallet"]["writeContract"]>[0]);
  const receipt = await w.reader.waitForTransactionReceipt({ hash }).catch(() => {
    throw new Error(SENT_UNCONFIRMED);
  });
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
/** Returns the refund tx hash, for the gateway's refund sync (batch 027). */
export async function refund(w: MerchantWallet, paymentId: bigint, amount: bigint): Promise<Hex> {
  const call = { address: w.merchantPay, abi: merchantPayAbi, functionName: "refund", args: [paymentId, amount] } as const;
  const allowance = await w.reader.readContract({ address: USDT, abi: usdtAbi, functionName: "allowance", args: [w.account, w.merchantPay] });
  if (allowance < amount) {
    // Before an approval costs gas: the balance is read, not guessed from a revert string, and the dry run may fail only
    // for the missing allowance; anything else (MerchantPay's checks, no revert data, a new error) stops here
    // (security review 005 F2, F-N5).
    const balance = await w.reader.readContract({ address: USDT, abi: usdtAbi, functionName: "balanceOf", args: [w.account] });
    if (balance < amount) throw new Error(NOT_ENOUGH_USDT);
    await w.reader.simulateContract({ ...call, account: w.account }).catch((error: unknown) => {
      if (!revertReason(error).includes("exceeds allowance")) throw error;
    });
    await send(w, { address: USDT, abi: usdtAbi, functionName: "approve", args: [w.merchantPay, amount] });
  }
  return (await send(w, call)).transactionHash;
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
  if (revertReason(error).includes("exceeds balance")) return NOT_ENOUGH_USDT;
  return "Your wallet couldn't send this. Check it has a little WBT for fees, then try again.";
}
