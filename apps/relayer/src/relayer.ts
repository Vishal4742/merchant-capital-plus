import {
  BaseError, ContractFunctionRevertedError, createWalletClient, encodeAbiParameters, encodeFunctionData, formatEther,
  getAddress, http, InternalRpcError, isAddress, isAddressEqual, isHex, keccak256, maxUint256, parseAbi, parseEventLogs,
  parseSignature, publicActions, recoverTypedDataAddress, TransactionReceiptNotFoundError, zeroAddress, zeroHash,
  type Address, type Hash, type Hex, type LocalAccount, type Transport,
} from 'viem';
import { setTimeout as sleep } from 'node:timers/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';
import {
  addresses, capitalMarketAbi, KIND_INVOICE, KIND_SALE, merchantPayAbi, MIN_PAYMENT, nonceParams, receiveWithAuthorizationTypes, usdtDomain,
} from './contracts.ts';
import * as store from './store.ts';
import { StoreError } from './store.ts';

// Ankr (G2 06:06: Whitechain's own RPC refused eth_sendRawTransactionSync with -32601, so the default went back to Ankr;
// sends are plain eth_sendRawTransaction now). Upgrade: try Whitechain's RPC again for reads, which were ~2× faster.
const DEFAULT_RPC = 'https://rpc.ankr.com/whitechain_testnet';
// No retries: with viem's default 3, one slow call could hold the send lock for ~33 s. The lock is then held for at most
// two RPC timeouts (simulate ‖ nonce, then the sync send); a client re-POSTs a 502 that carries no txHash.
const RPC_TIMEOUT_MS = 8_000;
// NFR-4 (payment ≤ 5 s): Ankr's eth_sendRawTransactionSync waited ~7 s for a 1 s-block chain (G2, 06:16), so send plainly
// and poll our own receipt. Tests shrink these.
// 1 s blocks: ~4 polls per block. Worst case after the age gate: the 8 s send timeout + the 8 s poll (+ one poll's
// overrun), about 37-44 s: past the web's 35 s, which it treats as unknown (it polls the chain), and under the 60 s maxDuration.
// leasePollMs: how often a request waits for another instance's send lock (FR-REL-10).
export const TIMING = { receiptPollMs: 250, receiptTimeoutMs: 8_000, maxRequestAgeMs: 20_000, leasePollMs: 100 };
const BALANCE_TTL_MS = 5_000; // /health WBT balance may be 5 s old (human 23:27, NFR-14 ≤ 300 ms p95); a send clears it
// Refresh it every 3 s (human 01:14): stays inside the 5 s rule and keeps the RPC socket warm (Node drops idle ones at ~4 s).
const BALANCE_REFRESH_MS = 3_000;
const FEE_TTL_MS = 60_000; // MerchantPay.relayFee() for invoice signatures (owner-set; rarely changes)
export const MAX_BODY_BYTES = 4096;

// Drain guard (ARCHITECTURE §3 points 4–6; limits approved by the human 2026-11-05 22:53).
const FEES = {
  // ≥ 335k: a sale that repays an advance used 278k (claude-review 01:07). Many-holder routings above 400k are refused.
  gas: 400_000n,
  maxFeePerGas: 6_000_000_000n, // 6 gwei: break-even ≈6.2 gwei at 217k gas and the 0.10 USDT fee (human 00:45, drain review R5)
  // ponytail: constant tip = the node's own suggestion (0.001 gwei). Upgrade: read eth_maxPriorityFeePerGas, capped, if the testnet gets busy.
  maxPriorityFeePerGas: 1_000_000n,
} as const;
const MAX_WINDOW_S = 900n; // validBefore ≤ now + 15 min
const MIN_REMAINING_S = 30n; // validBefore ≥ now + 30 s, so it can't expire before it is mined
// Limits (human 03:09) and the breaker (human 02:44, ARCHITECTURE §3 points 8 and 12).
const DAILY_BUDGET_WEI = 100_000_000_000_000_000n; // 0.1 WBT per UTC day
const CAP_FEE_WEI = FEES.gas * FEES.maxFeePerGas; // the most one send can cost: 0.0024 WBT
const PAYER_SENDS_PER_HOUR = 10;
const MERCHANT_SENDS_PER_HOUR = 200;
const BREAKER_REVERTS_PER_HOUR = 3;

