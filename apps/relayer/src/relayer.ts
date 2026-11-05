import {
  BaseError, ContractFunctionRevertedError, createWalletClient, encodeFunctionData, formatEther, getAddress, http,
  InternalRpcError, isAddress, isAddressEqual, isHex, keccak256, maxUint256, parseAbi, parseSignature, publicActions,
  recoverTypedDataAddress, type Address, type Hash, type Hex, type LocalAccount, type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';

const ANKR_RPC = 'https://rpc.ankr.com/whitechain_testnet';
const RPC_TIMEOUT_MS = 8_000; // also bounds how long one request can hold the send lock
const SYNC_SEND_TIMEOUT_MS = 4_000; // eth_sendRawTransactionSync inclusion wait (NFR-4: payment ≤ 5 s)
export const MAX_BODY_BYTES = 4096;

// Drain guard (ARCHITECTURE §3 points 4–6; limits approved by the human 2026-11-05 22:53).
const FEES = {
  gas: 400_000n,
  maxFeePerGas: 10_000_000_000n, // 10 gwei
  // ponytail: constant tip = the node's own suggestion (0.001 gwei). Upgrade: read eth_maxPriorityFeePerGas, capped, if the testnet gets busy.
  maxPriorityFeePerGas: 1_000_000n,
} as const;
const MIN_VALUE = 1_000_000n; // 1 USDT
const MAX_WINDOW_S = 900n; // validBefore ≤ now + 15 min
const MIN_REMAINING_S = 30n; // validBefore ≥ now + 30 s, so it can't expire before it is mined

const UINT_DECIMAL = /^\d{1,78}$/;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const SIG65_HEX = /^0x[0-9a-fA-F]{130}$/;

export const USDT: Address = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
export const USDT_DOMAIN = { name: 'Tether USD', version: '1', chainId: 1874, verifyingContract: USDT } as const;
const AUTH_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
} as const;
export const USDT_ABI = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);
// ponytail: Phase 1 stub ABI inlined; batch 004 imports MerchantPay's ABI from packages/shared.
export const PULL_STUB_ABI = parseAbi([
  'function pull(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
]);

type PullArgs = readonly [Address, bigint, bigint, bigint, Hex, number, Hex, Hex];
interface Pull { from: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; sig: Hex; args: PullArgs }
interface Reject { status: number; code: string; error: string; txHash?: Hash }
interface Sent { txHash: Hash; blockNumber: bigint }

export function makeClient(account: LocalAccount, transport: Transport) {
  return createWalletClient({ account, chain: whitechainSepolia, transport }).extend(publicActions);
}
export type RelayerClient = ReturnType<typeof makeClient>;

let liveClient: RelayerClient | undefined;

/** The live client: relayer key from the environment (never logged or returned), Ankr RPC by default. */
export function relayerClient(): RelayerClient {
  if (liveClient) return liveClient;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key || !BYTES32_HEX.test(key)) throw new Error('RELAYER_PRIVATE_KEY is missing or malformed');
  let account: LocalAccount;
  try {
    account = privateKeyToAccount(key as Hex);
  } catch {
    throw new Error('RELAYER_PRIVATE_KEY is not a valid private key'); // noble's own message prints the number
  }
  liveClient = makeClient(account, http(process.env.RPC_URL ?? ANKR_RPC, { timeout: RPC_TIMEOUT_MS }));
  return liveClient;
}

const reject = (status: number, code: string, error: string, txHash?: Hash): Reject => ({ status, code, error, txHash });
const respond = (r: Reject) => Response.json({ error: r.error, code: r.code, txHash: r.txHash }, { status: r.status });
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));
const reason = (e: unknown) => (e instanceof BaseError ? e.shortMessage : 'unexpected error');
const REPLAY = reject(422, 'replay', 'this authorization was already used');

// ponytail: in-process, one relayer process. Upgrade: a rel_sent table + Postgres advisory lock (batch 003, multi-instance Vercel).
const sentAuthorizations = new Set<string>();
const sentKey = (p: Pull) => `${p.from.toLowerCase()}:${p.nonce.toLowerCase()}`;
let sendQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = sendQueue.then(run, run);
  sendQueue = result.catch(() => undefined);
  return result;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function uint256(x: unknown): bigint | undefined {
  if (typeof x !== 'string' || !UINT_DECIMAL.test(x)) return undefined;
  const n = BigInt(x);
  return n <= maxUint256 ? n : undefined;
}

// A revert means "this authorization won't work" (422); anything else (RPC down) leaves the signature reusable (502).
function isRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  const revert = e.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return false;
  // viem also labels a JSON-RPC -32603 "Internal error" a revert; without hex revert data that's a node failure.
  return isHex(revert.raw) || e.walk((cause) => cause instanceof InternalRpcError) === null;
}

const simulationReject = (e: unknown) => isRevert(e)
  ? reject(422, 'would_revert', reason(e))
  : reject(502, 'rpc_error', 'the RPC node failed during simulation');

/** Validates a /relay body at the trust boundary. Never touches the chain. */
export function parsePull(body: string): { pull: Pull } | { error: string } {
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { error: 'body too large' };
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return { error: 'body is not JSON' };
  }
  if (!isRecord(input) || input.action !== 'pull') return { error: 'unknown action (this relayer supports "pull")' };
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
    const p = { from: getAddress(from), value, validAfter, validBefore, nonce: nonce as Hex, sig: sig as Hex };
    return { pull: { ...p, args: [p.from, value, validAfter, validBefore, p.nonce, yParity + 27, r, s] } };
  } catch {
    return { error: 'sig is not a valid signature' };
  }
}

