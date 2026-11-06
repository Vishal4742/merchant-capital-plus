// Shared setup for the gateway API tests (batch 007): a real Postgres in-process (PGlite) with every db/NNN_*.sql
// applied, a signed-in merchant cookie, and a Request builder. Not a test file itself (no .test. in the name).
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sqlStatements } from "../db/statements.mjs";

export const AUTH_SECRET = "gw-test-auth-secret-0123456789abcdef";
process.env.AUTH_SECRET = AUTH_SECRET;

const { setTestDb } = await import("../lib/server/db.ts");
const { SESSION_COOKIE, signSession } = await import("../lib/auth.ts");
const { resetRateLimits } = await import("../lib/server/http.ts");

export const MERCHANT = "0x1111111111111111111111111111111111111111";
export const OTHER_MERCHANT = "0x2222222222222222222222222222222222222222";

let pg;
/** One PGlite per test file (startup is slow); call resetDb() in beforeEach to empty the app_gw_* tables. */
export async function setupDb() {
  pg = new PGlite();
  const dir = new URL("../db/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()) {
    // one statement at a time with the same split db/migrate.mjs uses on Neon, so the split is tested too
    for (const statement of sqlStatements(readFileSync(new URL(file, dir), "utf8"))) await pg.query(statement);
  }
  setTestDb({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (statements) =>
      pg.transaction(async (tx) => {
        const results = [];
        for (const s of statements) results.push((await tx.query(s.text, s.params ?? [])).rows);
        return results;
      }),
  });
  return pg;
}

export async function resetDb() {
  const { rows } = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'app_gw_%'");
  if (rows.length) await pg.exec(`TRUNCATE ${rows.map((r) => r.table_name).join(", ")} CASCADE`);
  resetRateLimits(); // the in-memory limiter would otherwise carry counts from one test into the next
}

/** Cookie header for a merchant signed in to the dashboard. */
export const signedIn = (merchant = MERCHANT) => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(signSession(merchant, AUTH_SECRET))}` });

/** A Request for a route handler: req("POST", "/api/v1/links", { body: {...}, headers: signedIn() }). */
export function req(method, path, { body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  return new Request(`http://localhost${path}`, init);
}

/** Next 16 passes dynamic route params as a promise. */
export const params = (p) => ({ params: Promise.resolve(p) });
