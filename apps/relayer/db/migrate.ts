// Applies every apps/relayer/db/NNN_*.sql to the relayer's Postgres (Neon), in name order (batch 031). The files are
// idempotent (CREATE ... IF NOT EXISTS), so re-running is safe. Run it before deploying a relayer that needs the tables:
// the relayer refuses every /relay (503) while they are missing.
// Run from apps/relayer: npm run db:migrate   (reads DATABASE_URL from ../../.env; prints table names only, never the URL)
// A failure prints the file, the statement number and errorLabel() only (SQLSTATE or class name): the Neon driver's own
// messages can hold the whole connection string, password included (round 2, R2-1). Exit code 1.
import { readdirSync, readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { errorLabel } from '../src/db.ts';
import { sqlStatements } from './statements.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
let step = 'connecting';
try {
  const sql = neon(url);
  const dir = new URL('.', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()) {
    const statements = sqlStatements(readFileSync(new URL(file, dir), 'utf8'));
    for (const [i, statement] of statements.entries()) {
      step = `${file} statement ${i + 1}`;
      await sql.query(statement);
    }
    console.log(`applied ${file} (${statements.length} statements)`);
  }
  step = 'listing tables';
  const tables = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'rel\\_%' ORDER BY 1");
  console.log('rel tables:', tables.map((t) => t.table_name).join(', '));
} catch (e) {
  console.error(`migration failed: ${step}: ${errorLabel(e)}`);
  process.exit(1);
}
