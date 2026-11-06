// FR-REL-10 (batch 037): the relayer state every instance shares, in Postgres. On Vercel several instances can serve
// /relay at once, so the send lock, the daily gas budget, the breaker, the payer ban, the rate limits and the replay set
// can't live in process memory. Production: Neon's HTTP driver (the web's version and pattern, apps/web/lib/server/db.ts)
// as the relayer's own role, which can only touch rel_sent and rel_lock (db/001_rel.sql, db/002_relayer_role.sql). Tests
// and the dev server swap in PGlite with setDb(), so the SQL under test is the SQL that ships. Each write is one
// statement (CTEs where two tables move together), so no transaction API is needed. Every time is the database's clock
// in unix ms (security 037 M1: one clock for every instance, and no request-to-commit lag); fees are wei, sent as text.
import { neon } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;
export interface Db {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

/** The database failed or isn't configured: the relayer answers 503 storage_error, and never sends without it.
 *  Only the cause's name is kept: a driver message can quote the connection string (security 037 L5). */
export class StoreError extends Error {
  readonly causeName: string;
  constructor(cause: unknown) {
    super('the relayer database is unavailable');
    this.name = 'StoreError';
    this.causeName = cause instanceof Error ? cause.name : 'error';
  }
}

// A query that hangs would skip the relayer's 20 s age gate and hold the lease (review 037 M2): give up after 5 s,
// which still covers a Neon compute waking from idle.
const QUERY_TIMEOUT_MS = 5_000;
let current: Db | undefined;

/** Tests and the dev server: route every query to this database (PGlite); undefined goes back to DATABASE_URL. */
export function setDb(db: Db | undefined): void {
  current = db;
}

async function run(text: string, params: unknown[]): Promise<Row[]> {
  try {
    if (!current) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set');
      const sql = neon(url);
      current = { query: (t, p = []) => sql.query(t, p, { fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) } }) as Promise<Row[]> };
    }
    return await current.query(text, params);
  } catch (e) {
    throw new StoreError(e);
  }
}

// A lease outlives the longest hold: the 20 s age gate + the 8 s send + the 8 s receipt poll ≈ 44 s (relayer.ts TIMING),
// and a crashed instance's lease frees itself after this.
export const LEASE_MS = 60_000;
const NOW_MS = '(extract(epoch from clock_timestamp()) * 1000)::bigint';
const UTC_DAY_START_MS = "(extract(epoch from date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC')) * 1000)::bigint";
const HOUR_MS = 3_600_000;
const lc = (s: string) => s.toLowerCase();

/** The USDT authorization a payment pulls with: one broadcast per key, ever, across every instance. */
export const authKey = (payer: string, nonce: string) => `${lc(payer)}:${lc(nonce)}`;

export interface Counters {
  sent: boolean; // this authorization was already sent
  spentWei: bigint; // relay gas spent today (UTC), worst case for sends without a receipt
  revertsLastHour: number;
  banned: boolean; // this payer caused a mined revert, ever
  payerSendsLastHour: number;
  merchantSendsLastHour: number;
}

/** Everything the ledger checks need, for one relayer, payer and merchant, in one SELECT. */
export async function counters(relayer: string, payer: string, merchant: string | undefined, key: string): Promise<Counters> {
  const [row] = await run(`
    WITH t AS (SELECT ${UTC_DAY_START_MS} AS day, ${NOW_MS} - ${HOUR_MS} AS hour_ago)
    SELECT coalesce(bool_or(auth_key = $4), false) AS sent,
           coalesce(sum(fee_wei) FILTER (WHERE sent_at >= t.day), 0)::text AS spent,
           count(*) FILTER (WHERE reverted AND sent_at > t.hour_ago)::int AS reverts,
           coalesce(bool_or(reverted AND payer = $2), false) AS banned,
           count(*) FILTER (WHERE payer = $2 AND sent_at > t.hour_ago)::int AS payer_sends,
           count(*) FILTER (WHERE merchant = $3 AND sent_at > t.hour_ago)::int AS merchant_sends
    FROM rel_sent, t
    WHERE relayer = $1 AND (sent_at >= least(t.day, t.hour_ago) OR payer = $2 OR auth_key = $4)`,
  [lc(relayer), lc(payer), merchant ? lc(merchant) : null, key]);
  return {
    // fail closed: anything but a plain false counts as sent / banned (security 037 L5)
    sent: row.sent !== false, spentWei: BigInt(String(row.spent)), revertsLastHour: Number(row.reverts), banned: row.banned !== false,
    payerSendsLastHour: Number(row.payer_sends), merchantSendsLastHour: Number(row.merchant_sends),
  };
}

