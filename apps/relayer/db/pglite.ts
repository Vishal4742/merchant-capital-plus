// Tests and the local dev server only (PGlite is a devDependency; nothing under api/ imports this): an in-process
// Postgres with the production schema, so the SQL under test is the SQL that ships.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Row } from '../src/store.ts';

export async function memoryDb(files = ['001_rel.sql']): Promise<Db> {
  const pg = new PGlite();
  for (const file of files) await pg.exec(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
  return { query: async (text, params = []) => (await pg.query<Row>(text, params)).rows };
}
