import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect, createServer as createTcpServer, type AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  custom, decodeFunctionData, encodeErrorResult, http, keccak256, parseAbi, parseSignature, parseTransaction, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { health, makeClient, PULL_STUB_ABI, relay } from '../src/relayer.ts';

const STUB = '0x1111111111111111111111111111111111111111';
const USDT = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const HALF_WBT = '0x6f05b59d3b20000'; // 0.5e18 wei

// A fake JSON-RPC node: records every method called and answers just enough for viem's write path.
// `on` overrides single methods (tester round 1: failure paths).
function fakeNode({ revert = false, on = {} as Record<string, (params: unknown[]) => unknown> } = {}) {
  const calls: string[] = [];
  let sentRaw: Hex | undefined;
  const transport = custom({
    async request({ method, params }: { method: string; params: unknown[] }) {
      calls.push(method);
      if (method === 'eth_sendRawTransaction') sentRaw = params[0] as Hex;
      if (on[method]) return on[method](params);
      switch (method) {
        case 'eth_chainId': return '0x752';
        case 'eth_call':
          if (revert) throw Object.assign(new Error('execution reverted: FiatTokenV2: invalid signature'), { code: 3 });
          return '0x';
        case 'eth_fillTransaction': // Ankr's reth supports it (probed 21:12), so viem's live send path starts here
          return {
            raw: '0x',
            tx: { ...(params[0] as object), type: '0x2', chainId: '0x752', nonce: '0x7', gas: '0x186a0', maxFeePerGas: '0x12a153440', maxPriorityFeePerGas: '0xf4240' },
          };
        case 'eth_estimateGas': return '0x186a0';
        case 'eth_getTransactionCount': return '0x7';
        case 'eth_maxPriorityFeePerGas': return '0xf4240';
        case 'eth_gasPrice': return '0x12a05f200';
        case 'eth_blockNumber': return '0x10';
        case 'eth_getBlockByNumber':
          return { number: '0x10', hash: `0x${'ab'.repeat(32)}`, timestamp: '0x1', baseFeePerGas: '0x12a05f200', transactions: [] };
        case 'eth_sendRawTransaction':
          sentRaw = params[0] as Hex;
          return keccak256(sentRaw);
        case 'eth_getTransactionReceipt':
          return {
            transactionHash: params[0], status: '0x1', blockNumber: '0x10', blockHash: `0x${'ab'.repeat(32)}`,
            transactionIndex: '0x0', from: '0x0', to: STUB, gasUsed: '0x1', cumulativeGasUsed: '0x1',
            effectiveGasPrice: '0x1', logs: [], logsBloom: `0x${'00'.repeat(256)}`, type: '0x2', contractAddress: null,
          };
        case 'eth_getBalance': return HALF_WBT;
      }
      throw new Error(`fake node: unexpected ${method}`);
    },
  }, { retryCount: 0 }); // a real code-3 revert over HTTP isn't retried; a thrown plain Error would be
  const relayer = privateKeyToAccount(generatePrivateKey());
  return { client: makeClient(relayer, transport), calls, sentRaw: () => sentRaw, relayer };
}

