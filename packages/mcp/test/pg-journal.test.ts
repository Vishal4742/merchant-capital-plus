// Batch 058 phase B (FR-MCP-1..3; SRS-CHANGE FR-MCP-18 proposed): the remote endpoint's durable, tenant-scoped journal on
// Postgres (PGlite here: real Postgres in-process, with the migration the owner would apply). Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { JournalRefusal } from "../src/journal.ts";
import { PgJournal, type SqlRunner } from "../src/journal-pg.ts";
import { NOW } from "./helpers.ts";

const MIGRATION = readFileSync(new URL("../../../apps/web/db/051_mcp_remote.sql", import.meta.url), "utf8");
const PAYLOAD = { amount: "25.00", currency: "USDT", description: "Beans" };
const HOUR = 60 * 60_000;

async function database() {
  const db = new PGlite();
  await db.exec(MIGRATION);
  const sql: SqlRunner = { query: async (text, params) => (await db.query(text, params as unknown[])).rows as Record<string, unknown>[] };
  return { db, sql };
}

test("a claim is stored in Postgres and survives a restart: a new journal instance resumes the same key", async () => {
  const { sql } = await database();
  const first = await new PgJournal(sql, () => NOW).claim("scope-a", "create_payment_link", PAYLOAD);
  assert.match(first.key, /^wfmcp_/);
  const afterRestart = new PgJournal(sql, () => NOW + 5 * 60_000); // nothing in memory
  const again = await afterRestart.claim("scope-a", "create_payment_link", PAYLOAD);
  assert.deepEqual([again.key, again.source], [first.key, "resumed"]);
});

test("20 concurrent identical creates, on separate journal instances (separate serverless instances), yield one key and one entry", async () => {
  const { sql, db } = await database();
  const claims = await Promise.all(Array.from({ length: 20 }, () => new PgJournal(sql, () => NOW).claim("scope-a", "create_payment_link", PAYLOAD)));
  assert.equal(new Set(claims.map((c) => c.key)).size, 1);
  assert.equal(claims.filter((c) => c.source === "new").length, 1, "exactly one request minted the key; the rest resumed it");
  const rows = (await db.query("SELECT jsonb_array_length(entries) AS n FROM app_mcp_journal WHERE scope = 'scope-a'")).rows as { n: number }[];
  assert.equal(rows[0].n, 1);
});

test("concurrent creates with different explicit keys for the same request: one wins, the others are refused (no duplicates)", async () => {
  const { sql } = await database();
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => new PgJournal(sql, () => NOW).claim("scope-a", "create_payment_link", PAYLOAD, { callerKey: `order-9999-key${i}` })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof JournalRefusal);
});

test("tenants are isolated: another merchant's scope never sees or blocks these entries", async () => {
  const { sql } = await database();
  const journal = new PgJournal(sql, () => NOW);
  const a = await journal.claim("scope-a", "create_payment_link", PAYLOAD, { callerKey: "order-0001-aaaa" });
  const b = await journal.claim("scope-b", "create_payment_link", PAYLOAD, { callerKey: "order-0001-bbbb" });
  assert.notEqual(a.key, b.key);
  assert.deepEqual((await journal.unresolved("scope-a")).map((e) => e.key), ["order-0001-aaaa"]);
  assert.deepEqual((await journal.unresolved("scope-b")).map((e) => e.key), ["order-0001-bbbb"]);
  assert.equal(await journal.find("scope-a", "order-0001-bbbb"), undefined, "scope-a can't find scope-b's key");
});

test("the same guards as the file journal: needs-reconciliation blocks an explicit key; an old unresolved write is flagged, not re-sent", async () => {
  const { sql } = await database();
  const clock = { now: NOW };
  const journal = new PgJournal(sql, () => clock.now);
  const claim = await journal.claim("scope-a", "create_payment_link", PAYLOAD, { callerKey: "order-0002-aaaa" });
  await journal.settle("scope-a", claim.key, "needs_reconciliation", "reply didn't match");
  await assert.rejects(journal.claim("scope-a", "create_payment_link", PAYLOAD, { callerKey: "order-0002-aaaa" }), JournalRefusal);

  await journal.claim("scope-a", "create_payment_link", { ...PAYLOAD, amount: "30.00" }, { callerKey: "order-0003-aaaa" });
  clock.now += 24 * HOUR;
  await assert.rejects(journal.claim("scope-a", "create_payment_link", { ...PAYLOAD, amount: "30.00" }, { callerKey: "order-0003-aaaa" }), /no longer keeps its key/);
  assert.equal((await journal.find("scope-a", "order-0003-aaaa"))?.outcome, "needs_reconciliation");
});

test("settle persists across instances, and a done write replays inside the window", async () => {
  const { sql } = await database();
  const first = await new PgJournal(sql, () => NOW).claim("scope-a", "create_payment_link", PAYLOAD);
  await new PgJournal(sql, () => NOW).settle("scope-a", first.key, "done");
  assert.deepEqual((await new PgJournal(sql, () => NOW).unresolved("scope-a")).length, 0);
  const repeat = await new PgJournal(sql, () => NOW + 60_000).claim("scope-a", "create_payment_link", PAYLOAD);
  assert.deepEqual([repeat.key, repeat.source], [first.key, "replay"]);
});
