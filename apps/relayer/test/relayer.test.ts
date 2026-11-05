import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  custom, decodeFunctionData, domainSeparator, encodeAbiParameters, encodeErrorResult, encodeEventTopics,
  encodeFunctionResult, http, keccak256, parseAbi, parseAbiParameters, parseSignature, parseTransaction,
  serializeSignature, toHex, zeroHash, type Address, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { addresses, merchantPayAbi } from '../../../packages/shared/contracts.ts';
import { health, makeClient, relay, relayerClient, startBalanceRefresh, USDT_ABI, USDT_DOMAIN } from '../src/relayer.ts';

const MP = addresses.merchantPay; // lowercase in the generated file
const USDT: Address = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const RELAY_FEE = 100_000n; // MerchantPay.relayFee() on chain: 0.10 USDT
const HALF_WBT = '0x6f05b59d3b20000'; // 0.5e18 wei
const GAS_USED = 217_194n; // a live paySale (claude-contracts smoke test)
const GAS_PRICE = 5_001_000_000n;
const ABI = [...USDT_ABI, ...merchantPayAbi];
const REVERT_DATA = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['TetherToken: auth invalid'] });
const customRevert = (errorName: 'OrderPaid' | 'InvoiceNotOpen' | 'WrongAmount' | 'InvalidOrder') =>
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

interface NodeOptions {
  code?: Hex;
  balance?: bigint;
  gasPrice?: bigint;
  used?: Hex[];
  sendDelayMs?: number;
  on?: Record<string, (params: unknown[]) => unknown>; // override one method; simulations are 'eth_call:paySale' / 'eth_call:payInvoice'
}

type Call = ReturnType<typeof decodeFunctionData<typeof ABI>>;
// The authorization nonce MerchantPay pulls with, recomputed from a paySale / payInvoice call.
function authNonce(call: Call): Hex | undefined {
  if (call.functionName === 'paySale') { const [merchant, orderRef, , amount, , , salt] = call.args; return saleNonceOf(merchant, orderRef, amount, salt); }
  if (call.functionName === 'payInvoice') { const [id, , amount, , , salt] = call.args; return invoiceNonceOf(id, amount, salt); }
}