// The payer side, as the guest wallet / cast will do it: EIP-3009 typed data to the stub.
async function signedPull() {
  const payer = privateKeyToAccount(generatePrivateKey());
  const message = { from: payer.address, to: STUB, value: 1_000_000n, validAfter: 0n, validBefore: 1_900_000_000n, nonce: keccak256('0x01') } as const;
  const sig = await payer.signTypedData({
    domain: { name: 'Tether USD', version: '1', chainId: 1874, verifyingContract: USDT },
    types: {
      ReceiveWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'ReceiveWithAuthorization',
    message,
  });
  const args = { from: payer.address, value: '1000000', validAfter: '0', validBefore: '1900000000', nonce: message.nonce };
  return { body: { action: 'pull', args, sig }, message, sig };
}

test('rejects malformed bodies with 400 and makes no RPC call', async () => {
  const { body } = await signedPull();
  const withArgs = (patch: object) => JSON.stringify({ ...body, args: { ...body.args, ...patch } });
  const bad = [
    'not json',
    'x'.repeat(5000),
    JSON.stringify({ ...body, action: 'paySale' }),
    JSON.stringify({ action: 'pull' }),
    withArgs({ from: '0x123' }),
    withArgs({ from: body.args.from.toLowerCase().replace(/^0x/, '0X') }),
    withArgs({ value: '-1' }),
    withArgs({ value: '1.5' }),
    withArgs({ value: 1000000 }),
    withArgs({ value: '0' }),
    withArgs({ validBefore: '9'.repeat(78) }),
    withArgs({ nonce: '0x1234' }),
    JSON.stringify({ ...body, sig: body.sig.slice(0, 100) }),
    JSON.stringify({ ...body, sig: `0x${'00'.repeat(65)}` }),
  ];
  for (const input of bad) {
    const node = fakeNode();
    const res = await relay(input, node.client, STUB);
    assert.equal(res.status, 400, `expected 400 for ${input.slice(0, 60)}`);
    assert.ok((await res.json()).error);
    assert.deepEqual(node.calls, [], `no RPC for ${input.slice(0, 60)}`);
  }
});

test('returns 422 and sends nothing when the simulation reverts', async () => {
  const node = fakeNode({ revert: true });
  const res = await relay(JSON.stringify((await signedPull()).body), node.client, STUB);
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /revert/i);
  assert.ok(node.calls.includes('eth_call'));
  assert.ok(!node.calls.includes('eth_sendRawTransaction'));
});

test('submits pull to the stub with the exact args and returns the tx hash', async () => {
  const node = fakeNode();
  const { body, message, sig } = await signedPull();
  const res = await relay(JSON.stringify(body), node.client, STUB);
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));

  const raw = node.sentRaw();
  assert.ok(raw, 'a raw tx was broadcast');
  assert.equal(out.txHash, keccak256(raw));
  assert.equal(out.blockNumber, '16');

  assert.deepEqual(node.calls, ['eth_call', 'eth_fillTransaction', 'eth_sendRawTransaction', 'eth_getTransactionReceipt']);
  const tx = parseTransaction(raw);
  assert.equal(tx.to?.toLowerCase(), STUB);
  assert.equal(tx.chainId, 1874);
  const { r, s, yParity } = parseSignature(sig);
  const call = decodeFunctionData({ abi: PULL_STUB_ABI, data: tx.data! });
  assert.equal(call.functionName, 'pull');
  assert.deepEqual(call.args, [message.from, 1_000_000n, 0n, 1_900_000_000n, message.nonce, yParity + 27, r, s]);
});

test('health reports the relayer WBT balance and Phase 2 fields as null', async () => {
  const node = fakeNode();
  const res = await health(node.client);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    relayer: node.relayer.address, wbt: '0.5', gasSpentToday: null, budgetLeft: null, usdtFeesUnswapped: null, paused: false,
  });
});

// ---- Tester round 1: trust-boundary edges (parsePull) and the 502 paths of the spec's interface ----

const rpcDown = () => { throw Object.assign(new Error('fake node: internal error'), { code: -32000 }); };
const cut = (s: string) => s.slice(0, 70);

