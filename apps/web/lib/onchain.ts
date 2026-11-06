// Server-only chain reads: our server's IP, not the customer's (FR-PRIV-1 covers browser reads only).
// The consumer rules (ARCHITECTURE §2, claude-contracts S6), never the relayer's 200 alone:
// - a sale is paid only if payments(saleOf(merchant, orderRef)) has gross == the session amount and payer == the signer;
// - an invoice payment counts only if payments(paymentId) has gross == amount + fee, payer == the signer and merchant ==
//   the invoice's merchant, and invoices(id).paid rose by amount (Phase 3: fee on top, partial payments allowed).
import { createPublicClient, decodeEventLog, http, isHash, pad, parseAbi, toEventSelector, toHex, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { EXPLORER, USDT } from "./usdt.ts";

const ANKR_1874 = "https://rpc.ankr.com/whitechain_testnet";
const READ_TIMEOUT_MS = 10_000;
const READ_TRIES = 5;
const READ_GAP_MS = 1_000; // about a block
const INDEX_TIMEOUT_MS = 5_000;

// ponytail: the getters and events copied from MerchantPay.sol. packages/shared/contracts.ts has the full ABI, but
// importing it needs turbopack.root set outside apps/web; the vector tests pin this copy's encoding.
const merchantPayAbi = parseAbi([
  "function saleOf(address merchant, bytes32 orderRef) view returns (uint256)",
  "function payments(uint256 paymentId) view returns (address merchant, uint96 gross, address payer, uint96 refunded)",
  "function invoices(uint256 id) view returns (address merchant, uint64 dueDate, uint8 status, address customer, uint128 amount, uint128 paid)",
  "function relayFee() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)", // USDT's, for the guest's balance
  "event InvoiceCreated(uint256 indexed id, address indexed merchant, address indexed customer, uint256 amount, uint64 dueDate, bytes32 refHash)",
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
]);

type ReadRequest = { address: Address; abi: typeof merchantPayAbi; functionName: "saleOf" | "payments" | "invoices" | "relayFee" | "balanceOf"; args: readonly unknown[]; blockNumber?: bigint };
type Read = (req: ReadRequest) => Promise<unknown>;
type ReadOptions = { blockNumber?: bigint; read?: Read; tries?: number; gapMs?: number };

// multicall batching: parallel reads (a dashboard's payments, an invoice and its fee) go out as one eth_call
const makeClient = () => createPublicClient({ chain: whitechainSepolia, batch: { multicall: true }, transport: http(ANKR_1874, { timeout: READ_TIMEOUT_MS, retryCount: 2 }) });
let client: ReturnType<typeof makeClient> | undefined;
const defaultRead: Read = (req) => (client ??= makeClient()).readContract(req as Parameters<ReturnType<typeof makeClient>["readContract"]>[0]);
const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

/** A read error is retried at the same block: Ankr load-balances, and a backend a block behind answers "header not
 *  found", which viem doesn't retry. Never falls back to a later block (that could hide a payment). */
async function retried<T>(fn: () => Promise<T>, { tries = READ_TRIES, gapMs = READ_GAP_MS }: ReadOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}

/** What a receipt tells us about a transaction's cost: execution gas and its price, plus the OP-stack L1 data fee. */
export interface FeeReceipt {
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  l1Fee?: bigint | null;
}
type ReadReceipt = (hash: Hex) => Promise<FeeReceipt>;
const defaultReceipt: ReadReceipt = (hash) => (client ??= makeClient()).getTransactionReceipt({ hash });

/** The network fee the relayer paid for one transaction, in wei: gas used × the price it paid, plus the L1 data fee
 *  (Whitechain Sepolia is an OP-stack chain; viem's formatter puts it on the receipt). Shown to merchants only. */
export async function readTxFee(txHash: Hex, { readReceipt = defaultReceipt, ...retry }: { readReceipt?: ReadReceipt; tries?: number; gapMs?: number } = {}): Promise<bigint> {
  const receipt = await retried(() => readReceipt(txHash), retry);
  return receipt.gasUsed * receipt.effectiveGasPrice + (receipt.l1Fee ?? 0n);
}

export interface SaleRef {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex;
  amount: bigint;
  /** The address that signed this checkout's approval. */
  payer: Address;
}

/** MerchantPay's payment id (decimal string) if this payer paid the order on-chain with exactly `amount`, else null. */
export async function saleSettled(sale: SaleRef, { blockNumber, read = defaultRead, ...retry }: ReadOptions = {}): Promise<string | null> {
  return retried(() => readSale(sale, blockNumber, read), retry);
}

async function readSale(sale: SaleRef, blockNumber: bigint | undefined, read: Read): Promise<string | null> {
  const at = { address: sale.merchantPay, abi: merchantPayAbi, blockNumber } as const;
  const id = (await read({ ...at, functionName: "saleOf", args: [sale.merchant, sale.orderRef] })) as bigint;
  if (id === 0n) return null;
  const [merchant, gross, payer] = (await read({ ...at, functionName: "payments", args: [id] })) as readonly [Address, bigint, Address, bigint];
  return gross === sale.amount && same(merchant, sale.merchant) && same(payer, sale.payer) ? id.toString() : null;
}

export interface PaymentRecord {
  merchant: Address; // zero if there is no such payment
  gross: bigint; // what the payer paid: a sale's price, or an invoice's credited amount + fee
  payer: Address;
  refunded: bigint;
}

/** payments(id) on chain (FR-PAY-8, FR-PAY-9). */
export async function readPayment(merchantPay: Address, paymentId: bigint, { blockNumber, read = defaultRead }: ReadOptions = {}): Promise<PaymentRecord> {
  const [merchant, gross, payer, refunded] = (await read({ address: merchantPay, abi: merchantPayAbi, functionName: "payments", args: [paymentId], blockNumber })) as readonly [Address, bigint, Address, bigint];
  return { merchant, gross, payer, refunded };
}

/** USDT units refunded so far on a payment (FR-PAY-9's refund status). */
export async function paymentRefunded(merchantPay: Address, paymentId: bigint, read: Read = defaultRead): Promise<bigint> {
  return (await readPayment(merchantPay, paymentId, { read })).refunded;
}

/** MerchantPay.relayFee(): what an invoice's payer adds on top (0.10 USDT today, at most 0.25). */
export async function readRelayFee(merchantPay: Address, { read = defaultRead, ...retry }: ReadOptions = {}): Promise<bigint> {
  return retried(async () => (await read({ address: merchantPay, abi: merchantPayAbi, functionName: "relayFee", args: [] })) as bigint, retry);
}

/** The guest's test USDT, so an unfunded guest hears "this is a demo" before anything is locked or relayed. */
export async function readUsdtBalance(owner: Address, { read = defaultRead, ...retry }: ReadOptions = {}): Promise<bigint> {
  return retried(async () => (await read({ address: USDT, abi: merchantPayAbi, functionName: "balanceOf", args: [owner] })) as bigint, retry); // security 005 F-N3
}

const INVOICE_STATUS = ["missing", "open", "paid", "cancelled"] as const; // MerchantPay InvoiceStatus None/Open/Paid/Cancelled

export interface Invoice {
  id: bigint;
  merchant: Address;
  dueDate: bigint; // unix seconds
  status: (typeof INVOICE_STATUS)[number]; // "paid" only once fully paid
  /** The customer wallet the merchant named, or the zero address (anyone may pay). Only it can acknowledge (batch 047). */
  customer: Address;
  amount: bigint;
  paid: bigint; // credited so far (partial payments are allowed)
}

/** invoices(id) on chain, its status in words ("missing" for an id that was never created). */
export async function readInvoice(merchantPay: Address, id: bigint, { blockNumber, read = defaultRead, ...retry }: ReadOptions = {}): Promise<Invoice> {
  return retried(async () => {
    const [merchant, dueDate, status, customer, amount, paid] = (await read({ address: merchantPay, abi: merchantPayAbi, functionName: "invoices", args: [id], blockNumber })) as readonly [Address, bigint, number, Address, bigint, bigint];
    return { id, merchant, dueDate, status: INVOICE_STATUS[status] ?? "missing", customer, amount, paid };
  }, retry);
}

export interface InvoicePaymentRef {
  merchantPay: Address;
  invoiceId: bigint;
  /** The relayer's payment id: only a pointer, checked here against the chain. */
  paymentId: bigint;
  /** The credited amount the customer paid (the fee came on top). */
  amount: bigint;
  fee: bigint;
  payer: Address;
  /** invoices(id).paid as our server read it before relaying. */
  paidBefore: bigint;
}

/** The invoice consumer rule, read at the relay's block. ponytail: "paid rose by amount" compares with our pre-relay
 *  read, so another payment to the same invoice in between reads as unconfirmed (pending), never as a false receipt. */
export async function invoicePaid(ref: InvoicePaymentRef, { blockNumber, read = defaultRead, ...retry }: ReadOptions = {}): Promise<boolean> {
  return retried(async () => {
    const [invoice, payment] = await Promise.all([
      readInvoice(ref.merchantPay, ref.invoiceId, { blockNumber, read, tries: 1 }),
      readPayment(ref.merchantPay, ref.paymentId, { blockNumber, read }),
    ]);
    return payment.gross === ref.amount + ref.fee && same(payment.payer, ref.payer) && same(payment.merchant, invoice.merchant) && invoice.paid === ref.paidBefore + ref.amount;
  }, retry);
}

// History comes from Blockscout's log index, not log scans (ARCHITECTURE §2: Ankr caps eth_getLogs at 1,000 blocks).
// Untrusted: it only says which ids to look at. Amounts, status and refunds are then read from the chain.
// ponytail: one page (Blockscout's etherscan-style getLogs returns at most 1,000 logs); paginate past that.
async function indexedLogs(merchantPay: Address, eventName: "InvoiceCreated" | "Paid", topic: { index: 1 | 2; value: Hex }) {
  const topic0 = toEventSelector(merchantPayAbi.find((item) => item.type === "event" && item.name === eventName)!);
  const query = new URLSearchParams({ module: "logs", action: "getLogs", address: merchantPay, fromBlock: "0", toBlock: "latest", topic0, [`topic${topic.index}`]: pad(topic.value).toLowerCase(), [`topic0_${topic.index}_opr`]: "and" });
  const res = await fetch(`${EXPLORER}/api?${query}`, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`log index answered ${res.status}`);
  const { result } = (await res.json()) as { result?: unknown };
  if (!Array.isArray(result)) throw new Error("log index sent no result");
  return result.flatMap((log: { address?: string; data?: Hex; topics?: [Hex, ...Hex[]]; transactionHash?: string; timeStamp?: string }) => {
    try {
      if (!log.address || !same(log.address as Address, merchantPay) || !log.topics || !log.data) return [];
      const { args, eventName: decoded } = decodeEventLog({ abi: merchantPayAbi, eventName, data: log.data, topics: log.topics, strict: true });
      if (decoded !== eventName) return []; // viem decodes by topic0 and ignores eventName: another event's log
      return [{ args, txHash: isHash(log.transactionHash ?? "") ? (log.transactionHash as Hex) : null, time: Number(BigInt(log.timeStamp ?? "0")) * 1000 }];
    } catch {
      return []; // not a log we can read
    }
  });
}

/** The merchant's invoices: ids from InvoiceCreated (indexed merchant), each read on chain, newest first. */
export async function merchantInvoices(merchantPay: Address, merchant: Address, read: Read = defaultRead): Promise<Invoice[]> {
  const logs = await indexedLogs(merchantPay, "InvoiceCreated", { index: 2, value: merchant });
  const ids = [...new Set(logs.map((log) => (log.args as { id: bigint }).id))];
  const invoices = await Promise.all(ids.map((id) => readInvoice(merchantPay, id, { read, tries: 2 })));
  return invoices.filter((invoice) => same(invoice.merchant, merchant)).sort((a, b) => (a.id < b.id ? 1 : -1));
}

export interface PaidLog {
  paymentId: bigint;
  invoiceId: bigint; // 0 for a checkout sale
  gross: bigint; // from the index: display only; refunds read payments(id)
  txHash: Hex | null;
  time: number; // ms
}

/** Paid logs of one merchant (indexed topic2) or of one payment (topic1). */
export async function paidLogs(merchantPay: Address, by: { merchant: Address } | { paymentId: bigint }): Promise<PaidLog[]> {
  const topic = "merchant" in by ? { index: 2 as const, value: by.merchant } : { index: 1 as const, value: toHex(by.paymentId) };
  const logs = await indexedLogs(merchantPay, "Paid", topic);
  return logs.flatMap(({ args, txHash, time }) => {
    const paid = args as { paymentId: bigint; merchant: Address; invoiceId: bigint; gross: bigint };
    const match = "merchant" in by ? same(paid.merchant, by.merchant) : paid.paymentId === by.paymentId;
    return match ? [{ paymentId: paid.paymentId, invoiceId: paid.invoiceId, gross: paid.gross, txHash, time }] : [];
  });
}
