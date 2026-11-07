import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PGlite } from '@electric-sql/pglite';
import {
  custom, decodeFunctionData, domainSeparator, encodeAbiParameters, encodeErrorResult, encodeEventTopics,
  encodeFunctionResult, http, keccak256, parseAbi, parseAbiParameters, parseSignature, parseTransaction,
  serializeSignature, formatEther, toHex, zeroHash, type Address, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { addresses, capitalMarketAbi, merchantPayAbi } from '../src/contracts.ts';
import { setTestDb, type Db } from '../src/db.ts';
import { takeLease, unblockPayer, writeAhead } from '../src/state.ts';
import { health, makeClient, relay, relayerClient, startBalanceRefresh, TIMING, USDT_ABI, USDT_DOMAIN } from '../src/relayer.ts';
import { applyRoles, applySchema, pgDb, setupDb } from './db-helpers.ts';

// Batch 031: the relayer's shared state is Postgres (FR-REL-10), so every test runs on one PGlite with db/*.sql applied.
// Each fakeNode has its own relayer key, and the state is per relayer address, so tests stay independent.
let pg: PGlite;
before(async () => { pg = await setupDb(); });
// After DDL, an open PGlite keeps the process alive ~10 s per idle stretch (41 s → 8 s here). `?.`: when a filter
// matches no test, node:test skips before() but still runs after().
after(() => pg?.close());
// The second relayer instance for the batch 031 tests (bottom of the file). Imported here, before any test() is
// registered: a top-level await between test() calls lets node:test end the root early under --test-name-pattern.
const INSTANCE_2 = '../src/relayer.ts?instance=2';
const two = (await import(INSTANCE_2)) as typeof import('../src/relayer.ts');

const MP = addresses.merchantPay; // lowercase in the generated file
const USDT: Address = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const RELAY_FEE = 100_000n; // MerchantPay.relayFee() on chain: 0.10 USDT
const HALF_WBT = '0x6f05b59d3b20000'; // 0.5e18 wei
const GAS_USED = 217_194n; // a live paySale (claude-contracts smoke test)
const GAS_PRICE = 5_001_000_000n;
const L1_FEE = 8_960n; // OP Stack L1 data fee on a live paySale receipt (drain review chain facts)
const ABI = [...USDT_ABI, ...merchantPayAbi, ...capitalMarketAbi];
const CM = addresses.capitalMarket;
const REVERT_DATA = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['TetherToken: auth invalid'] });
const customRevert = (errorName: 'OrderPaid' | 'InvoiceNotOpen' | 'WrongAmount' | 'InvalidOrder' | 'EnforcedPause') =>
  () => { throw rpcError(3, 'execution reverted', encodeErrorResult({ abi: merchantPayAbi, errorName })); };
const now = () => BigInt(Math.floor(Date.now() / 1000));
const cut = (s: string) => s.slice(0, 70);
const rpcError = (code: number, message: string, data?: unknown) => Object.assign(new Error(message), { code, data });
const random32 = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

// MerchantPay's nonce, written out independently of packages/shared `nonceParams` (MerchantPay.sol saleNonce / invoiceNonce).
const NONCE_TYPES = parseAbiParameters('uint256, address, uint8, uint256, bytes32, uint256, bytes32');
const saleNonceOf = (merchant: Address, orderRef: Hex, amount: bigint, salt: Hex) =>
  keccak256(encodeAbiParameters(NONCE_TYPES, [1874n, MP, 2, BigInt(merchant), orderRef, amount, salt]));
const invoiceNonceOf = (id: bigint, amount: bigint, salt: Hex) =>
  keccak256(encodeAbiParameters(NONCE_TYPES, [1874n, MP, 1, id, zeroHash, amount, salt]));
// The fake chain's CapitalMarket.fundingNonce: any formula works, the relayer must use whatever the chain returns.
const fundNonceOf = (claimId: bigint, investor: Address, units: bigint, salt: Hex) =>
  keccak256(encodeAbiParameters(parseAbiParameters('uint256, address, uint256, bytes32'), [claimId, investor, units, salt]));

interface NodeOptions {
  code?: Hex;
  balance?: bigint;
  gasPrice?: bigint;
  used?: Hex[];
  sendDelayMs?: number;
  gasUsed?: bigint; // receipt override (budget tests)
  quote?: bigint; // CapitalMarket.quote answer (funding tests)
  estimate?: bigint; // eth_estimateGas answer (default 210k, a 2-holder repayment is ~310k, 3 holders 421,338)
  minedRevert?: boolean; // the sync receipt says status 0 (breaker tests)
  on?: Record<string, (params: unknown[], next: () => unknown) => unknown>; // override one method (next() = the default answer); simulations are 'eth_call:paySale' / 'eth_call:payInvoice'
}

type Call = ReturnType<typeof decodeFunctionData<typeof ABI>>;
// The authorization nonce MerchantPay pulls with, recomputed from a paySale / payInvoice call.
function authNonce(call: Call): Hex | undefined {
  if (call.functionName === 'paySale') { const [merchant, orderRef, , amount, , , salt] = call.args; return saleNonceOf(merchant, orderRef, amount, salt); }
  if (call.functionName === 'payInvoice') { const [id, , amount, , , salt] = call.args; return invoiceNonceOf(id, amount, salt); }
  if (call.functionName === 'fundWithAuthorization') { const [claimId, investor, units, , , salt] = call.args; return fundNonceOf(claimId, investor, units, salt); }
}

// A stateful fake JSON-RPC node: USDT reads, MerchantPay's relayFee, paySale/payInvoice (revert once their authorization
// is used), a relayer nonce that advances on every send, eth_sendRawTransaction + receipts with a Paid event.
function fakeNode(opts: NodeOptions = {}) {
  const calls: string[] = [];
  const sent: Hex[] = [];
  const simulations: Record<string, unknown>[] = []; // the eth_call request objects of every payment simulation
  const used = new Set<Hex>(opts.used ?? []);
  const mined = new Map<Hex, unknown>();
  let nonce = 7;
  let paymentId = 41n;
  const decode = (params: unknown[]) => decodeFunctionData({ abi: ABI, data: (params[0] as { data: Hex }).data });

  async function answer(method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case 'eth_getCode': return opts.code ?? '0x';
      case 'eth_gasPrice': return toHex(opts.gasPrice ?? GAS_PRICE);
      case 'eth_estimateGas': return toHex(opts.estimate ?? 210_000n);
      case 'eth_getTransactionCount': return toHex(nonce);
      case 'eth_getBalance': return HALF_WBT;
      case 'eth_call': {
        const call = decode(params);
        if (call.functionName === 'authorizationState') {
          return encodeFunctionResult({ abi: USDT_ABI, functionName: 'authorizationState', result: used.has(call.args[1]) });
        }
        if (call.functionName === 'balanceOf') {
          return encodeFunctionResult({ abi: USDT_ABI, functionName: 'balanceOf', result: opts.balance ?? 10_000_000n });
        }
        if (call.functionName === 'relayFee') return encodeFunctionResult({ abi: merchantPayAbi, functionName: 'relayFee', result: RELAY_FEE });
        if (call.functionName === 'quote') return encodeFunctionResult({ abi: capitalMarketAbi, functionName: 'quote', result: opts.quote ?? 2_000_000n });
        if (call.functionName === 'fundingNonce') {
          const [claimId, investor, units, salt] = call.args;
          return encodeFunctionResult({ abi: capitalMarketAbi, functionName: 'fundingNonce', result: fundNonceOf(claimId, investor, units, salt) });
        }
        const auth = authNonce(call);
        if (auth && used.has(auth)) throw rpcError(3, 'execution reverted: TetherToken: auth invalid', REVERT_DATA);
        if (auth && call.functionName === 'fundWithAuthorization') return '0x';
        if (auth) return encodeFunctionResult({ abi: merchantPayAbi, functionName: 'paySale', result: paymentId + 1n });
        throw new Error(`fake node: unexpected eth_call ${call.functionName}`);
      }
      case 'eth_sendRawTransaction': { // accepted now, mined after sendDelayMs (the relayer polls for the receipt)
        const raw = params[0] as Hex;
        const hash = keccak256(raw);
        sent.push(raw);
        const call = decodeFunctionData({ abi: ABI, data: parseTransaction(raw).data! });
        void sleep(opts.sendDelayMs ?? 0).then(() => {
          used.add(authNonce(call)!);
          nonce += 1;
          paymentId += 1n;
          calls.push('mined');
          const logs = call.functionName === 'paySale' || call.functionName === 'payInvoice' ? [paidLog(hash, paymentId, call)] : [];
          mined.set(hash, opts.minedRevert ? receipt(hash, '0x0', [], opts.gasUsed) : receipt(hash, '0x1', logs, opts.gasUsed));
        });
        return hash;
      }
      case 'eth_getTransactionReceipt': return mined.get(params[0] as Hex) ?? null;
    }
    throw new Error(`fake node: unexpected ${method}`);
  }

  const name = (method: string, params: unknown[]) => method === 'eth_call' ? `eth_call:${decode(params).functionName}` : method;
  const transport = custom({
    async request({ method, params }: { method: string; params: unknown[] }) {
      const label = name(method, params);
      calls.push(label);
      if (label === 'eth_call:paySale' || label === 'eth_call:payInvoice' || label === 'eth_call:fundWithAuthorization') simulations.push(params[0] as Record<string, unknown>);
      return opts.on?.[label] ? opts.on[label](params, () => answer(method, params)) : answer(method, params);
    },
  }, { retryCount: 0 }); // a real code-3 revert over HTTP isn't retried; a thrown plain Error would be
  const relayer = privateKeyToAccount(generatePrivateKey());
  return { client: makeClient(relayer, transport), calls, sent, simulations, relayer, answer, name };
}

// MerchantPay's Paid(paymentId, merchant, payer, invoiceId, orderRef, gross, fee, toInvestors, toMerchant) for a decoded call.
function paidLog(txHash: Hex, paymentId: bigint, call: ReturnType<typeof decodeFunctionData<typeof merchantPayAbi>>) {
  const sale = call.functionName === 'paySale';
  const [merchant, orderRef, payer, gross, invoiceId] = sale
    ? [call.args[0], call.args[1], call.args[2], call.args[3], 0n] as const
    : [`0x${'aa'.repeat(20)}` as Address, zeroHash, call.args[1] as Address, (call.args[2] as bigint) + RELAY_FEE, call.args[0] as bigint] as const;
  return {
    address: MP, topics: encodeEventTopics({ abi: merchantPayAbi, eventName: 'Paid', args: { paymentId, merchant, payer } }),
    data: encodeAbiParameters(parseAbiParameters('uint256, bytes32, uint256, uint256, uint256, uint256'),
      [invoiceId, orderRef, gross, RELAY_FEE, 0n, gross - RELAY_FEE]),
    blockNumber: '0x10', blockHash: `0x${'ab'.repeat(32)}`, transactionHash: txHash, transactionIndex: '0x0', logIndex: '0x0', removed: false,
  };
}

// The relayer polls for its receipt; shrink the waits so timeout paths run in milliseconds.
TIMING.receiptPollMs = 5;
TIMING.receiptTimeoutMs = 120;
// The node accepts the tx but it never gets mined (the receipt-timeout path). `push` records the raw tx.
const sentButNeverMined = (push: (raw: Hex) => void): NodeOptions['on'] => ({
  eth_sendRawTransaction: (params) => { push(params[0] as Hex); return keccak256(params[0] as Hex); },
  eth_getTransactionReceipt: () => null,
});

function receipt(hash: Hex, status = '0x1', logs: unknown[] = [], gasUsed = GAS_USED) {
  return {
    transactionHash: hash, status, blockNumber: '0x10', blockHash: `0x${'ab'.repeat(32)}`, transactionIndex: '0x0',
    from: '0x0', to: MP, gasUsed: toHex(gasUsed), cumulativeGasUsed: toHex(gasUsed), effectiveGasPrice: toHex(GAS_PRICE), logs, l1Fee: toHex(L1_FEE),
    logsBloom: `0x${'00'.repeat(256)}`, type: '0x2', contractAddress: null,
  };
}

const TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
} as const;
type Overrides = { value?: bigint; validAfter?: bigint; validBefore?: bigint; to?: Address; signerKey?: Hex; merchant?: Address };

// The payer side, as the guest wallet will do it: EIP-3009 typed data to MerchantPay. `value` is the sale amount.
async function signedSale(o: Overrides = {}) {
  const payer = privateKeyToAccount(generatePrivateKey());
  const signer = o.signerKey ? privateKeyToAccount(o.signerKey) : payer;
  const sale = { merchant: o.merchant ?? privateKeyToAccount(generatePrivateKey()).address, orderRef: random32(), salt: random32(), amount: o.value ?? 1_000_000n };
  const message = {
    from: payer.address, to: o.to ?? MP, value: sale.amount, validAfter: o.validAfter ?? 0n,
    validBefore: o.validBefore ?? now() + 600n, nonce: saleNonceOf(sale.merchant, sale.orderRef, sale.amount, sale.salt),
  } as const;
  const sig = await signer.signTypedData({ domain: USDT_DOMAIN, types: TYPES, primaryType: 'ReceiveWithAuthorization', message });
  const args = {
    merchant: sale.merchant, orderRef: sale.orderRef, from: payer.address, amount: String(sale.amount),
    validAfter: String(message.validAfter), validBefore: String(message.validBefore), salt: sale.salt,
  };
  return { body: { action: 'paySale', args, sig }, message, sig, sale };
}

// A sale signed by a given payer key (rate-limit tests need the same payer for many sales).
async function signedSaleFrom(payerKey: Hex) {
  const payer = privateKeyToAccount(payerKey);
  const sale = { merchant: privateKeyToAccount(generatePrivateKey()).address, orderRef: random32(), salt: random32(), amount: 1_000_000n };
  const message = {
    from: payer.address, to: MP, value: sale.amount, validAfter: 0n, validBefore: now() + 600n,
    nonce: saleNonceOf(sale.merchant, sale.orderRef, sale.amount, sale.salt),
  } as const;
  const sig = await payer.signTypedData({ domain: USDT_DOMAIN, types: TYPES, primaryType: 'ReceiveWithAuthorization', message });
  const args = { ...sale, from: payer.address, amount: '1000000', validAfter: '0', validBefore: String(message.validBefore) };
  return { body: { action: 'paySale', args, sig } };
}

// An invoice payment: `amount` is credited; the payer signs value = amount + relayFee (fee on top, MerchantPay.payInvoice).
async function signedInvoice(o: { amount?: bigint; invoiceId?: bigint; signedValue?: bigint } = {}) {
  const payer = privateKeyToAccount(generatePrivateKey());
  const invoice = { id: o.invoiceId ?? 3n, amount: o.amount ?? 2_000_000n, salt: random32() };
  const message = {
    from: payer.address, to: MP, value: o.signedValue ?? invoice.amount + RELAY_FEE, validAfter: 0n,
    validBefore: now() + 600n, nonce: invoiceNonceOf(invoice.id, invoice.amount, invoice.salt),
  } as const;
  const sig = await payer.signTypedData({ domain: USDT_DOMAIN, types: TYPES, primaryType: 'ReceiveWithAuthorization', message });
  const args = {
    invoiceId: String(invoice.id), from: payer.address, amount: String(invoice.amount),
    validAfter: '0', validBefore: String(message.validBefore), salt: invoice.salt,
  };
  return { body: { action: 'payInvoice', args, sig }, message, sig, invoice };
}

const post = async (body: unknown, node: ReturnType<typeof fakeNode>) => {
  const res = await relay(typeof body === 'string' ? body : JSON.stringify(body), node.client);
  return { status: res.status, out: await res.json() };
};
const expectedArgs = (p: Awaited<ReturnType<typeof signedSale>>) => {
  const { r, s, yParity } = parseSignature(p.sig);
  const m = p.message;
  return [p.sale.merchant, p.sale.orderRef, m.from, m.value, m.validAfter, m.validBefore, p.sale.salt, yParity + 27, r, s];
};
// One parallel round before the lock: four reads + the gas-capped simulation.
const PRECHECKS = ['eth_call:authorizationState', 'eth_call:balanceOf', 'eth_call:paySale', 'eth_estimateGas', 'eth_gasPrice', 'eth_getCode'];

test('the USDT EIP-712 domain hashes to the on-chain DOMAIN_SEPARATOR', () => {
  assert.equal(domainSeparator({ domain: USDT_DOMAIN }), '0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25');
});

// ---- 1. body parsing: 400, no RPC ----

test('rejects malformed bodies with 400 and makes no RPC call', async () => {
  const { body } = await signedSale();
  const withArgs = (patch: object) => JSON.stringify({ ...body, args: { ...body.args, ...patch } });
  const bad = [
    'not json', 'null', '[]', '"pull"', '', 'x'.repeat(5000), JSON.stringify(body).padEnd(4097, ' '),
    JSON.stringify({ ...body, action: 'pull' }), JSON.stringify({ ...body, action: 'refund' }), JSON.stringify({ action: 'paySale' }),
    JSON.stringify({ ...body, args: [body.args.from] }), JSON.stringify({ ...body, args: null }),
    JSON.stringify({ action: 'paySale', args: body.args }), JSON.stringify({ ...body, args: { ...body.args, salt: undefined } }),
    JSON.stringify({ ...body, args: { ...body.args, merchant: '0x12' } }), JSON.stringify({ ...body, args: { ...body.args, orderRef: '0x1234' } }),
    withArgs({ from: '0x123' }), withArgs({ from: 123 }),
    withArgs({ from: body.args.from.toLowerCase().replace(/^0x/, '0X') }),
    withArgs({ from: body.args.from.toUpperCase().replace(/^0X/, '0x') }), // bad checksum
    withArgs({ amount: '-1' }), withArgs({ amount: '1.5' }), withArgs({ amount: 1000000 }), withArgs({ amount: '0' }),
    withArgs({ amount: '' }), withArgs({ amount: ' 1' }), withArgs({ amount: '+1' }), withArgs({ amount: '0x10' }),
    withArgs({ amount: '1e6' }), withArgs({ validAfter: '-0' }), withArgs({ validBefore: '9'.repeat(78) }),
    withArgs({ salt: '0x1234' }), withArgs({ salt: `0X${body.args.salt.slice(2)}` }), withArgs({ salt: `${body.args.salt}00` }),
    JSON.stringify({ ...body, sig: body.sig.slice(0, 100) }), JSON.stringify({ ...body, sig: `0x${'00'.repeat(65)}` }),
    JSON.stringify({ ...body, sig: `${body.sig.slice(0, 130)}1d` }), JSON.stringify({ ...body, sig: `${body.sig}00` }),
  ];
  for (const input of bad) {
    const node = fakeNode();
    const { status, out } = await post(input, node);
    assert.equal(status, 400, `expected 400 for ${cut(input)}`);
    assert.equal(out.code, 'bad_request');
    assert.ok(out.error);
    assert.deepEqual(node.calls, [], `no RPC for ${cut(input)}`);
  }
});

test('the 4 KB cap counts bytes: 4096 multibyte bytes pass, 4097 bytes (under 4096 chars) is 400 with no RPC', async () => {
  const { body } = await signedSale();
  const ofBytes = (n: number) => {
    const euros = JSON.stringify({ ...body, memo: '€'.repeat(Math.floor((n - JSON.stringify({ ...body, memo: '' }).length) / 3)) });
    return euros.padEnd(euros.length + n - Buffer.byteLength(euros), ' ');
  };
  const [fits, over] = [ofBytes(4096), ofBytes(4097)];
  assert.deepEqual([Buffer.byteLength(fits), Buffer.byteLength(over)], [4096, 4097]);
  assert.ok(over.length < 4096);
  assert.equal((await post(fits, fakeNode())).status, 200);
  const no = fakeNode();
  assert.equal((await post(over, no)).status, 400);
  assert.deepEqual(no.calls, []);
});

// ---- 2. local pre-checks: 422 with a code, no RPC ----

test('local pre-checks reject with 422 + code before any RPC call', async () => {
  // Each case's times are computed when it is sent (batch 031 round 4): with one `t` for all cases, a second boundary
  // crossed while earlier cases ran made `t + 901` equal `now + 900`, which the rule (validBefore ≤ now + 15 min) allows.
  const cases: [string, (t: bigint) => Parameters<typeof signedSale>[0]][] = [
    ['not_yet_valid', (t) => ({ validAfter: t + 60n })],
    ['expired', (t) => ({ validBefore: t + 10n })],
    ['expired', (t) => ({ validBefore: t - 1n })],
    ['window_too_long', (t) => ({ validBefore: t + 905n })],
    ['window_too_long', () => ({ validBefore: 2n ** 256n - 1n })],
    ['below_minimum', () => ({ value: 999_999n })],
    ['below_minimum', () => ({ value: 1n })],
    ['bad_signature', () => ({ signerKey: generatePrivateKey() })],
    ['bad_signature', () => ({ to: '0x2222222222222222222222222222222222222222' })], // signed for another target
  ];
  for (const [code, at] of cases) {
    const node = fakeNode();
    const { status, out } = await post((await signedSale(at(now()))).body, node);
    assert.equal(status, 422, `${code}: ${JSON.stringify(out)}`);
    assert.equal(out.code, code);
    assert.deepEqual(node.calls, [], `${code} made an RPC call`);
  }
});

test('a contract as `from` fails locally as bad_signature (ECDSA never recovers to a contract), with no RPC', async () => {
  const { body } = await signedSale();
  const node = fakeNode({ code: '0x6080' });
  const { status, out } = await post({ ...body, args: { ...body.args, from: USDT } }, node);
  assert.deepEqual([status, out.code], [422, 'bad_signature']);
  assert.deepEqual(node.calls, []);
});

test('accepts boundary values: exactly 1 USDT, 30 s left, 15 min window, lowercase from, compact v', async () => {
  const t = now();
  for (const o of [{ value: 1_000_000n }, { validBefore: t + 35n }, { validBefore: t + 899n }]) {
    const { status, out } = await post((await signedSale(o)).body, fakeNode());
    assert.equal(status, 200, `${JSON.stringify(o, (_, v) => typeof v === 'bigint' ? String(v) : v)}: ${JSON.stringify(out)}`);
  }
  const sale = await signedSale();
  const { body } = sale;
  const lower = fakeNode();
  assert.equal((await post({ ...body, args: { ...body.args, from: body.args.from.toLowerCase() } }, lower)).status, 200);
  assert.deepEqual(decodeFunctionData({ abi: merchantPayAbi, data: parseTransaction(lower.sent[0]).data! }).args, expectedArgs(sale));
  const compact = await signedSale();
  const { yParity } = parseSignature(compact.sig);
  assert.equal((await post({ ...compact.body, sig: `${compact.sig.slice(0, 130)}0${yParity}` }, fakeNode())).status, 200);
});

// ---- 3. RPC pre-checks: one round, no simulation, no send ----

test('RPC pre-checks reject in one round with their code and never simulate or send', async () => {
  const delegated = `0xef0100${'ab'.repeat(20)}` as Hex; // EIP-7702 delegation designator
  const cases: [string, number, (body: Awaited<ReturnType<typeof signedSale>>) => NodeOptions][] = [
    ['payer_has_code', 422, () => ({ code: delegated })],
    ['replay', 422, (p) => ({ used: [p.message.nonce] })],
    ['insufficient_funds', 422, () => ({ balance: 999_999n })],
    ['gas_price_cap', 503, () => ({ gasPrice: 6_000_000_001n })],
    ['would_revert', 422, () => ({ on: { 'eth_call:paySale': () => { throw rpcError(3, 'execution reverted: TetherToken: auth expired', REVERT_DATA); } } })],
  ];
  for (const [code, status, setup] of cases) {
    const pull = await signedSale();
    const node = fakeNode(setup(pull));
    const res = await post(pull.body, node);
    assert.deepEqual([res.status, res.out.code], [status, code], JSON.stringify(res.out));
    assert.deepEqual([...node.calls].sort(), PRECHECKS, `${code}: only the pre-check round, no nonce, no send`);
  }
});

