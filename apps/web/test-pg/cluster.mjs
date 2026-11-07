// Batch 031 Part D: a throwaway real Postgres cluster for apps/web/test-pg/run.mjs (opt-in: npm run test:pg).
// initdb → a new temp dir OUTSIDE the repo, a free port, listen on 127.0.0.1 only, trust auth for 127.0.0.1/32 only (no
// password exists anywhere), then pg_ctl start. Every psql child is its own process and its own connection (backend),
// so the statements in race() really run at the same time, unlike the single-connection embedded PGlite in test/.
// stopCluster() always runs (finally, exit, SIGINT/SIGTERM) and deletes the temp dir.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export const SKIP_EXIT = 77; // distinct from pass (0) and fail (1): reported as a skip, never as a pass
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const NEEDED = ["initdb", "pg_ctl", "psql", "postgres"];

/** The first directory holding initdb, pg_ctl, psql and postgres with psql >= 16 (needed for \bind), or null. Order:
 *  $PG_BIN, the standard install dirs for 18/17/16, then PATH. */
export function findPgBin() {
  const dirs = [];
  if (process.env.PG_BIN) dirs.push(process.env.PG_BIN);
  for (const v of [18, 17, 16]) {
    if (process.platform === "win32") dirs.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin`);
    else dirs.push(`/usr/lib/postgresql/${v}/bin`, `/usr/pgsql-${v}/bin`, `/opt/homebrew/opt/postgresql@${v}/bin`, `/usr/local/opt/postgresql@${v}/bin`);
  }
  dirs.push(...(process.env.PATH ?? "").split(delimiter).filter(Boolean));
  const searched = [];
  for (const dir of dirs) {
    searched.push(dir);
    if (!NEEDED.every((n) => existsSync(join(dir, exe(n))))) continue;
    const out = spawnSync(join(dir, exe("psql")), ["--version"], { encoding: "utf8" });
    const major = Number(/(\d+)(?:\.\d+)?/.exec(out.stdout ?? "")?.[1] ?? 0);
    if (major >= 16) return { dir, version: (out.stdout ?? "").trim() };
  }
  return { dir: null, searched };
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

let active = null; // the one running cluster, for the exit/signal cleanup
const children = new Set();

/** Stops the cluster (fast, then immediate) and deletes its temp dir. Synchronous, idempotent, safe in process 'exit'. */
export function stopCluster() {
  const c = active;
  if (!c) return null;
  active = null;
  for (const child of children) child.kill();
  const report = { stopped: false, removed: false };
  if (c.started) {
    for (const mode of ["fast", "immediate"]) {
      const r = spawnSync(join(c.bin, exe("pg_ctl")), ["-D", c.data, "-m", mode, "-w", "-t", "30", "stop"], { stdio: "ignore" });
      if (r.status === 0) {
        report.stopped = true;
        break;
      }
    }
  } else report.stopped = true;
  try {
    rmSync(c.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {
    // reported below; a leftover temp dir is named in the output so it can be deleted by hand
  }
  report.removed = !existsSync(c.dir);
  report.dir = c.dir;
  return report;
}

process.on("exit", () => stopCluster());
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    stopCluster();
    process.exit(1);
  });
}

/** initdb + start + CREATE DATABASE wf. Returns { bin, dir, data, port, db }. Throws on any failure (cleanup still runs). */
export async function startCluster(bin) {
  const dir = mkdtempSync(join(tmpdir(), "wf-web-test-pg-"));
  const data = join(dir, "data");
  const c = { bin, dir, data, port: 0, db: "wf", started: false };
  active = c;
  const init = spawnSync(join(bin, exe("initdb")), ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C", "--no-instructions"], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`initdb failed (exit ${init.status}): ${(init.stderr || init.stdout || "").trim().slice(-800)}`);
  // trust for 127.0.0.1/32 only: no unix socket line, no ::1, no other host, no replication
  writeFileSync(join(data, "pg_hba.conf"), "# wf test-pg: throwaway cluster, loopback only\nhost all postgres 127.0.0.1/32 trust\n");
  for (let attempt = 1; ; attempt++) {
    c.port = await freePort();
    // fsync/synchronous_commit/full_page_writes only change crash durability of this throwaway cluster, never locking,
    // MVCC visibility or READ COMMITTED semantics, which is what the scenarios exercise
    appendFileSync(
      join(data, "postgresql.conf"),
      `\n# wf test-pg (attempt ${attempt})\nlisten_addresses = '127.0.0.1'\nport = ${c.port}\nunix_socket_directories = ''\nmax_connections = 200\nfsync = off\nsynchronous_commit = off\nfull_page_writes = off\n`,
    );
    // pg_ctl's output goes to a file, not a pipe: the postmaster inherits the handles and a pipe would never close
    const outFile = join(dir, "pg_ctl.out");
    const fd = openSync(outFile, "a");
    const start = spawnSync(join(bin, exe("pg_ctl")), ["-D", data, "-l", join(dir, "postgres.log"), "-w", "-t", "60", "start"], { stdio: ["ignore", fd, fd] });
    closeSync(fd);
    if (start.status === 0) break;
    const log = existsSync(join(dir, "postgres.log")) ? readFileSync(join(dir, "postgres.log"), "utf8") : "";
    if (attempt < 3 && /could not bind|address already in use/i.test(log)) continue; // the free port was taken meanwhile
    throw new Error(`pg_ctl start failed (exit ${start.status}): ${(readFileSync(outFile, "utf8") + log).trim().slice(-800)}`);
  }
  c.started = true;
  const created = await psql(c, "CREATE DATABASE wf;\n", { db: "postgres" });
  if (created.code !== 0) throw new Error(`CREATE DATABASE failed: ${created.stderr.trim()}`);
  return c;
}

