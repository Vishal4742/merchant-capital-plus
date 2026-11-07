// The relayer's shared state lives in Postgres (batch 031, FR-REL-10): Neon's HTTP driver in production, PGlite (real
// Postgres in-process) in tests via setTestDb(), so the SQL under test is the SQL that ships. Same driver and pinned
// version as apps/web/lib/server/db.ts. There is no in-memory fallback: no database means no relaying (fail closed).
import { neon } from '@neondatabase/serverless';
import { setTimeout as sleep } from 'node:timers/promises';

export type Row = Record<string, unknown>;
export interface Db {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

// A hung query must not hold the send lock: past this the call fails and the relay is refused (nothing sent yet), or,
// after a broadcast, the outcome is logged and the conservative write-ahead row (fee = the cap) stands.
const DB_TIMEOUT_MS = 5_000;

/** The database is unset, unreachable or failing. The message is fixed: driver errors can carry the host or the URL. */
export class DbUnavailable extends Error {
  constructor() {
    super("the relayer's database is unavailable");
    this.name = 'DbUnavailable';
  }
}

let current: Db | undefined;

/** Tests only: route every query to this client (PGlite); undefined goes back to DATABASE_URL. */
export function setTestDb(db: Db | undefined): void {
  current = db;
}

function db(): Db {
  if (current) return current;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbUnavailable();
  const sql = neon(url);
  current = {
    query: (text, params = []) => sql.query(text, params, { fetchOptions: { signal: AbortSignal.timeout(DB_TIMEOUT_MS) } }) as Promise<Row[]>,
  };
  return current;
}

/** What may be printed about a database error: its SQLSTATE (e.g. 42P01: tables missing) or its class name, never
 *  its message or stack (the Neon driver puts the whole connection string, password included, in some messages). */
export function errorLabel(e: unknown): string {
  const { code, name } = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'error';
}

// Round 3 (owner, B8): a transient failure is retried briefly before the caller answers 503. Every statement in
// src/state.ts is safe to run twice: reads, guarded updates, and the two inserts recognise their own committed row
// (take-lease by its holder id, write-ahead by its tx hash + fence), so a lost reply is never read as busy or replay.
// No new try starts once RETRY_BUDGET_MS has passed (a hung statement already used its 5 s timeout and is not retried).
const RETRY_BACKOFF_MS = [100, 300, 600]; // before tries 2, 3, 4
const RETRY_BUDGET_MS = 1_500;
// Postgres SQLSTATEs worth a retry: connection exceptions (08), insufficient resources (53), admin/crash shutdown and
// "cannot connect now" (57P01-03), serialization failure and deadlock (40001, 40P01).
const TRANSIENT_SQLSTATE = /^(08...|53...|57P0[123]|40001|40P01)$/;
const TRANSIENT_NODE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/** True for failures that may pass on a retry: a timeout, a dropped or refused connection, an HTTP 5xx/429 from Neon, or
 *  a transient SQLSTATE. False for SQL/constraint/logic errors, a 4xx and anything unknown (they would fail again). */
export function isTransient(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, code, message, sourceError, cause } = e as { name?: unknown; code?: unknown; message?: unknown; sourceError?: unknown; cause?: unknown };
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (typeof code === 'string') return TRANSIENT_SQLSTATE.test(code) || TRANSIENT_NODE_CODES.has(code);
  // Neon's HTTP driver: "Error connecting to database" carries the fetch failure as sourceError (network, our timeout);
  // any other non-2xx/400 answer is "Server error (HTTP status N)" with no code.
  if (sourceError !== undefined) return true;
  const status = typeof message === 'string' ? /^Server error \(HTTP status (\d{3})\)/.exec(message)?.[1] : undefined;
  if (status) return status === '429' || status.startsWith('5');
  return cause !== undefined && isTransient(cause);
}

/** One statement, retried on transient failures (see above). Any final failure becomes DbUnavailable; only errorLabel()
 *  of each cause is logged. */
export async function query(text: string, params: unknown[] = []): Promise<Row[]> {
  const started = performance.now();
  for (let tries = 1; ; tries++) {
    try {
      return await db().query(text, params);
    } catch (e) {
      if (e instanceof DbUnavailable) throw e; // not configured: nothing to retry
      process.stderr.write(`db error ${errorLabel(e)}\n`);
      const wait = RETRY_BACKOFF_MS[tries - 1];
      if (!isTransient(e) || wait === undefined || performance.now() - started + wait > RETRY_BUDGET_MS) throw new DbUnavailable();
      await sleep(wait);
    }
  }
}
