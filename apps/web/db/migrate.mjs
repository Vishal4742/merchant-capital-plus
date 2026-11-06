// Applies every apps/web/db/NNN_*.sql to the Neon database, in name order (batch 007, ARCHITECTURE §4b).
// The files are idempotent (CREATE ... IF NOT EXISTS), so re-running is safe. Statements are split on ";" at a line end
// because Neon's HTTP driver runs one statement per call; keep the SQL free of functions and DO blocks.
// Run from apps/web: node --env-file=../../.env db/migrate.mjs   (prints table names only, never the URL)
import { readdirSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { sqlStatements } from "./statements.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
const dir = new URL(".", import.meta.url);
const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
for (const file of files) {
  const statements = sqlStatements(readFileSync(new URL(file, dir), "utf8"));
  for (const statement of statements) await sql.query(statement);
  console.log(`applied ${file} (${statements.length} statements)`);
}
const tables = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'app_gw_%' ORDER BY 1");
console.log("app_gw tables:", tables.map((t) => t.table_name).join(", "));
