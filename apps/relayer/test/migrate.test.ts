// Batch 031 round 2 (R2-1, AGENTS.md "never print a .env value"): @neondatabase/serverless rejects the first query on a
// malformed DATABASE_URL with an error whose message and stack hold the whole connection string, password included.
// db/migrate.ts must print only the file, the statement number and a safe label (SQLSTATE or error name), and exit 1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const FAKE_PASSWORD = 'SECRETPW'; // a fake: the URL below points nowhere
const MALFORMED = `psql 'postgresql://u:${FAKE_PASSWORD}@x/db'`; // a pasted psql command instead of a URL

test('db/migrate.ts on a malformed DATABASE_URL exits 1 and never prints the password', () => {
  const run = spawnSync(process.execPath, ['db/migrate.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { DATABASE_URL: MALFORMED, PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const output = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.status, 1, output.replaceAll(FAKE_PASSWORD, '<redacted>'));
  assert.ok(!output.includes(FAKE_PASSWORD), 'the password was printed');
  assert.ok(!output.includes('postgresql://'), 'the connection string was printed');
  assert.match(run.stderr, /migration failed: 001_rel_state\.sql statement 1: NeonDbError/);
});
