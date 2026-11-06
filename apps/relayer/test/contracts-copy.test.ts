// The deploy uploads only apps/relayer, so it carries a copy of claude-contracts' generated packages/shared/contracts.ts.
// In the repo (and CI) the copy must be byte-for-byte identical, so an ABI or address change can't be missed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const shared = new URL('../../../packages/shared/contracts.ts', import.meta.url);
const copy = new URL('../src/contracts.ts', import.meta.url);

test('src/contracts.ts is an exact copy of packages/shared/contracts.ts', { skip: !existsSync(shared) && 'packages/shared not present (deploy bundle)' }, () => {
  assert.ok(existsSync(copy), 'src/contracts.ts is missing: cp ../../packages/shared/contracts.ts src/contracts.ts');
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(shared, 'utf8'), 'stale copy: cp ../../packages/shared/contracts.ts src/contracts.ts');
});