test('a 200 carries per-step timings in whole ms (NFR-4 on the deployed relayer); cold only on the first relay', async () => {
  const { status, out } = await post((await signedSale()).body, fakeNode({ sendDelayMs: 40 }));
  assert.equal(status, 200, JSON.stringify(out));
  const t = out.timings;
  const steps = ['checks', 'queue', 'presend', 'send', 'receipt'];
  for (const k of [...steps, 'total']) assert.ok(Number.isInteger(t[k]) && t[k] >= 0, `${k}: ${t[k]}`);
  assert.ok(steps.reduce((sum, k) => sum + t[k], 0) <= t.total + steps.length, `steps add up to the total (± rounding): ${JSON.stringify(t)}`);
  assert.ok(t.receipt >= 30, `the receipt wait is measured: ${t.receipt}`);
  assert.equal(t.cold, false, 'earlier tests already relayed in this process');
  assert.deepEqual(Object.keys(t).sort(), ['checks', 'cold', 'presend', 'queue', 'receipt', 'send', 'total']);
});

test('every simulation carries the same gas limit and fees the relayer signs with', async () => {
  const node = fakeNode();
  assert.equal((await post((await signedSale()).body, node)).status, 200);
  assert.equal(node.simulations.length, 2, 'pre-check round + inside the lock');
  for (const call of node.simulations) {
    assert.equal(call.gas, '0x61a80');
    assert.equal(call.maxFeePerGas, '0x165a0bc00');
  }
});

// ---- 4. the send path ----

test('a valid paySale is signed with capped gas and fees, sent once, its own receipt polled, and returns the hash', async () => {
  const node = fakeNode();
  const sale = await signedSale();
  const { body } = sale;
  const { status, out } = await post(body, node);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(node.sent.length, 1);
  assert.equal(out.txHash, keccak256(node.sent[0]));
  assert.equal(out.blockNumber, '16');

  const tx = parseTransaction(node.sent[0]);
  assert.equal(tx.to?.toLowerCase(), MP);
  assert.equal(tx.chainId, 1874);
  assert.equal(tx.type, 'eip1559');
  assert.equal(tx.nonce, 7);
  assert.equal(tx.gas, 400_000n);
  assert.equal(tx.maxFeePerGas, 6_000_000_000n);
  assert.equal(tx.maxPriorityFeePerGas, 1_000_000n);
  assert.equal(tx.value ?? 0n, 0n);
  const call = decodeFunctionData({ abi: merchantPayAbi, data: tx.data! });
  assert.equal(call.functionName, 'paySale');
  assert.deepEqual(call.args, expectedArgs(sale));

  assert.deepEqual(node.calls.slice(0, 6).sort(), PRECHECKS);
  assert.deepEqual(node.calls.slice(6, 8).sort(), ['eth_call:paySale', 'eth_getTransactionCount']);
  assert.equal(node.calls[8], 'eth_sendRawTransaction');
  assert.ok(node.calls.slice(9).includes('mined'));
  assert.equal(node.calls.at(-1), 'eth_getTransactionReceipt', 'answered after our own receipt');
  for (const never of ['eth_fillTransaction', 'eth_sendRawTransactionSync']) {
    assert.ok(!node.calls.includes(never), `called ${never}`);
  }
  // batch 022: one estimate, in the pre-check round, as a drain guard; the tx itself is still signed with the fixed 400k
  assert.equal(node.calls.filter((c) => c === 'eth_estimateGas').length, 1);
});

test('ignores a client-supplied target or calldata: the tx always goes to MerchantPay as paySale', async () => {
  const node = fakeNode();
  const { body, message } = await signedSale();
  const evil = '0x2222222222222222222222222222222222222222';
  const { status } = await post({
    ...body, to: evil, target: evil, address: evil, data: '0xdeadbeef', functionName: 'transfer',
    args: { ...body.args, to: evil, data: '0xdeadbeef' },
  }, node);
  assert.equal(status, 200);
  const tx = parseTransaction(node.sent[0]);
  assert.equal(tx.to?.toLowerCase(), MP);
  assert.equal(decodeFunctionData({ abi: merchantPayAbi, data: tx.data! }).args[2], message.from);
});

test('the same authorization sent twice at once is broadcast once; the copy is rejected after re-simulating', async () => {
  const node = fakeNode({ sendDelayMs: 40 });
  const { body } = await signedSale();
  const [a, b] = await Promise.all([post(body, node), post(body, node)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 422]);
  assert.ok(['replay', 'would_revert'].includes([a, b].find((r) => r.status === 422)!.out.code));
  assert.equal(node.sent.length, 1);
});

test('after a receipt timeout, re-POSTing the same authorization is a replay and is not sent again', async () => {
  const node = fakeNode({ on: sentButNeverMined((raw) => node.sent.push(raw)) });
  const { body } = await signedSale();
  const first = await post(body, node);
  assert.deepEqual([first.status, first.out.code], [502, 'rpc_error']);
  assert.equal(first.out.txHash, keccak256(node.sent[0]));
  const again = await post(body, node); // still pending on-chain, so authorizationState is false and simulation passes
  assert.deepEqual([again.status, again.out.code], [422, 'replay'], JSON.stringify(again.out));
  assert.equal(node.sent.length, 1);
});

