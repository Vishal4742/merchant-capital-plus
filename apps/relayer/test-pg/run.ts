// Batch 031 round 4 (B10), opt-in: npm run test:pg   (from apps/relayer; never part of npm test)
// The relayer's concurrency guarantees on a REAL PostgreSQL server, from independent psql processes (one connection and
// one server backend each), using the relayer's own statements: every SQL text and parameter list comes from
// src/state.ts `statements`, the builders the relayer itself runs, so the harness can't drift from the code.
// Exit codes: 0 all scenarios passed · 1 a scenario failed or the cluster couldn't start · 77 SKIPPED (no PostgreSQL
// 16+ binaries: install PostgreSQL or set PG_BIN=<dir with initdb, pg_ctl, psql>).
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address, Hash } from 'viem';
import { isSchemaFile, sqlStatements } from '../db/statements.ts';
import { statements, type Authorization, type CooldownPolicy } from '../src/state.ts';
import { barrierLine, Cluster, findPgBin, render, rowsAfterMarker, type PsqlResult } from './cluster.ts';

const SKIP = 77;
const N = Number(process.env.PG_SESSIONS ?? 40); // concurrent sessions per race
const ROUNDS = 4;
const CAP_FEE = 2_400_000_000_000_000n; // 400k gas × 6 gwei: what a write-ahead row counts (src/relayer.ts)
const T0 = 1_800_000_000_000; // a fixed "now" (unix ms) for the cooldown arithmetic
const POLICY: CooldownPolicy = { failures: 3, windowMs: 600_000, cooldownMs: 900_000 }; // the provisional testnet defaults

const hex = (bytes: number) => `0x${randomBytes(bytes).toString('hex')}`;
const address = () => hex(20) as Address;
const txHash = () => hex(32) as Hash;
let nextKey = 7_000;
const barrierKey = () => ++nextKey;

