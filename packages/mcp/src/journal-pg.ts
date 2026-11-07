// The remote endpoint's journal on shared Postgres (batch 058, FR-MCP-1..3; SRS-CHANGE FR-MCP-18 proposed). Same decisions
// as the file journal (decideClaim), different storage: one JSON document per tenant scope in app_mcp_journal
// (apps/web/db/051_mcp_remote.sql), changed only by compare-and-swap on `version`. Neon's HTTP driver has no interactive
// transactions, so the read, the decision and the write can't share one; the version check makes a lost race retry
// against the winner's state instead, which is how 20 simultaneous identical creates end with one key.
// No local file is read or written, so nothing depends on which instance, or how many, handle a request.
import { JournalRefusal, decideClaim, prune, type Claim, type ClaimOptions, type Entry, type JournalPort, type Outcome } from "./journal.ts";

/** The one thing needed from a database: parameterised queries returning rows (Neon's `sql.query`, PGlite's `query`). */
export interface SqlRunner {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

const MAX_ATTEMPTS = 40;
const BACKOFF_MS = 15;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Entries compared without `last` (the time of the latest attempt): a resume that only touches it needs no write. */
const material = (entries: Entry[]) => JSON.stringify(entries.map(({ last: _last, ...rest }) => rest));

export class JournalBusy extends Error {
  readonly expose = true;
  constructor() {
    super("Too many requests are changing this business's write journal at once. Try again in a moment; nothing was created.");
  }
}

export class PgJournal implements JournalPort {
  readonly #sql: SqlRunner;
  readonly #now: () => number;

  constructor(sql: SqlRunner, now: () => number = Date.now) {
    this.#sql = sql;
    this.#now = now;
  }

  async #change<R>(scope: string, fn: (entries: Entry[]) => { next?: Entry[]; result: R }): Promise<R> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rows = await this.#sql.query("SELECT version::text AS version, entries FROM app_mcp_journal WHERE scope = $1", [scope]);
      const exists = rows.length === 1;
      const version = exists ? BigInt(rows[0].version as string) : 0n;
      const stored = exists ? ((typeof rows[0].entries === "string" ? JSON.parse(rows[0].entries) : rows[0].entries) as Entry[]) : [];
      const { next, result } = fn(prune(stored.filter((e) => e.scope === scope), this.#now()));
      if (!next || material(next) === material(stored)) return result; // a resume changes nothing that matters: don't contend
      const document = JSON.stringify(prune(next, this.#now()));
      const written = exists
        ? await this.#sql.query("UPDATE app_mcp_journal SET entries = $3::jsonb, version = version + 1, updated_at = $4 WHERE scope = $1 AND version = $2 RETURNING scope", [scope, version.toString(), document, this.#now()])
        : await this.#sql.query("INSERT INTO app_mcp_journal (scope, version, entries, updated_at) VALUES ($1, 1, $2::jsonb, $3) ON CONFLICT (scope) DO NOTHING RETURNING scope", [scope, document, this.#now()]);
      if (written.length === 1) return result; // our version was current: the decision stands
      // someone else changed this scope first: decide again on their result, after a jittered pause so racers spread out
      await pause(Math.random() * BACKOFF_MS * Math.min(attempt + 1, 6));
    }
    throw new JournalBusy();
  }

  async claim(scope: string, op: string, payload: unknown, opts: ClaimOptions = {}): Promise<Claim> {
    const now = this.#now();
    const result = await this.#change<Claim | JournalRefusal>(scope, (entries) => decideClaim(entries, scope, op, payload, opts, now));
    if (result instanceof JournalRefusal) throw result;
    return result;
  }

  async settle(scope: string, key: string, outcome: Exclude<Outcome, "pending">, note: string | null = null): Promise<void> {
    const now = this.#now();
    await this.#change<void>(scope, (entries) => ({ next: entries.map((e) => (e.key === key ? { ...e, outcome, note: note ?? e.note, last: now } : e)), result: undefined }));
  }

  async unresolved(scope: string): Promise<Entry[]> {
    return this.#change(scope, (entries) => ({ result: entries.filter((e) => e.outcome === "pending" || e.outcome === "needs_reconciliation") }));
  }

  async find(scope: string, key: string): Promise<Entry | undefined> {
    return this.#change(scope, (entries) => ({ result: entries.find((e) => e.key === key) }));
  }
}