const UINT_DECIMAL = /^\d{1,78}$/;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const SIG65_HEX = /^0x[0-9a-fA-F]{130}$/;

// The allowlist (FR-REL-2): exactly three calls: MerchantPay.paySale and .payInvoice here, and
// CapitalMarket.fundWithAuthorization below. refund is the merchant's own tx.
const MERCHANT_PAY = getAddress(addresses.merchantPay);
// Investor funding (human 08:20): CapitalMarket.fundWithAuthorization. No relay fee, so funding below 1 USDT is refused.
const CAPITAL_MARKET = getAddress(addresses.capitalMarket);
const FORBIDDEN_MERCHANTS = new Set([zeroAddress, addresses.merchantPay, addresses.capitalMarket, addresses.usdt].map((a) => a.toLowerCase()));
export const USDT = getAddress(addresses.usdt);
export const USDT_DOMAIN = usdtDomain;
export const USDT_ABI = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

type SaleArgs = readonly [Address, Hex, Address, bigint, bigint, bigint, Hex, number, Hex, Hex];
type InvoiceArgs = readonly [bigint, Address, bigint, bigint, bigint, Hex, number, Hex, Hex];
type FundArgs = readonly [bigint, Address, bigint, bigint, bigint, Hex, number, Hex, Hex];
type Call = { functionName: 'paySale'; args: SaleArgs } | { functionName: 'payInvoice'; args: InvoiceArgs }
  | { functionName: 'fundWithAuthorization'; args: FundArgs };
/** A parsed payment: what the payer authorized (USDT EIP-3009) and the MerchantPay call that pulls it. */
interface Payment {
  from: Address; amount: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; sig: Hex; call: Call;
  merchant?: Address; // sales only
  feeOnTop: boolean; // invoices: the payer signs amount + relayFee
  target: Address; // MerchantPay for sales and invoices, CapitalMarket for funding
}
interface Reject { status: number; code: string; error: string; txHash?: Hash }
interface Sent { txHash: Hash; blockNumber: bigint; paymentId?: bigint; gasUsed: bigint; gasCostWei: bigint }

export function makeClient(account: LocalAccount, transport: Transport) {
  return createWalletClient({ account, chain: whitechainSepolia, transport }).extend(publicActions);
}
export type RelayerClient = ReturnType<typeof makeClient>;

let liveClient: RelayerClient | undefined;

/** The live client: relayer key from the environment (never logged or returned), Whitechain's RPC by default. */
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
  // batch: one HTTP request per round keeps it on the warm socket (cold 5-call round 916 → 345 ms on Ankr).
  liveClient = makeClient(account, http(process.env.RPC_URL ?? DEFAULT_RPC, { timeout: RPC_TIMEOUT_MS, retryCount: 0, batch: true }));
  // ponytail: only a long-running process keeps refreshing; on Vercel the first /health of an invocation may read live.
  startBalanceRefresh(liveClient, BALANCE_REFRESH_MS);
  return liveClient;
}

const reject = (status: number, code: string, error: string, txHash?: Hash): Reject => ({ status, code, error, txHash });
const respond = (r: Reject) => Response.json({ error: r.error, code: r.code, txHash: r.txHash }, { status: r.status });
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));
const reason = (e: unknown) => (e instanceof BaseError ? e.shortMessage : 'unexpected error');
const REPLAY = reject(422, 'replay', 'this authorization was already used');
const EXPIRED = reject(422, 'expired', 'validBefore must leave at least 30 s');
const tooLate = (p: Payment) => p.validBefore < nowSeconds() + MIN_REMAINING_S;

