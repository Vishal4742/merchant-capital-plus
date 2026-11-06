// Idempotency keys that survive a lost reply (batch 052, FR-MCP-15). Before a write is sent, its key is journaled
// with a hash of what is being written. A later call for the same write without a key (the model retrying after a
// timeout, or after the client restarted) gets the same key back, so the backend replays the first record instead
// of creating a second. A genuinely new record needs a new idempotency_key from the caller. The backend enforces
// idempotency durably; this journal only makes sure the connector asks with the same key.
import { createHash, randomUUID } from "node:crypto";
import { transact } from "./state.ts";

export const REUSE_WINDOW_MS = 15 * 60_000;
const KEEP_MS = 24 * 60 * 60_000; // the backend keeps a key for 24 h
const MAX_ENTRIES = 500;

export type Outcome = "pending" | "done" | "refused";
interface Entry {
  key: string;
  scope: string; // which backend and credential (a hash): another merchant's journal entry is never reused
  op: string;
  hash: string;
  at: number;
  outcome: Outcome;
}
interface State {
  version: 1;
  entries: Entry[];
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
  /** "caller": the caller's own key; "recovered": an earlier same-payload attempt's key; "new": freshly made. */
  source: "caller" | "recovered" | "new";
  previousOutcome?: Outcome;
}

export class Journal {
  readonly #file: string;
  readonly #scope: string;
  readonly #now: () => number;

  constructor(file: string, scopeSeed: string, now: () => number = Date.now) {
    this.#file = file;
    this.#scope = sha(scopeSeed).slice(0, 24);
    this.#now = now;
  }

  /** The key to send for `op` + `payload`, journaled as pending before anything goes out. */
  claim(op: string, payload: unknown, callerKey?: string): Claim {
    const hash = sha(canonical(payload)), now = this.#now();
    return transact<State, Claim>(this.#file, () => ({ version: 1, entries: [] }), (state) => {
      const entries = state.entries.filter((e) => now - e.at < KEEP_MS);
      let claim: Claim;
      if (callerKey) {
        claim = { key: callerKey, source: "caller" };
      } else {
        // the newest same write in the window that wasn't refused: its outcome is unknown or it was created
        const prior = [...entries].reverse().find((e) => e.scope === this.#scope && e.op === op && e.hash === hash && e.outcome !== "refused" && now - e.at < REUSE_WINDOW_MS);
        claim = prior ? { key: prior.key, source: "recovered", previousOutcome: prior.outcome } : { key: `wfmcp_${randomUUID()}`, source: "new" };
      }
      const kept = entries.filter((e) => !(e.scope === this.#scope && e.key === claim.key));
      const next = [...kept, { key: claim.key, scope: this.#scope, op, hash, at: now, outcome: "pending" as const }].slice(-MAX_ENTRIES);
      return { next: { version: 1, entries: next }, result: claim };
    });
  }

  /** "done": created (or replayed); "refused": a definite no (4xx), so the next attempt may use a fresh key. A write
   *  whose outcome is unknown simply stays "pending". */
  settle(key: string, outcome: Exclude<Outcome, "pending">): void {
    transact<State, void>(this.#file, () => ({ version: 1, entries: [] }), (state) => ({
      next: { version: 1, entries: state.entries.map((e) => (e.scope === this.#scope && e.key === key ? { ...e, outcome } : e)) },
      result: undefined,
    }));
  }
}
