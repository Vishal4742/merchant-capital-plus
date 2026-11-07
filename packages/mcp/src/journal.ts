// Operation identity for writes that survives a lost reply, a restart and a key rotation (batch 052, FR-MCP-15;
// production review F2). Before a write is sent, its Idempotency-Key is journaled with a hash of the request.
//
// - Retrying an unresolved write (no answer, a timeout, a 5xx, a malformed success) resumes it with the SAME key for
//   as long as the backend can still replay that key (it keeps slots 24 hours), however much time or how many other
//   writes have passed. It is never evicted to make room.
// - Past that retention the outcome can no longer be settled by a replay, so the operation becomes
//   "needs_reconciliation": nothing is sent, and the merchant checks the record (get_operation_status) before
//   deliberately creating another.
// - A reply that doesn't match the request (wrong amount, foreign URL) is also "needs_reconciliation".
// - The same write repeated right after it succeeded (15 minutes) replays the same record instead of making a second:
//   an accidental repeat. A deliberate second, identical record needs `create_another` (a new key).
// Entries are bound to the authenticated backend + environment + merchant (not to the API key), so a rotated key for
// the same merchant still resumes them, and another merchant's never match.
import { createHash, randomUUID } from "node:crypto";
import { transact } from "./state.ts";

export const SERVER_RETENTION_MS = 24 * 60 * 60_000; // apps/web lib/server/idempotency.ts IDEMPOTENCY_MS; the sandbox's too
const RESUME_LIMIT_MS = SERVER_RETENTION_MS - 60 * 60_000; // a one-hour margin before the server forgets the key
export const REPLAY_WINDOW_MS = 15 * 60_000;
export const MAX_UNRESOLVED = 200; // per file: past this, new writes are refused until some are reconciled
const MAX_SETTLED = 2_000;

export type Outcome = "pending" | "done" | "refused" | "needs_reconciliation" | "acknowledged";
const UNRESOLVED: Outcome[] = ["pending", "needs_reconciliation"];

export interface Entry {
  key: string;
  scope: string;
  op: string;
  hash: string;
  at: number; // first claimed
  last: number; // last attempt or settlement
  outcome: Outcome;
  note: string | null; // why it needs reconciliation, or the record it produced (an id, never a secret)
}
interface State {
  version: 2;
  entries: Entry[];
}

export class JournalRefusal extends Error {
  readonly expose = true;
  readonly entry: Entry | null;
  constructor(message: string, entry: Entry | null = null) {
    super(message);
    this.entry = entry;
  }
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Same JSON with sorted keys, so property order never makes two equal requests look different. */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(value));
}

export interface Claim {
  key: string;
  /** caller: the caller's key · resumed: an unresolved earlier attempt · replay: an accidental repeat of a success · new */
  source: "caller" | "resumed" | "replay" | "new";
  since: number;
}

const empty = (): State => ({ version: 2, entries: [] });
const upgrade = (state: State | { version: 1; entries: Omit<Entry, "last" | "note">[] }): State =>
  state.version === 2 ? state : { version: 2, entries: state.entries.map((e) => ({ ...e, last: e.at, note: null })) };

/** Settled entries are kept 24 h and at most 2,000; unresolved ones are never dropped here. */
function prune(entries: Entry[], now: number): Entry[] {
  const open = entries.filter((e) => UNRESOLVED.includes(e.outcome));
  const settled = entries.filter((e) => !UNRESOLVED.includes(e.outcome) && now - e.last < SERVER_RETENTION_MS).slice(-MAX_SETTLED);
  return [...open, ...settled].sort((a, b) => a.at - b.at);
}

