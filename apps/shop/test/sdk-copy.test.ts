// The deploy uploads only apps/shop, so it carries a copy of claude-sdk's packages/sdk/index.ts.
// In the repo (and CI) the copy must be byte-for-byte identical, so an SDK fix can't be missed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const shared = new URL('../../../packages/sdk/index.ts', import.meta.url);
const copy = new URL('../lib/sdk.ts', import.meta.url);

test('lib/sdk.ts is an exact copy of packages/sdk/index.ts', { skip: !existsSync(shared) && 'packages/sdk not present (deploy bundle)' }, () => {
  assert.ok(existsSync(copy), 'lib/sdk.ts is missing: cp ../../packages/sdk/index.ts lib/sdk.ts');
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(shared, 'utf8'), 'stale copy: cp ../../packages/sdk/index.ts lib/sdk.ts');
});
