// NFR-4 on the deployed relayer: /health and /relay must be one Vercel function, so a /health warm-up ping (sent when
// a checkout opens) warms the instance and the RPC socket that the sale then uses. Fluid compute keeps it warm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('vercel.json routes /relay and /health to the same function, with Fluid compute on', () => {
  const to = Object.fromEntries(config.rewrites.map((r: { source: string; destination: string }) => [r.source, r.destination]));
  assert.equal(to['/relay'], '/api/relay');
  assert.equal(to['/health'], '/api/relay');
  assert.equal(config.fluid, true);
});

// Batch 031: the shared send lease must outlive any live invocation, or a slow holder could lose it mid-send.
test('the send lease (LEASE_S) outlasts the function maxDuration', async () => {
  const { LEASE_S } = await import('../src/state.ts');
  assert.ok(LEASE_S > config.functions['api/*.ts'].maxDuration, `LEASE_S ${LEASE_S} s vs maxDuration ${config.functions['api/*.ts'].maxDuration} s`);
});

test('api/relay.ts serves both methods', async () => {
  const mod = await import('../api/relay.ts');
  assert.equal(typeof mod.POST, 'function');
  assert.equal(typeof mod.GET, 'function');
});
