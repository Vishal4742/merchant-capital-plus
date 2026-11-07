// Batch 058: the staging database guard refuses anything that looks like a real database. Real SQL on PGlite. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { decide, guard } from "../db/staging-guard.mjs";

const runner = (pg) => ({ query: async (text, params) => (await pg.query(text, params)).rows });

test("an empty database is claimed for staging and then recognised", async () => {
  const pg = new PGlite();
  const first = await guard(runner(pg));
  assert.deepEqual([first.ok, first.claim], [true, true]);
  const again = await guard(runner(pg));
  assert.deepEqual([again.ok, again.claim], [true, false]);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM app_staging_marker")).rows[0].n, 1, "one marker, however often it runs");
});

test("a database with gateway tables and no marker is refused and left untouched", async () => {
  const pg = new PGlite();
  await pg.exec("CREATE TABLE app_gw_keys (id TEXT PRIMARY KEY)");
  const verdict = await guard(runner(pg));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /real database/);
  const tables = (await pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name);
  assert.deepEqual(tables, ["app_gw_keys"], "no marker was written into the refused database");
});

test("every kind of existing gateway state counts as real", () => {
  for (const table of ["app_gw_keys", "app_gw_links", "app_web_sessions", "relayer_state"]) assert.equal(decide([table]).ok, false, table);
  assert.equal(decide(["app_gw_keys", "app_staging_marker"]).ok, true);
  assert.equal(decide([]).ok, true);
});
