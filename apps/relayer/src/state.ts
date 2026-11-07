// The relayer's shared state (batch 031, FR-REL-10): the send lock, the replay set, the daily WBT budget, the hourly
// rate limits, the breaker and (round 3) the payer cooldown, in Postgres (db/*.sql) so they hold across Vercel Fluid
// instances. Every function is ONE statement: Neon's HTTP driver can't keep a session (or a session advisory lock)
// between statements. db.ts retries transient failures, so every statement here is safe to run twice (round 3, B8).
//
// The lock is a lease row with a fence (not pg_advisory_lock over a pooled/WebSocket session): it works over the same
// HTTP driver as the web app, holds no connection open across the ~1-25 s an RPC send takes, runs the same on PGlite in
// tests, and mirrors apps/web's reviewed app_web_locks pattern. Its weakness, a holder that outlives its lease (a frozen
// or hung instance), is closed by the fence: the write-ahead row (and so the broadcast) needs the writer's lease to still
// be live in the same statement, so a stale holder can sign locally but can never record or broadcast.
import { randomUUID } from 'node:crypto';
import { isAddress, type Address, type Hash } from 'viem';
import { query } from './db.ts';

/** A lease outlives any live holder: above vercel.json's maxDuration (60 s). One left by a crashed or frozen instance
 *  frees itself after this. Raise it with maxDuration. */
export const LEASE_S = 90;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000; // UTC days: Date.now() has no leap seconds

/** One payer authorization: its replay key "<payer>:<authorization nonce>" (lowercase) and who it counts against. */
export interface Authorization { key: string; payer: string; merchant?: string }
export interface Ledger {
  replay: boolean; // this authorization already has a row (signed, maybe broadcast)
  reverts: number; // this relayer's mined reverts in the last hour (the breaker)
  cooldownUntil: number | null; // the payer's cooldown end (unix ms) if one is active or was (round 3, B9)
  spentWei: bigint; // today's (UTC) relay gas, the cap for any send without a receipt
  payerSends: number; // this payer's sends in the last hour
  merchantSends: number; // this merchant's sends in the last hour (sales only)
}
export type Outcome = 'mined' | 'reverted' | 'unknown';
export interface CooldownPolicy { failures: number; windowMs: number; cooldownMs: number }
export interface WriteAheadInput {
  relayer: Address; fence: string; auth: Authorization; txHash: Hash; txNonce: number; feeWei: bigint; sentAt: number;
}

const lower = (a: string) => a.toLowerCase();

// Round 3 (owner, B9): the payer cooldown policy. Provisional TESTNET values, not production-validated: 3 distinct
// payer-attributable failures within 10 minutes → a 15-minute cooldown. An invalid value falls back to the default.
const warned = new Set<string>();
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  if (!warned.has(name)) {
    warned.add(name);
    process.stderr.write(`${name} must be an integer from ${min} to ${max}; using ${fallback}\n`);
  }
  return fallback;
}
export function cooldownPolicy(): CooldownPolicy {
  return {
    failures: envInt('RELAYER_COOLDOWN_FAILURES', 3, 1, 100),
    windowMs: envInt('RELAYER_COOLDOWN_WINDOW_S', 600, 1, 86_400) * 1000,
    cooldownMs: envInt('RELAYER_COOLDOWN_S', 900, 1, 86_400) * 1000,
  };
}

/** One SQL statement exactly as the relayer sends it: its text and its positional parameters ($1, $2, ...). */
export interface Statement { text: string; params: unknown[] }

