// Refund sync (SRS FR-GW-7, FR-PAY-10, AT-15): the dashboard says "this tx refunded payment N"; only the chain decides.
// The tx's receipt is read from our RPC, and only a Refunded log that MerchantPay itself emitted, for this payment, in a
// successful tx counts. Each one goes to onRefund, whose `refund:<session>:<total>` key makes a re-sync a no-op.
import { createPublicClient, decodeEventLog, http, parseAbi, toEventSelector, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { listPayments } from "../sessions.ts";
import { plainUsdt } from "../usdt.ts";
import { onRefund } from "./events.ts";
import { HttpError } from "./http.ts";
import { merchantPayAddress } from "./reports.ts";

// ponytail: the RPC URL and timeouts copied from lib/onchain.ts, whose client isn't exported; share it if a third caller appears.
const ANKR_1874 = "https://rpc.ankr.com/whitechain_testnet";
const READ_TIMEOUT_MS = 10_000;
const READ_TRIES = 3;
const READ_GAP_MS = 1_000; // about a block

const abi = parseAbi(["event Refunded(uint256 indexed paymentId, uint256 amount, uint256 totalRefunded)"]);
const REFUNDED = toEventSelector(abi[0]);

/** The parts of a viem TransactionReceipt the sync reads. */
export interface RefundReceipt {
  status: "success" | "reverted";
  logs: readonly { address: Address; data: Hex; topics: [Hex, ...Hex[]] | [] }[];
}
type ReadReceipt = (hash: Hex) => Promise<RefundReceipt>;

// retryCount 0: chainReceipt retries, so a dead RPC costs at most READ_TRIES timeouts, not READ_TRIES × viem's retries
const makeClient = () => createPublicClient({ chain: whitechainSepolia, transport: http(ANKR_1874, { timeout: READ_TIMEOUT_MS, retryCount: 0 }) });
let client: ReturnType<typeof makeClient> | undefined;

/** Asked again on "not found": Ankr load-balances, and a backend a block behind hasn't seen a just-mined tx. */
async function chainReceipt(hash: Hex): Promise<RefundReceipt> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await (client ??= makeClient()).getTransactionReceipt({ hash });
    } catch (error) {
      if (attempt >= READ_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, READ_GAP_MS));
    }
  }
}

/** MerchantPay's Refunded logs for `paymentId`, in log order; every other log (another contract, event or payment) is dropped. */
function refundsOf(receipt: RefundReceipt, merchantPay: Address, paymentId: bigint) {
  return receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== merchantPay.toLowerCase() || log.topics[0]?.toLowerCase() !== REFUNDED) return [];
    try {
      const event = decodeEventLog({ abi, eventName: "Refunded", data: log.data, topics: log.topics, strict: true });
      if (event.eventName !== "Refunded" || event.args.paymentId !== paymentId) return []; // viem decodes by topic0, whatever eventName says
      return [{ amount: event.args.amount, totalRefunded: event.args.totalRefunded }];
    } catch {
      return []; // not a log we can read
    }
  });
}

/** Fires payment.refunded for each refund of the merchant's payment `paymentId` in tx `txHash`, as the chain records it. */
export async function syncRefund(merchant: Address, paymentId: bigint, txHash: Hex, { readReceipt = chainReceipt }: { readReceipt?: ReadReceipt } = {}) {
  const merchantPay = merchantPayAddress(); // 503 until the contracts are configured
  const paid = listPayments(merchant).find(({ payment }) => payment.paymentId === paymentId.toString());
  if (!paid) throw new HttpError(404, "No such payment.");
  const receipt = await readReceipt(txHash).catch((error: unknown) => {
    console.error("refund sync: receipt read failed:", error instanceof Error ? error.name : typeof error); // never the message: it can hold the RPC URL
    throw new HttpError(502, "That transaction can't be read yet. Try again in a minute.");
  });
  if (receipt.status !== "success") throw new HttpError(400, "That refund transaction failed.");
  const refunds = refundsOf(receipt, merchantPay, paymentId);
  if (refunds.length === 0) throw new HttpError(400, "That transaction has no refund for this payment.");
  for (const { amount, totalRefunded } of refunds) await onRefund(paid.session, amount, totalRefunded, paid.payment.amount);
  return {
    payment_id: paymentId.toString(),
    refunds: refunds.map(({ amount, totalRefunded }) => ({ amount: plainUsdt(amount), total_refunded: plainUsdt(totalRefunded) })),
    tx_hash: txHash,
  };
}
