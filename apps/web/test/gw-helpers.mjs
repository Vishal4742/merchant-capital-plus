// Shared setup for the gateway API tests (batch 007): a real Postgres in-process (PGlite) with every db/NNN_*.sql
// applied, a signed-in merchant cookie, and a Request builder. Not a test file itself (no .test. in the name).
import { after } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sqlStatements } from "../db/statements.mjs";

export const AUTH_SECRET = "gw-test-auth-secret-0123456789abcdef";
process.env.AUTH_SECRET = AUTH_SECRET;

const { query, setTestDb } = await import("../lib/server/db.ts");
const { SESSION_COOKIE, signSession } = await import("../lib/auth.ts");
const { resetRateLimits } = await import("../lib/server/http.ts");
const { resetRateCache } = await import("../lib/server/quotes.ts");

export const MERCHANT = "0x1111111111111111111111111111111111111111";
export const OTHER_MERCHANT = "0x2222222222222222222222222222222222222222";

// Batch 031 round 4 (A11): production webhooks resolve with c-ares and POST over a socket pinned to the vetted address.
// The gateway tests keep mocking dns.lookup and globalThis.fetch, so route the webhook network layer through those mocks
// (looked up at call time). Installed from setupDb(), i.e. after each test file has registered its module mocks (a
// static import here would load webhooks.ts before a file's mock.module("next/server.js") and bind the real after()).
// Files that mock webhooks.ts entirely get no setWebhookNet and skip this. test/gw-isolation.test.mjs tests the real layer.
async function installTestWebhookNet() {
  const webhooks = await import("../lib/server/webhooks.ts");
  if (typeof webhooks.setWebhookNet !== "function") return;
  const dns = (await import("node:dns/promises")).default;
  webhooks.setWebhookNet({
    resolve: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
    post: async (url, _address, headers, body, timeoutMs) => {
      const res = await globalThis.fetch(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      await res.body?.cancel().catch(() => {});
      return res.status;
    },
  });
}

let pg;
// Close the file's PGlite when its tests are done (batch 031 round 4). The embedded Postgres keeps internal timers; when a
// test mocks Date and advances it (the rate-limit tests move it by a whole window), PGlite can arm a timer of up to an
// hour from the skewed clock, and an open instance then keeps the process alive after every test passed. Teardown, not
// a forced exit: closing the database stops its timers.
after(async () => {
  if (pg && !pg.closed) await pg.close();
});
/** One PGlite per test file (startup is slow); call resetDb() in beforeEach to empty the app_gw_* and app_web_* tables. */
export async function setupDb() {
  await installTestWebhookNet();
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
  const { rows } = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'app_gw_%' OR table_name LIKE 'app_web_%' OR table_name LIKE 'wf_%'");
  if (rows.length) await pg.exec(`TRUNCATE ${rows.map((r) => r.table_name).join(", ")} CASCADE`);
  resetRateLimits(); // the in-memory limiter would otherwise carry counts from one test into the next
  resetRateCache(); // and the FX cache would serve one test's mocked rates to the next
}

/** The checkout store is the database (batch 023): end a stored checkout at `at` (default: just now). */
export const expireSession = (id, at = Date.now() - 1) => query("UPDATE app_web_sessions SET expires_at = $2 WHERE id = $1", [id, at]);

/** Sets a checkout's pending attempt's validBefore (default 0: long past, so USDT can no longer settle it). */
export const agePending = (id, validBefore = 0n) => query("UPDATE app_web_sessions SET pending = jsonb_set(pending, '{validBefore}', to_jsonb($2::text)) WHERE id = $1", [id, validBefore.toString()]);

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