// A stateful fake JSON-RPC node: USDT reads, MerchantPay's relayFee, paySale/payInvoice (revert once their authorization
// is used), a relayer nonce that advances on every send, and eth_sendRawTransactionSync with a Paid event.
function fakeNode(opts: NodeOptions = {}) {
  const calls: string[] = [];
  const sent: Hex[] = [];
  const simulations: Record<string, unknown>[] = []; // the eth_call request objects of every payment simulation
  const used = new Set<Hex>(opts.used ?? []);
  let nonce = 7;
  let paymentId = 41n;
  const decode = (params: unknown[]) => decodeFunctionData({ abi: ABI, data: (params[0] as { data: Hex }).data });

  async function answer(method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case 'eth_getCode': return opts.code ?? '0x';
      case 'eth_gasPrice': return toHex(opts.gasPrice ?? GAS_PRICE);
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
        const auth = authNonce(call);
        if (auth && used.has(auth)) throw rpcError(3, 'execution reverted: TetherToken: auth invalid', REVERT_DATA);
        if (auth) return encodeFunctionResult({ abi: merchantPayAbi, functionName: 'paySale', result: paymentId + 1n });
        throw new Error(`fake node: unexpected eth_call ${call.functionName}`);
      }
      case 'eth_sendRawTransactionSync': {
        const raw = params[0] as Hex;
        sent.push(raw);
        await sleep(opts.sendDelayMs ?? 0);
        const call = decodeFunctionData({ abi: merchantPayAbi, data: parseTransaction(raw).data! });
        used.add(authNonce(call)!);
        nonce += 1;
        paymentId += 1n;
        calls.push('eth_sendRawTransactionSync:done');
        return receipt(keccak256(raw), '0x1', [paidLog(keccak256(raw), paymentId, call)]);
      }
    }
    throw new Error(`fake node: unexpected ${method}`);
  }

  const name = (method: string, params: unknown[]) => method === 'eth_call' ? `eth_call:${decode(params).functionName}` : method;
  const transport = custom({
    async request({ method, params }: { method: string; params: unknown[] }) {
      const label = name(method, params);
      calls.push(label);
      if (label === 'eth_call:paySale' || label === 'eth_call:payInvoice') simulations.push(params[0] as Record<string, unknown>);
      return opts.on?.[label] ? opts.on[label](params) : answer(method, params);
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

function receipt(hash: Hex, status = '0x1', logs: unknown[] = []) {
  return {
    transactionHash: hash, status, blockNumber: '0x10', blockHash: `0x${'ab'.repeat(32)}`, transactionIndex: '0x0',
    from: '0x0', to: MP, gasUsed: toHex(GAS_USED), cumulativeGasUsed: toHex(GAS_USED), effectiveGasPrice: toHex(GAS_PRICE), logs,
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
const PRECHECKS = ['eth_call:authorizationState', 'eth_call:balanceOf', 'eth_call:paySale', 'eth_gasPrice', 'eth_getCode'];

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
  const t = now();
  const cases: [string, Parameters<typeof signedSale>[0]][] = [
    ['not_yet_valid', { validAfter: t + 60n }],
    ['expired', { validBefore: t + 10n }],
    ['expired', { validBefore: t - 1n }],
    ['window_too_long', { validBefore: t + 901n }],
    ['window_too_long', { validBefore: 2n ** 256n - 1n }],
    ['below_minimum', { value: 999_999n }],
    ['below_minimum', { value: 1n }],
    ['bad_signature', { signerKey: generatePrivateKey() }],
    ['bad_signature', { to: '0x2222222222222222222222222222222222222222' }], // signed for another target
  ];
  for (const [code, o] of cases) {
    const node = fakeNode();
    const { status, out } = await post((await signedSale(o)).body, node);
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

test('a valid paySale is signed with capped gas and fees, sent once with eth_sendRawTransactionSync, and returns the hash', async () => {
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

  assert.deepEqual(node.calls.slice(0, 5).sort(), PRECHECKS);
  assert.deepEqual(node.calls.slice(5, 7).sort(), ['eth_call:paySale', 'eth_getTransactionCount']);
  assert.deepEqual(node.calls.slice(7), ['eth_sendRawTransactionSync', 'eth_sendRawTransactionSync:done']);
  for (const never of ['eth_fillTransaction', 'eth_estimateGas', 'eth_sendRawTransaction', 'eth_getTransactionReceipt']) {
    assert.ok(!node.calls.includes(never), `called ${never}`);
  }
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

test('after a sync-send timeout, re-POSTing the same authorization is a replay and is not sent again', async () => {
  const node = fakeNode({
    on: { eth_sendRawTransactionSync: (params) => { node.sent.push(params[0] as Hex); throw rpcError(4, 'transaction not included in time'); } },
  });
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
  const firstDone = node.calls.indexOf('eth_sendRawTransactionSync:done');
  const secondSim = node.calls.lastIndexOf('eth_call:paySale');
  assert.ok(secondSim > firstDone, `the second simulation ran before the first send finished: ${node.calls.join(' > ')}`);
});

test('failures inside the lock release it: the next payment still goes through', async () => {
  const failures: NodeOptions['on'][] = [
    { eth_sendRawTransactionSync: () => { throw rpcError(-32000, 'nonce too low'); } },
    { eth_getTransactionCount: () => { throw rpcError(-32000, 'header not found'); } },
  ];
  for (const on of failures) {
    assert.equal((await post((await signedSale()).body, fakeNode({ on }))).status, 502);
    assert.equal((await post((await signedSale()).body, fakeNode())).status, 200);
  }
});

test('send outcomes: mined-but-reverted, a receipt for another hash, and a sync timeout all return 502 with our txHash', async () => {
  const cases: [string, (params: unknown[]) => unknown][] = [
    ['reverted', (params) => receipt(keccak256(params[0] as Hex), '0x0')],
    ['receipt_mismatch', () => receipt(`0x${'cd'.repeat(32)}`)],
    ['rpc_error', (params) => { throw rpcError(4, 'transaction not included in time', keccak256(params[0] as Hex)); }],
    ['rpc_error', () => { throw rpcError(-32000, 'nonce too low'); }],
  ];
  for (const [code, reply] of cases) {
    const node = fakeNode({ on: { eth_sendRawTransactionSync: (params) => { node.sent.push(params[0] as Hex); return reply(params); } } });
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

test('health reports the relayer WBT balance and Phase 2 fields as null; a failed lookup is 502', async () => {
  const node = fakeNode();
  const res = await health(node.client);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    relayer: node.relayer.address, wbt: '0.5', gasSpentToday: null, budgetLeft: null, usdtFeesUnswapped: null, paused: false,
  });
  const down = fakeNode({ on: { eth_getBalance: () => { throw rpcError(-32000, 'down'); } } });
  assert.equal((await health(down.client)).status, 502);
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
    on: { eth_sendRawTransactionSync: async (params) => { node.sent.push(params[0] as Hex); await sleep(40); throw rpcError(4, 'transaction not included in time'); } },
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
      on: { eth_sendRawTransactionSync: async (params) => { node.sent.push(params[0] as Hex); await held; return receipt(keccak256(params[0] as Hex)); } },
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
    ['sync timeout', { eth_sendRawTransactionSync: () => { throw rpcError(4, 'transaction not included in time'); } }],
    ['receipt_mismatch', { eth_sendRawTransactionSync: () => receipt(`0x${'cd'.repeat(32)}`) }],
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
  try {
    await sleep(75);
    const refreshed = node.reads();
    assert.ok(refreshed >= 3, `only ${refreshed} background reads in 75 ms at a 20 ms interval`);
    assert.equal(await wbtOf(node), '1');
    assert.equal(node.reads(), refreshed, 'health waited on the node instead of the refreshed cache');
  } finally {
    stop();
  }
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
  assert.equal(out.gasCostWei, String(GAS_USED * GAS_PRICE));
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