test('two different payments at once are sent one after the other with nonces n and n+1', async () => {
  const node = fakeNode({ sendDelayMs: 40 });
  const [p, q] = await Promise.all([signedSale(), signedSale()]);
  const results = await Promise.all([post(p.body, node), post(q.body, node)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.deepEqual(node.sent.map((raw) => parseTransaction(raw).nonce).sort(), [7, 8]);
  const firstDone = node.calls.indexOf('mined');
  const secondSim = node.calls.lastIndexOf('eth_call:paySale');
  assert.ok(secondSim > firstDone, `the second simulation ran before the first send finished: ${node.calls.join(' > ')}`);
});

test('failures inside the lock release it: the next payment still goes through', async () => {
  const failures: NodeOptions['on'][] = [
    { eth_sendRawTransaction: () => { throw rpcError(-32000, 'nonce too low'); } },
    { eth_getTransactionCount: () => { throw rpcError(-32000, 'header not found'); } },
  ];
  for (const on of failures) {
    assert.equal((await post((await signedSale()).body, fakeNode({ on }))).status, 502);
    assert.equal((await post((await signedSale()).body, fakeNode())).status, 200);
  }
});

test('send outcomes: mined-but-reverted, a receipt for another hash, and a sync timeout all return 502 with our txHash', async () => {
  const cases: [string, (params: unknown[]) => unknown][] = [
    ['reverted', (params) => receipt(params[0] as Hex, '0x0')],
    ['receipt_mismatch', () => receipt(`0x${'cd'.repeat(32)}`)],
    ['rpc_error', () => null], // never mined within the receipt timeout
    ['rpc_error', () => { throw rpcError(-32000, 'header not found'); }], // the receipt lookup itself fails
  ];
  for (const [code, reply] of cases) {
    const node = fakeNode({ on: {
      eth_sendRawTransaction: (params) => { node.sent.push(params[0] as Hex); return keccak256(params[0] as Hex); },
      eth_getTransactionReceipt: reply,
    } });
    const { status, out } = await post((await signedSale()).body, node);
    assert.deepEqual([status, out.code], [502, code], JSON.stringify(out));
    assert.equal(out.txHash, keccak256(node.sent[0]), `${code}: our hash is returned so the client can poll it`);
  }
});

// ---- 5. revert vs node failure ----

test('a simulation revert is 422 would_revert with the reason; a -32603 with non-hex data is a node failure (502)', async () => {
  const revert = fakeNode({ on: { 'eth_call:paySale': () => { throw rpcError(3, 'execution reverted: TetherToken: auth invalid', REVERT_DATA); } } });
  const r = await post((await signedSale()).body, revert);
  assert.deepEqual([r.status, r.out.code], [422, 'would_revert']);
  assert.match(r.out.error, /TetherToken: auth invalid/);
  assert.equal(revert.sent.length, 0);

  const internal = fakeNode({ on: { 'eth_call:paySale': () => { throw rpcError(-32603, 'Internal error', 'not hex'); } } });
  const i = await post((await signedSale()).body, internal);
  assert.deepEqual([i.status, i.out.code], [502, 'rpc_error'], JSON.stringify(i.out));
  assert.doesNotMatch(i.out.error, /revert/i, 'a node failure must not say "reverted"');
});

// A JSON-RPC node over real HTTP (the production transport): answers like fakeNode, except the pull simulation,
// which gets one canned HTTP reply (Ankr's reth answers a reverting eth_call with code 3 + Error(string) data).
async function relayOverHttp(pullReply: { status?: number; body: string | object }) {
  const node = fakeNode();
  const server = createServer((req, res) => {
    let text = '';
    req.on('data', (c) => { text += c; }).on('end', async () => {
      const { id, method, params } = JSON.parse(text);
      const reply = (status: number, body: string | object) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify({ jsonrpc: '2.0', id, ...body }));
      };
      if (node.name(method, params) === 'eth_call:paySale') return reply(pullReply.status ?? 200, pullReply.body);
      reply(200, { result: await node.answer(method, params) });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const client = makeClient(privateKeyToAccount(generatePrivateKey()), http(`http://127.0.0.1:${port}`, { retryCount: 0 }));
  try {
    const res = await relay(JSON.stringify((await signedSale()).body), client);
    return { status: res.status, text: await res.text() };
  } finally {
    server.close();
  }
}

test('over HTTP, a real revert (code 3, with or without data) is 422; transport and node failures are 502', async () => {
  const withData = await relayOverHttp({ body: { error: { code: 3, message: 'execution reverted: TetherToken: auth invalid', data: REVERT_DATA } } });
  assert.equal(withData.status, 422, withData.text);
  assert.match(withData.text, /TetherToken: auth invalid/);
  const bare = await relayOverHttp({ body: { error: { code: 3, message: 'execution reverted' } } });
  assert.equal(bare.status, 422, bare.text);
  const failures: [string, { status?: number; body: string | object }][] = [
    ['HTTP 503', { status: 503, body: '<html>bad gateway</html>' }],
    ['HTTP 429', { status: 429, body: { error: { code: 429, message: 'Too Many Requests' } } }],
    ['HTTP 200, not JSON', { body: 'not json' }],
    ['-32000', { body: { error: { code: -32000, message: 'header not found' } } }],
    ['-32005', { body: { error: { code: -32005, message: 'request rate exceeded' } } }],
    ['-32603', { body: { error: { code: -32603, message: 'Internal error' } } }],
  ];
  for (const [name, reply] of failures) {
    const out = await relayOverHttp(reply);
    assert.equal(out.status, 502, `${name} answered ${out.status} ${out.text}`);
  }
});

test('an unreachable RPC gives 502 and no response echoes the RPC URL', async () => {
  const token = 'fake-provider-token-not-a-secret';
  const client = makeClient(privateKeyToAccount(generatePrivateKey()), http(`http://127.0.0.1:1/${token}`, { retryCount: 0 }));
  const relayed = await relay(JSON.stringify((await signedSale()).body), client);
  const relayedText = await relayed.text();
  const healthText = await (await health(client)).text();
  for (const leak of [token, '127.0.0.1']) {
    assert.ok(!relayedText.includes(leak) && !healthText.includes(leak), `${leak} leaked into a response`);
  }
  assert.equal(relayed.status, 502, relayedText);
});

// ---- 6. health and the key ----

test('health reports the relayer WBT balance, nothing spent yet and the full 0.1 WBT budget; a failed lookup is 502', async () => {
  const node = fakeNode();
  const res = await health(node.client);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    relayer: node.relayer.address, wbt: '0.5', gasSpentToday: '0', budgetLeft: '0.1', usdtFeesUnswapped: null, paused: false,
  });
  const down = fakeNode({ on: { eth_getBalance: () => { throw rpcError(-32000, 'down'); } } });
  assert.equal((await health(down.client)).status, 502);
});

// Batch 018 security F1: /health now runs in the signing instance and the web pings it on every checkout open, so a
// burst must not fan out balance reads onto the RPC quota a sale's receipt poll needs.
test('concurrent /health calls on a cold cache share one balance read', async () => {
  const node = fakeNode();
  const replies = await Promise.all(Array.from({ length: 10 }, () => health(node.client)));
  assert.ok(replies.every((r) => r.status === 200));
  assert.equal(node.calls.filter((c) => c === 'eth_getBalance').length, 1);
});

// Batch 022 (claude-contracts Q19): a full repayment of a 3-holder invoice needs 421,338 gas, above the relayer's fixed 400k.
test('a payment that needs more gas than the 400k limit is refused with 422 too_much_gas and never sent', async () => {
  const node = fakeNode({ estimate: 421_338n });
  const { status, out } = await post((await signedInvoice()).body, node);
  assert.equal(status, 422, JSON.stringify(out));
  assert.equal(out.code, 'too_much_gas');
  assert.equal(node.sent.length, 0);
  assert.ok(!node.calls.includes('eth_getTransactionCount'), 'refused in the pre-check round');
});

test('exactly 400k estimated still relays; a failed estimate leaves the decision to the gas-capped simulation', async () => {
  assert.equal((await post((await signedSale()).body, fakeNode({ estimate: 400_000n }))).status, 200);
  const reverting = fakeNode({ on: { eth_estimateGas: () => { throw rpcError(3, 'execution reverted'); } } });
  assert.equal((await post((await signedSale()).body, reverting)).status, 200, 'the simulation passed, so the payment goes');
});

// Batch 022 (security 018 F1b): a 429 or 5xx while polling the receipt must not turn a sale that gets mined into a 502.
test('transient RPC errors while polling the receipt do not fail a sale that is mined', async () => {
  let failures = 2;
  const node = fakeNode({ sendDelayMs: 20, on: { eth_getTransactionReceipt: (_params, next) => {
    if (failures-- > 0) throw rpcError(-32005, 'limit exceeded');
    return next();
  } } });
  const { status, out } = await post((await signedSale()).body, node);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(node.sent.length, 1);
  assert.ok(node.calls.filter((c) => c === 'eth_getTransactionReceipt').length >= 3, 'polled past the errors');
});

test('a receipt poll that errors until the deadline answers 502 rpc_error with the txHash (it may still be mined)', async () => {
  const node = fakeNode({ on: { eth_getTransactionReceipt: () => { throw rpcError(-32005, 'limit exceeded'); } } });
  const { status, out } = await post((await signedSale()).body, node);
  assert.equal(status, 502);
  assert.equal(out.code, 'rpc_error');
  assert.equal(out.txHash, keccak256(node.sent[0]));
});

// Batch 022 (security 018 F4): a sale queued behind a hung one never signs after the web has given up.
test('a sale that waited too long for the send lock is refused before signing: 503 busy (retry-safe), no txHash, nothing sent', async () => {
  const saved = TIMING.maxRequestAgeMs;
  TIMING.maxRequestAgeMs = 60;
  try {
    const node = fakeNode({ sendDelayMs: 100 }); // the first sale holds the lock while its receipt is polled
    const [a, b] = await Promise.all([signedSale(), signedSale()]);
    const [first, second] = await Promise.all([post(a.body, node), post(b.body, node)]);
    assert.equal(first.status, 200, JSON.stringify(first.out));
    assert.equal(second.status, 503, JSON.stringify(second.out)); // the web shows 503 as "Nothing was charged; try again" (security 022 L1)
    assert.equal(second.out.code, 'busy');
    assert.equal(second.out.txHash, undefined, 'nothing was sent, so the web may re-POST it');
    assert.equal(node.sent.length, 1);
  } finally {
    TIMING.maxRequestAgeMs = saved;
  }
});

// Human 23:27: NFR-14 /health ≤ 300 ms p95 via a balance at most 5 s old, re-read after every send.
test('health caches the WBT balance for 5 s and re-reads it after a send or once 5 s pass', async () => {
  const node = fakeNode();
  const reads = () => node.calls.filter((c) => c === 'eth_getBalance').length;
  await health(node.client);
  await health(node.client);
  assert.equal(reads(), 1, 'the second read within 5 s is served from the cache');
  assert.equal((await post((await signedSale()).body, node)).status, 200);
  await health(node.client);
  assert.equal(reads(), 2, 'a send makes the next health read fresh');
  const realNow = Date.now;
  Date.now = () => realNow() + 5_001;
  try {
    await health(node.client);
    assert.equal(reads(), 3, 'stale after 5 s');
  } finally {
    Date.now = realNow;
  }
});

// ---- tester round 1 (batch 002): sent set, in-lock re-checks, judging order ----

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const timeoutNode = () => {
  const node = fakeNode({
    on: sentButNeverMined((raw) => node.sent.push(raw)),
  });
  return node;
};

test('the sent set keys on (from, nonce): after a timeout, a re-cased nonce or from, or a malleated sig, is not sent again', async () => {
  const node = timeoutNode();
  const { body, sig } = await signedSale();
  assert.equal((await post(body, node)).status, 502);
  const { r, s, yParity } = parseSignature(sig);
  const malleated = serializeSignature({ r, s: toHex(SECP256K1_N - BigInt(s), { size: 32 }), yParity: 1 - yParity! });
  const variants: [string, unknown][] = [
    ['uppercase nonce hex', { ...body, args: { ...body.args, nonce: `0x${body.args.salt.slice(2).toUpperCase()}` } }],
    ['lowercase from', { ...body, args: { ...body.args, from: body.args.from.toLowerCase() } }],
    ['malleated (high-s) signature', { ...body, sig: malleated }],
  ];
  for (const [name, variant] of variants) {
    const { status, out } = await post(variant, node);
    assert.deepEqual([status, out.code], [422, 'replay'], `${name}: ${JSON.stringify(out)}`);
    assert.equal(node.sent.length, 1, `${name} was broadcast again`);
  }
});

test('a copy queued behind a send that times out is a replay inside the lock, not a second broadcast', async () => {
  const node = timeoutNode(); // the first tx stays "pending": authorizationState is false and simulation passes
  const { body } = await signedSale();
  const results = await Promise.all([post(body, node), post(body, node)]);
  assert.deepEqual(results.map((x) => `${x.status} ${x.out.code}`).sort(), ['422 replay', '502 rpc_error']);
  assert.equal(node.sent.length, 1);
  assert.equal(node.calls.filter((c) => c === 'eth_call:authorizationState').length, 2, 'both copies passed the pre-check round');
});

test('queue time counts: an authorization that drops under 30 s while waiting for the lock is expired, not sent', async () => {
  const realNow = Date.now;
  let skewMs = 0;
  Date.now = () => realNow() + skewMs;
  try {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const node = fakeNode({
      on: {
        eth_sendRawTransaction: (params) => { node.sent.push(params[0] as Hex); return keccak256(params[0] as Hex); },
        eth_getTransactionReceipt: async (params) => { await held; return receipt(params[0] as Hex); },
      },
    });
    const first = post((await signedSale()).body, node);
    while (node.sent.length === 0) await sleep(1); // the first request now holds the lock
    const late = await signedSale({ validBefore: now() + 45n });
    const seen = node.calls.length;
    const second = post(late.body, node);
    while (node.calls.length < seen + PRECHECKS.length) await sleep(1); // passed its pre-check round
    await sleep(5); // and is queued on the lock
    skewMs = 20_000; // 20 s in the queue: 25 s left
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.status, 200);
    assert.deepEqual([b.status, b.out.code], [422, 'expired'], JSON.stringify(b.out));
    assert.equal(node.sent.length, 1);
    assert.equal(node.calls.filter((c) => c === 'eth_getTransactionCount').length, 1, 'the late request never reached nonce/sign');
  } finally {
    Date.now = realNow;
  }
});

// Tester round 1 (F2): a slow simulate ‖ nonce step inside the lock (viem retries used to stretch it to ~33 s)
// must not lead to signing an authorization with < 30 s left. Simulated here as a 25 s nonce read.
test('an authorization that drops under 30 s during the in-lock simulate/nonce step is not signed or sent', async () => {
  const realNow = Date.now;
  let skewMs = 0;
  Date.now = () => realNow() + skewMs;
  try {
    const node = fakeNode({ on: { eth_getTransactionCount: async (params) => { skewMs = 25_000; return node.answer('eth_getTransactionCount', params); } } });
    const { status, out } = await post((await signedSale({ validBefore: now() + 45n })).body, node);
    assert.deepEqual([status, out.code], [422, 'expired'], JSON.stringify(out));
    assert.equal(node.sent.length, 0);
  } finally {
    Date.now = realNow;
  }
});

test('RPC pre-checks are judged in spec order: replay, payer_has_code, insufficient_funds, gas_price_cap, would_revert', async () => {
  const revert = { 'eth_call:paySale': () => { throw rpcError(3, 'execution reverted: TetherToken: auth invalid', REVERT_DATA); } };
  const allBad = (nonce: Hex): NodeOptions => ({ used: [nonce], code: `0xef0100${'ab'.repeat(20)}`, balance: 0n, gasPrice: 6_000_000_001n, on: revert });
  const steps: [string, number, (nonce: Hex) => NodeOptions][] = [
    ['replay', 422, allBad],
    ['payer_has_code', 422, (n) => ({ ...allBad(n), used: [] })],
    ['insufficient_funds', 422, (n) => ({ ...allBad(n), used: [], code: '0x' })],
    ['gas_price_cap', 503, (n) => ({ ...allBad(n), used: [], code: '0x', balance: 10_000_000n })],
    ['would_revert', 422, () => ({ on: revert })],
  ];
  for (const [code, status, setup] of steps) {
    const pull = await signedSale();
    const node = fakeNode(setup(pull.message.nonce));
    const res = await post(pull.body, node);
    assert.deepEqual([res.status, res.out.code], [status, code], JSON.stringify(res.out));
    assert.equal(node.sent.length, 0);
  }
});

// ---- tester round 2 (batch 002): the /health balance cache (human 23:27) ----

const balanceNode = (wei: bigint, opts: NodeOptions = {}) => {
  const node = fakeNode({ ...opts, on: { ...opts.on, eth_getBalance: () => toHex(wei) } });
  return { ...node, reads: () => node.calls.filter((c) => c === 'eth_getBalance').length };
};
const wbtOf = async (node: ReturnType<typeof fakeNode>) => (await (await health(node.client)).json()).wbt;

test("the health cache is per relayer: one relayer never sees another relayer's cached balance", async () => {
  const a = balanceNode(500_000_000_000_000_000n);
  const b = balanceNode(10n ** 18n);
  assert.equal(await wbtOf(a), '0.5');
  assert.equal(await wbtOf(b), '1', 'b got a cached balance');
  assert.equal(await wbtOf(a), '0.5');
  assert.deepEqual([a.reads(), b.reads()], [1, 1]);
});

test('a failed send (sync timeout, receipt for another hash) also clears the health cache; a reject before the lock does not', async () => {
  const failing: [string, NodeOptions['on']][] = [
    ['receipt timeout', { ...sentButNeverMined(() => undefined) }],
    ['receipt_mismatch', { eth_sendRawTransaction: (params) => keccak256(params[0] as Hex), eth_getTransactionReceipt: () => receipt(`0x${'cd'.repeat(32)}`) }],
  ];
  for (const [name, on] of failing) {
    const node = balanceNode(10n ** 18n, { on });
    await wbtOf(node);
    assert.equal((await post((await signedSale({ value: 999_999n })).body, node)).status, 422);
    await wbtOf(node);
    assert.equal(node.reads(), 1, `${name}: a local reject must not clear the cache`);
    assert.equal((await post((await signedSale()).body, node)).status, 502);
    await wbtOf(node);
    assert.equal(node.reads(), 2, `${name}: the next health read after a failed send must be fresh`);
  }
});

// Tester round 2 (F6): a /health read that starts before a send and answers after it must not re-cache the
// pre-send balance ("refreshed after each send" must hold for every interleaving).
test('a health read in flight across a send does not re-cache the pre-send balance', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const node = fakeNode({
    on: { eth_getBalance: async () => (++reads === 1 ? (await held, toHex(5n * 10n ** 17n)) : toHex(4995n * 10n ** 14n)) },
  });
  const before = health(node.client); // reads the pre-send balance, slowly
  await sleep(5);
  assert.equal(reads, 1, 'the first health read reached the node');
  assert.equal((await post((await signedSale()).body, node)).status, 200);
  release();
  assert.equal((await (await before).json()).wbt, '0.5');
  assert.equal(await wbtOf(node), '0.4995', 'served the pre-send balance after the send');
});

