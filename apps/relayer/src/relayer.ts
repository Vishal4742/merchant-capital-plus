import {
  BaseError, ContractFunctionRevertedError, createWalletClient, encodeAbiParameters, encodeFunctionData, formatEther,
  getAddress, http, InternalRpcError, isAddress, isAddressEqual, isHex, keccak256, maxUint256, parseAbi, parseEventLogs,
  parseSignature, publicActions, recoverTypedDataAddress, TransactionReceiptNotFoundError, zeroAddress, zeroHash,
  type Address, type Hash, type Hex, type LocalAccount, type Transport,
} from 'viem';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';
import {
  addresses, capitalMarketAbi, KIND_INVOICE, KIND_SALE, merchantPayAbi, MIN_PAYMENT, nonceParams, receiveWithAuthorizationTypes, usdtDomain,
} from './contracts.ts';
import { DbUnavailable } from './db.ts';
import { readLedger, releaseLease, settle, takeLease, writeAhead, type Authorization, type Ledger, type Outcome } from './state.ts';

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
export const TIMING = { receiptPollMs: 250, receiptTimeoutMs: 8_000, maxRequestAgeMs: 20_000 };
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
interface Reject { status: number; code: string; error: string; txHash?: Hash; retryAfterS?: number }
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
const respond = (r: Reject) => Response.json(
  { error: r.error, code: r.code, txHash: r.txHash, retry_after_s: r.retryAfterS },
  { status: r.status, headers: r.retryAfterS === undefined ? undefined : { 'retry-after': String(r.retryAfterS) } },
);
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

// Batch 031 (FR-REL-10): the replay set, budget, rate limits and breaker are rows in the shared rel_sent table
// (src/state.ts), per relayer address, so every instance sees every instance's sends. No database, no relaying (B4).
const authorization = (p: Payment): Authorization =>
  ({ key: `${p.from.toLowerCase()}:${p.nonce.toLowerCase()}`, payer: p.from.toLowerCase(), merchant: p.merchant?.toLowerCase() });
const breakerOpen = (l: Ledger) => l.reverts >= BREAKER_REVERTS_PER_HOUR;
const budgetSpent = (l: Ledger) => l.spentWei + CAP_FEE_WEI > DAILY_BUDGET_WEI;

/** Breaker, payer cooldown, budget and rate limits on one ledger read: no RPC, so they run before any RPC and again
 *  inside the lease. Round 3 (owner, B9): no payer ban; a payer with repeated payer-attributable failures waits out a
 *  temporary cooldown (429 payer_cooldown + retry_after_s). The global breaker, budget and rate limits are unchanged. */
function ledgerChecks(l: Ledger, p: Payment, now = Date.now()): Reject | undefined {
  if (breakerOpen(l)) return reject(503, 'breaker_open', 'relaying is paused after repeated reverts; retry later');
  if (l.cooldownUntil !== null && l.cooldownUntil > now) {
    const retryAfterS = Math.ceil((l.cooldownUntil - now) / 1000);
    return { ...reject(429, 'payer_cooldown', 'this payer is cooling down after repeated failed payments; retry later'), retryAfterS };
  }
  if (budgetSpent(l)) return reject(503, 'budget_exhausted', "today's relay budget is used up; retry tomorrow");
  if (l.payerSends >= PAYER_SENDS_PER_HOUR || (p.merchant && l.merchantSends >= MERCHANT_SENDS_PER_HOUR)) {
    return reject(429, 'rate_limited', 'too many payments in the last hour; retry later');
  }
}

/** After a broadcast attempt: the spend (the cap when unknown), a mined revert and whether it was the payer's fault, on
 *  the shared row. db.ts retries transient failures (round 2 R2-3 → round 3 B8). Never throws: a bookkeeping failure
 *  must not change a sent payment's answer, and the written-ahead row already counts the cap. */
async function recordSend(p: Payment, feeWei: bigint, outcome: Outcome, txHash: Hash, payerFault = false) {
  if (outcome === 'reverted') process.stderr.write(`ALERT reverted ${txHash} payer ${p.from}${payerFault ? ' (payer-attributable)' : ''}\n`);
  await settle(authorization(p), feeWei, outcome, payerFault).catch(() => {
    process.stderr.write(`ALERT settle failed ${txHash}: ${outcome} not recorded (the capped fee stands)\n`);
  });
}

/** Round 3 (owner, B9): was this mined revert the payer's fault? Checked independently on chain, at the revert's block:
 *  the authorization is still unused (if it was consumed elsewhere, e.g. a front-run that paid the order, the funds left
 *  with it and that is not the payer's doing) AND the payer's USDT is below the value they signed (they moved it after
 *  signing). The signature was already verified as the payer's before relaying, so a forged one never gets here. Any
 *  other cause (a contract or token pause, a blocklist, gas, an unknown) and any failure of this check is not the
 *  payer's fault. */