/** Relay gas spent today (UTC) by this relayer, every instance included. */
export async function spentToday(relayer: string): Promise<bigint> {
  const [row] = await run(`SELECT coalesce(sum(fee_wei), 0)::text AS spent FROM rel_sent WHERE relayer = $1 AND sent_at >= ${UTC_DAY_START_MS}`,
    [lc(relayer)]);
  return BigInt(String(row.spent));
}

/** Takes the send lock if it is free or expired (one atomic upsert); false while another holder's lease is live. */
export async function acquire(relayer: string, holder: string): Promise<boolean> {
  const rows = await run(`
    INSERT INTO rel_lock (relayer, holder, until_ms) VALUES ($1, $2, ${NOW_MS} + ${LEASE_MS})
    ON CONFLICT (relayer) DO UPDATE SET holder = EXCLUDED.holder, until_ms = EXCLUDED.until_ms WHERE rel_lock.until_ms <= ${NOW_MS}
    RETURNING holder`, [lc(relayer), holder]);
  return rows.length === 1;
}

/** Frees the lock if this holder still has it. */
export async function release(relayer: string, holder: string): Promise<void> {
  await run('UPDATE rel_lock SET holder = NULL, until_ms = 0 WHERE relayer = $1 AND holder = $2', [lc(relayer), holder]);
}

export interface Reservation { relayer: string; holder: string; key: string; payer: string; merchant?: string; txHash: string; feeWei: bigint }

/**
 * Right before a broadcast, in one statement: renew the lease (fencing: only if this holder still has it) and write the
 * send with its worst-case fee. 'lost' = another instance took the lock; 'replay' = this authorization was already sent.
 */
export async function reserve(r: Reservation): Promise<'ok' | 'lost' | 'replay'> {
  const [row] = await run(`
    WITH lease AS (
      UPDATE rel_lock SET until_ms = ${NOW_MS} + ${LEASE_MS} WHERE relayer = $1 AND holder = $2 AND until_ms > ${NOW_MS} RETURNING 1
    ), sent AS (
      INSERT INTO rel_sent (auth_key, relayer, payer, merchant, tx_hash, fee_wei, sent_at)
      SELECT $3::text, $1::text, $4::text, $5::text, $6::text, $7::bigint, ${NOW_MS} FROM lease
      ON CONFLICT (auth_key) DO NOTHING RETURNING 1
    )
    SELECT (SELECT count(*) FROM lease)::int AS leased, (SELECT count(*) FROM sent)::int AS inserted`,
  [lc(r.relayer), r.holder, r.key, lc(r.payer), r.merchant ? lc(r.merchant) : null, r.txHash, String(r.feeWei)]);
  if (Number(row.leased) !== 1) return 'lost';
  return Number(row.inserted) === 1 ? 'ok' : 'replay';
}

/** After the receipt: the real fee (gasUsed × price + L1 fee) and whether it reverted. */
export async function settle(key: string, feeWei: bigint, reverted: boolean): Promise<void> {
  await run('UPDATE rel_sent SET fee_wei = $2, reverted = $3 WHERE auth_key = $1', [key, String(feeWei), reverted]);
}
