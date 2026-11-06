// Tests and the local dev server only (PGlite is a devDependency; nothing under api/ imports this): an in-process
// Postgres with the production schema, so the SQL under test is the SQL that ships.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Row } from '../src/store.ts';

export async function memoryDb(): Promise<Db & { pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(readFileSync(new URL('./001_rel.sql', import.meta.url), 'utf8'));
  return { pg, query: async (text, params = []) => (await pg.query<Row>(text, params)).rows };
}