const balances = new Map<Address, { wei: bigint; at: number }>();
const balanceReads = new Map<Address, Promise<bigint>>(); // single-flight: a /health burst shares one RPC read
let sendCount = 0; // a balance read that overlaps a send is returned but not cached
async function wbtBalance(client: RelayerClient, fresh = false): Promise<bigint> {
  const address = client.account.address;
  const hit = balances.get(address);
  if (!fresh && hit && Date.now() - hit.at < BALANCE_TTL_MS) return hit.wei;
  const pending = balanceReads.get(address);
  if (!fresh && pending) return pending;
  const sendsBefore = sendCount;
  const read = client.getBalance({ address }).then((wei) => {
    if (sendCount === sendsBefore) balances.set(address, { wei, at: Date.now() });
    return wei;
  });
  balanceReads.set(address, read);
  const clear = () => { if (balanceReads.get(address) === read) balanceReads.delete(address); };
  read.then(clear, clear);
  return read;
}

/** Re-reads the WBT balance every `everyMs` until stopped; never keeps the process alive on its own. */
export function startBalanceRefresh(client: RelayerClient, everyMs: number): () => void {
  const timer = setInterval(() => wbtBalance(client, true).catch(() => undefined), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

const authKey = (p: Payment) => store.authKey(p.from, p.nonce);

/** Replay, breaker, ban, budget and rate limits, from the table every instance writes (FR-REL-10). No RPC, so they run
 *  before the RPC round, and again once this request holds the send lock. */
async function ledgerChecks(client: RelayerClient, p: Payment): Promise<Reject | undefined> {
  const c = await store.counters(client.account.address, p.from, p.merchant, authKey(p), Date.now());
  if (c.sent) return REPLAY;
  if (c.revertsLastHour >= BREAKER_REVERTS_PER_HOUR) return reject(503, 'breaker_open', 'relaying is paused after repeated reverts; retry later');
  if (c.banned) return reject(422, 'payer_banned', 'this payer caused a reverted relay');
  if (c.spentWei + CAP_FEE_WEI > DAILY_BUDGET_WEI) return reject(503, 'budget_exhausted', "today's relay budget is used up; retry tomorrow");
  if (c.payerSendsLastHour >= PAYER_SENDS_PER_HOUR || (p.merchant && c.merchantSendsLastHour >= MERCHANT_SENDS_PER_HOUR)) {
    return reject(429, 'rate_limited', 'too many payments in the last hour; retry later');
  }
}

/** After a receipt: its real fee and a mined revert (which bans the payer and feeds the breaker). A send without a
 *  receipt keeps the worst-case fee it was reserved with. */
async function settleSend(p: Payment, feeWei: bigint, minedRevert: boolean, txHash: Hash) {
  if (minedRevert) process.stderr.write(`ALERT reverted ${txHash} payer ${p.from}\n`);
  await store.settle(authKey(p), feeWei, minedRevert)
    .catch(() => process.stderr.write(`ALERT could not record the receipt of ${txHash}; its worst-case fee stays counted\n`));
}

let feeRead: { at: number; fee: Promise<bigint> } | undefined;
/** MerchantPay.relayFee(), single-flight and cached for 60 s; a failed read is not cached. */
function relayFee(client: RelayerClient): Promise<bigint> {
  if (feeRead && Date.now() - feeRead.at < FEE_TTL_MS) return feeRead.fee;
  const fee = client.readContract({ address: MERCHANT_PAY, abi: merchantPayAbi, functionName: 'relayFee' });
  feeRead = { at: Date.now(), fee };
  fee.catch(() => { feeRead = undefined; });
  return fee;
}

// One request at a time per instance, in arrival order, in front of the shared lease (so an instance never polls it twice).
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

const bytes32 = (x: unknown): Hex | undefined => (typeof x === 'string' && BYTES32_HEX.test(x) ? (x as Hex) : undefined);

// MerchantPay's nonce: keccak256(abi.encode(chainid, merchantPay, kind, ref, orderRef, amount, salt)) (packages/shared nonceParams).
const merchantPayNonce = (kind: number, ref: bigint, orderRef: Hex, amount: bigint, salt: Hex) =>
  keccak256(encodeAbiParameters(nonceParams, [BigInt(whitechainSepolia.id), MERCHANT_PAY, kind, ref, orderRef, amount, salt]));

// A revert means "this authorization won't work" (422); anything else (RPC down) leaves the signature reusable (502).
function revertOf(e: unknown): ContractFunctionRevertedError | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const revert = e.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return undefined;
  // viem also labels a JSON-RPC -32603 "Internal error" a revert; without hex revert data that's a node failure.
  return isHex(revert.raw) || e.walk((cause) => cause instanceof InternalRpcError) === null ? revert : undefined;
}

function simulationReject(e: unknown): Reject {
  const revert = revertOf(e);
  if (!revert) return reject(502, 'rpc_error', 'the RPC node failed during simulation');
  const name = revert.data?.errorName;
  if (name === 'OrderPaid' || name === 'InvoiceNotOpen') return reject(422, 'order_paid', 'this order or invoice is already paid');
  if (name === 'WrongAmount') return reject(422, 'wrong_amount', 'the amount does not match what the invoice still owes');
  if (name === 'InvalidOrder') return reject(422, 'bad_merchant', 'this merchant address is not allowed');
  if (name === 'EnforcedPause') return reject(503, 'paused', 'payments are paused; retry later');
  return reject(422, 'would_revert', reason(e));
}

/** Validates a /relay body at the trust boundary. Never touches the chain. */
export function parsePayment(body: string): { payment: Payment } | { error: string } {
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { error: 'body too large' };
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return { error: 'body is not JSON' };
  }
  if (!isRecord(input) || (input.action !== 'paySale' && input.action !== 'payInvoice' && input.action !== 'fund')) {
    return { error: 'unknown action (this relayer supports "paySale", "payInvoice" and "fund")' };
  }
  const { args, sig } = input;
  if (!isRecord(args)) return { error: 'args must be an object' };
  if (input.action === 'fund') return parseFunding(args, sig);
  if (typeof args.from !== 'string' || !isAddress(args.from)) return { error: 'args.from must be an address' };
  const [amount, validAfter, validBefore] = [args.amount, args.validAfter, args.validBefore].map(uint256);
  if (amount === undefined || validAfter === undefined || validBefore === undefined) {
    return { error: 'args.amount, validAfter and validBefore must be uint256 decimal strings' };
  }
  if (amount === 0n) return { error: 'args.amount must be above 0' };
  const salt = bytes32(args.salt);
  if (!salt) return { error: 'args.salt must be 32 bytes of hex' };
  if (typeof sig !== 'string' || !SIG65_HEX.test(sig)) return { error: 'sig must be 65 bytes of hex' };
  let v: number, r: Hex, s: Hex;
  try {
    const parts = parseSignature(sig as Hex);
    [v, r, s] = [parts.yParity + 27, parts.r, parts.s];
  } catch {
    return { error: 'sig is not a valid signature' };
  }
  const from = getAddress(args.from);
  const base = { from, amount, validAfter, validBefore, sig: sig as Hex };
  if (input.action === 'paySale') {
    if (typeof args.merchant !== 'string' || !isAddress(args.merchant)) return { error: 'args.merchant must be an address' };
    const orderRef = bytes32(args.orderRef);
    if (!orderRef || BigInt(orderRef) === 0n) return { error: 'args.orderRef must be 32 non-zero bytes of hex' };
    const merchant = getAddress(args.merchant);
    const nonce = merchantPayNonce(KIND_SALE, BigInt(merchant), orderRef, amount, salt);
    const call: Call = { functionName: 'paySale', args: [merchant, orderRef, from, amount, validAfter, validBefore, salt, v, r, s] };
    return { payment: { ...base, nonce, call, merchant, feeOnTop: false, target: MERCHANT_PAY } };
  }
  const invoiceId = uint256(args.invoiceId);
  if (invoiceId === undefined) return { error: 'args.invoiceId must be a uint256 decimal string' };
  const nonce = merchantPayNonce(KIND_INVOICE, invoiceId, zeroHash, amount, salt);
  const call: Call = { functionName: 'payInvoice', args: [invoiceId, from, amount, validAfter, validBefore, salt, v, r, s] };
  return { payment: { ...base, nonce, call, feeOnTop: true, target: MERCHANT_PAY } };
}

