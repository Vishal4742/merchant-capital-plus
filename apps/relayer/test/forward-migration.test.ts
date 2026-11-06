// Batch 049 (port of batch 031 onto main): 003_rel_state.sql upgrades the batch-037 schema (001_rel.sql, possibly
// already applied in production) in place. Rows the old relayer wrote must survive with an honest status, keep
// blocking replays and keep counting toward today's budget; the upgrade must be re-run safe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { sqlStatements } from '../db/statements.ts';
import { applySchema } from './db-helpers.ts';

const file = (name: string) => readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8');
const apply = async (pg: PGlite, name: string) => {
  for (const statement of sqlStatements(file(name))) await pg.query(statement);
};

test('003 upgrades batch-037 rows in place: replay key, fee and revert kept; status honest; re-run safe', async () => {
  const pg = new PGlite();
  try {
    await apply(pg, '001_rel.sql');
    await pg.query(`INSERT INTO rel_sent (auth_key, relayer, payer, merchant, tx_hash, fee_wei, reverted, sent_at) VALUES
      ('0xpayer:0x01', '0xrelayer', '0xpayer', '0xshop', '0xaa', 2400000000000000, false, 1000),
      ('0xpayer:0x02', '0xrelayer', '0xpayer', NULL, '0xbb', 1234, true, 2000)`);
    await pg.query("INSERT INTO rel_lock (relayer, holder, until_ms) VALUES ('0xrelayer', NULL, 0)");

    await applySchema(pg); // 001 again (no-op), 003, 004
    await applySchema(pg); // and once more: idempotent

    const rows = (await pg.query<Record<string, string>>(
      'SELECT auth_key, fee_wei::text, status, tx_nonce::text, fence::text, reverted_at::text FROM rel_sent ORDER BY auth_key')).rows;
    assert.deepEqual(rows, [
      { auth_key: '0xpayer:0x01', fee_wei: '2400000000000000', status: 'unknown', tx_nonce: '-1', fence: '0', reverted_at: null },
      { auth_key: '0xpayer:0x02', fee_wei: '1234', status: 'reverted', tx_nonce: '-1', fence: '0', reverted_at: '2000' },
    ]);
    // The reviewed batch-031 constraint holds on upgraded tables too.
    await assert.rejects(pg.query("UPDATE rel_sent SET status = 'paid' WHERE auth_key = '0xpayer:0x01'"), /rel_sent_status_check/);
    // New tables exist and the old lock row is untouched (rollback to the batch-037 relayer stays possible).
    const tables = (await pg.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_name LIKE 'rel\_%' ORDER BY 1")).rows.map((r) => r.t);
    assert.deepEqual(tables, ['rel_lease', 'rel_lock', 'rel_payer_unblocks', 'rel_sent']);
    assert.equal((await pg.query('SELECT 1 FROM rel_lock')).rows.length, 1);
  } finally {
    await pg.close();
  }
});