const psqlArgs = (c, db) => ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(c.port), "-U", "postgres", "-d", db, "-f", "-"];
const psqlEnv = () => {
  const env = { ...process.env, PGAPPNAME: "wf-test-pg", PGCLIENTENCODING: "UTF8", PGCONNECT_TIMEOUT: "10" };
  for (const k of ["PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGSSLMODE"]) delete env[k];
  return env;
};

/** Spawns one psql process (= one new connection) that runs `script` from stdin. Resolves { code, stdout, stderr };
 *  `onSpawn` gets the child (race() watches for early exits). `keepOpen` leaves stdin open for more commands (the gate). */
export function psql(c, script, { db = c.db, onSpawn, keepOpen = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(c.bin, exe("psql")), psqlArgs(c, db), { env: psqlEnv(), windowsHide: true });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      children.delete(child);
      reject(err);
    });
    child.on("close", (code) => {
      children.delete(child);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {}); // psql may exit (ON_ERROR_STOP) before reading everything
    onSpawn?.(child);
    if (keepOpen) child.stdin.write(script);
    else child.stdin.end(script);
  });
}

const lines = (text) => text.split(/\r?\n/).filter((l) => l.length > 0);

/** Runs harness-owned SQL (fixtures, checks) in one psql; returns the output rows as arrays of columns. Throws on error. */
export async function sql(c, script) {
  const r = await psql(c, script.trim().endsWith(";") ? `${script}\n` : `${script};\n`);
  if (r.code !== 0) throw new Error(`psql failed (exit ${r.code}): ${r.stderr.trim()}\n--- script ---\n${script}`);
  return lines(r.stdout).map((l) => l.split("|"));
}
export const scalar = async (c, script) => (await sql(c, script))[0]?.[0];

/** A literal for harness-owned fixture SQL (never production SQL). */
export const lit = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** One `\bind` argument: psql single-quoted text ('' = a quote, \\ = a backslash). NULL can't be bound by \bind. */
const bindArg = (v) => {
  if (v === null || v === undefined) throw new Error("\\bind can't pass NULL; choose a non-null parameter value");
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
};

/** Production SQL must reach the server byte for byte: psql would act on a backslash (meta-command), an unquoted ";"
 *  (statement end) or ":name" (variable interpolation), so refuse any such text instead of silently changing it. */
