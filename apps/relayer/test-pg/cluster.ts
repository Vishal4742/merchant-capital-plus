// Batch 031 round 4 (B10): the plumbing of the opt-in real-PostgreSQL harness (run.ts). It starts a throwaway cluster
// (initdb + pg_ctl) in a fresh temp dir on a random free 127.0.0.1 port, runs scripts through one-shot psql processes
// (each its own connection and server backend: independent sessions, not one embedded engine), and removes the cluster
// on exit. No npm dependency: only the PostgreSQL client/server binaries.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Statement } from '../src/state.ts';

const EXE = process.platform === 'win32' ? '.exe' : '';
const BINARIES = ['initdb', 'pg_ctl', 'psql'];

/** The directory holding initdb, pg_ctl and psql ('' = they are on PATH), or undefined when they can't be found. An
 *  explicit PG_BIN is the only place looked at (a wrong one must skip loudly, not fall back to another install). */
export function findPgBin(): string | undefined {
  const explicit = process.env.PG_BIN?.trim();
  if (explicit) return BINARIES.every((b) => existsSync(join(explicit, b + EXE))) ? explicit : undefined;
  const candidates = [
    'C:\\Program Files\\PostgreSQL\\18\\bin',
    '/usr/lib/postgresql/18/bin',
    '/opt/homebrew/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@18/bin',
  ];
  for (const dir of candidates) {
    if (dir && BINARIES.every((b) => existsSync(join(dir, b + EXE)))) return dir;
  }
  const onPath = BINARIES.every((b) => spawnSync(b, ['--version'], { stdio: 'ignore' }).status === 0);
  return onPath ? '' : undefined;
}

export interface PsqlResult { label: string; code: number | null; stdout: string; stderr: string }

/** The rows a script printed after its "\echo @@BEGIN" marker (psql -At: one line per row, columns joined by "|"). */
export function rowsAfterMarker(r: PsqlResult): string[] {
  const lines = r.stdout.split(/\r?\n/);
  const at = lines.indexOf('@@BEGIN');
  if (at < 0) throw new Error(`${r.label}: no @@BEGIN marker (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`);
  return lines.slice(at + 1).filter((l) => l !== '');
}