/** fund: {claimId, investor, units, validAfter, validBefore, salt}; the quote and the nonce come from the chain (prepareFunding). */
function parseFunding(args: Record<string, unknown>, sig: unknown): { payment: Payment } | { error: string } {
  if (typeof args.investor !== 'string' || !isAddress(args.investor)) return { error: 'args.investor must be an address' };
  const [claimId, units, validAfter, validBefore] = [args.claimId, args.units, args.validAfter, args.validBefore].map(uint256);
  if (claimId === undefined || units === undefined || validAfter === undefined || validBefore === undefined) {
    return { error: 'args.claimId, units, validAfter and validBefore must be uint256 decimal strings' };
  }
  if (units === 0n) return { error: 'args.units must be above 0' };
  const salt = bytes32(args.salt);
  if (!salt) return { error: 'args.salt must be 32 bytes of hex' };
  if (typeof sig !== 'string' || !SIG65_HEX.test(sig)) return { error: 'sig must be 65 bytes of hex' };
  try {
    const { r, s, yParity } = parseSignature(sig as Hex);
    const investor = getAddress(args.investor);
    const call: Call = { functionName: 'fundWithAuthorization', args: [claimId, investor, units, validAfter, validBefore, salt, yParity + 27, r, s] };
    // amount and nonce are filled from CapitalMarket.quote / fundingNonce before any check runs
    return { payment: { from: investor, amount: 0n, validAfter, validBefore, nonce: zeroHash, sig: sig as Hex, call, feeOnTop: false, target: CAPITAL_MARKET } };
  } catch {
    return { error: 'sig is not a valid signature' };
  }
}

