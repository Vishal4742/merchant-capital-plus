// Round 3 (B9): the audited unblock is an operator CLI (no public endpoint). It checks its arguments before touching the
// database and never prints the connection string. The unblock itself is tested on PGlite in relayer.test.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const FAKE_PASSWORD = 'SECRETPW'; // a fake: the URL below points nowhere
const PAYER = '0x1111111111111111111111111111111111111111';
const cli = (args: string[], databaseUrl?: string) => {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
  if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
  const run = spawnSync(process.execPath, ['db/unblock-payer.ts', ...args], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 30_000 });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}`, stderr: run.stderr };
};

test('db/unblock-payer.ts needs --payer, --actor and --reason; a bad or missing one exits 2 before any database access', () => {
  for (const args of [[], ['--payer', PAYER, '--actor', 'ops'], ['--payer', '0x12', '--actor', 'ops', '--reason', 'r'], ['--payer', PAYER, '--actor', ' ', '--reason', 'r']]) {
    const run = cli(args, `psql 'postgresql://u:${FAKE_PASSWORD}@x/db'`);
    assert.equal(run.status, 2, `${args.join(' ')}: ${run.out.replaceAll(FAKE_PASSWORD, '<redacted>')}`);
    assert.match(run.stderr, /usage: npm run payer:unblock -- --payer 0x… --actor <who> --reason "<why>"/);
    assert.ok(!run.out.includes(FAKE_PASSWORD));
  }
});

test('db/unblock-payer.ts with a malformed DATABASE_URL exits 1 and never prints the password', () => {
  const run = cli(['--payer', PAYER, '--actor', 'ops-asha', '--reason', 'test'], `psql 'postgresql://u:${FAKE_PASSWORD}@x/db'`);
  assert.equal(run.status, 1, run.out.replaceAll(FAKE_PASSWORD, '<redacted>'));
  assert.ok(!run.out.includes(FAKE_PASSWORD) && !run.out.includes('postgresql://'));
  assert.match(run.stderr, /unblock failed: the relayer's database is unavailable/);
});