test('rejects more malformed shapes with 400 and makes no RPC call', async () => {
  const { body } = await signedPull();
  const withArgs = (patch: object) => JSON.stringify({ ...body, args: { ...body.args, ...patch } });
  const exact = (n: number) => JSON.stringify(body).padEnd(n, ' ');
  const bad = [
    'null', '[]', '"pull"', '',
    JSON.stringify({ ...body, args: [body.args.from] }),
    JSON.stringify({ ...body, args: null }),
    JSON.stringify({ action: 'pull', args: body.args }),            // no sig
    JSON.stringify({ ...body, args: { ...body.args, nonce: undefined } }),
    withArgs({ from: 123 }),
    withArgs({ from: body.args.from.toUpperCase().replace(/^0X/, '0x') }), // bad checksum (all upper)
    withArgs({ value: '' }), withArgs({ value: ' 1' }), withArgs({ value: '+1' }),
    withArgs({ value: '0x10' }), withArgs({ value: '1e6' }), withArgs({ validAfter: '-0' }),
    withArgs({ nonce: `0X${body.args.nonce.slice(2)}` }), withArgs({ nonce: `${body.args.nonce}00` }),
    JSON.stringify({ ...body, sig: `${body.sig.slice(0, 130)}1d` }),   // v = 29
    JSON.stringify({ ...body, sig: `${body.sig}00` }),                // 66 bytes
    exact(4097),                                                      // one char over the cap
  ];
  for (const input of bad) {
    const node = fakeNode();
    const res = await relay(input, node.client, STUB);
    assert.equal(res.status, 400, `expected 400 for ${cut(input)}`);
    assert.ok((await res.json()).error);
    assert.deepEqual(node.calls, [], `no RPC for ${cut(input)}`);
  }
});

test('accepts boundary values: a 4096-char body, uint256 max, lowercase from, compact v', async () => {
  const { body, message, sig } = await signedPull();
  const { r, s, yParity } = parseSignature(sig);
  const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  const cases: [string, readonly unknown[]][] = [
    [JSON.stringify(body).padEnd(4096, ' '), [message.from, 1_000_000n, 0n, 1_900_000_000n, message.nonce, yParity + 27, r, s]],
    [JSON.stringify({ ...body, args: { ...body.args, validBefore: max } }), [message.from, 1_000_000n, 0n, BigInt(max), message.nonce, yParity + 27, r, s]],
    [JSON.stringify({ ...body, args: { ...body.args, from: body.args.from.toLowerCase() } }), [message.from, 1_000_000n, 0n, 1_900_000_000n, message.nonce, yParity + 27, r, s]],
    [JSON.stringify({ ...body, sig: `${sig.slice(0, 130)}0${yParity}` }), [message.from, 1_000_000n, 0n, 1_900_000_000n, message.nonce, yParity + 27, r, s]],
  ];
  for (const [input, expected] of cases) {
    const node = fakeNode();
    const res = await relay(input, node.client, STUB);
    assert.equal(res.status, 200, `expected 200 for ${cut(input)}: ${await res.clone().text()}`);
    const call = decodeFunctionData({ abi: PULL_STUB_ABI, data: parseTransaction(node.sentRaw()!).data! });
    assert.deepEqual(call.args, expected, `calldata for ${cut(input)}`);
  }
});

test('ignores a client-supplied target or calldata: the tx always goes to the stub as pull', async () => {
  const node = fakeNode();
  const { body, message } = await signedPull();
  const evil = '0x2222222222222222222222222222222222222222';
  const input = JSON.stringify({
    ...body, to: evil, target: evil, address: evil, data: '0xdeadbeef', functionName: 'transfer',
    args: { ...body.args, to: evil, data: '0xdeadbeef' },
  });
  const res = await relay(input, node.client, STUB);
  assert.equal(res.status, 200);
  const tx = parseTransaction(node.sentRaw()!);
  assert.equal(tx.to?.toLowerCase(), STUB);
  assert.equal(tx.value ?? 0n, 0n);
  const call = decodeFunctionData({ abi: PULL_STUB_ABI, data: tx.data! });
  assert.equal(call.functionName, 'pull');
  assert.equal(call.args[0], message.from);
});

test('returns 502 with the txHash when the tx is mined but reverts', async () => {
  const node = fakeNode({
    on: {
      eth_getTransactionReceipt: ([hash]) => ({
        transactionHash: hash, status: '0x0', blockNumber: '0x10', blockHash: `0x${'ab'.repeat(32)}`,
        transactionIndex: '0x0', from: '0x0', to: STUB, gasUsed: '0x1', cumulativeGasUsed: '0x1',
        effectiveGasPrice: '0x1', logs: [], logsBloom: `0x${'00'.repeat(256)}`, type: '0x2', contractAddress: null,
      }),
    },
  });
  const res = await relay(JSON.stringify((await signedPull()).body), node.client, STUB);
  const out = await res.json();
  assert.equal(res.status, 502);
  assert.equal(out.txHash, keccak256(node.sentRaw()!));
  assert.match(out.error, /reverted/);
});