export function assertPsqlSafe(name, text) {
  if (typeof text !== "string" || text.trim() === "") throw new Error(`${name} is not exported as a non-empty string`);
  const bare = text.replace(/'(?:[^']|'')*'/g, "''"); // psql leaves quoted literals alone (e.g. the ':' in SQL_ENQUEUE_ONCE)
  if (text.includes("\\") || bare.includes(";") || /(^|[^:]):[A-Za-z_'"{]/.test(bare)) throw new Error(`${name} contains text psql would rewrite; can't send it unchanged`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, check, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

let gateKey = 7_000;
const lockState = (key, granted) =>
  `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = ${key} AND objsubid = 1 AND ${granted ? "granted AND mode = 'ExclusiveLock'" : "NOT granted"}`;

/** Runs every job's production SQL at the same instant from its own psql process (= its own connection), autocommit,
 *  READ COMMITTED (the server default, as Neon's HTTP driver runs one statement). How: a gate connection holds an
 *  exclusive advisory lock; each worker connects, reports its backend pid, then waits for a shared lock on the same key;
 *  once pg_locks shows ALL workers waiting, the gate unlocks and they are released together. Each job is
 *  { sql, params, tag }; returns [{ tag, pid, startUs, rows: string[][] }] in job order. */
export async function race(c, jobs) {
  const key = ++gateKey;
  let gate;
  const gateDone = psql(c, `SELECT pg_advisory_lock(${key});\n`, { keepOpen: true, onSpawn: (child) => (gate = child) });
  await waitFor("the gate lock", async () => (await scalar(c, lockState(key, true))) === "1");
  const exited = [];
  const workers = jobs.map((job, i) => {
    const script = [
      "SELECT 'PID ' || pg_backend_pid();",
      `SELECT 'GATE ' || pg_advisory_lock_shared(${key})::text;`,
      "SELECT 'AT ' || floor(extract(epoch FROM clock_timestamp()) * 1000000)::bigint;",
      "\\echo ROWS",
      job.sql,
      `\\bind ${job.params.map(bindArg).join(" ")} \\g`,
      "\\echo END",
      "",
    ].join("\n");
    return psql(c, script, { onSpawn: (child) => child.on("close", () => exited.push(i)) });
  });
  try {
    await waitFor(`${jobs.length} workers to wait at the gate`, async () => {
      if (exited.length) {
        const r = await workers[exited[0]];
        throw new Error(`worker ${exited[0]} exited before the gate (exit ${r.code}): ${r.stderr.trim()}`);
      }
      return (await scalar(c, lockState(key, false))) === String(jobs.length);
    });
  } finally {
    gate.stdin.end(`SELECT pg_advisory_unlock(${key});\n`); // release everyone at once; EOF then ends the gate session
  }
  const results = await Promise.all(workers);
  await gateDone;
  return results.map((r, i) => {
    if (r.code !== 0) throw new Error(`worker ${i} (${jobs[i].tag ?? ""}) failed (exit ${r.code}): ${r.stderr.trim()}`);
    const out = lines(r.stdout);
    const pid = out.find((l) => l.startsWith("PID "))?.slice(4);
    const startUs = Number(out.find((l) => l.startsWith("AT "))?.slice(3));
    const from = out.indexOf("ROWS");
    const to = out.lastIndexOf("END");
    if (!pid || !Number.isFinite(startUs) || from < 0 || to < from) throw new Error(`worker ${i}: unexpected output:\n${r.stdout}`);
    return { tag: jobs[i].tag, pid, startUs, rows: out.slice(from + 1, to).map((l) => l.split("|")) };
  });
}

/** Applies every apps/web/db/NNN_*.sql in name order, one statement at a time, split by db/statements.mjs exactly as
 *  db/migrate.mjs sends them to Neon (each statement is followed by \g, so psql sends that text as one query). */
export async function applyMigrations(c, dbDir, sqlStatements) {
  const files = readdirSync(dbDir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied = [];
  let notices = 0;
  for (const file of files) {
    const statements = sqlStatements(readFileSync(join(dbDir, file), "utf8"));
    const r = await psql(c, statements.map((s) => `${s}\n\\g\n`).join(""));
    if (r.code !== 0) throw new Error(`${file} failed (exit ${r.code}): ${r.stderr.trim()}`);
    notices += (r.stderr.match(/already exists, skipping/g) ?? []).length;
    applied.push({ file, statements: statements.length });
  }
  return { applied, notices };
}
