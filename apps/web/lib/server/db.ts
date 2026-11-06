// Server-only Postgres for the gateway API (ARCHITECTURE §4b: the app_gw_* tables). Production uses Neon's HTTP
// driver; tests swap in PGlite (real Postgres in-process) with setTestDb(), so the SQL under test is the SQL that ships.
// House rules so both drivers return the same JS values: times are BIGINT unix ms, money is BIGINT USDT units, and
// every BIGINT is selected as ::text and read back with BigInt() or Number().
import { neon } from "@neondatabase/serverless";

export type Row = Record<string, unknown>;
export interface Statement {
  text: string;
  params?: unknown[];
}
export interface Db {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  /** The statements in order, in one READ COMMITTED transaction: all or nothing; each sees what the earlier ones did. */
  transaction(statements: Statement[]): Promise<Row[][]>;
}

/** DATABASE_URL is missing: the gateway API answers 503 instead of failing somewhere deeper. */
export class DbUnavailable extends Error {
  constructor() {
    super("The gateway database isn't configured.");
  }
}

let current: Db | undefined;

/** Tests only: route every query to this client (PGlite); undefined goes back to Neon. */
export function setTestDb(db: Db | undefined): void {
  current = db;
}

function db(): Db {
  if (current) return current;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbUnavailable();
  const sql = neon(url);
  current = {
    query: (text, params = []) => sql.query(text, params) as Promise<Row[]>,
    // pinned, not left to the server default: the voucher hold count relies on a fresh snapshot per statement (R2-L1)
    transaction: (statements) =>
      sql.transaction((txn) => statements.map((s) => txn.query(s.text, s.params ?? [])), { isolationLevel: "ReadCommitted" }) as Promise<Row[][]>,
  };
  return current;
}

export async function query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query(text, params)) as T[];
}

export async function transaction(statements: Statement[]): Promise<Row[][]> {
  return db().transaction(statements);
}
