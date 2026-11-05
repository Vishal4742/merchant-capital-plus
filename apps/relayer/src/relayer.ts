import {
  BaseError, ContractFunctionRevertedError, createWalletClient, formatEther, getAddress, http, InternalRpcError, isAddress,
  maxUint256, parseAbi, parseSignature,
  publicActions, type Account, type Address, type Hash, type Hex, type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';

const ANKR_RPC = 'https://rpc.ankr.com/whitechain_testnet';
const MAX_BODY_BYTES = 4096;
const RECEIPT_TIMEOUT_MS = 30_000;
const UINT_DECIMAL = /^\d{1,78}$/;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const SIG65_HEX = /^0x[0-9a-fA-F]{130}$/;

// ponytail: Phase 1 stub ABI inlined; Phase 2 imports MerchantPay's ABI from packages/shared.
export const PULL_STUB_ABI = parseAbi([
  'function pull(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
]);

type PullArgs = readonly [Address, bigint, bigint, bigint, Hex, number, Hex, Hex];
type Parsed = { args: PullArgs } | { error: string };

export function makeClient(account: Account, transport: Transport) {
  return createWalletClient({ account, chain: whitechainSepolia, transport }).extend(publicActions);
}
export type RelayerClient = ReturnType<typeof makeClient>;

let liveClient: RelayerClient | undefined;

/** The live client: relayer key from the environment (never logged or returned), Ankr RPC by default. */
export function relayerClient(): RelayerClient {
  if (liveClient) return liveClient;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key || !BYTES32_HEX.test(key)) throw new Error('RELAYER_PRIVATE_KEY is missing or malformed');
  liveClient = makeClient(privateKeyToAccount(key as Hex), http(process.env.RPC_URL ?? ANKR_RPC));
  return liveClient;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function uint256(x: unknown): bigint | undefined {
  if (typeof x !== 'string' || !UINT_DECIMAL.test(x)) return undefined;
  const n = BigInt(x);
  return n <= maxUint256 ? n : undefined;
}

function reason(e: unknown): string {
  return e instanceof BaseError ? e.shortMessage : 'unexpected error';
}

// A revert means "this authorization won't work" (422); anything else (RPC down) leaves the signature reusable (502).
function isRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  const revert = e.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return false;
  // viem also labels a JSON-RPC -32603 "Internal error" a revert; without revert data that's a node failure.
  return revert.raw !== undefined || e.walk((cause) => cause instanceof InternalRpcError) === null;
}

/** Validates a /relay body at the trust boundary. Never touches the chain. */
export function parsePull(body: string): Parsed {
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { error: 'body too large' };
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return { error: 'body is not JSON' };
  }
  if (!isRecord(input) || input.action !== 'pull') return { error: 'unknown action (Phase 1 supports "pull")' };
  const { args, sig } = input;
  if (!isRecord(args)) return { error: 'args must be an object' };
  const { from, nonce } = args;
  if (typeof from !== 'string' || !isAddress(from)) return { error: 'args.from must be an address' };
  const [value, validAfter, validBefore] = [args.value, args.validAfter, args.validBefore].map(uint256);
  if (value === undefined || validAfter === undefined || validBefore === undefined) {
    return { error: 'args.value, validAfter and validBefore must be uint256 decimal strings' };
  }
  if (value === 0n) return { error: 'args.value must be above 0' };
  if (typeof nonce !== 'string' || !BYTES32_HEX.test(nonce)) return { error: 'args.nonce must be 32 bytes of hex' };
  if (typeof sig !== 'string' || !SIG65_HEX.test(sig)) return { error: 'sig must be 65 bytes of hex' };
  try {
    const { r, s, yParity } = parseSignature(sig as Hex);
    return { args: [getAddress(from), value, validAfter, validBefore, nonce as Hex, yParity + 27, r, s] };
  } catch {
    return { error: 'sig is not a valid signature' };
  }
}

/**
 * POST /relay: validate, simulate as the relayer (never send a tx that would revert, FR-REL-3),
 * send to the fixed stub target, and answer once the receipt is in.
 * ponytail: no send lock, so two concurrent requests can pick the same nonce.
 * Upgrade: Postgres advisory lock around sends (Phase 2, ARCHITECTURE §3).
 */
export async function relay(body: string, client: RelayerClient, stub: Address): Promise<Response> {
  const parsed = parsePull(body);
  if ('error' in parsed) return Response.json(parsed, { status: 400 });

  const simulation = await client
    .simulateContract({ address: stub, abi: PULL_STUB_ABI, functionName: 'pull', args: parsed.args })
    .catch((e: unknown) => ({ error: reason(e), status: isRevert(e) ? 422 : 502 }));
  if ('error' in simulation) return Response.json({ error: simulation.error }, { status: simulation.status });

  let txHash: Hash | undefined;
  try {
    txHash = await client.writeContract(simulation.request);
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== 'success') return Response.json({ error: 'transaction reverted', txHash }, { status: 502 });
    return Response.json({ txHash, blockNumber: receipt.blockNumber.toString() });
  } catch (e) {
    return Response.json({ error: reason(e), txHash }, { status: 502 });
  }
}

/** GET /health (Phase 1 skeleton): the real WBT balance; spend, budget and fee fields need Phase 2 storage. */
export async function health(client: RelayerClient): Promise<Response> {
  try {
    const wei = await client.getBalance({ address: client.account.address });
    return Response.json({
      relayer: client.account.address, wbt: formatEther(wei),
      gasSpentToday: null, budgetLeft: null, usdtFeesUnswapped: null, paused: false,
    });
  } catch (e) {
    return Response.json({ error: reason(e) }, { status: 502 });
  }
}
