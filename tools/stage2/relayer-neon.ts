// Stage 2 production-adapter verification of the relayer's shared state (batch 031), run by whiteflow-ef.
// Targets ONLY the isolated databases wf_s2_relayer (clean) and wf_s2_relayer_prev (previous schema), each checked with
// current_database() before any DDL. Reads only DATABASE_URL from the given .env (the file holds other secrets that are
// never loaded), never prints it, and passes the derived URL to child processes through their environment only.
// Overlap is deterministic: every child prints READY and blocks on stdin until the parent writes GO to all at once.
// Run from the repo root: node tools/stage2/relayer-neon.ts P:/Whiteflow/.env
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const require = createRequire(new URL('../../apps/relayer/package.json', import.meta.url));
const { neon } = require('@neondatabase/serverless');
const { isSchemaFile, sqlStatements } = await import('../../apps/relayer/db/statements.ts');

const raw = parseEnv(readFileSync(process.argv[2] ?? 'P:/Whiteflow/.env', 'utf8')).DATABASE_URL;
if (!raw) {
  console.log('BLOCKED: DATABASE_URL missing');
  process.exit(2);
}
const urlFor = (db: string) => {
  const u = new URL(raw);
  u.pathname = `/${db}`;
  return u.toString();
};
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, note: string) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${note}`);
};
const hex = (n: number) => `0x${randomBytes(n).toString('hex')}`;
const CHILD = fileURLToPath(new URL('./relayer-child.ts', import.meta.url));
const DB_DIR = new URL('../../apps/relayer/db/', import.meta.url);

async function target(db: string) {
  const sql = neon(urlFor(db));
  const [r] = await sql.query('SELECT current_database() AS db');
  if (r.db !== db) throw new Error(`target mismatch: connected to ${r.db}, expected ${db}`);
  return sql;
}
async function migrate(sql: any, files: string[]) {
  for (const f of files) for (const s of sqlStatements(readFileSync(new URL(f, DB_DIR), 'utf8'))) await sql.query(s);
}
/** Runs every op in its own Node process against `db`, all released by one GO. */
async function race(db: string, ops: object[]): Promise<any[]> {
  const kids = ops.map((op) => spawn(process.execPath, [CHILD], { env: { ...process.env, DATABASE_URL: urlFor(db), WF_OP: JSON.stringify(op) }, stdio: ['pipe', 'pipe', 'pipe'] }));
  const bufs = kids.map(() => ({ out: '' }));
  kids.forEach((k, i) => k.stdout.on('data', (d) => (bufs[i].out += d)));
  const exited = kids.map((k) => new Promise((r) => k.on('exit', r)));
  await Promise.all(
    kids.map(
      (k, i) =>
        new Promise<void>((res, rej) => {
          const t = setInterval(() => {
            if (bufs[i].out.includes('READY')) {
              clearInterval(t);
              res();
            }
          }, 10);
          k.on('exit', (c) => {
            clearInterval(t);
            if (!bufs[i].out.includes('READY')) rej(new Error(`child exited ${c} before READY`));
          });
        }),
    ),
  );
  for (const k of kids) k.stdin.write('GO\n');
  await Promise.all(exited);
  return bufs.map((b) => JSON.parse(b.out.split('\n').filter((l) => l.startsWith('{')).pop() ?? '{"ok":false,"error":"no output"}'));
}

// Batch 049: schema files only (the owner-run *_role*.sql files are not run here: on Neon the role is cluster-wide and
// the live project already has it; test/relayer.test.ts proves the grants on PGlite).
const files = readdirSync(DB_DIR).filter(isSchemaFile).sort();
const RELAYER_TABLES = ['rel_payer_unblocks', 'rel_sent', 'rel_lease', 'rel_lock'];

// ---- clean target (verified disposable database; only its rel_* tables are recreated)
const clean = await target('wf_s2_relayer');
for (const t of RELAYER_TABLES) await clean.query(`DROP TABLE IF EXISTS ${t}`);
await migrate(clean, files);
await migrate(clean, files);
const tables = (await clean.query("SELECT string_agg(table_name, ',' ORDER BY table_name) AS t FROM information_schema.tables WHERE table_schema='public'"))[0].t;
check('clean schema: every schema file (001, 003, 004) applied twice through the migrate splitter', tables === 'rel_lease,rel_lock,rel_payer_unblocks,rel_sent', `tables: ${tables}`);

const relayer = hex(20).toLowerCase();
const takes = await race('wf_s2_relayer', Array.from({ length: 12 }, () => ({ kind: 'take', relayer, holder: randomUUID() })));
const fences = takes.filter((r) => r.ok && r.result !== null).map((r) => r.result);
check('takeLease race: 12 processes released at once', fences.length === 1 && takes.every((r) => r.ok), `winners=${fences.length} fence=${fences[0]} errors=${takes.filter((r) => !r.ok).length}`);
const fence = fences[0];

const payer = hex(20).toLowerCase();
const auth = { key: `${payer}:${hex(32)}`, payer };
const base = { relayer, fence, auth, txNonce: 7, feeWei: '2400000000000000', sentAt: Date.now() };
const writes = await race('wf_s2_relayer', Array.from({ length: 10 }, () => ({ kind: 'write', input: { ...base, txHash: hex(32) } })));
const w = writes.map((r) => r.result);
const nWritten = w.filter((x) => x === 'written').length;
const nReplay = w.filter((x) => x === 'replay').length;
check('duplicate authorization: 10 processes, one authorization, different tx hashes', nWritten === 1 && nReplay === 9, `written=${nWritten} replay=${nReplay}`);
const row = (await clean.query('SELECT tx_hash, tx_nonce::int AS nonce, status FROM rel_sent WHERE auth_key = $1', [auth.key]))[0];

const again = await race('wf_s2_relayer', Array.from({ length: 4 }, () => ({ kind: 'write', input: { ...base, txHash: row.tx_hash } })));
const rows = (await clean.query('SELECT count(*)::int AS n FROM rel_sent WHERE auth_key = $1', [auth.key]))[0].n;
check('uncertain DB commit recovery: 4 concurrent retries with our own tx hash + fence', again.every((r) => r.result === 'written') && rows === 1, `answers=${again.map((r) => r.result).join(',')}; rows=${rows}`);

await clean.query("UPDATE rel_lease SET until = now() - interval '1 second' WHERE relayer = $1", [relayer]); // its process "died"; lease lapsed
const [t2] = await race('wf_s2_relayer', [{ kind: 'take', relayer, holder: randomUUID() }]);
const reuse = await race('wf_s2_relayer', [{ kind: 'write', input: { ...base, fence: t2.result, txHash: hex(32) } }]);
const kept = (await clean.query('SELECT tx_hash, tx_nonce::int AS nonce, status FROM rel_sent WHERE auth_key = $1', [auth.key]))[0];
check(
  'durable nonce/tx reference after an uncertain send: a new holder cannot rebroadcast that authorization',
  t2.result !== null && Number(t2.result) === Number(fence) + 1 && reuse[0].result === 'replay' && kept.tx_hash === row.tx_hash && kept.nonce === 7,
  `new fence=${t2.result}; rewrite=${reuse[0].result}; stored tx hash unchanged, nonce ${kept.nonce}, status ${kept.status}`,
);
const stale = await race('wf_s2_relayer', [{ kind: 'write', input: { ...base, auth: { key: `${payer}:${hex(32)}`, payer }, txHash: hex(32) } }]);
check('stale-holder fencing: the old fence after a takeover writes nothing', stale[0].result === 'lost_lease', `answer=${stale[0].result}`);

const now = Date.now();
const faults = Array.from({ length: 3 }, () => ({ key: `${payer}:${hex(32)}`, payer }));
for (const a of faults) {
  await clean.query("INSERT INTO rel_sent (auth_key, relayer, payer, tx_hash, tx_nonce, fence, fee_wei, status, sent_at) VALUES ($1, $2, $3, $4, 1, 1, 2400000000000000, 'signed', $5)", [a.key, relayer, payer, hex(32), now]);
}
await race('wf_s2_relayer', faults.map((a) => ({ kind: 'settle', auth: a, feeWei: '1000', outcome: 'reverted', payerFault: true, at: now })));
const seen = await race('wf_s2_relayer', Array.from({ length: 3 }, () => ({ kind: 'ledger', relayer, auth: { key: 'none', payer }, now: now + 1000 })));
check(
  'restart persistence: failures settled by 3 processes; 3 fresh processes see the cooldown and the spend',
  seen.every((r) => r.ok && r.result.cooldownUntil === now + 900_000 && BigInt(r.result.spentWei) > 0n),
  `cooldownUntil=now+${seen[0].result?.cooldownUntil - now} ms; spentWei=${seen[0].result?.spentWei}`,
);

// ---- previous-schema target (batch 049): main's batch-037 schema (001_rel.sql, live in production) + legacy rows →
// every schema file twice → rows preserved with an honest status, the old lock row untouched
const prev = await target('wf_s2_relayer_prev');
for (const t of RELAYER_TABLES) await prev.query(`DROP TABLE IF EXISTS ${t}`);
await migrate(prev, ['001_rel.sql']);
await prev.query("INSERT INTO rel_lock (relayer, holder, until_ms) VALUES ('0xaaaa', NULL, 0)");
for (let i = 0; i < 5; i++) {
  await prev.query("INSERT INTO rel_sent (auth_key, relayer, payer, tx_hash, fee_wei, reverted, sent_at) VALUES ($1, '0xaaaa', '0xbbbb', $2, 1000, $3, $4)", [`0xbbbb:${i}`, hex(32), i === 4, now]);
}
const before = (await prev.query('SELECT count(*)::int AS n, sum(fee_wei)::text AS s FROM rel_sent'))[0];
await migrate(prev, files);
await migrate(prev, files);
const after = (await prev.query('SELECT count(*)::int AS n, sum(fee_wei)::text AS s FROM rel_sent'))[0];
const statuses = (await prev.query("SELECT string_agg(status, ',' ORDER BY auth_key) AS s FROM rel_sent"))[0].s;
const cols = (await prev.query("SELECT string_agg(column_name, ',' ORDER BY column_name) AS c FROM information_schema.columns WHERE table_name IN ('rel_sent', 'rel_lease') AND column_name IN ('holder', 'payer_fault_at', 'status', 'tx_nonce', 'fence')"))[0].c;
const lock = (await prev.query("SELECT count(*)::int AS n FROM rel_lock"))[0].n;
check(
  "previous schema (main's 001_rel.sql + legacy rows) → every schema file applied twice: rows, fees and the old lock kept",
  before.n === 5 && after.n === 5 && after.s === before.s && statuses === 'unknown,unknown,unknown,unknown,reverted' && lock === 1
    && cols === 'fence,fence,holder,payer_fault_at,status,tx_nonce',
  `rows ${before.n}→${after.n}; fee sum ${before.s}→${after.s}; statuses ${statuses}; columns ${cols}; rel_lock rows ${lock}`,
);

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} production-adapter checks passed (Neon HTTP driver; wf_s2_relayer + wf_s2_relayer_prev)`);
process.exit(failed ? 1 : 0);