test('returns 502 without a txHash when the broadcast fails', async () => {
  const node = fakeNode({ on: { eth_sendRawTransaction: rpcDown } });
  const res = await relay(JSON.stringify((await signedPull()).body), node.client, STUB);
  const out = await res.json();
  assert.equal(res.status, 502);
  assert.ok(out.error);
  assert.equal(out.txHash, undefined);
});

test('returns 502 with the txHash when the receipt lookup fails after the broadcast', async () => {
  const node = fakeNode({ on: { eth_getTransactionReceipt: rpcDown } });
  const res = await relay(JSON.stringify((await signedPull()).body), node.client, STUB);
  const out = await res.json();
  assert.equal(res.status, 502);
  assert.equal(out.txHash, keccak256(node.sentRaw()!));
});

test('health returns 502 when the balance lookup fails', async () => {
  const node = fakeNode({ on: { eth_getBalance: rpcDown } });
  const res = await health(node.client);
  assert.equal(res.status, 502);
  assert.ok((await res.json()).error);
});

// Spec interface: "422 simulation reverted … 502 RPC failure". An unreachable node during simulation is an RPC failure.
// The RPC URL may carry a provider API key (RPC_URL), so no error body may echo it (NFR-3).
test('an unreachable RPC gives 502 (not 422) and the error never echoes the RPC URL', async () => {
  const token = 'fake-provider-token-not-a-secret';
  const client = makeClient(privateKeyToAccount(generatePrivateKey()), http(`http://127.0.0.1:1/${token}`, { retryCount: 0 }));
  const relayed = await relay(JSON.stringify((await signedPull()).body), client, STUB);
  const relayedText = await relayed.text();
  const healthText = await (await health(client)).text();
  assert.ok(!relayedText.includes(token) && !healthText.includes(token), 'RPC URL leaked into a response');
  assert.ok(!relayedText.includes('127.0.0.1') && !healthText.includes('127.0.0.1'), 'RPC host leaked into a response');
  assert.equal(relayed.status, 502, `RPC down during simulation answered ${relayed.status} ${relayedText}`);
});

// Spec interface: "400 … body over 4 KB … the chain isn't touched". 4 KB is bytes; the check counts UTF-16 chars.
test('a body over 4 KB in bytes (multibyte padding, under 4096 chars) is rejected with 400 before any RPC', async () => {
  const node = fakeNode();
  const { body } = await signedPull();
  const input = JSON.stringify({ ...body, memo: '€'.repeat(2000) }); // ~2.3k chars, ~6.3 KB of UTF-8
  assert.ok(input.length <= 4096 && Buffer.byteLength(input) > 4096);
  const res = await relay(input, node.client, STUB);
  assert.equal(res.status, 400, `a ${Buffer.byteLength(input)}-byte body answered ${res.status}`);
  assert.deepEqual(node.calls, []);
});

// ---- Tester round 2: simulation errors over the production transport (viem http), byte-cap boundary, dev.ts ----

// A JSON-RPC node over real HTTP that answers every request with one canned reply.
async function httpNode(reply: { status?: number; body: string | object }) {
  const server = createServer((req, res) => req.resume().on('end', () => {
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify({ jsonrpc: '2.0', id: 0, ...reply.body }));
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const client = makeClient(privateKeyToAccount(generatePrivateKey()), http(`http://127.0.0.1:${port}`, { retryCount: 0 }));
  return { client, close: () => server.close() };
}

async function relayVia(reply: { status?: number; body: string | object }) {
  const node = await httpNode(reply);
  try {
    const res = await relay(JSON.stringify((await signedPull()).body), node.client, STUB);
    return { status: res.status, text: await res.text() };
  } finally {
    node.close();
  }
}

// Ankr's reth answers a reverting eth_call with code 3 + Error(string) data (raw curl, round 2: "TetherToken: auth expired").
test('over HTTP, a real revert (code 3 + Error(string) data, as Ankr answers) is still 422 with the reason', async () => {
  const data = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['TetherToken: auth invalid'] });
  const out = await relayVia({ body: { error: { code: 3, message: 'execution reverted: TetherToken: auth invalid', data } } });
  assert.equal(out.status, 422, out.text);
  assert.match(out.text, /TetherToken: auth invalid/);
  const bare = await relayVia({ body: { error: { code: 3, message: 'execution reverted' } } });
  assert.equal(bare.status, 422, bare.text);
});