/** The value and nonce the investor signed, as CapitalMarket computes them (one batched read). */
async function prepareFunding(client: RelayerClient, p: Payment): Promise<Payment> {
  if (p.call.functionName !== 'fundWithAuthorization') return p;
  const [claimId, investor, units, , , salt] = p.call.args;
  const [amount, nonce] = await Promise.all([
    client.readContract({ address: CAPITAL_MARKET, abi: capitalMarketAbi, functionName: 'quote', args: [claimId, units] }),
    client.readContract({ address: CAPITAL_MARKET, abi: capitalMarketAbi, functionName: 'fundingNonce', args: [claimId, investor, units, salt] }),
  ]);
  return { ...p, amount, nonce };
}

/** What the payer must hold and sign: the sale price, or an invoice's credited amount + relayFee. */
const signedValue = async (client: RelayerClient, p: Payment) => (p.feeOnTop ? p.amount + (await relayFee(client)) : p.amount);

/** Free checks (the relayFee read for invoices is cached): merchant, window, minimum, signature, sent set. */
async function localChecks(client: RelayerClient, p: Payment): Promise<Reject | undefined> {
  if (p.merchant && FORBIDDEN_MERCHANTS.has(p.merchant.toLowerCase())) return reject(422, 'bad_merchant', 'this merchant address is not allowed');
  const now = nowSeconds();
  if (p.validAfter > now) return reject(422, 'not_yet_valid', 'validAfter is in the future');
  if (tooLate(p)) return EXPIRED;
  if (p.validBefore > now + MAX_WINDOW_S) return reject(422, 'window_too_long', 'validBefore must be within 15 min');
  // Sales: at least 1 USDT. Invoices: the contract allows an exact remainder below 1 USDT and enforces its own rule.
  if (!p.feeOnTop && p.amount < MIN_PAYMENT) return reject(422, 'below_minimum', 'amount must be at least 1 USDT');
  const message = { from: p.from, to: p.target, value: await signedValue(client, p), validAfter: p.validAfter, validBefore: p.validBefore, nonce: p.nonce };
  const signer = await recoverTypedDataAddress({
    domain: usdtDomain, types: receiveWithAuthorizationTypes, primaryType: 'ReceiveWithAuthorization', message, signature: p.sig,
  }).catch(() => undefined);
  // An ECDSA signature never recovers to a contract, so ERC-1271 payers stop here.
  if (!signer || !isAddressEqual(signer, p.from)) return reject(422, 'bad_signature', 'the signature is not from args.from for this payment');
  return ledgerChecks(client, p);
}