function expect(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
function exitedCleanly(results: PsqlResult[]): void {
  const bad = results.filter((r) => r.code !== 0);
  expect(bad.length === 0, `${bad.length} session(s) failed, e.g. ${bad[0]?.label}: ${bad[0]?.stderr.trim().slice(0, 300)}`);
}

const outcomes: { name: string; ok: boolean; notes: string[] }[] = [];
async function scenario(name: string, run: (notes: string[]) => Promise<void>): Promise<void> {
  const notes: string[] = [];
  try {
    await run(notes);
    outcomes.push({ name, ok: true, notes });
  } catch (e) {
    outcomes.push({ name, ok: false, notes: [...notes, `FAILED: ${e instanceof Error ? e.message : String(e)}`] });
  }
}

function psqlMajor(bin: string): number {
  const psql = bin ? join(bin, `psql${process.platform === 'win32' ? '.exe' : ''}`) : 'psql';
  const out = spawnSync(psql, ['--version'], { encoding: 'utf8' }).stdout ?? '';
  return Number(/(\d+)\.\d+/.exec(out)?.[1] ?? 0);
}

const bin = findPgBin();
if (bin === undefined) {
  console.error('SKIP (exit 77): PostgreSQL binaries (initdb, pg_ctl, psql) not found. Install PostgreSQL 16+ or set PG_BIN=<dir>. Nothing was tested.');
  process.exit(SKIP);
}
if (psqlMajor(bin) < 16) {
  console.error(`SKIP (exit 77): psql ${psqlMajor(bin)} found; psql 16+ is needed (\\bind runs the statements with real parameters). Nothing was tested.`);
  process.exit(SKIP);
}

let cluster: Cluster | undefined;
const guard = setTimeout(() => {
  console.error('FAIL: the harness timed out after 10 minutes');
  void (cluster?.stop() ?? Promise.resolve()).finally(() => process.exit(1));
}, 600_000);
process.once('SIGINT', () => { void (cluster?.stop() ?? Promise.resolve()).finally(() => process.exit(130)); });

try {
  cluster = await Cluster.start(bin);
  const c = cluster;
  const take = async (relayer: Address, holder: string) => c.lines(render(statements.takeLease(relayer, holder)));
  const fenceRow = async (relayer: Address) => (await c.lines(`SELECT fence::text || '|' || holder || '|' || (until > now())::text FROM rel_lease WHERE relayer = '${relayer}'`))[0];

  await scenario('schema: every schema db/NNN_*.sql applied twice through the migrate splitter (idempotent, additive)', async (notes) => {
    const dir = new URL('../db/', import.meta.url);
    const files = readdirSync(dir).filter(isSchemaFile).sort(); // batch 049: owner-run *_role*.sql excluded
    for (const pass of [1, 2]) {
      for (const file of files) {
        const r = await c.psql(sqlStatements(readFileSync(new URL(file, dir), 'utf8')).map((s) => `${s};`).join('\n'), `migrate-${pass}-${file}`);
        expect(r.code === 0, `${file}, pass ${pass}: ${r.stderr.trim()}`);
      }
    }
    const tables = await c.lines("SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_name LIKE 'rel\\_%'");
    expect(tables[0] === 'rel_lease,rel_payer_unblocks,rel_sent', `tables: ${tables[0]}`);
    const columns = await c.lines("SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name || '.' || column_name) FROM information_schema.columns WHERE (table_name, column_name) IN (('rel_lease', 'holder'), ('rel_sent', 'payer_fault_at'))");
    expect(columns[0] === 'rel_lease.holder,rel_sent.payer_fault_at', `round-3 columns: ${columns[0]}`);
    notes.push(`${files.join(' + ')} applied twice with no error; tables ${tables[0]}`);
  });

  await scenario(`takeLease race: ${ROUNDS} rounds × ${N} independent sessions released at once → exactly 1 winner per round, fences 1..${ROUNDS} (no reuse)`, async (notes) => {
    const relayer = address();
    const fences: string[] = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const key = barrierKey();
      const workers = Array.from({ length: N }, (_, i) => ({
        label: `take-r${round}-${i}`, holder: `r${round}-holder-${i}`,
        script: `${barrierLine(key)}\n\\echo @@BEGIN\n${render(statements.takeLease(relayer, `r${round}-holder-${i}`))}`,
      }));
      const results = await c.race(workers, key);
      exitedCleanly(results);
      const winners = results.map((r, i) => ({ i, rows: rowsAfterMarker(r) })).filter((w) => w.rows.length > 0);
      expect(winners.length === 1, `round ${round}: ${winners.length} sessions got a fence`);
      const fence = winners[0].rows[0];
      expect(fence === String(round), `round ${round}: fence ${fence}, expected ${round}`);
      expect(await fenceRow(relayer) === `${fence}|${workers[winners[0].i].holder}|true`, `round ${round}: rel_lease row ${await fenceRow(relayer)}`);
      if (round > 1) { // a stale holder's release must not free the current lease
        await c.lines(render(statements.releaseLease(relayer, String(round - 1))));
        expect((await fenceRow(relayer)).endsWith('|true'), `round ${round}: a release with the stale fence ${round - 1} freed the lease`);
      }
      await c.lines(render(statements.releaseLease(relayer, fence)));
      expect((await fenceRow(relayer)).endsWith('|false'), `round ${round}: the winner's release did not expire the lease`);
      fences.push(fence);
    }
    notes.push(`winners' fences: ${fences.join(', ')}; a stale-fence release never freed a live lease; each release expired (not deleted) the row`);
  });

  await scenario('takeLease retry by the same holder (reply lost): a new connection gets its own live lease back; strangers get nothing', async (notes) => {
    const relayer = address();
    const first = await take(relayer, 'holder-H');
    expect(first.join() === '1', `first take: ${first.join()}`);
    const retry = await take(relayer, 'holder-H');
    expect(retry.join() === '1', `retry from a new connection: ${retry.join() || '(no row)'}`);
    const stranger = await take(relayer, 'holder-other');
    expect(stranger.length === 0, `another holder got ${stranger.join()}`);
    const key = barrierKey();
    const workers = Array.from({ length: 25 }, (_, i) => ({
      label: `retry-race-${i}`, script: `${barrierLine(key)}\n\\echo @@BEGIN\n${render(statements.takeLease(relayer, i === 0 ? 'holder-H' : `stranger-${i}`))}`,
    }));
    const results = await c.race(workers, key);
    exitedCleanly(results);
    const got = results.map((r) => rowsAfterMarker(r).join());
    expect(got[0] === '1' && got.slice(1).every((g) => g === ''), `race of the retry vs 24 strangers: ${JSON.stringify(got)}`);
    expect(await fenceRow(relayer) === '1|holder-H|true', `rel_lease row ${await fenceRow(relayer)}`);
    notes.push('sequential retry → fence 1; retry racing 24 strangers → only the retry got fence 1; no second fence was ever issued');
  });

  await scenario('takeLease retry while the first try is still uncommitted (in flight): it never takes a second lease; the next poll gets fence 1', async (notes) => {
    const relayer = address();
    const key = barrierKey();
    const coordinator = c.psql(`SELECT pg_advisory_lock(${key});\nSELECT pg_sleep(600);`, 'inflight-coordinator');
    await c.waitFor('coordinator lock', async () => (await c.lines(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${key} AND granted`))[0] === '1');
    const firstTry = c.psql(`BEGIN;\n\\echo @@BEGIN\n${render(statements.takeLease(relayer, 'holder-H'))}\nSELECT pg_advisory_lock(${key});\nCOMMIT;`, 'inflight-first-try');
    await c.waitFor('first try holding its uncommitted take', async () => (await c.lines(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${key} AND mode = 'ExclusiveLock' AND NOT granted`))[0] === '1');
    const retry = c.psql(`\\echo @@BEGIN\n${render(statements.takeLease(relayer, 'holder-H'))}`, 'inflight-retry');
    await c.waitFor('retry blocked on the uncommitted row', async () => Number((await c.lines("SELECT count(*) FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted"))[0]) >= 1);
    await c.lines(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${key} AND granted`);
    const [a, b] = await Promise.all([firstTry, retry]);
    await coordinator;
    exitedCleanly([a, b]);
    const rowsA = rowsAfterMarker(a);
    const rowsB = rowsAfterMarker(b);
    expect(rowsA.join() === '1', `first try: ${rowsA.join()}`);
    expect(rowsB.join() === '' || rowsB.join() === '1', `retry returned ${rowsB.join()} (a second lease?)`);
    const next = await take(relayer, 'holder-H');
    expect(next.join() === '1', `next poll: ${next.join() || '(no row)'}`);
    expect(await fenceRow(relayer) === '1|holder-H|true', `rel_lease row ${await fenceRow(relayer)}`);
    notes.push(`the retry blocked on the uncommitted row, then returned ${rowsB.length ? 'fence 1' : 'no row (its snapshot predates the commit; the relayer polls again)'}; the next poll returned fence 1; one lease, fence 1`);
  });

  const leaseFor = async (relayer: Address, holder: string) => {
    const rows = await take(relayer, holder);
    expect(rows.length === 1, `could not take a lease for ${holder}`);
    return rows[0];
  };
  const auth = (payer: Address, merchant: Address): Authorization => ({ key: `${payer}:${hex(32)}`, payer, merchant });

  await scenario(`writeAhead race on one authorization: ${N - 10} sessions, same lease, different tx hashes → exactly 1 written, the rest replay`, async (notes) => {
    const relayer = address();
    const fence = await leaseFor(relayer, 'holder-wa');
    const a = auth(address(), address());
    const key = barrierKey();
    const workers = Array.from({ length: N - 10 }, (_, i) => {
      const hash = txHash();
      return { label: `wa-race-${i}`, hash, script: `${barrierLine(key)}\n\\echo @@BEGIN\n${render(statements.writeAhead({ relayer, fence, auth: a, txHash: hash, txNonce: 7, feeWei: CAP_FEE, sentAt: T0 }))}` };
    });
    const results = await c.race(workers, key);
    exitedCleanly(results);
    const got = results.map((r) => rowsAfterMarker(r).join());
    const written = got.flatMap((g, i) => (g === 't|t' ? [i] : []));
    const replays = got.filter((g) => g === 't|f').length;
    expect(written.length === 1 && replays === workers.length - 1, `written ${written.length}, replay ${replays}, other ${JSON.stringify(got.filter((g) => g !== 't|t' && g !== 't|f'))}`);
    const row = await c.lines(`SELECT count(*)::text || '|' || max(tx_hash) FROM rel_sent WHERE auth_key = '${a.key}'`);
    expect(row[0] === `1|${workers[written[0]].hash}`, `rel_sent: ${row[0]}`);
    notes.push(`1 written (leased|written = t|t), ${replays} replay (t|f); one rel_sent row, holding the winner's tx hash`);
  });

  await scenario(`writeAhead retried with our own tx hash and fence: ${N - 20} identical concurrent tries + 1 later retry → all written, one row`, async (notes) => {
    const relayer = address();
    const fence = await leaseFor(relayer, 'holder-idem');
    const a = auth(address(), address());
    const write = statements.writeAhead({ relayer, fence, auth: a, txHash: txHash(), txNonce: 8, feeWei: CAP_FEE, sentAt: T0 });
    const key = barrierKey();
    const workers = Array.from({ length: N - 20 }, (_, i) => ({ label: `idem-${i}`, script: `${barrierLine(key)}\n\\echo @@BEGIN\n${render(write)}` }));
    const results = await c.race(workers, key);
    exitedCleanly(results);
    const got = results.map((r) => rowsAfterMarker(r).join());
    expect(got.every((g) => g === 't|t'), `concurrent identical tries: ${JSON.stringify([...new Set(got)])}`);
    const later = await c.lines(render(write));
    expect(later.join() === 't|t', `later retry: ${later.join()}`);
    const row = await c.lines(`SELECT count(*)::text || '|' || max(status) || '|' || max(fence)::text FROM rel_sent WHERE auth_key = '${a.key}'`);
    expect(row[0] === `1|signed|${fence}`, `rel_sent: ${row[0]}`);
    notes.push(`${workers.length} concurrent + 1 later retry all answered written; exactly one row (status signed, fence ${fence})`);
  });

  await scenario('stale fence: after a takeover, 10 sessions with the old fence race 1 with the new one on the same authorization and tx hash → only the new one writes', async (notes) => {
    const relayer = address();
    const oldFence = await leaseFor(relayer, 'holder-old');
    await c.lines(render(statements.releaseLease(relayer, oldFence)));
    const newFence = await leaseFor(relayer, 'holder-new');
    expect(Number(newFence) === Number(oldFence) + 1, `fences ${oldFence} then ${newFence}`);
    const a = auth(address(), address());
    const hash = txHash(); // a stale holder re-signing the same nonce produces the same hash
    const key = barrierKey();
    const workers = Array.from({ length: 11 }, (_, i) => ({
      label: i === 0 ? 'current' : `stale-${i}`,
      script: `${barrierLine(key)}\n\\echo @@BEGIN\n${render(statements.writeAhead({ relayer, fence: i === 0 ? newFence : oldFence, auth: a, txHash: hash, txNonce: 9, feeWei: CAP_FEE, sentAt: T0 }))}`,
    }));
    const results = await c.race(workers, key);
    exitedCleanly(results);
    const got = results.map((r) => rowsAfterMarker(r).join());
    expect(got[0] === 't|t' && got.slice(1).every((g) => g === 'f|f'), `current vs stale: ${JSON.stringify(got)}`);
    const row = await c.lines(`SELECT count(*)::text || '|' || max(fence)::text FROM rel_sent WHERE auth_key = '${a.key}'`);
    expect(row[0] === `1|${newFence}`, `rel_sent: ${row[0]}`);
    const alone = auth(address(), address());
    const stale = await c.lines(render(statements.writeAhead({ relayer, fence: oldFence, auth: alone, txHash: txHash(), txNonce: 10, feeWei: CAP_FEE, sentAt: T0 })));
    const none = await c.lines(`SELECT count(*) FROM rel_sent WHERE auth_key = '${alone.key}'`);
    expect(stale.join() === 'f|f' && none[0] === '0', `a stale write alone: ${stale.join()}, rows ${none[0]}`);
    await c.lines(render(statements.releaseLease(relayer, newFence))); // expired, same fence, nobody took it yet
    const expired = auth(address(), address());
    const late = await c.lines(render(statements.writeAhead({ relayer, fence: newFence, auth: expired, txHash: txHash(), txNonce: 11, feeWei: CAP_FEE, sentAt: T0 })));
    expect(late.join() === 'f|f', `a write under an expired lease with the current fence: ${late.join()}`);
    notes.push(`fence ${oldFence} → ${newFence}; the current holder wrote (t|t), all 10 stale writers were refused as lost_lease (f|f); one row with fence ${newFence}; a stale write alone wrote nothing; a write under an expired lease with the same fence was refused too`);
  });

  await scenario('cooldown: 6 payer-attributable failures settled concurrently from 6 sessions → all counted; cooldown and expiry exact; unblock lifts it; NULL params via PREPARE', async (notes) => {
    const relayer = address();
    const fence = await leaseFor(relayer, 'holder-cool');
    const payer = address();
    const merchant = address();
    const auths = Array.from({ length: 6 }, () => auth(payer, merchant));
    for (const a of auths) {
      const w = await c.lines(render(statements.writeAhead({ relayer, fence, auth: a, txHash: txHash(), txNonce: 11, feeWei: CAP_FEE, sentAt: T0 })));
      expect(w.join() === 't|t', `write-ahead for the failure rows: ${w.join()}`);
    }
    const key = barrierKey();
    const workers = auths.map((a, i) => ({ label: `fault-${i}`, script: `${barrierLine(key)}\n\\echo @@BEGIN\n${render(statements.settle(a, CAP_FEE, 'reverted', true, T0 + i * 1000))}` }));
    exitedCleanly(await c.race(workers, key));
    const counted = await c.lines(`SELECT count(*) FROM rel_sent WHERE payer = '${payer}' AND payer_fault_at IS NOT NULL AND reverted_at = payer_fault_at`);
    expect(counted[0] === '6', `failures recorded: ${counted[0]}`);
    const probe = auth(payer, merchant);
    const cooldownAt = async (now: number) => (await c.lines(render(statements.readLedger(relayer, probe, now, POLICY))))[0].split('|')[2];
    const until = String(T0 + 5_000 + POLICY.cooldownMs); // from the latest failure that completed a 3-in-10-min streak
    expect(await cooldownAt(T0 + 6_000) === until, `cooldown_until at T0+6s: ${await cooldownAt(T0 + 6_000)}, expected ${until}`);
    const readKey = barrierKey();
    const readers = Array.from({ length: 10 }, (_, i) => ({ label: `reader-${i}`, script: `${barrierLine(readKey)}\n\\echo @@BEGIN\n${render(statements.readLedger(relayer, probe, T0 + 6_000, POLICY))}` }));
    const reads = await c.race(readers, readKey);
    exitedCleanly(reads);
    expect(new Set(reads.map((r) => rowsAfterMarker(r).join())).size === 1, 'concurrent readers disagreed');
    expect(await cooldownAt(Number(until) - 1) === until, 'not active 1 ms before its end');
    expect(await cooldownAt(Number(until)) === '', 'still reported at its end');
    const unblockAt = T0 + 7_000;
    const unblocked = await c.lines(render(statements.unblock({ id: randomUUID(), payer, actor: 'round4-harness', reason: 'real-PG check', cooldownUntil: Number(until), at: unblockAt })));
    expect(unblocked.length === 0, `unblock printed ${unblocked.join()}`);
    expect(await cooldownAt(T0 + 8_000) === '', 'cooldown survived the audited unblock');
    const later = auth(payer, merchant); // one new failure after the unblock + the 6 before it: no new cooldown
    await c.lines(render(statements.writeAhead({ relayer, fence, auth: later, txHash: txHash(), txNonce: 12, feeWei: CAP_FEE, sentAt: T0 })));
    await c.lines(render(statements.settle(later, CAP_FEE, 'reverted', true, T0 + 9_000)));
    expect(await cooldownAt(T0 + 10_000) === '', 'pre-unblock failures counted again');
    const mined = auth(payer, merchant); // a mined outcome sends NULLs (reverted_at, payer_fault_at): the PREPARE path
    await c.lines(render(statements.writeAhead({ relayer, fence, auth: mined, txHash: txHash(), txNonce: 13, feeWei: CAP_FEE, sentAt: T0 })));
    const settleMined = statements.settle(mined, 217_194n * 5_001_000_000n, 'mined', false, T0 + 11_000);
    expect(render(settleMined).startsWith('PREPARE'), 'a NULL parameter must use PREPARE/EXECUTE');
    await c.lines(render(settleMined));
    const minedRow = await c.lines(`SELECT status || '|' || coalesce(reverted_at::text, 'null') || '|' || coalesce(payer_fault_at::text, 'null') FROM rel_sent WHERE auth_key = '${mined.key}'`);
    expect(minedRow[0] === 'mined|null|null', `mined row: ${minedRow[0]}`);
    notes.push(`6/6 concurrent failures recorded; cooldown_until = T0+905000 (10 concurrent readers agree); active at its end −1 ms, gone at its end; lifted by the audited unblock; 1 later failure didn't re-trigger it; a NULL-param settle ran via PREPARE/EXECUTE`);
  });

  console.log(`real PostgreSQL ${c.version} on 127.0.0.1:${c.port} (throwaway cluster in ${c.dir}); ${c.spawned} psql processes = independent connections`);
} catch (e) {
  outcomes.push({ name: 'cluster', ok: false, notes: [`FAILED: ${e instanceof Error ? e.message : String(e)}`] });
} finally {
  await cluster?.stop();
  clearTimeout(guard);
}

for (const o of outcomes) {
  console.log(`${o.ok ? 'PASS' : 'FAIL'}  ${o.name}`);
  for (const n of o.notes) console.log(`        ${n}`);
}
const failed = outcomes.filter((o) => !o.ok).length;
console.log(`${outcomes.length - failed}/${outcomes.length} scenarios passed${process.env.KEEP_PG === '1' ? '' : '; temp cluster removed'}`);
process.exit(failed === 0 ? 0 : 1);
