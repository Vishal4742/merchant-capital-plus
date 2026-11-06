// Server-only: durable Idempotency-Key slots (table app_web_idempotency), shared by POST /api/v1/sessions (FR-PAY-4,
// ARCHITECTURE §4b) and POST /api/v1/links (batch 052, FR-GW-16 proposed). Moved here unchanged from the sessions route,
// plus `replayed` on a stored reply and a canonical request hash for routes whose body is JSON.
import { createHash, randomUUID } from "node:crypto";
import { query } from "./db.ts";

export const MAX_IDEMPOTENCY_KEY = 255;
const IDEMPOTENCY_MS = 24 * 60 * 60 * 1000;
const ABANDONED_MS = 300_000; // = the function's maximum duration (security 026 F4): a first request that stored no reply by now died with its instance, so its key is free again
const WAIT_GAP_MS = 100;
const WAIT_TRIES = 100; // a second request waits up to 10 s for the first one's reply (an FX quote takes at most 5 s)
const STILL_CREATING = "A request with this Idempotency-Key is still being processed. Try again in a moment.";

export type Reply = { status: number; body: unknown; replayed?: true };
type Slot = { hash: string; status: number | null; body: string | null };

const fail = (status: number, error: string): Reply => ({ status, body: { error } });
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** JSON with every object's keys sorted, so `{"a":1,"b":2}` and `{ "b": 2, "a": 1 }` are the same request (v3.1
 *  §8.H's canonical hash). A body that isn't JSON hashes as its raw text; the route then refuses it anyway. */
export function requestHash(text: string): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])]))
        : value;
  try {
    return sha256(JSON.stringify(sorted(JSON.parse(text))));
  } catch {
    return sha256(text);
  }
}

/** The same key within 24 h gets the first reply back, across instances. The slot is taken (INSERT ... ON CONFLICT DO
 *  NOTHING) before anything is created, so two requests at the same moment create one; the second waits for the first
 *  one's stored reply. Only a created (201) reply is replayed: a refused or failed one frees the key for a corrected
 *  retry, deleting only its own row (code review 006 R2-4). `slot` must name the merchant (and the route, for any route
 *  but sessions), so one merchant's key never replays another's reply. */
export async function idempotent(slot: string, hash: string, run: () => Promise<Reply>): Promise<Reply> {
  const now = Date.now(), owner = randomUUID();
  // expiry by age replaces the 1,000-key cap (security review 006 F6): past 24 h, or a first request that died
  await query("DELETE FROM app_web_idempotency WHERE created_at < $1 OR (status IS NULL AND created_at < $2)", [now - IDEMPOTENCY_MS, now - ABANDONED_MS]);
  for (let tries = 0; ; tries++) {
    const taken = await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (slot) DO NOTHING RETURNING slot", [slot, owner, hash, Date.now()]);
    if (taken.length === 1) return first(slot, owner, run);
    const [prior] = await query<Slot>("SELECT hash, status, body::text FROM app_web_idempotency WHERE slot = $1", [slot]);
    if (prior && prior.hash !== hash) return fail(422, "This Idempotency-Key was already used for a different request.");
    if (prior?.status != null) return { status: prior.status, body: JSON.parse(prior.body!), replayed: true };
    if (tries >= WAIT_TRIES) return fail(409, STILL_CREATING);
    // still being created, or just freed by a refused first request (then this one takes the slot next time round)
    if (prior) await new Promise((resolve) => setTimeout(resolve, WAIT_GAP_MS));
  }
}

async function first(slot: string, owner: string, run: () => Promise<Reply>): Promise<Reply> {
  let done: Reply | undefined;
  try {
    done = await run();
    return done;
  } finally {
    const own = [slot, owner];
    // a reply that can't be stored is logged, never thrown over the created record: the slot then frees after 5 min
    const kept = done?.status === 201
      ? query("UPDATE app_web_idempotency SET status = $3, body = $4::jsonb WHERE slot = $1 AND owner = $2", [...own, done.status, JSON.stringify(done.body)])
      : query("DELETE FROM app_web_idempotency WHERE slot = $1 AND owner = $2", own);
    await kept.catch((error: unknown) => console.error(`idempotency slot not ${done?.status === 201 ? "stored" : "freed"}: ${error instanceof Error ? error.name : "error"}`));
  }
}

/** A reply as a Response; a replayed one says so in `Idempotent-Replayed: true`. */
export const send = ({ status, body, replayed }: Reply) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...(replayed ? { "idempotent-replayed": "true" } : {}) } });
