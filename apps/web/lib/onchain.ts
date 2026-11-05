// Server-only chain reads: our server's IP, not the customer's (FR-PRIV-1 covers browser reads only).
// The consumer rule (ARCHITECTURE §2, claude-contracts S6): an order counts as paid only if
// payments(saleOf(merchant, orderRef)) has gross == the session amount and payer == the customer who signed.
// The relayer's 200 alone is not enough.
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";

const ANKR_1874 = "https://rpc.ankr.com/whitechain_testnet";
const READ_TIMEOUT_MS = 10_000;
const READ_TRIES = 5;
const READ_GAP_MS = 1_000; // about a block

// ponytail: two getters copied from MerchantPay.sol. packages/shared/merchantPay.ts is on main now; importing it needs
// turbopack.root set outside apps/web, so the vector tests guard this copy until the address switch (G2 plan F2).
const merchantPayAbi = parseAbi([
  "function saleOf(address merchant, bytes32 orderRef) view returns (uint256)",
  "function payments(uint256 paymentId) view returns (address merchant, uint96 gross, address payer, uint96 refunded)",
]);

type ReadRequest = { address: Address; abi: typeof merchantPayAbi; functionName: "saleOf" | "payments"; args: readonly unknown[]; blockNumber?: bigint };
type Read = (req: ReadRequest) => Promise<unknown>;

const makeClient = () => createPublicClient({ chain: whitechainSepolia, transport: http(ANKR_1874, { timeout: READ_TIMEOUT_MS, retryCount: 2 }) });
let client: ReturnType<typeof makeClient> | undefined;
const defaultRead: Read = (req) => (client ??= makeClient()).readContract(req as Parameters<ReturnType<typeof makeClient>["readContract"]>[0]);

export interface SaleRef {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex;
  amount: bigint;
  /** The address that signed this checkout's approval. */
  payer: Address;
}

/** MerchantPay's payment id (decimal string) if this payer paid the order on-chain with exactly `amount`, else null.
 *  A read error is retried at the same block: Ankr load-balances, and a backend a block behind answers "header not
 *  found", which viem doesn't retry. Never falls back to a later block (that could hide a payment). */
export async function saleSettled(
  sale: SaleRef,
  { blockNumber, read = defaultRead, tries = READ_TRIES, gapMs = READ_GAP_MS }: { blockNumber?: bigint; read?: Read; tries?: number; gapMs?: number } = {},
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readSale(sale, blockNumber, read);
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}

async function readSale(sale: SaleRef, blockNumber: bigint | undefined, read: Read): Promise<string | null> {
  const at = { address: sale.merchantPay, abi: merchantPayAbi, blockNumber } as const;
  const id = (await read({ ...at, functionName: "saleOf", args: [sale.merchant, sale.orderRef] })) as bigint;
  if (id === 0n) return null;
  const [merchant, gross, payer] = (await read({ ...at, functionName: "payments", args: [id] })) as readonly [Address, bigint, Address, bigint];
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  return gross === sale.amount && same(merchant, sale.merchant) && same(payer, sale.payer) ? id.toString() : null;
}

/** USDT units refunded so far on a payment (FR-PAY-9's refund status). */
export async function paymentRefunded(merchantPay: Address, paymentId: bigint, read: Read = defaultRead): Promise<bigint> {
  const [, , , refunded] = (await read({ address: merchantPay, abi: merchantPayAbi, functionName: "payments", args: [paymentId] })) as readonly [Address, bigint, Address, bigint];
  return refunded;
}