// Round 4 (B10): every statement's text and parameter list live in these builders, the single source for both the
// functions below (through db.ts) and the opt-in real-Postgres harness (test-pg/), which runs the same builders from
// independent psql processes. Change SQL here only.
export const statements = {
  /** See readLedger(). */
  readLedger(relayer: string, auth: Authorization | undefined, now: number, policy: CooldownPolicy): Statement {
    return {
      text: `WITH unblocked AS (
       SELECT coalesce(max(at), 0) AS at FROM rel_payer_unblocks WHERE payer = $3::text
     ), faults AS (
       SELECT payer_fault_at AS t FROM rel_sent
       WHERE payer = $3::text AND payer_fault_at IS NOT NULL AND payer_fault_at > (SELECT at FROM unblocked)
         AND payer_fault_at > $7::bigint - $10::bigint - $9::bigint
     )
     SELECT
       EXISTS (SELECT 1 FROM rel_sent WHERE auth_key = $2::text) AS replay,
       (SELECT count(*) FROM rel_sent WHERE relayer = $1 AND reverted_at > $5::bigint)::int AS reverts,
       (SELECT max(f.t) + $10::bigint FROM faults f
         WHERE f.t > $7::bigint - $10::bigint
           AND (SELECT count(*) FROM faults g WHERE g.t > f.t - $9::bigint AND g.t <= f.t) >= $8::int)::text AS cooldown_until,
       (SELECT coalesce(sum(fee_wei), 0) FROM rel_sent WHERE relayer = $1 AND sent_at >= $6::bigint)::text AS spent_wei,
       (SELECT count(*) FROM rel_sent WHERE relayer = $1 AND payer = $3::text AND sent_at > $5::bigint)::int AS payer_sends,
       (SELECT count(*) FROM rel_sent WHERE relayer = $1 AND merchant = $4::text AND sent_at > $5::bigint)::int AS merchant_sends`,
      params: [lower(relayer), auth?.key ?? null, auth?.payer ?? null, auth?.merchant ?? null, now - HOUR_MS, now - (now % DAY_MS), now,
        policy.failures, policy.windowMs, policy.cooldownMs],
    };
  },
  /** See takeLease(). */
  takeLease(relayer: string, holder: string): Statement {
    return {
      text: `WITH taken AS (
       INSERT INTO rel_lease (relayer, fence, until, holder) VALUES ($1, 1, now() + interval '${LEASE_S} seconds', $2)
       ON CONFLICT (relayer) DO UPDATE SET fence = rel_lease.fence + 1, until = EXCLUDED.until, holder = EXCLUDED.holder
         WHERE rel_lease.until < now()
       RETURNING fence
     )
     SELECT fence::text AS fence FROM taken
     UNION ALL
     SELECT fence::text FROM rel_lease WHERE relayer = $1 AND holder = $2 AND until > now() AND NOT EXISTS (SELECT 1 FROM taken)`,
      params: [lower(relayer), holder],
    };
  },
  /** See releaseLease(). */
  releaseLease(relayer: string, fence: string): Statement {
    return {
      text: "UPDATE rel_lease SET until = now() - interval '1 second' WHERE relayer = $1 AND fence = $2::bigint",
      params: [lower(relayer), fence],
    };
  },
  /** See writeAhead(). */
  writeAhead(a: WriteAheadInput): Statement {
    return {
      text: `WITH lease AS (
       SELECT 1 FROM rel_lease WHERE relayer = $1 AND fence = $2::bigint AND until > now()
     ), written AS (
       INSERT INTO rel_sent (auth_key, relayer, payer, merchant, tx_hash, tx_nonce, fence, fee_wei, status, sent_at)
       SELECT $3::text, $1, $4::text, $5::text, $6::text, $7::bigint, $2::bigint, $8::numeric, 'signed', $9::bigint
       WHERE EXISTS (SELECT 1 FROM lease)
       ON CONFLICT (auth_key) DO UPDATE SET status = rel_sent.status
         WHERE rel_sent.tx_hash = EXCLUDED.tx_hash AND rel_sent.fence = EXCLUDED.fence AND rel_sent.status = 'signed'
       RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM lease) AS leased, EXISTS (SELECT 1 FROM written) AS written`,
      params: [lower(a.relayer), a.fence, a.auth.key, a.auth.payer, a.auth.merchant ?? null, lower(a.txHash), a.txNonce, a.feeWei.toString(), a.sentAt],
    };
  },
  /** See settle(). */
  settle(auth: Authorization, feeWei: bigint, outcome: Outcome, payerFault: boolean, at: number): Statement {
    const reverted = outcome === 'reverted';
    return {
      // reverted mirrors status for the batch-037 columns, so a rollback to that relayer keeps its breaker (review 049 M1)
      text: "UPDATE rel_sent SET fee_wei = $2::numeric, status = $3, reverted = ($3 = 'reverted'), reverted_at = $4::bigint, payer_fault_at = $5::bigint WHERE auth_key = $1",
      params: [auth.key, feeWei.toString(), outcome, reverted ? at : null, reverted && payerFault ? at : null],
    };
  },
  /** See unblockPayer(). */
  unblock(a: { id: string; payer: string; actor: string; reason: string; cooldownUntil: number | null; at: number }): Statement {
    return {
      text: 'INSERT INTO rel_payer_unblocks (id, payer, actor, reason, cooldown_until, at) VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint) ON CONFLICT (id) DO NOTHING',
      params: [a.id, lower(a.payer), a.actor, a.reason, a.cooldownUntil, a.at],
    };
  },
};