// Tester round 2 (F5) + human 01:14: Node drops idle sockets after ~4 s, so a cache miss after idle paid a new TLS
// handshake. A 3 s background refresh keeps the balance ≤ ~3 s old and the connection warm; /health never waits.
test('the background refresh keeps re-reading the balance, so health is served from the cache', async () => {
  const node = balanceNode(10n ** 18n);
  const stop = startBalanceRefresh(node.client, 20);
  // Batch 049: wait for the reads instead of a fixed 75 ms (Windows timers tick at ~15.6 ms, so a 20 ms interval can fire
  // only twice in 75 ms), then stop the timer before the health call so a late tick can't be mistaken for health reading.
  const deadline = Date.now() + 2_000;
  while (node.reads() < 3 && Date.now() < deadline) await sleep(5);
  stop();
  const refreshed = node.reads();
  assert.ok(refreshed >= 3, `only ${refreshed} background reads in 2 s at a 20 ms interval`);
  assert.equal(await wbtOf(node), '1');
  assert.equal(node.reads(), refreshed, 'health waited on the node instead of the refreshed cache');
  const stopped = node.reads();
  await sleep(50);
  assert.equal(node.reads(), stopped, 'the refresh kept running after stop()');
});

test('an unparsable relayer key fails with a fixed message that never contains the key', () => {
  const bad = `0x${'f'.repeat(64)}`; // above the secp256k1 order
  const saved = process.env.RELAYER_PRIVATE_KEY;
  process.env.RELAYER_PRIVATE_KEY = bad;
  try {
    assert.throws(relayerClient, (e: Error) => {
      assert.ok(!e.message.includes('f'.repeat(16)) && !e.message.includes(BigInt(bad).toString().slice(0, 16)), e.message);
      return /RELAYER_PRIVATE_KEY/.test(e.message);
    });
  } finally {
    if (saved === undefined) delete process.env.RELAYER_PRIVATE_KEY;
    else process.env.RELAYER_PRIVATE_KEY = saved;
  }
});

// ---- batch 007: MerchantPay paySale + payInvoice ----

test('the local nonces match the MerchantPay formula (sale: kind 2 + merchant; invoice: kind 1 + id + zero orderRef)', async () => {
  const merchant = '0x1111111111111111111111111111111111111111';
  const ref = `0x${'22'.repeat(32)}` as Hex;
  const salt = `0x${'33'.repeat(32)}` as Hex;
  // computed with the generic abi.encode layout: (chainid, merchantPay, kind, ref, orderRef, amount, salt)
  assert.equal(saleNonceOf(merchant, ref, 25_000_000n, salt), keccak256(encodeAbiParameters(
    parseAbiParameters('uint256 c, address m, uint8 k, uint256 r, bytes32 o, uint256 a, bytes32 s'),
    [1874n, '0xab817593253a0a37de723072827d88fe0ca54251', 2, BigInt(merchant), ref, 25_000_000n, salt])));
  const node = fakeNode(); // and the relayer accepts a payment signed with exactly these nonces
  assert.equal((await post((await signedSale()).body, node)).status, 200);
  assert.equal((await post((await signedInvoice()).body, fakeNode())).status, 200);
});

test('paySale returns the paymentId from our own Paid event, gasUsed and the gas cost', async () => {
  const node = fakeNode();
  const { status, out } = await post((await signedSale()).body, node);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.paymentId, '42');
  assert.equal(out.gasUsed, String(GAS_USED));
  assert.equal(out.gasCostWei, String(GAS_USED * GAS_PRICE + L1_FEE), 'includes the OP-Stack L1 data fee');
});

test('payInvoice: value = amount + relayFee is checked, the call carries the credited amount, and returns the paymentId', async () => {
  const inv = await signedInvoice({ amount: 2_000_000n, invoiceId: 9n });
  const short = fakeNode({ balance: 2_000_000n }); // enough for the amount, not for amount + fee
  const s = await post(inv.body, short);
  assert.deepEqual([s.status, s.out.code], [422, 'insufficient_funds']);
  const node = fakeNode({ balance: 2_100_000n });
  const { status, out } = await post(inv.body, node);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.paymentId, '42');
  const tx = parseTransaction(node.sent[0]);
  assert.equal(tx.to?.toLowerCase(), MP);
  const call = decodeFunctionData({ abi: merchantPayAbi, data: tx.data! });
  assert.equal(call.functionName, 'payInvoice');
  const { r, s: ss, yParity } = parseSignature(inv.sig);
  assert.deepEqual(call.args, [9n, inv.message.from, 2_000_000n, 0n, inv.message.validBefore, inv.invoice.salt, yParity + 27, r, ss]);
  assert.ok(node.calls.includes('eth_call:payInvoice'));
});

test('an invoice signed for the amount without the fee is a bad signature; a remainder below 1 USDT is not rejected locally', async () => {
  const noFee = fakeNode();
  const bad = await post((await signedInvoice({ signedValue: 2_000_000n })).body, noFee);
  assert.deepEqual([bad.status, bad.out.code], [422, 'bad_signature']);
  assert.deepEqual(noFee.calls.filter((c) => c !== 'eth_call:relayFee'), [], 'only the cached fee read may happen');
  const remainder = await post((await signedInvoice({ amount: 400_000n })).body, fakeNode());
  assert.equal(remainder.status, 200, JSON.stringify(remainder.out));
});

test('a sale to a forbidden merchant (0, MerchantPay, CapitalMarket, USDT) is 422 bad_merchant with no RPC', async () => {
  for (const merchant of ['0x0000000000000000000000000000000000000000', addresses.merchantPay, addresses.capitalMarket, addresses.usdt]) {
    const node = fakeNode();
    const { status, out } = await post((await signedSale({ merchant: merchant as Address })).body, node);
    assert.deepEqual([status, out.code], [422, 'bad_merchant'], merchant);
    assert.deepEqual(node.calls, []);
  }
});

test('MerchantPay reverts map to codes: OrderPaid and InvoiceNotOpen are order_paid, WrongAmount is wrong_amount', async () => {
  const cases: [string, 'OrderPaid' | 'InvoiceNotOpen' | 'WrongAmount', 'sale' | 'invoice'][] = [
    ['order_paid', 'OrderPaid', 'sale'], ['order_paid', 'InvoiceNotOpen', 'invoice'], ['wrong_amount', 'WrongAmount', 'invoice'],
  ];
  for (const [code, errorName, kind] of cases) {
    const label = kind === 'sale' ? 'eth_call:paySale' : 'eth_call:payInvoice';
    const node = fakeNode({ on: { [label]: customRevert(errorName) } });
    const body = kind === 'sale' ? (await signedSale()).body : (await signedInvoice()).body;
    const { status, out } = await post(body, node);
    assert.deepEqual([status, out.code], [422, code], `${errorName}: ${JSON.stringify(out)}`);
    assert.equal(node.sent.length, 0);
  }
});

// ---- batch 006 (lean, human 05:51): breaker, budget, rate limits, L1 fee, zero orderRef, contract pause ----

const CAP_FEE = 400_000n * 6_000_000_000n; // the worst case one send can cost: 0.0024 WBT

test('an all-zero orderRef is a bad request with no RPC', async () => {
  const { body } = await signedSale();
  const node = fakeNode();
  const { status, out } = await post({ ...body, args: { ...body.args, orderRef: zeroHash } }, node);
  assert.deepEqual([status, out.code], [400, 'bad_request']);
  assert.deepEqual(node.calls, []);
});

// Round 3 (owner, B9): one mined revert no longer bans the payer; the global breaker is unchanged.
test('breaker: a mined revert never bans the payer; three mined reverts in an hour stop every relay with 503', async () => {
  const node = fakeNode({ minedRevert: true });
  const payerKey = generatePrivateKey();
  assert.deepEqual([(await post((await signedSaleFrom(payerKey)).body, node)).out.code], ['reverted']);
  const again = await post((await signedSaleFrom(payerKey)).body, node); // the same payer, a new authorization: relayed
  assert.deepEqual([again.status, again.out.code], [502, 'reverted'], JSON.stringify(again.out));
  assert.equal((await post((await signedSale()).body, node)).out.code, 'reverted');
  const sendsBefore = node.sent.length;
  const open = await post((await signedSale()).body, node);
  assert.deepEqual([open.status, open.out.code], [503, 'breaker_open']);
  assert.equal(node.sent.length, sendsBefore, 'nothing sent once the breaker is open');
});

test('budget: a send that would pass 0.1 WBT today is refused before any RPC, and queued requests are re-checked in the lock', async () => {
  const big = fakeNode({ gasUsed: 20_000_000n, sendDelayMs: 30 }); // one send costs 0.10002 WBT
  const results = await Promise.all([1, 2, 3].map(async () => post((await signedSale()).body, big)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 503, 503], JSON.stringify(results.map((r) => r.out)));
  assert.ok(results.filter((r) => r.status === 503).every((r) => r.out.code === 'budget_exhausted'));
  assert.equal(big.sent.length, 1, 'the queued copies never reached the node');
  const calls = big.calls.length;
  assert.equal((await post((await signedSale()).body, big)).out.code, 'budget_exhausted');
  assert.equal(big.calls.length, calls, 'refused with no RPC once the budget is spent');
});

test('budget accounting: a receipt adds gasUsed × price + L1 fee; a timeout adds the capped fee; /health reports both fields', async () => {
  const node = fakeNode();
  assert.equal((await post((await signedSale()).body, node)).status, 200);
  const spent = GAS_USED * GAS_PRICE + L1_FEE;
  const h = await (await health(node.client)).json();
  assert.equal(h.gasSpentToday, formatEther(spent));
  assert.equal(h.budgetLeft, formatEther(100_000_000_000_000_000n - spent));
  const slow = fakeNode({ on: sentButNeverMined((raw) => slow.sent.push(raw)) });
  assert.equal((await post((await signedSale()).body, slow)).status, 502);
  assert.equal((await (await health(slow.client)).json()).gasSpentToday, formatEther(CAP_FEE), 'a timeout counts the worst case');
});

test('rate limit: the 11th send from one payer within an hour is 429 rate_limited', async () => {
  const node = fakeNode();
  const payerKey = generatePrivateKey();
  const one = async () => {
    const p = await signedSaleFrom(payerKey);
    return post(p.body, node);
  };
  for (let i = 0; i < 10; i++) assert.equal((await one()).status, 200, `send ${i + 1}`);
  const eleventh = await one();
  assert.deepEqual([eleventh.status, eleventh.out.code], [429, 'rate_limited']);
  assert.equal(node.sent.length, 10);
});

test('MerchantPay paused (EnforcedPause) is 503 paused', async () => {
  const node = fakeNode({ on: { 'eth_call:paySale': customRevert('EnforcedPause') } });
  const { status, out } = await post((await signedSale()).body, node);
  assert.deepEqual([status, out.code], [503, 'paused']);
  assert.equal(node.sent.length, 0);
});

// ---- batch 010 (human 08:20): investors fund a claim gaslessly through CapitalMarket.fundWithAuthorization ----

async function signedFunding(o: { quote?: bigint; to?: Address; claimId?: bigint; units?: bigint } = {}) {
  const investor = privateKeyToAccount(generatePrivateKey());
  const [claimId, units, salt] = [o.claimId ?? 4n, o.units ?? 2_200_000n, random32()];
  const message = {
    from: investor.address, to: o.to ?? CM, value: o.quote ?? 2_000_000n, validAfter: 0n, validBefore: now() + 600n,
    nonce: fundNonceOf(claimId, investor.address, units, salt),
  } as const;
  const sig = await investor.signTypedData({ domain: USDT_DOMAIN, types: TYPES, primaryType: 'ReceiveWithAuthorization', message });
  const args = { claimId: String(claimId), investor: investor.address, units: String(units), validAfter: '0', validBefore: String(message.validBefore), salt };
  return { body: { action: 'fund', args, sig }, message, sig, investor, claimId, units, salt };
}