test('over HTTP, transport and node failures during simulation are 502', async () => {
  const failures: [string, { status?: number; body: string | object }][] = [
    ['HTTP 503', { status: 503, body: '<html>bad gateway</html>' }],
    ['HTTP 429', { status: 429, body: { error: { code: 429, message: 'Too Many Requests' } } }],
    ['HTTP 200, not JSON', { body: 'not json' }],
    ['-32000 header not found', { body: { error: { code: -32000, message: 'header not found' } } }],
    ['-32005 limit exceeded', { body: { error: { code: -32005, message: 'request rate exceeded' } } }],
  ];
  for (const [name, reply] of failures) {
    const out = await relayVia(reply);
    assert.equal(out.status, 502, `${name} answered ${out.status} ${out.text}`);
  }
});

// Spec interface: 502 = RPC failure. JSON-RPC -32603 is "Internal error" (a node failure, not a revert; Ankr's reverts are code 3),
// but viem's getContractError wraps -32603 in ContractFunctionRevertedError, so isRevert() calls it a revert.
test('over HTTP, a JSON-RPC -32603 internal error during simulation is 502, not 422', async () => {
  const out = await relayVia({ body: { error: { code: -32603, message: 'Internal error' } } });
  assert.equal(out.status, 502, `-32603 answered ${out.status} ${out.text}`);
});

test('the 4 KB cap counts bytes: a 4096-byte multibyte body is accepted, 4097 bytes is 400 with no RPC', async () => {
  const { body, message } = await signedPull();
  const ofBytes = (n: number) => {
    const euros = JSON.stringify({ ...body, memo: '€'.repeat(Math.floor((n - JSON.stringify({ ...body, memo: '' }).length) / 3)) });
    return euros.padEnd(euros.length + n - Buffer.byteLength(euros), ' ');
  };
  const [fits, over] = [ofBytes(4096), ofBytes(4097)];
  assert.deepEqual([Buffer.byteLength(fits), Buffer.byteLength(over)], [4096, 4097]);
  assert.ok(over.length < 4096, 'the over-cap body is under 4096 chars');

  const ok = fakeNode();
  const accepted = await relay(fits, ok.client, STUB);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal(decodeFunctionData({ abi: PULL_STUB_ABI, data: parseTransaction(ok.sentRaw()!).data! }).args[0], message.from);

  const no = fakeNode();
  assert.equal((await relay(over, no.client, STUB)).status, 400);
  assert.deepEqual(no.calls, []);
});

// dev.ts parses req.url with new URL() before its try block; an absolute-form target with a bad host throws there.
// Spawned with only PORT in its environment: no relayer key, and the handlers are never reached.
test('the dev server survives a malformed request target and keeps answering', { timeout: 15_000 }, async () => {
  const probe = createTcpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));

  const dev = spawn(process.execPath, ['dev.ts'], {
    cwd: new URL('..', import.meta.url), env: { PORT: String(port) }, timeout: 10_000, // never outlives the test
  });
  try {
    await once(dev.stdout, 'data'); // the "listening" line
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {}).resume(); // read the reply, so 'close' fires once the server hangs up
    socket.end('GET http://[/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    await once(socket, 'close');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await fetch(`http://127.0.0.1:${port}/nope`).then((r) => r.status, () => 'connection refused');
    assert.equal(after, 404, `after one malformed request the dev server answered: ${after} (exit code ${dev.exitCode})`);
  } finally {
    dev.kill();
  }
});