export class Journal {
  readonly #file: string;
  readonly #now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.#file = file;
    this.#now = now;
  }

  /** A scope for one backend + environment + merchant, as the server authenticated it (not the key). */
  static scope(origin: string, environment: string, merchant: string): string {
    return sha(`${origin}|${environment}|${merchant.toLowerCase()}`).slice(0, 32);
  }

  /** The key to send for `op` + `payload`, journaled as pending before anything goes out. */
  claim(scope: string, op: string, payload: unknown, opts: { callerKey?: string; createAnother?: boolean } = {}): Claim {
    const hash = sha(canonical(payload)), now = this.#now();
    const result = this.#change<Claim | JournalRefusal>((entries) => {
      const mine = entries.filter((e) => e.scope === scope);
      const keep = (claim: Claim, next: Entry[]) => ({ next, result: claim });
      const refuse = (refusal: JournalRefusal, next?: Entry[]) => ({ next, result: refusal });
      const record = (key: string, at: number): Entry => ({ key, scope, op, hash, at, last: now, outcome: "pending", note: null });

      if (opts.callerKey) {
        const prior = mine.find((e) => e.key === opts.callerKey);
        // a caller key already used for a different request keeps its own entry; the server would answer 422 anyway
        if (prior && (prior.op !== op || prior.hash !== hash)) return refuse(new JournalRefusal(`idempotency_key ${opts.callerKey} was already used for a different request. Use a new key for a new record.`, prior));
        const entry = prior ? { ...prior, last: now } : record(opts.callerKey, now);
        return keep({ key: entry.key, source: "caller", since: entry.at }, [...entries.filter((e) => e !== prior), entry]);
      }

      const unresolved = mine.filter((e) => e.op === op && e.hash === hash && UNRESOLVED.includes(e.outcome)).at(-1);
      if (unresolved && !opts.createAnother) {
        if (unresolved.outcome === "needs_reconciliation") {
          return refuse(new JournalRefusal("An earlier identical request needs reconciliation before this one can be sent.", unresolved));
        }
        if (now - unresolved.at > RESUME_LIMIT_MS) {
          const flagged = { ...unresolved, last: now, outcome: "needs_reconciliation" as const, note: "outcome unknown and past the server's 24-hour retention: it can no longer be settled by a retry" };
          // stored with the refusal: a caller that ignores it still can't slip a fresh key past it
          return refuse(new JournalRefusal("An earlier identical request's outcome is still unknown, and Whiteflow no longer keeps its key, so it can't be safely retried.", flagged), entries.map((e) => (e === unresolved ? flagged : e)));
        }
        return keep({ key: unresolved.key, source: "resumed", since: unresolved.at }, entries.map((e) => (e === unresolved ? { ...e, last: now } : e)));
      }

      const recent = mine.filter((e) => e.op === op && e.hash === hash && e.outcome === "done" && now - e.last < REPLAY_WINDOW_MS).at(-1);
      if (recent && !opts.createAnother) return keep({ key: recent.key, source: "replay", since: recent.at }, entries);

      if (entries.filter((e) => UNRESOLVED.includes(e.outcome)).length >= MAX_UNRESOLVED) {
        return refuse(new JournalRefusal(`There are ${MAX_UNRESOLVED} writes whose outcome is still unknown. Reconcile them (get_operation_status) before creating more.`));
      }
      const key = `wfmcp_${randomUUID()}`;
      return keep({ key, source: "new", since: now }, [...entries, record(key, now)]);
    });
    if (result instanceof JournalRefusal) throw result;
    return result;
  }

  /** done: created or replayed · refused: a definite no · needs_reconciliation: a reply that didn't match, or a
   *  write the merchant must check · acknowledged: the merchant checked it. A write whose outcome is unknown simply
   *  stays pending. */
  settle(scope: string, key: string, outcome: Exclude<Outcome, "pending">, note: string | null = null): void {
    const now = this.#now();
    this.#change((entries) => ({ next: entries.map((e) => (e.scope === scope && e.key === key ? { ...e, outcome, note: note ?? e.note, last: now } : e)), result: undefined }));
  }

  unresolved(scope: string): Entry[] {
    return this.#change((entries) => ({ result: entries.filter((e) => e.scope === scope && UNRESOLVED.includes(e.outcome)) }));
  }

  find(scope: string, key: string): Entry | undefined {
    return this.#change((entries) => ({ result: entries.find((e) => e.scope === scope && e.key === key) }));
  }

  #change<R>(fn: (entries: Entry[]) => { next?: Entry[]; result: R }): R {
    return transact<State, R>(this.#file, empty, (raw) => {
      const state = upgrade(raw);
      const { next, result } = fn(prune(state.entries, this.#now()));
      return { next: next ? { version: 2, entries: prune(next, this.#now()) } : undefined, result };
    });
  }
}