test('fund: the investor signature over quote + fundingNonce is relayed to CapitalMarket.fundWithAuthorization', async () => {
  const node = fakeNode({ quote: 2_000_000n });
  const f = await signedFunding({ quote: 2_000_000n });
  const { status, out } = await post(f.body, node);
  assert.equal(status, 200, JSON.stringify(out));
  const tx = parseTransaction(node.sent[0]);
  assert.equal(tx.to?.toLowerCase(), CM.toLowerCase());
  const call = decodeFunctionData({ abi: capitalMarketAbi, data: tx.data! });
  assert.equal(call.functionName, 'fundWithAuthorization');
  const { r, s: ss, yParity } = parseSignature(f.sig);
  assert.deepEqual(call.args, [f.claimId, f.investor.address, f.units, 0n, f.message.validBefore, f.salt, yParity + 27, r, ss]);
  assert.equal(out.gasUsed, String(GAS_USED));
  assert.ok(node.calls.includes('eth_call:quote') && node.calls.includes('eth_call:fundingNonce'));
});

test('fund: a quote under 1 USDT is below_minimum (no relay fee, so dust funding would drain gas) and nothing is simulated or sent', async () => {
  const node = fakeNode({ quote: 999_999n });
  const { status, out } = await post((await signedFunding({ quote: 999_999n })).body, node);
  assert.deepEqual([status, out.code], [422, 'below_minimum']);
  assert.ok(!node.calls.includes('eth_call:fundWithAuthorization'));
  assert.equal(node.sent.length, 0);
});

test('fund: a signature made for another contract (to = MerchantPay) is bad_signature', async () => {
  const node = fakeNode();
  const { status, out } = await post((await signedFunding({ to: MP })).body, node);
  assert.deepEqual([status, out.code], [422, 'bad_signature']);
  assert.equal(node.sent.length, 0);
});

// ---- batch 031 (FR-REL-10, FR-REL-5, FR-REL-6): the send lock, replay set, budget, limits and breaker across instances ----
// A second "instance" is the same module imported under another URL (as apps/web/test/sessions-db.test.mjs does): its own
// in-process state (send queue, caches, TIMING), the same PGlite, the same chain and hot key, as two Fluid instances have.

two.TIMING.receiptPollMs = TIMING.receiptPollMs;
two.TIMING.receiptTimeoutMs = TIMING.receiptTimeoutMs;
const postTwo = async (body: unknown, node: ReturnType<typeof fakeNode>) => {
  const res = await two.relay(JSON.stringify(body), node.client);
  return { status: res.status, out: await res.json() };
};
type SentRow = { auth_key: string; tx_hash: string; tx_nonce: string; fee_wei: string; status: string; fence: string };
const sentRows = async (relayer: Address) => (await pg.query<SentRow>(
  'SELECT auth_key, tx_hash, tx_nonce::text, fee_wei::text, status, fence::text FROM rel_sent WHERE relayer = $1 ORDER BY tx_nonce, sent_at',
  [relayer.toLowerCase()])).rows;
/** Runs `run` with the relayer on `db`, then routes it back to the shared PGlite. */
async function withDb<T>(db: Db | undefined, run: () => Promise<T>): Promise<T> {
  setTestDb(db);
  try {
    return await run();
  } finally {
    setTestDb(pgDb(pg));
  }
}
// Driver-like errors that name a host (which must never be echoed). Transient ones are retried (round 3, B8); fatal
// ones (here an internal SQLSTATE) are not.
const transientError = () => Object.assign(new Error('connect ECONNREFUSED db-host.internal:5432'), { code: 'ECONNREFUSED' });
const fatalError = () => Object.assign(new Error('internal error on db-host.internal'), { code: 'XX000' });
/** The shared PGlite, except the statements `fail(text, n)` picks (n counts from 1, retries included) throw. */
const failingDb = (fail: (text: string, n: number) => boolean, kind: 'transient' | 'fatal' = 'transient'): Db => {
  let n = 0;
  return {
    query: async (text, params) => {
      if (fail(text, ++n)) throw kind === 'transient' ? transientError() : fatalError();
      return pgDb(pg).query(text, params);
    },
  };
};
/** The shared PGlite, except the statements `lose(text)` picks run AND commit, then their reply is "lost" (B8). */
const lostReplyDb = (lose: (text: string) => boolean): Db => ({
  query: async (text, params) => {
    const rows = await pgDb(pg).query(text, params);
    if (lose(text)) throw Object.assign(new Error('socket hang up on db-host.internal'), { code: 'ECONNRESET' });
    return rows;
  },
});
const encodeBalance = (wei: bigint) => encodeFunctionResult({ abi: USDT_ABI, functionName: 'balanceOf', result: wei });
const encodeUsed = (used: boolean) => encodeFunctionResult({ abi: USDT_ABI, functionName: 'authorizationState', result: used });
/** A node whose next tx is mined reverted (B9). After the broadcast, `drained`: the payer's USDT is gone (they moved it:
 *  payer-attributable); `consumedElsewhere`: the authorization was used by someone else (a front-run: not the payer's
 *  fault); `checkFails`: the post-revert reads fail (RPC trouble: never the payer's fault). */