function simulateCall(client: RelayerClient, p: Payment) {
  switch (p.call.functionName) {
    case 'paySale': return client.simulateContract({ address: MERCHANT_PAY, abi: merchantPayAbi, functionName: 'paySale', args: p.call.args, ...FEES });
    case 'payInvoice': return client.simulateContract({ address: MERCHANT_PAY, abi: merchantPayAbi, functionName: 'payInvoice', args: p.call.args, ...FEES });
    case 'fundWithAuthorization':
      return client.simulateContract({ address: CAPITAL_MARKET, abi: capitalMarketAbi, functionName: 'fundWithAuthorization', args: p.call.args, ...FEES });
  }
}
const simulate = (client: RelayerClient, p: Payment) => simulateCall(client, p).then(() => undefined, (e: unknown) => e);

function calldata(p: Payment): Hex {
  switch (p.call.functionName) {
    case 'paySale': return encodeFunctionData({ abi: merchantPayAbi, functionName: 'paySale', args: p.call.args });
    case 'payInvoice': return encodeFunctionData({ abi: merchantPayAbi, functionName: 'payInvoice', args: p.call.args });
    case 'fundWithAuthorization': return encodeFunctionData({ abi: capitalMarketAbi, functionName: 'fundWithAuthorization', args: p.call.args });
  }
}

/** One parallel round of reads, a gas estimate and a gas-capped simulation; throws only if a read fails. */
async function rpcChecks(client: RelayerClient, p: Payment): Promise<Reject | undefined> {
  const value = await signedValue(client, p);
  const [used, code, balance, gasPrice, failedSimulation, gasNeeded] = await Promise.all([
    client.readContract({ address: USDT, abi: USDT_ABI, functionName: 'authorizationState', args: [p.from, p.nonce] }),
    client.getCode({ address: p.from }),
    client.readContract({ address: USDT, abi: USDT_ABI, functionName: 'balanceOf', args: [p.from] }),
    client.getGasPrice(),
    simulate(client, p),
    // the plain address, so viem doesn't fill nonce and fees first; an estimate reverts whenever the call would, and
    // then the gas-capped simulation decides (claude-contracts Q19: a 3-holder invoice repayment needs 421,338 gas)
    client.estimateGas({ account: client.account.address, to: p.target, data: calldata(p) }).catch(() => undefined),
  ]);
  if (used) return REPLAY;
  if (code !== undefined && code !== '0x') return reject(422, 'payer_has_code', 'the payer must be a plain account (no contract code)');
  if (balance < value) return reject(422, 'insufficient_funds', 'the payer does not hold enough USDT');
  if (gasPrice > FEES.maxFeePerGas) return reject(503, 'gas_price_cap', 'network gas price is above the relayer cap; retry later');
  if (gasNeeded !== undefined && gasNeeded > FEES.gas) return reject(422, 'too_much_gas', `this payment needs ${gasNeeded} gas, above the relayer's ${FEES.gas} limit`);
  if (failedSimulation) return simulationReject(failedSimulation);
}

/** Our own receipt, looked up by our hash only (so never a replacement's), polled until TIMING.receiptTimeoutMs.
 *  A 429 or 5xx mid-poll doesn't end it (security 018 F1b): only the deadline does, and then the last error is thrown. */
async function ownReceipt(client: RelayerClient, hash: Hash) {
  const deadline = Date.now() + TIMING.receiptTimeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError)) lastError = e;
    }
    if (Date.now() >= deadline) {
      if (lastError) throw lastError;
      return undefined;
    }
    await sleep(TIMING.receiptPollMs);
  }
}

type Step = 'checks' | 'queue' | 'presend' | 'send' | 'receipt';

