// Batch 031: a real Postgres in-process (PGlite) with every apps/relayer/db/NNN_*.sql applied, the way db/migrate.ts
// applies them to Neon (same split). Not a test file itself (no .test. in the name).
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { isRoleFile, isSchemaFile, sqlStatements } from '../db/statements.ts';
import { setTestDb, type Db, type Row } from '../src/db.ts';

/** The Db adapter over one PGlite: every relayer module instance in a test process shares it, as instances share Neon. */
export const pgDb = (pg: PGlite): Db => ({ query: async (text, params) => (await pg.query<Row>(text, params)).rows });

/** Every schema file (db/NNN_*.sql except the owner-run *_role*.sql) in name order, one statement at a time (as db/migrate.ts does on Neon). */
export async function applySchema(pg: PGlite): Promise<void> {
  const dir = new URL('../db/', import.meta.url);
  for (const file of readdirSync(dir).filter(isSchemaFile).sort()) {
    for (const statement of sqlStatements(readFileSync(new URL(file, dir), 'utf8'))) await pg.query(statement);
  }
}

/** One PGlite per test file (startup is slow), schema applied, routed to by src/db.ts. */
export async function setupDb(): Promise<PGlite> {
  const pg = new PGlite();
  await applySchema(pg);
  setTestDb(pgDb(pg));
  return pg;
}

/** The owner-run role files too (batch 049): PGlite runs each whole file (002 has a DO block), after the schema. */
export async function applyRoles(pg: PGlite): Promise<void> {
  const dir = new URL('../db/', import.meta.url);
  for (const file of readdirSync(dir).filter(isRoleFile).sort()) await pg.exec(readFileSync(new URL(file, dir), 'utf8'));
}