/** Free checks: the time window, the minimum and the payer's signature. */
async function localChecks(p: Pull, target: Address): Promise<Reject | undefined> {
  const now = nowSeconds();
  if (p.validAfter > now) return reject(422, 'not_yet_valid', 'validAfter is in the future');
  if (p.validBefore < now + MIN_REMAINING_S) return reject(422, 'expired', 'validBefore must leave at least 30 s');
  if (p.validBefore > now + MAX_WINDOW_S) return reject(422, 'window_too_long', 'validBefore must be within 15 min');
  if (p.value < MIN_VALUE) return reject(422, 'below_minimum', 'value must be at least 1 USDT');
  const message = { from: p.from, to: target, value: p.value, validAfter: p.validAfter, validBefore: p.validBefore, nonce: p.nonce };
  const signer = await recoverTypedDataAddress({
    domain: USDT_DOMAIN, types: AUTH_TYPES, primaryType: 'ReceiveWithAuthorization', message, signature: p.sig,
  }).catch(() => undefined);
  // An ECDSA signature never recovers to a contract, so ERC-1271 payers stop here.
  if (!signer || !isAddressEqual(signer, p.from)) return reject(422, 'bad_signature', 'the signature is not from args.from for this target');
  if (sentAuthorizations.has(sentKey(p))) return REPLAY;
}

const simulate = (client: RelayerClient, target: Address, p: Pull) => client
  .simulateContract({ address: target, abi: PULL_STUB_ABI, functionName: 'pull', args: p.args, ...FEES })
  .then(() => undefined, (e: unknown) => e);

/** One parallel round of reads plus a gas-capped simulation; throws only if a read fails. */
async function rpcChecks(client: RelayerClient, p: Pull, target: Address): Promise<Reject | undefined> {
  const [used, code, balance, gasPrice, failedSimulation] = await Promise.all([
    client.readContract({ address: USDT, abi: USDT_ABI, functionName: 'authorizationState', args: [p.from, p.nonce] }),
    client.getCode({ address: p.from }),
    client.readContract({ address: USDT, abi: USDT_ABI, functionName: 'balanceOf', args: [p.from] }),
    client.getGasPrice(),
    simulate(client, target, p),
  ]);
  if (used) return REPLAY;
  if (code !== undefined && code !== '0x') return reject(422, 'payer_has_code', 'the payer must be a plain account (no contract code)');
  if (balance < p.value) return reject(422, 'insufficient_funds', 'the payer does not hold enough USDT');
  if (gasPrice > FEES.maxFeePerGas) return reject(503, 'gas_price_cap', 'network gas price is above the relayer cap; retry later');
  if (failedSimulation) return simulationReject(failedSimulation);
}

/** Runs inside the send lock: re-simulate on fresh state, sign with capped fees, send once, check the receipt. */
async function send(client: RelayerClient, p: Pull, target: Address): Promise<Reject | Sent> {
  if (p.validBefore < nowSeconds() + MIN_REMAINING_S) return reject(422, 'expired', 'validBefore must leave at least 30 s');
  if (sentAuthorizations.has(sentKey(p))) return REPLAY;
  let nonce: number;
  try {
    const [failedSimulation, pending] = await Promise.all([
      simulate(client, target, p),
      client.getTransactionCount({ address: client.account.address, blockTag: 'pending' }),
    ]);
    if (failedSimulation) return simulationReject(failedSimulation);
    nonce = pending;
  } catch (e) {
    return reject(502, 'rpc_error', reason(e));
  }
  const data = encodeFunctionData({ abi: PULL_STUB_ABI, functionName: 'pull', args: p.args });
  const signed = await client.account.signTransaction({ chainId: whitechainSepolia.id, type: 'eip1559', to: target, data, nonce, ...FEES });
  const txHash = keccak256(signed);
  sentAuthorizations.add(sentKey(p)); // kept even if the send fails: the tx may still be pending, so a re-POST must not pay twice
  try {
    const receipt = await client.sendRawTransactionSync({ serializedTransaction: signed, timeout: SYNC_SEND_TIMEOUT_MS });
    if (receipt.transactionHash.toLowerCase() !== txHash) return reject(502, 'receipt_mismatch', 'the node returned a receipt for another transaction', txHash);
    if (receipt.status !== 'success') return reject(502, 'reverted', 'the transaction was mined and reverted', txHash);
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (e) {
    return reject(502, 'rpc_error', reason(e), txHash);
  }
}

/**
 * POST /relay: parse → free checks → one RPC pre-check round → send lock (re-simulate, sign, sync send).
 * Every rejection happens before a transaction exists (AT-10), and the target and function are fixed (FR-REL-2).
 */
export async function relay(body: string, client: RelayerClient, target: Address): Promise<Response> {
  const parsed = parsePull(body);
  if ('error' in parsed) return respond(reject(400, 'bad_request', parsed.error));
  const local = await localChecks(parsed.pull, target);
  if (local) return respond(local);
  try {
    const pre = await rpcChecks(client, parsed.pull, target);
    if (pre) return respond(pre);
  } catch (e) {
    return respond(reject(502, 'rpc_error', reason(e)));
  }
  const result = await serialized(() => send(client, parsed.pull, target));
  if ('code' in result) return respond(result);
  return Response.json({ txHash: result.txHash, blockNumber: result.blockNumber.toString() });
}

/** GET /health (skeleton): the real WBT balance; spend, budget and fee fields arrive with batch 003's storage. */
export async function health(client: RelayerClient): Promise<Response> {
  try {
    const wei = await client.getBalance({ address: client.account.address });
    return Response.json({
      relayer: client.account.address, wbt: formatEther(wei),
      gasSpentToday: null, budgetLeft: null, usdtFeesUnswapped: null, paused: false,
    });
  } catch (e) {
    return Response.json({ error: reason(e), code: 'rpc_error' }, { status: 502 });
  }
}