/** Wall time per step in whole ms (NFR-4 on the deployed relayer): each lap is the time since the previous one. */
function stopwatch() {
  const start = performance.now();
  let last = start;
  let laps: Partial<Record<Step, number>> = {};
  return {
    lap(step: Step) {
      const now = performance.now();
      laps = { ...laps, [step]: Math.round(now - last) };
      last = now;
    },
    read: () => ({ ...laps, total: Math.round(performance.now() - start) }),
  };
}
type Stopwatch = ReturnType<typeof stopwatch>;
let relays = 0; // the first /relay of this process is the cold one
// Queued behind a hung send (security 018 F4): never sign after the web has given up. Nothing was sent, so 503: the web
// shows it as "Nothing was charged; try again" (security 022 L1).
const tooOld = (clock: Stopwatch) => clock.read().total > TIMING.maxRequestAgeMs;
const QUEUED_TOO_LONG = reject(503, 'busy', 'the relayer was too slow to start this payment; nothing was sent, so retry');
// Another instance took the send lock between our checks and the broadcast (its lease ran out on us): don't broadcast.
const LEASE_LOST = reject(503, 'busy', 'another relayer instance took over the send lock; nothing was sent, so retry');
const STORAGE_DOWN = reject(503, 'storage_error', 'the relayer database is unavailable; nothing was sent, so retry');
function storageDown(e: StoreError): Reject {
  const cause = e.cause instanceof Error ? e.cause.name : 'error';
  console.error(`relayer: storage error (${cause})`); // the name only: a driver message may quote the connection string
  return STORAGE_DOWN;
}

/** The send lock across instances (FR-REL-10): a lease row, polled until the age gate, released in `finally`
 *  (a crashed instance's lease expires after store.LEASE_MS). */
async function leased(client: RelayerClient, clock: Stopwatch, run: (holder: string) => Promise<Reject | Sent>): Promise<Reject | Sent> {
  const holder = crypto.randomUUID();
  while (!(await store.acquire(client.account.address, holder, Date.now()))) {
    if (tooOld(clock)) return QUEUED_TOO_LONG;
    await sleep(TIMING.leasePollMs);
  }
  try {
    return await run(holder);
  } finally {
    await store.release(client.account.address, holder)
      .catch(() => process.stderr.write(`relayer: lease release failed; it expires in ${store.LEASE_MS / 1000} s\n`));
  }
}

/** Runs inside the send lock: re-check the shared ledger, re-simulate on fresh state, sign with capped fees, reserve
 *  the send in the shared table (fencing), send once, poll our receipt. */
async function send(client: RelayerClient, p: Payment, clock: Stopwatch, holder: string): Promise<Reject | Sent> {
  clock.lap('queue');
  if (tooOld(clock)) return QUEUED_TOO_LONG; // before any RPC in the lock (security 022 L2)
  if (tooLate(p)) return EXPIRED; // queue time counts
  // queued requests: the budget, the breaker or a copy's send may have moved while we waited; from here until the
  // release no other instance can send, so this one read holds
  const ledger = await ledgerChecks(client, p);
  if (ledger) return ledger;
  let nonce: number;
  try {
    const [failedSimulation, pending] = await Promise.all([
      simulate(client, p),
      client.getTransactionCount({ address: client.account.address, blockTag: 'pending' }),
    ]);
    if (failedSimulation) return simulationReject(failedSimulation);
    nonce = pending;
  } catch (e) {
    return reject(502, 'rpc_error', reason(e));
  }
  if (tooLate(p)) return EXPIRED; // and so does a slow simulate/nonce step: never sign what could expire unmined
  if (tooOld(clock)) return QUEUED_TOO_LONG; // and the simulate/nonce round may have been slow too
  const signed = await client.account.signTransaction({
    chainId: whitechainSepolia.id, type: 'eip1559', to: p.target, data: calldata(p), nonce, ...FEES,
  });
  const txHash = keccak256(signed);
  // Written before the broadcast with the worst-case fee and never deleted: the tx may still be pending after a failed
  // send, so a re-POST to any instance must not pay twice. A database error here throws: nothing is broadcast.
  const reserved = await store.reserve({
    relayer: client.account.address, holder, key: authKey(p), payer: p.from, merchant: p.merchant, txHash, feeWei: CAP_FEE_WEI,
  }, Date.now());
  if (reserved === 'lost') return LEASE_LOST;
  if (reserved === 'replay') return REPLAY;
  clock.lap('presend');
  try {
    await client.sendRawTransaction({ serializedTransaction: signed });
    clock.lap('send');
    const receipt = await ownReceipt(client, txHash);
    clock.lap('receipt');
    // may still be mined: the reserved worst-case fee stays counted
    if (!receipt) return reject(502, 'rpc_error', 'not mined within 8 s; poll the txHash', txHash);
    if (receipt.transactionHash.toLowerCase() !== txHash) {
      return reject(502, 'receipt_mismatch', 'the node returned a receipt for another transaction', txHash);
    }
    // OP Stack: the L1 data fee is charged on top of gasUsed × price (viem's OP formatter puts it on the receipt).
    const l1Fee = 'l1Fee' in receipt && typeof receipt.l1Fee === 'bigint' ? receipt.l1Fee : 0n;
    const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice + l1Fee;
    const reverted = receipt.status !== 'success';
    await settleSend(p, gasCostWei, reverted, txHash);
    if (reverted) return reject(502, 'reverted', 'the transaction was mined and reverted', txHash);
    const paid = parseEventLogs({ abi: merchantPayAbi, eventName: 'Paid', logs: receipt.logs })
      .find((log) => isAddressEqual(log.address, MERCHANT_PAY));
    return { txHash, blockNumber: receipt.blockNumber, paymentId: paid?.args.paymentId, gasUsed: receipt.gasUsed, gasCostWei };
  } catch (e) {
    return reject(502, 'rpc_error', reason(e), txHash); // outcome unknown: the worst-case fee stays counted
  } finally {
    sendCount += 1; // gas was (probably) spent: drop the cached balance and any read in flight
    balances.delete(client.account.address);
    balanceReads.delete(client.account.address); // so the next /health starts a post-send read instead of joining one
  }
}