const sqlLiteral = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint' || (typeof v === 'number' && Number.isSafeInteger(v))) return String(v);
  if (typeof v === 'string') return `'${v.replaceAll("'", "''")}'`;
  throw new Error(`unsupported parameter: ${typeof v}`);
};
// psql meta-command arguments: single-quoted, '' for a quote, and backslash escapes are interpreted (so double them)
const bindArg = (v: unknown): string => `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
let prepared = 0;

/** psql text that runs one relayer statement with its real parameters. Without NULLs: the extended protocol through
 *  psql's \bind (Parse/Bind/Execute of an unnamed statement, parameter types inferred by the server, as the Neon driver
 *  and PGlite do). With a NULL parameter (\bind can't send one): PREPARE + EXECUTE, also server-side parameters. */
export function render(s: Statement): string {
  if (s.text.includes(';')) throw new Error('a statement text must not contain ";" (psql would split it)');
  if (s.params.some((p) => p === null || p === undefined)) {
    const name = `relayer_stmt_${++prepared}`;
    return `PREPARE ${name} AS ${s.text};\nEXECUTE ${name}(${s.params.map(sqlLiteral).join(', ')});\nDEALLOCATE ${name};`;
  }
  return `${s.text}\n\\bind ${s.params.map(bindArg).join(' ')} \\g`;
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
});

function exec(file: string, args: string[], stdio: 'pipe' | 'ignore'): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: stdio === 'ignore' ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (d) => { output += d; });
    child.stderr?.on('data', (d) => { output += d; });
    child.once('error', reject);
    // 'exit', not 'close': pg_ctl's background postmaster could keep inherited pipes open
    child.once('exit', (code) => resolve({ code, output }));
  });
}

export class Cluster {
  dir = '';
  port = 0;
  version = '';
  spawned = 0; // psql processes started (each one connection)
  private bin = '';
  private stopped = false;

  private path(name: string): string {
    return this.bin ? join(this.bin, name + EXE) : name;
  }

  /** initdb a fresh cluster in a new temp dir and start it on a random free port, listening on 127.0.0.1 only. */
  static async start(bin: string): Promise<Cluster> {
    const c = new Cluster();
    c.bin = bin;
    c.dir = mkdtempSync(join(tmpdir(), 'relayer-pg-'));
    const data = join(c.dir, 'data');
    const init = await exec(c.path('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'], 'pipe');
    if (init.code !== 0) throw new Error(`initdb failed (exit ${init.code}): ${init.output.slice(-600)}`);
    c.port = await freePort();
    const options = `-p ${c.port} -c listen_addresses=127.0.0.1 -c max_connections=200 -c fsync=off`;
    const started = await exec(c.path('pg_ctl'), ['-D', data, '-o', options, '-l', join(c.dir, 'server.log'), '-w', '-t', '60', 'start'], 'ignore');
    if (started.code !== 0) throw new Error(`pg_ctl start failed (exit ${started.code}); see ${join(c.dir, 'server.log')}`);
    const created = await c.psql('CREATE DATABASE relayer', 'setup', 'postgres');
    if (created.code !== 0) throw new Error(`CREATE DATABASE failed: ${created.stderr}`);
    c.version = (await c.lines('SHOW server_version'))[0] ?? '?';
    return c;
  }

  /** Runs a script in a NEW psql process (its own connection), stopping at the first error. Output is read at exit. */
  psql(script: string, label = 'psql', db = 'relayer'): Promise<PsqlResult> {
    this.spawned += 1;
    return new Promise((resolve, reject) => {
      const child = spawn(this.path('psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(this.port), '-U', 'postgres', '-d', db], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PGAPPNAME: label.slice(0, 60), PGCONNECT_TIMEOUT: '15', PGCLIENTENCODING: 'UTF8', PGOPTIONS: '' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ label, code, stdout, stderr }));
      child.stdin.end(`${script}\n`);
    });
  }

  /** One-shot query; fails loudly on error. Returns the printed rows. */
  async lines(sqlText: string): Promise<string[]> {
    const r = await this.psql(`\\echo @@BEGIN\n${sqlText}`, 'harness');
    if (r.code !== 0) throw new Error(`query failed (exit ${r.code}): ${sqlText}\n${r.stderr}`);
    return rowsAfterMarker(r);
  }

  async waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  /** Starts every script in its own psql process and releases them at the same instant: a coordinator session holds an
   *  advisory lock; each worker blocks on it (shared) right before its statement; once all are waiting, the harness
   *  terminates the coordinator's backend, which frees the lock for all of them at once. Each worker script must
   *  contain "SELECT pg_advisory_lock_shared(<key>)" before its "\echo @@BEGIN" marker (use barrierLine()). */
  async race(workers: { label: string; script: string }[], key: number): Promise<PsqlResult[]> {
    const coordinator = this.psql(`SELECT pg_advisory_lock(${key});\nSELECT pg_sleep(600);`, `coordinator-${key}`);
    const held = `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${key} AND mode = 'ExclusiveLock' AND granted`;
    await this.waitFor(`coordinator holds advisory lock ${key}`, async () => (await this.lines(held))[0] === '1');
    const running = workers.map((w) => this.psql(w.script, w.label));
    const waiting = `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${key} AND mode = 'ShareLock' AND NOT granted`;
    await this.waitFor(`${workers.length} workers waiting at barrier ${key}`, async () => Number((await this.lines(waiting))[0]) === workers.length);
    await this.lines(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${key} AND mode = 'ExclusiveLock' AND granted`);
    const results = await Promise.all(running);
    await coordinator; // ends with "terminating connection" by design
    return results;
  }

  async stop(): Promise<void> {
    if (this.stopped || !this.dir) return;
    this.stopped = true;
    if (this.port) await exec(this.path('pg_ctl'), ['-D', join(this.dir, 'data'), '-m', 'immediate', '-w', '-t', '60', 'stop'], 'ignore').catch(() => undefined);
    if (process.env.KEEP_PG !== '1') rmSync(this.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

/** The line a race worker runs right before its statement (see Cluster.race). */
export const barrierLine = (key: number) => `SELECT pg_advisory_lock_shared(${key});`;
