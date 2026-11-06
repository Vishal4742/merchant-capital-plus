// The HTTP edge: api/relay.ts media-type check and the localhost dev server (spawned with only PORT, so no key).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { connect, createServer, type AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { POST } from '../api/relay.ts';

const SECRET = 'test-relay-secret-not-a-real-one';
const req = (headers: Record<string, string>) => new Request('http://127.0.0.1/relay', { method: 'POST', headers, body: '{}' });
async function withSecret<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.RELAY_API_SECRET;
  if (value === undefined) delete process.env.RELAY_API_SECRET; else process.env.RELAY_API_SECRET = value;
  try { return await run(); } finally { if (saved === undefined) delete process.env.RELAY_API_SECRET; else process.env.RELAY_API_SECRET = saved; }
}

test('api/relay.ts: no, wrong or wrong-length x-relay-secret is 401, and an unset RELAY_API_SECRET refuses everything', async () => {
  const json = { 'content-type': 'application/json' };
  await withSecret(SECRET, async () => {
    for (const headers of [json, { ...json, 'x-relay-secret': 'nope' }, { ...json, 'x-relay-secret': `${SECRET}x` }, { ...json, 'x-relay-secret': SECRET.toUpperCase() }]) {
      const res = await POST(req(headers));
      assert.equal(res.status, 401, JSON.stringify(headers));
      assert.equal((await res.json()).code, 'unauthorized');
    }
  });
  await withSecret(undefined, async () => {
    assert.equal((await POST(req({ ...json, 'x-relay-secret': '' }))).status, 401, 'unset secret: fail closed');
  });
});

test('api/relay.ts: with the right secret it checks the media type (415) and then needs the relayer key', async () => {
  await withSecret(SECRET, async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      const res = await POST(req({ 'content-type': type, 'x-relay-secret': SECRET }));
      assert.equal(res.status, 415, `content-type "${type}"`);
      assert.equal((await res.json()).code, 'unsupported_media_type');
    }
    await assert.rejects(POST(req({ 'content-type': 'application/json', 'x-relay-secret': SECRET })), /RELAYER_PRIVATE_KEY/, 'auth passed, then the missing key');
  });
});

let dev: ChildProcess;
let port: number;

before(async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  dev = spawn(process.execPath, ['dev.ts'], { cwd: new URL('..', import.meta.url), env: { PORT: String(port), RELAY_API_SECRET: SECRET }, timeout: 20_000 });
  await once(dev.stdout!, 'data'); // the "listening" line
});
after(() => dev.kill());

const url = (path: string) => `http://127.0.0.1:${port}${path}`;
// A raw HTTP/1.1 request, for things fetch won't send (a foreign Host, a malformed target).
async function raw(request: string): Promise<string> {
  const socket = connect(port, '127.0.0.1');
  let reply = '';
  socket.on('data', (c) => { reply += c; }).on('error', () => {});
  socket.end(request);
  await once(socket, 'close');
  return reply;
}

test('dev forwards content-type and x-relay-secret: a JSON POST with the secret passes both checks (500 here only because no key is loaded)', async () => {
  const json = await fetch(url('/relay'), { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'x-relay-secret': SECRET }, body: '{}' });
  assert.equal(json.status, 500);
  const text = await fetch(url('/relay'), { method: 'POST', headers: { 'content-type': 'text/plain', 'x-relay-secret': SECRET }, body: '{}' });
  assert.equal(text.status, 415);
  const noSecret = await fetch(url('/relay'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noSecret.status, 401);
});

test('dev stops reading a body past 4 KB with 413 and keeps answering', async () => {
  const res = await fetch(url('/relay'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-secret': SECRET }, body: 'x'.repeat(5000) })
    .then((r) => r.status, (e: Error) => e.message);
  assert.equal(res, 413);
  assert.equal((await fetch(url('/nope'))).status, 404);
});

test('dev answers 403 to a foreign Host header (DNS rebinding)', async () => {
  const reply = await raw('GET /health HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
  assert.match(reply, /^HTTP\/1\.1 403/);
});

test('dev routes on the path: GET /health?x=1 reaches the handler (500 without a key), unknown paths 404', async () => {
  assert.equal((await fetch(url('/health?x=1'))).status, 500);
  assert.equal((await fetch(url('/nope'))).status, 404);
});

test('dev survives a malformed request target and keeps answering', async () => {
  await raw(`GET http://[/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  assert.equal((await fetch(url('/nope'))).status, 404, `exit code ${dev.exitCode}`);
});