/**
 * POST /relay: parse → free checks → one RPC pre-check round → send lock (re-simulate, sign, sync send).
 * Every rejection happens before a transaction exists (AT-10), and only MerchantPay.paySale / .payInvoice and
 * CapitalMarket.fundWithAuthorization are called (FR-REL-2).
 */
export async function relay(body: string, client: RelayerClient): Promise<Response> {
  const clock = stopwatch();
  const cold = relays++ === 0;
  const parsed = parsePayment(body);
  if ('error' in parsed) return respond(reject(400, 'bad_request', parsed.error));
  let p = parsed.payment;
  try {
    p = await prepareFunding(client, p);
    const pre = (await localChecks(client, p)) ?? (await rpcChecks(client, p));
    if (pre) return respond(pre);
  } catch (e) {
    return respond(e instanceof StoreError ? storageDown(e) : reject(502, 'rpc_error', reason(e)));
  }
  clock.lap('checks');
  const result = await serialized(() => leased(client, clock, (holder) => send(client, p, clock, holder))).catch((e: unknown) => {
    if (e instanceof StoreError) return storageDown(e); // only before a broadcast: reserve is the last write before it
    throw e;
  });
  if ('code' in result) return respond(result);
  const timings = { cold, ...clock.read() };
  console.info(`relayed ${result.txHash} timings ${JSON.stringify(timings)}`); // the web app gets the body; this is ours
  return Response.json({
    txHash: result.txHash, blockNumber: result.blockNumber.toString(), paymentId: result.paymentId?.toString(),
    gasUsed: result.gasUsed.toString(), gasCostWei: result.gasCostWei.toString(), timings,
  });
}

/** GET /health: the WBT balance (≤ 5 s old), today's relay spend and what is left of the 0.1 WBT budget (every instance). */
export async function health(client: RelayerClient): Promise<Response> {
  try {
    const [wei, spentWei] = await Promise.all([wbtBalance(client), store.spentToday(client.account.address, Date.now())]);
    return Response.json({
      relayer: client.account.address, wbt: formatEther(wei),
      gasSpentToday: formatEther(spentWei), budgetLeft: formatEther(spentWei < DAILY_BUDGET_WEI ? DAILY_BUDGET_WEI - spentWei : 0n),
      usdtFeesUnswapped: null, paused: false,
    });
  } catch (e) {
    if (e instanceof StoreError) return Response.json({ error: storageDown(e).error, code: 'storage_error' }, { status: 502 });
    return Response.json({ error: reason(e), code: 'rpc_error' }, { status: 502 });
  }
}
