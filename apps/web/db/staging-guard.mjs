// Refuses to let the staging workflow migrate any database that isn't an isolated staging one (batch 058).
//
// The migration runner (migrate.mjs) applies every db/NNN_*.sql to whatever DATABASE_URL it is given. Staging must never be
// pointed at the shared or production database, so before migrating we look at the database itself:
//   - it must be reachable;
//   - if it already holds gateway tables (app_gw_keys) it must also hold the staging marker (app_staging_marker), which only
//     this guard creates: a database with real tables and no marker is somebody's real data, so we stop;
//   - an empty database (no gateway tables) is claimed for staging by creating the marker.
// Prints verdicts and table names only, never the URL. Exit 0 = safe to migrate, 1 = refuse.
import { neon } from "@neondatabase/serverless";

/** The decision, separated from I/O so it is tested without a network: given the table names present, what to do. */
export function decide(tables) {
  const has = (name) => tables.includes(name);
  if (has("app_staging_marker")) return { ok: true, claim: false, reason: "marked as a staging database" };
  if (has("app_gw_keys") || has("app_gw_links") || has("app_web_sessions") || has("relayer_state")) {
    return { ok: false, claim: false, reason: "holds gateway tables but no staging marker: this looks like a real database" };
  }
  return { ok: true, claim: true, reason: "empty database: claiming it for staging" };
}

export async function guard(sql) {
  const rows = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const verdict = decide(rows.map((r) => r.table_name));
  if (verdict.ok && verdict.claim) {
    await sql.query("CREATE TABLE IF NOT EXISTS app_staging_marker (marked_at BIGINT NOT NULL)");
    await sql.query("INSERT INTO app_staging_marker (marked_at) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM app_staging_marker)", [Date.now()]);
  }
  return verdict;
}

if (process.argv[1] && /staging-guard\.mjs$/.test(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("staging-guard: DATABASE_URL is not set");
    process.exit(1);
  }
  try {
    const verdict = await guard(neon(url));
    console.log(`staging-guard: ${verdict.ok ? "OK" : "REFUSED"}: ${verdict.reason}`);
    process.exit(verdict.ok ? 0 : 1);
  } catch (error) {
    console.error(`staging-guard: could not inspect the database (${error instanceof Error ? error.name : "error"})`);
    process.exit(1);
  }
}