async function payerFault(client: RelayerClient, p: Payment, blockNumber: bigint): Promise<boolean> {
  try {
    const [value, used, balance] = await Promise.all([
      signedValue(client, p),
      client.readContract({ address: USDT, abi: USDT_ABI, functionName: 'authorizationState', args: [p.from, p.nonce], blockNumber }),
      client.readContract({ address: USDT, abi: USDT_ABI, functionName: 'balanceOf', args: [p.from], blockNumber }),
    ]);
    return !used && balance < value;
  } catch {
    return false;
  }
}

// /health's ledger read, per relayer: up to 5 s old like the balance, single-flight, dropped after a send here. /health is
// public, so a burst costs one database read, not one each; other instances' sends show up within 5 s.
const LEDGER_TTL_MS = 5_000;
const healthLedgers = new Map<Address, { at: number; ledger: Promise<Ledger> }>();
function healthLedger(relayer: Address): Promise<Ledger> {
  const hit = healthLedgers.get(relayer);
  if (hit && Date.now() - hit.at < LEDGER_TTL_MS) return hit.ledger;
  const entry = { at: Date.now(), ledger: readLedger(relayer) };
  healthLedgers.set(relayer, entry);
  entry.ledger.catch(() => { if (healthLedgers.get(relayer) === entry) healthLedgers.delete(relayer); });
  return entry.ledger;
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

// Two layers: this FIFO queues an instance's own requests in memory (only its head polls the database), and the
// rel_lease row (src/state.ts) serializes sends per relayer address across instances (FR-REL-10).
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

/** Checks with no chain call (the relayFee read for invoices is cached): merchant, window, minimum, signature, then one
 *  shared-ledger read: sent set, breaker, ban, budget, rate limits. Throws DbUnavailable when the database is down. */
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
  const ledger = await readLedger(client.account.address, authorization(p));
  if (ledger.replay) return REPLAY;
  return ledgerChecks(ledger, p);
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
const LEASE_LOST = reject(503, 'busy', 'the relayer lost its send lock before sending; nothing was sent, so retry');
// B4 fail closed: every database failure before the broadcast refuses with 503 (the web: "Nothing was charged; try again").
const DB_DOWN = reject(503, 'db_unavailable', "the relayer can't reach its database; nothing was sent, so retry");
// ponytail: a waiting instance polls the lease (≤ 20 reads/s, for at most maxRequestAgeMs). Upgrade: LISTEN/NOTIFY over
// a WebSocket client if instances often wait on each other.
const LEASE_POLL_MS = 50;

/** The relayer's shared send lease (its fence), polling while another instance holds it; undefined once this request is
 *  too old to sign. Throws DbUnavailable. One holder id per request, so a take whose reply was lost is recognised (B8). */
async function leaseFor(relayer: Address, clock: Stopwatch): Promise<string | undefined> {
  const holder = randomUUID();
  for (;;) {
    const fence = await takeLease(relayer, holder);
    if (fence) return fence;
    if (tooOld(clock)) return undefined;
    await sleep(LEASE_POLL_MS);
  }
}

/** Runs at the head of this instance's queue: takes the shared send lease (FR-REL-10), sends under it, gives it back. */
async function send(client: RelayerClient, p: Payment, clock: Stopwatch): Promise<Reject | Sent> {
  if (tooOld(clock)) return QUEUED_TOO_LONG; // before any RPC in the lock (security 022 L2)
  if (tooLate(p)) return EXPIRED; // queue time counts
  const relayer = client.account.address;
  const fence = await leaseFor(relayer, clock);
  clock.lap('queue'); // this instance's queue plus waiting for another instance's lease
  if (!fence) return QUEUED_TOO_LONG;
  try {
    if (tooLate(p)) return EXPIRED; // and so does waiting for the lease
    return await sendLeased(client, p, clock, fence);
  } finally {
    await releaseLease(relayer, fence).catch(() => undefined); // db.ts logged it; the lease lapses by itself after LEASE_S
  }
}

/** Under the lease: re-simulate on fresh state, re-check the shared ledger, sign with capped fees, write ahead, send
 *  once, poll our receipt. Database failures before the write-ahead refuse (503); after it they are only logged. */
async function sendLeased(client: RelayerClient, p: Payment, clock: Stopwatch, fence: string): Promise<Reject | Sent> {
  const relayer = client.account.address;
  const auth = authorization(p);
  let nonce: number;
  let ledger: Ledger;
  try {
    // the ledger read rides along with the RPC round, and is judged first, as the in-memory sent set was
    const [read, failedSimulation, pending] = await Promise.all([
      readLedger(relayer, auth),
      simulate(client, p),
      client.getTransactionCount({ address: relayer, blockTag: 'pending' }),
    ]);
    if (read.replay) return REPLAY;
    if (failedSimulation) return simulationReject(failedSimulation);
    [ledger, nonce] = [read, pending];
  } catch (e) {
    return e instanceof DbUnavailable ? DB_DOWN : reject(502, 'rpc_error', reason(e));
  }
  if (tooLate(p)) return EXPIRED; // and so does a slow simulate/nonce step: never sign what could expire unmined
  if (tooOld(clock)) return QUEUED_TOO_LONG; // and the simulate/nonce round may have been slow too
  const refused = ledgerChecks(ledger, p); // another send, on any instance, may have moved the budget or the breaker
  if (refused) return refused;
  const signed = await client.account.signTransaction({
    chainId: whitechainSepolia.id, type: 'eip1559', to: p.target, data: calldata(p), nonce, ...FEES,
  });
  const txHash = keccak256(signed);
  // Write-ahead (B2): hash + nonce are stored before the broadcast, only while our lease is live (the fence), so a holder
  // whose lease lapsed never broadcasts. The row stays even if the send fails: the tx may still be pending, so a re-POST
  // on any instance must not pay twice. It counts the capped fee until a receipt says otherwise.
  let written: Awaited<ReturnType<typeof writeAhead>>;
  try {
    written = await writeAhead({ relayer, fence, auth, txHash, txNonce: nonce, feeWei: CAP_FEE_WEI, sentAt: Date.now() });
  } catch {
    return DB_DOWN;
  }
  if (written === 'replay') return REPLAY;
  if (written === 'lost_lease') return LEASE_LOST;
  clock.lap('presend');
  try {
    await client.sendRawTransaction({ serializedTransaction: signed });
    clock.lap('send');
    const receipt = await ownReceipt(client, txHash);
    clock.lap('receipt');
    if (!receipt) {
      await recordSend(p, CAP_FEE_WEI, 'unknown', txHash); // may still be mined: count the worst case
      return reject(502, 'rpc_error', 'not mined within 8 s; poll the txHash', txHash);
    }
    if (receipt.transactionHash.toLowerCase() !== txHash) {
      await recordSend(p, CAP_FEE_WEI, 'unknown', txHash);
      return reject(502, 'receipt_mismatch', 'the node returned a receipt for another transaction', txHash);
    }
    // OP Stack: the L1 data fee is charged on top of gasUsed × price (viem's OP formatter puts it on the receipt).
    const l1Fee = 'l1Fee' in receipt && typeof receipt.l1Fee === 'bigint' ? receipt.l1Fee : 0n;
    const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice + l1Fee;
    const reverted = receipt.status !== 'success';
    // B9: a revert counts toward the payer's cooldown only if the on-chain check attributes it to them
    await recordSend(p, gasCostWei, reverted ? 'reverted' : 'mined', txHash, reverted && (await payerFault(client, p, receipt.blockNumber)));
    if (reverted) return reject(502, 'reverted', 'the transaction was mined and reverted', txHash);
    const paid = parseEventLogs({ abi: merchantPayAbi, eventName: 'Paid', logs: receipt.logs })
      .find((log) => isAddressEqual(log.address, MERCHANT_PAY));
    return { txHash, blockNumber: receipt.blockNumber, paymentId: paid?.args.paymentId, gasUsed: receipt.gasUsed, gasCostWei };
  } catch (e) {
    await recordSend(p, CAP_FEE_WEI, 'unknown', txHash); // outcome unknown: count the worst case
    return reject(502, 'rpc_error', reason(e), txHash);
  } finally {
    sendCount += 1; // gas was (probably) spent: drop the cached balance and any read in flight
    balances.delete(relayer);
    balanceReads.delete(relayer); // so the next /health starts a post-send read instead of joining one
    healthLedgers.delete(relayer); // and a fresh spend
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
    return respond(e instanceof DbUnavailable ? DB_DOWN : reject(502, 'rpc_error', reason(e)));
  }
  clock.lap('checks');
  const result = await serialized(() => send(client, p, clock)).catch((e: unknown) => {
    if (e instanceof DbUnavailable) return DB_DOWN; // only from taking the lease: nothing is signed yet
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

/** GET /health (FR-REL-6): the WBT balance and the shared ledger (each ≤ 5 s old): today's relay spend across every
 *  instance, what is left of the 0.1 WBT budget, and paused = every /relay is refused now (breaker open or budget spent). */
export async function health(client: RelayerClient): Promise<Response> {
  try {
    const [wei, ledger] = await Promise.all([wbtBalance(client), healthLedger(client.account.address)]);
    const { spentWei } = ledger;
    return Response.json({
      relayer: client.account.address, wbt: formatEther(wei),
      gasSpentToday: formatEther(spentWei), budgetLeft: formatEther(spentWei < DAILY_BUDGET_WEI ? DAILY_BUDGET_WEI - spentWei : 0n),
      usdtFeesUnswapped: null, paused: breakerOpen(ledger) || budgetSpent(ledger),
    });
  } catch (e) {
    if (e instanceof DbUnavailable) return Response.json({ error: e.message, code: 'db_unavailable' }, { status: 503 });
    return Response.json({ error: reason(e), code: 'rpc_error' }, { status: 502 });
  }
}