const run = (s: Statement) => query(s.text, s.params);

/** One read of everything the checks need. Without an authorization (/health) only the relayer-wide fields mean anything.
 *  The cooldown is per payer across relayers: the end of the cooldown started by the latest failure that completed
 *  `failures` failures within `windowMs`, ignoring failures at or before the payer's last audited unblock. */
export async function readLedger(relayer: string, auth?: Authorization, now = Date.now()): Promise<Ledger> {
  const [row] = await run(statements.readLedger(relayer, auth, now, cooldownPolicy()));
  return {
    replay: row.replay === true, reverts: Number(row.reverts), spentWei: BigInt(String(row.spent_wei)),
    cooldownUntil: row.cooldown_until === null || row.cooldown_until === undefined ? null : Number(row.cooldown_until),
    payerSends: Number(row.payer_sends), merchantSends: Number(row.merchant_sends),
  };
}

/** Takes this relayer's send lease if it is free or lapsed. One statement, so of two instances racing exactly one gets a
 *  row back. Returns the fence, or undefined while another holder's lease is live. `holder` is this request's own id:
 *  if a take committed but its reply was lost, the retry finds the live lease it already holds (B8). */
export async function takeLease(relayer: Address, holder: string): Promise<string | undefined> {
  const rows = await run(statements.takeLease(relayer, holder));
  return rows[0] ? String(rows[0].fence) : undefined;
}

/** Ends our own lease only (a later holder's fence differs). Expires the row instead of deleting it, so fences never repeat. */
export async function releaseLease(relayer: Address, fence: string): Promise<void> {
  await run(statements.releaseLease(relayer, fence));
}

/** The write-ahead (B2): records a signed transaction before it is broadcast, only while `fence` holds a live lease.
 *  'replay': the authorization already has someone else's row. 'lost_lease': the lease lapsed or was taken over; nothing
 *  written. A retry whose first try committed (reply lost) finds its own row, same tx hash and fence, still 'signed', and
 *  counts it as written (B8): the no-op DO UPDATE sees the latest committed row, so this holds even mid-commit. */
export async function writeAhead(a: WriteAheadInput): Promise<'written' | 'replay' | 'lost_lease'> {
  const [row] = await run(statements.writeAhead(a));
  if (row.leased !== true) return 'lost_lease';
  return row.written === true ? 'written' : 'replay';
}

/** After the broadcast attempt: the real fee (or the cap again when the outcome is unknown), a mined revert (the
 *  breaker) and, for a revert the on-chain check attributed to the payer, the failure that counts toward a cooldown. */
export async function settle(auth: Authorization, feeWei: bigint, outcome: Outcome, payerFault = false, at = Date.now()): Promise<void> {
  await run(statements.settle(auth, feeWei, outcome, payerFault, at));
}

/** The audited unblock (B9): failures at or before now stop counting, so an active cooldown ends at once. Writes one
 *  audit row (who, why, the cooldown it lifted). Operators run it through db/unblock-payer.ts; there is no endpoint. */
export async function unblockPayer(a: { payer: string; actor: string; reason: string; now?: number }): Promise<{ id: string; at: number; cooldownUntil: number | null }> {
  const [payer, actor, reason] = [a.payer.trim(), a.actor.trim(), a.reason.trim()];
  if (!isAddress(payer, { strict: false })) throw new Error('payer must be a 0x address');
  if (!actor || actor.length > 100) throw new Error('actor is required (at most 100 characters)');
  if (!reason || reason.length > 500) throw new Error('reason is required (at most 500 characters)');
  const at = a.now ?? Date.now();
  const { cooldownUntil } = await readLedger('', { key: '', payer: lower(payer) }, at);
  const lifted = cooldownUntil !== null && cooldownUntil > at ? cooldownUntil : null;
  const id = randomUUID();
  await run(statements.unblock({ id, payer, actor, reason, cooldownUntil: lifted, at }));
  return { id, at, cooldownUntil: lifted };
}