function revertingNode(o: { drained?: boolean; consumedElsewhere?: boolean; checkFails?: boolean } = {}) {
  let broadcast = false;
  const after = (answer: () => unknown) => (_params: unknown[], next: () => unknown) => {
    if (!broadcast) return next();
    if (o.checkFails) throw rpcError(-32000, 'header not found');
    return answer();
  };
  return fakeNode({ minedRevert: true, on: {
    eth_sendRawTransaction: (_params, next) => { broadcast = true; return next(); },
    'eth_call:balanceOf': after(() => encodeBalance(o.drained ? 0n : 10_000_000n)),
    'eth_call:authorizationState': after(() => encodeUsed(o.consumedElsewhere === true)), // a reverted tx consumed nothing
  } });
}
const faultRows = async (payer: Address) =>
  Number((await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM rel_sent WHERE payer = $1 AND payer_fault_at IS NOT NULL', [payer.toLowerCase()])).rows[0].n);
/** Seeds a payer-attributable failure `agoMs` ago (another relayer's row), for the window/cooldown arithmetic. */
const seedFault = (payer: Address, agoMs: number) => pg.query(
  `INSERT INTO rel_sent (auth_key, relayer, payer, tx_hash, tx_nonce, fence, fee_wei, status, sent_at, reverted_at, payer_fault_at)
   VALUES ($1, 'seed', $2, '0x', 0, 1, 0, 'reverted', $3, $3, $3)`, [`seed:${random32()}`, payer.toLowerCase(), Date.now() - agoMs]);
const MINUTE = 60_000;
/** Collects what the relayer writes to stderr while `run` runs (DB errors are logged there). */
async function stderrOf<T>(run: () => Promise<T>): Promise<[T, string]> {
  const write = process.stderr.write;
  let text = '';
  process.stderr.write = ((chunk: string | Uint8Array) => { text += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    return [await run(), text];
  } finally {
    process.stderr.write = write;
  }
}

test('B1: two instances on one database never sign at once: the second waits for the shared send lock and gets nonce n+1', async () => {
  const node = fakeNode({ sendDelayMs: 40 });
  const [p, q] = await Promise.all([signedSale(), signedSale()]);
  const results = await Promise.all([post(p.body, node), postTwo(q.body, node)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200], JSON.stringify(results.map((r) => r.out)));
  assert.deepEqual(node.sent.map((raw) => parseTransaction(raw).nonce).sort(), [7, 8]);
  const nonceReads = node.calls.flatMap((c, i) => (c === 'eth_getTransactionCount' ? [i] : []));
  assert.equal(nonceReads.length, 2);
  assert.ok(nonceReads[1] > node.calls.indexOf('mined'), `the second nonce was read before the first tx was mined: ${node.calls.join(' > ')}`);
  assert.deepEqual((await sentRows(node.relayer.address)).map((r) => r.tx_nonce), ['7', '8']);
});

test('B1: a live lease left by a crashed instance blocks sends (503 busy, nothing signed) until it lapses; then it is re-taken with the next fence', async () => {
  const node = fakeNode();
  const relayer = node.relayer.address.toLowerCase();
  await pg.query("INSERT INTO rel_lease (relayer, fence, until) VALUES ($1, 41, now() + interval '1 hour')", [relayer]);
  const saved = two.TIMING.maxRequestAgeMs;
  two.TIMING.maxRequestAgeMs = 100;
  try {
    const blocked = await postTwo((await signedSale()).body, node);
    assert.deepEqual([blocked.status, blocked.out.code, blocked.out.txHash], [503, 'busy', undefined], JSON.stringify(blocked.out));
    assert.equal(node.sent.length, 0);
    assert.ok(!node.calls.includes('eth_getTransactionCount'), 'nothing ran inside the lock');
  } finally {
    two.TIMING.maxRequestAgeMs = saved;
  }
  await pg.query("UPDATE rel_lease SET until = now() - interval '1 second' WHERE relayer = $1", [relayer]);
  assert.equal((await postTwo((await signedSale()).body, node)).status, 200);
  assert.deepEqual((await sentRows(node.relayer.address)).map((r) => r.fence), ['42']);
  const lease = (await pg.query<{ fence: string; live: boolean }>('SELECT fence::text, until > now() AS live FROM rel_lease WHERE relayer = $1', [relayer])).rows;
  assert.deepEqual(lease, [{ fence: '42', live: false }], 'released after the send: expired, not deleted, so a fence never repeats');
});

test('B1 fencing: a sender whose lease was taken over while it was in the lock cannot write ahead, so it never broadcasts', async () => {
  const node = fakeNode({ on: { eth_getTransactionCount: async (_params, next) => {
    // another instance takes the lease over meanwhile (e.g. this instance was frozen past the lease)
    await pg.query('UPDATE rel_lease SET fence = fence + 1 WHERE relayer = $1', [node.relayer.address.toLowerCase()]);
    return next();
  } } });
  const { status, out } = await post((await signedSale()).body, node);
  assert.deepEqual([status, out.code, out.txHash], [503, 'busy', undefined], JSON.stringify(out));
  assert.equal(node.sent.length, 0);
  assert.deepEqual(await sentRows(node.relayer.address), []);
});

// Round 2 (R2-2): the write-ahead also needs the lease to be live, not only the fence to match.
test('B1 fencing: a sender whose lease merely expired (same fence, nobody took it yet) cannot write ahead either', async () => {
  const node = fakeNode({ on: { eth_getTransactionCount: async (_params, next) => {
    await pg.query("UPDATE rel_lease SET until = now() - interval '1 second' WHERE relayer = $1", [node.relayer.address.toLowerCase()]);
    return next();
  } } });
  const { status, out } = await post((await signedSale()).body, node);
  assert.deepEqual([status, out.code, out.txHash], [503, 'busy', undefined], JSON.stringify(out));
  assert.equal(node.sent.length, 0);
  assert.deepEqual(await sentRows(node.relayer.address), []);
});

test('B2: an authorization sent by instance 1 is a replay on instance 2 while its tx is still pending', async () => {
  const node = timeoutNode();
  const { body } = await signedSale();
  const first = await post(body, node);
  assert.deepEqual([first.status, first.out.code], [502, 'rpc_error']);
  const again = await postTwo(body, node); // still pending: authorizationState is false and the simulation passes
  assert.deepEqual([again.status, again.out.code], [422, 'replay'], JSON.stringify(again.out));
  assert.equal(node.sent.length, 1);
  assert.deepEqual((await sentRows(node.relayer.address)).map((r) => r.status), ['unknown']);
});

test('B2: the signed tx hash and nonce are persisted before the broadcast; the receipt then records the real fee', async () => {
  let atBroadcast: SentRow[] = [];
  const node = fakeNode({ on: { eth_sendRawTransaction: async (_params, next) => {
    atBroadcast = await sentRows(node.relayer.address);
    return next();
  } } });
  const sale = await signedSale();
  const { status, out } = await post(sale.body, node);
  assert.equal(status, 200, JSON.stringify(out));
  const authKey = `${sale.message.from.toLowerCase()}:${sale.message.nonce.toLowerCase()}`;
  assert.equal(atBroadcast.length, 1, 'the row existed when eth_sendRawTransaction arrived');
  const { fence: _fence, ...written } = atBroadcast[0];
  assert.deepEqual(written, { auth_key: authKey, tx_hash: out.txHash, tx_nonce: '7', fee_wei: String(CAP_FEE), status: 'signed' });
  const [settled] = await sentRows(node.relayer.address);
  assert.deepEqual([settled.status, settled.fee_wei], ['mined', String(GAS_USED * GAS_PRICE + L1_FEE)]);
});

test("B3: the revert breaker is shared and a revert bans nobody: instance 2 relays the same payer, then opens after the 3rd revert", async () => {
  const node = fakeNode({ minedRevert: true });
  const payerKey = generatePrivateKey();
  assert.equal((await post((await signedSaleFrom(payerKey)).body, node)).out.code, 'reverted');
  assert.equal((await postTwo((await signedSaleFrom(payerKey)).body, node)).out.code, 'reverted', 'no ban on instance 2 either');
  assert.equal((await post((await signedSale()).body, node)).out.code, 'reverted');
  const sendsBefore = node.sent.length;
  const open = await postTwo((await signedSale()).body, node);
  assert.deepEqual([open.status, open.out.code], [503, 'breaker_open']);
  assert.equal(node.sent.length, sendsBefore, 'nothing sent once the breaker is open');
});

test('B3: the daily budget is shared: three sales racing on two instances spend it once, the others are refused in the lock', async () => {
  const big = fakeNode({ gasUsed: 20_000_000n, sendDelayMs: 30 }); // one send costs 0.10002 WBT
  const sales = await Promise.all([signedSale(), signedSale(), signedSale()]);
  const results = await Promise.all([post(sales[0].body, big), postTwo(sales[1].body, big), postTwo(sales[2].body, big)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 503, 503], JSON.stringify(results.map((r) => r.out)));
  assert.ok(results.filter((r) => r.status === 503).every((r) => r.out.code === 'budget_exhausted'));
  assert.equal(big.sent.length, 1);
  const calls = big.calls.length;
  assert.equal((await postTwo((await signedSale()).body, big)).out.code, 'budget_exhausted');
  assert.equal(big.calls.length, calls, 'refused on instance 2 with no RPC');
});

test('B3: the per-payer limit is shared: 10 sends on instance 1, the 11th on instance 2 is 429 rate_limited', async () => {
  const node = fakeNode();
  const payerKey = generatePrivateKey();
  for (let i = 0; i < 10; i++) assert.equal((await post((await signedSaleFrom(payerKey)).body, node)).status, 200, `send ${i + 1}`);
  const eleventh = await postTwo((await signedSaleFrom(payerKey)).body, node);
  assert.deepEqual([eleventh.status, eleventh.out.code], [429, 'rate_limited']);
  assert.equal(node.sent.length, 10);
});

test("B3: the per-merchant limit (200 an hour) counts every instance's sends: the 200th passes, the 201st is 429", async () => {
  const node = fakeNode();
  const merchant = privateKeyToAccount(generatePrivateKey()).address;
  await pg.query(`INSERT INTO rel_sent (auth_key, relayer, payer, merchant, tx_hash, tx_nonce, fence, fee_wei, status, sent_at)
    SELECT 'seed:' || g || ':' || $2::text, $1, 'seed' || g, $2::text, '0x', g, 1, 0, 'mined', $3 FROM generate_series(1, 199) g`,
  [node.relayer.address.toLowerCase(), merchant.toLowerCase(), Date.now()]);
  assert.equal((await postTwo((await signedSale({ merchant })).body, node)).status, 200, 'the 200th send');
  const over = await post((await signedSale({ merchant })).body, node);
  assert.deepEqual([over.status, over.out.code], [429, 'rate_limited']);
});

test('B4: with no database configured, /relay is 503 before any RPC (nothing signed or sent) and /health is 503', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await withDb(undefined, async () => {
      const node = fakeNode();
      const { status, out } = await post((await signedSale()).body, node);
      assert.deepEqual([status, out.code, out.txHash], [503, 'db_unavailable', undefined], JSON.stringify(out));
      assert.deepEqual(node.calls, [], 'refused before any RPC');
      const h = await health(node.client);
      assert.deepEqual([h.status, (await h.json()).code], [503, 'db_unavailable']);
    });
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test('B4: a database failure at any step before the broadcast (pre-check, lease, in-lock read, write-ahead) is 503 and sends nothing', async () => {
  for (const step of [1, 2, 3, 4]) {
    const node = fakeNode();
    // fatal errors: not retried (B8), so query n is exactly the step named above
    const [{ status, out }, logged] = await stderrOf(() => withDb(failingDb((_text, n) => n === step, 'fatal'), async () => post((await signedSale()).body, node)));
    assert.deepEqual([status, out.code, out.txHash], [503, 'db_unavailable', undefined], `query ${step}: ${JSON.stringify(out)}`);
    assert.equal(node.sent.length, 0, `query ${step}: broadcast`);
    assert.ok(!JSON.stringify(out).includes('db-host') && !logged.includes('db-host'), `query ${step}: the driver error leaked`);
  }
});

test('B4: a database failure after the broadcast never turns a sent payment into a refusal: the 200 and txHash stand', async () => {
  const node = fakeNode();
  const [{ status, out }] = await stderrOf(() => withDb(failingDb((text) => /^\s*UPDATE rel_/.test(text)), async () => post((await signedSale()).body, node)));
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.txHash, keccak256(node.sent[0]));
  const [row] = await sentRows(node.relayer.address);
  assert.deepEqual([row.status, row.fee_wei], ['signed', String(CAP_FEE)], 'the write-ahead row stands: the cap is counted');
});

// Round 2 (R2-3), round 3: a settle that hits a database blip is retried (now by db.ts, B8), so a payer-attributable
// revert still reaches the cooldown count and every revert the breaker.
test('B3/B4: a failed settle is retried, so a payer-attributable revert is still recorded; the answer is unchanged', async () => {
  let settles = 0;
  const node = revertingNode({ drained: true });
  const payerKey = generatePrivateKey();
  const flaky = failingDb((text) => /^\s*UPDATE rel_sent/.test(text) && ++settles <= 2); // the first two tries fail
  const [{ status, out }] = await stderrOf(() => withDb(flaky, async () => post((await signedSaleFrom(payerKey)).body, node)));
  assert.deepEqual([status, out.code, out.txHash], [502, 'reverted', keccak256(node.sent[0])]);
  assert.equal(settles, 3, 'two failures, then the third try recorded it');
  assert.equal((await sentRows(node.relayer.address))[0].status, 'reverted');
  assert.equal(await faultRows(privateKeyToAccount(payerKey).address), 1);
});

test('B4: settle runs once when it succeeds and at most 4 tries (≈1 s) when it keeps failing, then alerts; the 200 stands', async () => {
  let settles = 0;
  const counting = failingDb((text) => { if (/^\s*UPDATE rel_sent/.test(text)) settles += 1; return false; });
  assert.equal((await withDb(counting, async () => post((await signedSale()).body, fakeNode()))).status, 200);
  assert.equal(settles, 1, 'never retried after a success');
  settles = 0;
  const node = fakeNode();
  const broken = failingDb((text) => /^\s*UPDATE rel_sent/.test(text) && ++settles > 0);
  const [{ status, out }, logged] = await stderrOf(() => withDb(broken, async () => post((await signedSale()).body, node)));
  assert.deepEqual([status, out.txHash], [200, keccak256(node.sent[0])]);
  assert.equal(settles, 4);
  assert.match(logged, new RegExp(`ALERT settle failed ${out.txHash}`));
  assert.ok(!logged.includes('db-host'), 'the driver error leaked');
});

// ---- round 3, B8 (owner): retry transient database failures briefly, idempotently; never sign on unknown DB state ----

test('B8: transient database errors are retried briefly: two failed tries of the pre-check read, then the payment goes through', async () => {
  const node = fakeNode();
  const [{ status, out }] = await stderrOf(() => withDb(failingDb((_text, n) => n <= 2), async () => post((await signedSale()).body, node)));
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(node.sent.length, 1);
});

test('B8: a take-lease whose reply was lost is recognised as ours on retry (never a false "busy")', async () => {
  const node = fakeNode();
  let takes = 0;
  const saved = TIMING.maxRequestAgeMs;
  TIMING.maxRequestAgeMs = 400; // without recognition this request would wait on its own lease, then answer busy
  try {
    const db = lostReplyDb((text) => /INSERT INTO rel_lease/.test(text) && ++takes === 1);
    const [{ status, out }] = await stderrOf(() => withDb(db, async () => post((await signedSale()).body, node)));
    assert.equal(status, 200, JSON.stringify(out));
  } finally {
    TIMING.maxRequestAgeMs = saved;
  }
  assert.equal(takes, 2, 'the first take committed, its reply was lost, the retry recognised it');
  assert.deepEqual((await sentRows(node.relayer.address)).map((r) => r.fence), ['1'], 'one take: fence 1, not a second lease');
});

test('B8: a write-ahead whose reply was lost is recognised as ours on retry (never a false "replay"); broadcast once', async () => {
  const node = fakeNode();
  let writes = 0;
  const db = lostReplyDb((text) => /INSERT INTO rel_sent/.test(text) && ++writes === 1);
  const [{ status, out }] = await stderrOf(() => withDb(db, async () => post((await signedSale()).body, node)));
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(writes, 2);
  assert.equal(node.sent.length, 1);
  assert.equal((await sentRows(node.relayer.address)).length, 1);
});

// The relay path can't reach this guard (its replay reads refuse first), so writeAhead is called directly: a stale holder
// re-signing the same nonce produces the SAME tx hash, and only the fence tells the two writers apart.
test('B8: write-ahead recognition needs our fence too: the same tx hash under another fence is a replay', async () => {
  const relayer = privateKeyToAccount(generatePrivateKey()).address;
  const base = { relayer, auth: { key: `0xabc:${random32()}`, payer: '0xabc' }, txHash: random32(), txNonce: 7, feeWei: CAP_FEE, sentAt: Date.now() };
  const first = await takeLease(relayer, 'holder-1');
  assert.ok(first);
  assert.equal(await writeAhead({ ...base, fence: first }), 'written');
  assert.equal(await writeAhead({ ...base, fence: first }), 'written', 'our own retry after a lost reply');
  await pg.query("UPDATE rel_lease SET until = now() - interval '1 second' WHERE relayer = $1", [relayer.toLowerCase()]);
  const second = await takeLease(relayer, 'holder-2');
  assert.ok(second && second !== first);
  assert.equal(await writeAhead({ ...base, fence: second }), 'replay', 'same hash, another holder');
  assert.equal(await takeLease(relayer, 'holder-1'), undefined, 'holder-1 lost its lease and is not recognised');
  assert.equal(await takeLease(relayer, 'holder-2'), second, 'holder-2 retrying its take is recognised');
});

test("B8: another holder's write-ahead row is still a replay on retry (recognition needs our tx hash AND fence)", async () => {
  const node = timeoutNode();
  const { body } = await signedSale();
  assert.equal((await post(body, node)).status, 502); // written ahead + broadcast, then no receipt
  const again = await postTwo(body, node);
  assert.deepEqual([again.status, again.out.code], [422, 'replay']);
  assert.equal(node.sent.length, 1);
});

test('B8: non-transient errors are not retried; persistent transient errors give up within ~1.5 s with 503; nothing signed or sent', async () => {
  let tries = 0;
  const fatal = failingDb(() => { tries += 1; return true; }, 'fatal');
  const node = fakeNode();
  const [first] = await stderrOf(() => withDb(fatal, async () => post((await signedSale()).body, node)));
  assert.deepEqual([first.status, first.out.code, tries], [503, 'db_unavailable', 1], 'a fatal error is tried once');
  tries = 0;
  const down = failingDb(() => { tries += 1; return true; });
  const started = performance.now();
  const [second] = await stderrOf(() => withDb(down, async () => post((await signedSale()).body, node)));
  const elapsed = performance.now() - started;
  assert.deepEqual([second.status, second.out.code, second.out.txHash, tries], [503, 'db_unavailable', undefined, 4]);
  assert.ok(elapsed < 1_800, `gave up after ${Math.round(elapsed)} ms`);
  assert.deepEqual([node.calls, node.sent], [[], []], 'refused before any RPC, nothing signed');
});

// ---- round 3, B9 (owner): no automatic ban; a temporary cooldown for repeated payer-attributable failures ----

test('B9: 3 payer-attributable reverts within 10 min put the payer in a 15-min cooldown: 429 payer_cooldown + retry_after_s, on every instance', async () => {
  const payerKey = generatePrivateKey();
  const payer = privateKeyToAccount(payerKey).address;
  // separate relayers, so the per-relayer revert breaker stays closed and only the payer's cooldown can refuse
  for (const via of [post, postTwo, post]) {
    assert.equal((await via((await signedSaleFrom(payerKey)).body, revertingNode({ drained: true }))).out.code, 'reverted');
  }
  assert.equal(await faultRows(payer), 3);
  const node = fakeNode();
  const res = await two.relay(JSON.stringify((await signedSaleFrom(payerKey)).body), node.client);
  const out = await res.json();
  assert.deepEqual([res.status, out.code], [429, 'payer_cooldown'], JSON.stringify(out));
  assert.ok(Number.isInteger(out.retry_after_s) && out.retry_after_s > 890 && out.retry_after_s <= 900, `retry_after_s ${out.retry_after_s}`);
  assert.equal(res.headers.get('retry-after'), String(out.retry_after_s));
  assert.deepEqual(node.calls, [], 'refused before any RPC');
  const one = await post((await signedSaleFrom(payerKey)).body, fakeNode());
  assert.deepEqual([one.status, one.out.code], [429, 'payer_cooldown'], 'instance 1 sees it too');
  assert.equal((await post((await signedSale()).body, fakeNode())).status, 200, 'other payers are unaffected');
});

test('B9: two attributable reverts do not block; unattributable reverts never count (pause/unknown, front-run, RPC trouble)', async () => {
  const twice = generatePrivateKey();
  for (let i = 0; i < 2; i++) await post((await signedSaleFrom(twice)).body, revertingNode({ drained: true }));
  assert.equal((await post((await signedSaleFrom(twice)).body, fakeNode())).status, 200, 'two failures: still relayed');
  const cases: [string, Parameters<typeof revertingNode>[0]][] = [
    ['funds still there (pause, gas, unknown)', {}],
    ['authorization consumed elsewhere (front-run), funds gone with it', { drained: true, consumedElsewhere: true }],
    ['the post-revert check itself failed (RPC trouble)', { drained: true, checkFails: true }],
  ];
  for (const [name, o] of cases) {
    const payerKey = generatePrivateKey();
    for (let i = 0; i < 3; i++) assert.equal((await post((await signedSaleFrom(payerKey)).body, revertingNode(o))).out.code, 'reverted', name);
    assert.equal(await faultRows(privateKeyToAccount(payerKey).address), 0, `${name}: counted`);
    assert.equal((await post((await signedSaleFrom(payerKey)).body, fakeNode())).status, 200, `${name}: penalized`);
  }
});

test('B9: re-POSTs of a failed authorization are replays (no rebroadcast) and never add a failure; bad signatures never count', async () => {
  const payerKey = generatePrivateKey();
  const payer = privateKeyToAccount(payerKey).address;
  const node = revertingNode({ drained: true });
  const { body } = await signedSaleFrom(payerKey);
  assert.equal((await post(body, node)).out.code, 'reverted');
  for (const via of [post, postTwo]) assert.deepEqual([(await via(body, node)).out.code], ['replay']);
  assert.deepEqual([node.sent.length, await faultRows(payer)], [1, 1]);
  // someone else signs "as" this payer: refused before any relay, so it can never count against them
  for (let i = 0; i < 5; i++) {
    const forged = await signedSale({ signerKey: generatePrivateKey() });
    const res = await post({ ...forged.body, args: { ...forged.body.args, from: payer } }, fakeNode());
    assert.equal(res.out.code, 'bad_signature');
  }
  assert.deepEqual([await faultRows(payer), (await post((await signedSaleFrom(payerKey)).body, fakeNode())).status], [1, 200]);
});

test('B9: the window is 10 min (exclusive) and the cooldown 15 min from the 3rd failure', async () => {
  const blocked = async (payerKey: Hex) => (await post((await signedSaleFrom(payerKey)).body, fakeNode())).out.code === 'payer_cooldown';
  const spread = generatePrivateKey(); // 11, 5 and 1 min ago: never 3 inside one 10-min window
  for (const ago of [11, 5, 1]) await seedFault(privateKeyToAccount(spread).address, ago * MINUTE);
  assert.equal(await blocked(spread), false);
  const old = generatePrivateKey(); // 3 within 2 min, the last 16 min ago: the 15-min cooldown is over
  for (const ago of [18, 17, 16]) await seedFault(privateKeyToAccount(old).address, ago * MINUTE);
  assert.equal(await blocked(old), false);
  const recent = generatePrivateKey(); // 9, 5 and 1 min ago: in cooldown for another ~14 min
  for (const ago of [9, 5, 1]) await seedFault(privateKeyToAccount(recent).address, ago * MINUTE);
  const res = await post((await signedSaleFrom(recent)).body, fakeNode());
  assert.equal(res.out.code, 'payer_cooldown');
  assert.ok(res.out.retry_after_s > 830 && res.out.retry_after_s <= 840, `retry_after_s ${res.out.retry_after_s}`);
});

test('B9: the thresholds come from RELAYER_COOLDOWN_FAILURES, RELAYER_COOLDOWN_WINDOW_S and RELAYER_COOLDOWN_S', async () => {
  const names = ['RELAYER_COOLDOWN_FAILURES', 'RELAYER_COOLDOWN_WINDOW_S', 'RELAYER_COOLDOWN_S'] as const;
  const saved = names.map((n) => process.env[n]);
  Object.assign(process.env, { RELAYER_COOLDOWN_FAILURES: '2', RELAYER_COOLDOWN_WINDOW_S: '120', RELAYER_COOLDOWN_S: '60' });
  try {
    const payerKey = generatePrivateKey();
    for (const ago of [90_000, 10_000]) await seedFault(privateKeyToAccount(payerKey).address, ago);
    const res = await post((await signedSaleFrom(payerKey)).body, fakeNode());
    assert.equal(res.out.code, 'payer_cooldown');
    assert.ok(res.out.retry_after_s > 45 && res.out.retry_after_s <= 50, `retry_after_s ${res.out.retry_after_s}`);
  } finally {
    names.forEach((n, i) => { if (saved[i] === undefined) delete process.env[n]; else process.env[n] = saved[i]; });
  }
});

test('B9: an audited unblock lifts a cooldown at once (actor, reason, what was active); earlier failures stop counting', async () => {
  const payerKey = generatePrivateKey();
  const payer = privateKeyToAccount(payerKey).address;
  for (const ago of [3, 2, 1]) await seedFault(payer, ago * MINUTE);
  assert.equal((await post((await signedSaleFrom(payerKey)).body, fakeNode())).out.code, 'payer_cooldown');
  const audit = await unblockPayer({ payer, actor: 'ops-asha', reason: 'customer confirmed the funds move was a mistake' });
  const [row] = (await pg.query<{ payer: string; actor: string; reason: string; cooldown_until: string | null }>(
    'SELECT payer, actor, reason, cooldown_until::text FROM rel_payer_unblocks WHERE id = $1', [audit.id])).rows;
  assert.deepEqual([row.payer, row.actor, row.reason], [payer.toLowerCase(), 'ops-asha', 'customer confirmed the funds move was a mistake']);
  assert.ok(Number(row.cooldown_until) > Date.now(), 'the audit row keeps the cooldown it lifted');
  assert.equal((await post((await signedSaleFrom(payerKey)).body, fakeNode())).status, 200);
  await seedFault(payer, 0); // one new failure + the 3 before the unblock: not a new cooldown
  assert.equal((await post((await signedSaleFrom(payerKey)).body, fakeNode())).status, 200);
  await assert.rejects(unblockPayer({ payer, actor: ' ', reason: 'x' }), /actor/);
  await assert.rejects(unblockPayer({ payer: '0x12', actor: 'a', reason: 'x' }), /payer/);
});

test("B5: /health on instance 2 reports instance 1's spend, and paused is the real breaker state (at most 5 s old, like the balance)", async () => {
  const node = fakeNode({ minedRevert: true });
  const healthTwo = async () => (await two.health(node.client)).json();
  const fresh = await healthTwo();
  assert.deepEqual([fresh.gasSpentToday, fresh.budgetLeft, fresh.paused], ['0', '0.1', false]);
  for (let i = 0; i < 3; i++) assert.equal((await post((await signedSale()).body, node)).out.code, 'reverted');
  const realNow = Date.now;
  Date.now = () => realNow() + 5_001;
  let later;
  try {
    later = await healthTwo();
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual([later.gasSpentToday, later.paused], [formatEther(3n * (GAS_USED * GAS_PRICE + L1_FEE)), true]);
});

test('B5: paused is true once the shared budget cannot cover one more send', async () => {
  const big = fakeNode({ gasUsed: 20_000_000n });
  assert.equal((await post((await signedSale()).body, big)).status, 200);
  const h = await (await two.health(big.client)).json();
  assert.deepEqual([h.budgetLeft, h.paused], ['0', true]);
});

test('B5: a burst of /health calls makes one database read (the endpoint is public)', async () => {
  let reads = 0;
  const counting: Db = { query: (text, params) => { reads += 1; return pgDb(pg).query(text, params); } };
  const node = fakeNode();
  const replies = await withDb(counting, () => Promise.all(Array.from({ length: 10 }, () => health(node.client))));
  assert.ok(replies.every((r) => r.status === 200));
  assert.equal(reads, 1);
});

test('B7: db/*.sql is idempotent: applying it again keeps every table and row', async () => {
  const rows = async () => (await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM rel_sent')).rows[0].n;
  await pg.query(`INSERT INTO rel_sent (auth_key, relayer, payer, tx_hash, tx_nonce, fence, fee_wei, status, sent_at)
    VALUES ('b7:' || $1::text, 'b7', 'b7', '0x', 0, 1, 0, 'mined', 0)`, [random32()]);
  const existing = await rows();
  assert.ok(existing > 0);
  await applySchema(pg);
  assert.equal(await rows(), existing);
});

// Batch 049 (port): main's batch-037 least-privilege role kept for the batch-031 state. 002 creates mcplus_relayer,
// 005 grants what src/state.ts needs; a relay must work as that role and everything else must stay refused.
test('049: as the mcplus_relayer role (002 + 005) a sale relays end to end; other tables, deletes and unblocks are refused', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const rolePg = new PGlite();
  try {
    await applySchema(rolePg);
    await applyRoles(rolePg);
    await rolePg.query('CREATE TABLE app_gw_keys (id text)'); // stands in for the gateway's tables
    await rolePg.query('SET ROLE mcplus_relayer');
    await assert.rejects(rolePg.query('SELECT * FROM app_gw_keys'), /permission denied/);
    await assert.rejects(rolePg.query('DELETE FROM rel_sent'), /permission denied/);
    await assert.rejects(rolePg.query("INSERT INTO rel_payer_unblocks (id, payer, actor, reason, at) VALUES ('x', '0x', 'a', 'b', 1)"), /permission denied/);
    await withDb(pgDb(rolePg), async () => {
      const node = fakeNode();
      const sale = await signedSale();
      assert.equal((await post(sale.body, node)).status, 200);
      assert.equal((await post(sale.body, node)).out.code, 'replay');
      const h = await (await health(node.client)).json();
      assert.notEqual(h.gasSpentToday, '0', 'spend read back as the role');
    });
  } finally {
    await rolePg.close();
  }
});
