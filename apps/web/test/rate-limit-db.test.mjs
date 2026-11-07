// Batch 031-PW4 Part C (FR-REL-5, FR-REL-10 theme; owner: "restart preserves … rate-limit state"): the web app's
// request limits live in Postgres (db/052, app_web_rate_limits), so every Vercel instance counts against one window and
// a restart doesn't reset it. A second "instance" is the same module imported under another URL (?instance=2): its own
// in-memory state, the same database. Payment and money-adjacent routes fail closed (503, one fixed message) when the
// store is down; public capital reads fall back to the instance's in-memory window. Real SQL on PGlite.
// Run from apps/web: node --experimental-test-module-mocks --test test/rate-limit-db.test.mjs
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupDb, resetDb } from "./gw-helpers.mjs";
import { sqlStatements } from "../db/statements.mjs";

process.env.MERCHANT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "rl-test-shop-key-0123456789abcdef";
delete process.env.DATABASE_URL; // "not configured" must mean DbUnavailable, never a real server

const one = await import("../lib/server/http.ts");
const two = await import("../lib/server/http.ts?instance=2");
const { query, setTestDb } = await import("../lib/server/db.ts");
const fund = (await import("../app/api/v1/capital/fund/route.ts")).POST;
const sessions = (await import("../app/api/v1/sessions/route.ts")).POST;
const demo = (await import("../app/api/demo-checkout/route.ts")).POST;
const capitalQuote = (await import("../app/api/v1/capital/quote/route.ts")).GET;
const { payLink } = await import("../lib/server/links.ts");

const MIN = 60_000;
const T0 = 1_800_000_000_000; // a fixed clock for the window tests
let pg;
const adapter = (client) => ({
  query: async (text, params) => (await client.query(text, params)).rows,
  transaction: (statements) =>
    client.transaction(async (tx) => {
      const out = [];
      for (const s of statements) out.push((await tx.query(s.text, s.params ?? [])).rows);
      return out;
    }),
});
const SECRET_IN_ERROR = "connect ECONNREFUSED postgres://app:hunter2@db.internal:5432/web";
const downDb = {
  query: async () => {
    throw new Error(SECRET_IN_ERROR);
  },
  transaction: async () => {
    throw new Error(SECRET_IN_ERROR);
  },
};
/** Runs `body` with the database down (`how`: "unreachable" or "unconfigured"), then puts PGlite back. */
async function withDbDown(how, body) {
  setTestDb(how === "unreachable" ? downDb : undefined);
  try {
    return await body();
  } finally {
    setTestDb(adapter(pg));
  }
}
const statusOf = (promise) => promise.then(() => "ok", (err) => err.status);
const rows = (key) => query("SELECT key, count::text AS count, reset_at::text AS reset_at FROM app_web_rate_limits WHERE key = $1", [key]);
const ipReq = (path, ip, init = {}) => new Request(`http://localhost${path}`, { ...init, headers: { "x-forwarded-for": ip, ...(init.headers ?? {}) } });

before(async () => {
  pg = await setupDb();
});
beforeEach(async () => {
  await resetDb();
  one.resetRateLimits();
  two.resetRateLimits();
});

test("db/052 is idempotent, splitter-safe and app_web_-prefixed (resetDb truncates it)", async () => {
  const [file] = readdirSync(new URL("../db/", import.meta.url)).filter((f) => /^052_.+\.sql$/.test(f));
  assert.ok(file, "a db/052_*.sql migration exists");
  const text = readFileSync(new URL(`../db/${file}`, import.meta.url), "utf8");
  const statements = sqlStatements(text);
  for (const s of statements) {
    assert.doesNotMatch(s, /\bDO\s+\$|\bFUNCTION\b/i, "no DO blocks or functions (db/statements.mjs splitter)");
    assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, "additive and idempotent only");
  }
  for (let run = 0; run < 2; run++) for (const s of statements) await pg.query(s); // re-run safe
  const cols = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'app_web_rate_limits' ORDER BY column_name");
  assert.deepEqual(cols.map((c) => [c.column_name, c.data_type]), [["count", "bigint"], ["key", "text"], ["reset_at", "bigint"]]);
  await one.sharedRateLimit("probe:1", 5, MIN, "closed", T0);
  await resetDb();
  assert.equal((await rows("probe:1")).length, 0, "the test reset empties it");
});

test("one window across two instances: `limit` calls pass in total, the next is 429 on either instance", async () => {
  for (let i = 0; i < 6; i++) await (i % 2 ? two : one).sharedRateLimit("quotes:198.51.100.9", 6, MIN, "closed", T0 + i);
  for (const inst of [one, two]) {
    const err = await inst.sharedRateLimit("quotes:198.51.100.9", 6, MIN, "closed", T0 + 10).then(() => null, (e) => e);
    assert.equal(err?.status, 429);
    assert.equal(err.message, "Too many requests. Wait a minute and try again.", "the message callers already show is unchanged");
  }
  assert.equal(await statusOf(one.sharedRateLimit("quotes:198.51.100.10", 6, MIN, "closed", T0)), "ok", "another key has its own window");
});

test("a restart keeps the count: a fresh instance (and a cleared memory) still sees the used window", async () => {
  for (let i = 0; i < 4; i++) await one.sharedRateLimit("capital-fund:203.0.113.7", 5, MIN, "closed", T0);
  one.resetRateLimits(); // what a process restart does to the old in-memory limiter
  const restarted = await import("../lib/server/http.ts?instance=restarted");
  assert.equal(await statusOf(restarted.sharedRateLimit("capital-fund:203.0.113.7", 5, MIN, "closed", T0 + 1)), "ok", "5th of 5");
  assert.equal(await statusOf(restarted.sharedRateLimit("capital-fund:203.0.113.7", 5, MIN, "closed", T0 + 2)), 429, "6th refused after the restart");
});

test("concurrent calls from two instances: exactly `limit` pass, every call is counted once", async () => {
  const key = "sessions:0xabc";
  const calls = Array.from({ length: 15 }, () => [one, two]).flat().map((inst) => statusOf(inst.sharedRateLimit(key, 10, MIN, "closed", T0)));
  const statuses = await Promise.all(calls);
  assert.deepEqual([statuses.filter((s) => s === "ok").length, statuses.filter((s) => s === 429).length], [10, 20]);
  assert.equal((await rows(key))[0].count, "30");
});

test("the window is fixed from the first call: still 429 at windowMs - 1, open again at windowMs with a fresh count", async () => {
  const key = "voucher:203.0.113.7:sess_1";
  for (let i = 0; i < 3; i++) await one.sharedRateLimit(key, 3, MIN, "closed", T0);
  assert.equal(await statusOf(two.sharedRateLimit(key, 3, MIN, "closed", T0 + MIN - 1)), 429);
  assert.equal(await statusOf(two.sharedRateLimit(key, 3, MIN, "closed", T0 + MIN)), "ok");
  assert.deepEqual(await rows(key), [{ key, count: "1", reset_at: String(T0 + 2 * MIN) }]);
});

test("counting is one atomic upsert per call (no read-then-write): every statement on the table is RATE_LIMIT_SQL", async () => {
  assert.match(one.RATE_LIMIT_SQL, /^INSERT INTO app_web_rate_limits[\s\S]+ON CONFLICT \(key\) DO UPDATE[\s\S]+RETURNING/);
  const seen = [];
  const base = adapter(pg);
  setTestDb({ ...base, query: (text, params) => (seen.push(text), base.query(text, params)) });
  try {
    for (let i = 0; i < 5; i++) await one.sharedRateLimit("refunds:0xabc", 30, MIN, "closed", T0);
  } finally {
    setTestDb(base);
  }
  const counting = seen.filter((t) => /app_web_rate_limits/.test(t) && !/^DELETE/.test(t));
  assert.equal(counting.length, 5);
  assert.ok(counting.every((t) => t === one.RATE_LIMIT_SQL), "never a SELECT then an UPDATE");
});

test("expired windows are pruned (only ones that ended over a minute ago), every PRUNE_EVERY calls per instance", async () => {
  await query("INSERT INTO app_web_rate_limits (key, count, reset_at) VALUES ('old:1', 9, $1), ('recent:1', 9, $2), ('live:1', 9, $3)", [T0 - 2 * MIN, T0 - 1, T0 + MIN]);
  await one.pruneRateLimits(T0);
  assert.deepEqual((await query("SELECT key FROM app_web_rate_limits ORDER BY key")).map((r) => r.key), ["live:1", "recent:1"]);
  await query("INSERT INTO app_web_rate_limits (key, count, reset_at) VALUES ('old:2', 9, $1)", [T0 - 2 * MIN]);
  const fresh = await import("../lib/server/http.ts?instance=prune");
  for (let i = 0; i < fresh.PRUNE_EVERY - 1; i++) await fresh.sharedRateLimit("checkout:1", 1e6, MIN, "closed", T0);
  assert.equal((await rows("old:2")).length, 1, "not before the PRUNE_EVERY-th call");
  await fresh.sharedRateLimit("checkout:1", 1e6, MIN, "closed", T0);
  assert.equal((await rows("old:2")).length, 0, "pruned on the PRUNE_EVERY-th call");
});

test("an over-long key (a huge x-forwarded-for) is stored hashed, still counted, and never errors", async () => {
  const long = (c) => `quotes:${c.repeat(5_000)}`;
  for (let i = 0; i < 2; i++) await one.sharedRateLimit(long("a"), 2, MIN, "closed", T0);
  assert.equal(await statusOf(two.sharedRateLimit(long("a"), 2, MIN, "closed", T0)), 429);
  assert.equal(await statusOf(one.sharedRateLimit(long("b"), 2, MIN, "closed", T0)), "ok", "a different long key is a different window");
  const keys = (await query("SELECT key FROM app_web_rate_limits")).map((r) => r.key);
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k) => /^sha256:[0-9a-f]{64}$/.test(k)), keys.join());
});

for (const how of ["unreachable", "unconfigured"]) {
  test(`fail closed when the database is ${how}: 503 with the one fixed message, logging no error text`, async (t) => {
    const logged = [];
    t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
    const err = await withDbDown(how, () => one.sharedRateLimit("capital-fund:203.0.113.7", 10, MIN, "closed", T0).then(() => null, (e) => e));
    assert.deepEqual([err?.status, err?.message], [503, one.RATE_LIMIT_DOWN]);
    assert.match(one.RATE_LIMIT_DOWN, /nothing was charged/i);
    assert.ok(!logged.some((l) => /hunter2|postgres:\/\/|ECONNREFUSED/.test(l)), `no connection text in logs: ${logged}`);
  });

  test(`"memory" mode with the database ${how}: falls back to this instance's window (same limit, then 429)`, async (t) => {
    t.mock.method(console, "error", () => {});
    await withDbDown(how, async () => {
      for (let i = 0; i < 3; i++) assert.equal(await statusOf(one.sharedRateLimit("capital-read:203.0.113.7", 3, MIN, "memory", T0)), "ok");
      assert.equal(await statusOf(one.sharedRateLimit("capital-read:203.0.113.7", 3, MIN, "memory", T0)), 429);
    });
  });
}

test("POST /api/v1/capital/fund: 10 a minute per IP survive a restart; with the store down it refuses before relaying", async (t) => {
  const call = () => fund(ipReq("/api/v1/capital/fund", "203.0.113.20", { method: "POST", body: "{}" }));
  for (let i = 0; i < 10; i++) assert.equal((await call()).status, 400, `call ${i + 1}: past the limit, refused by validation`);
  one.resetRateLimits(); // a restart: the old in-memory limiter would have let 10 more through
  assert.equal((await call()).status, 429);
  await resetDb();
  t.mock.method(console, "error", () => {});
  const res = await withDbDown("unreachable", call);
  assert.deepEqual([res.status, (await res.json()).error], [503, one.RATE_LIMIT_DOWN]);
});

test("POST /api/v1/sessions with the store down: 503 with the fixed message, not the 429 'too many checkouts' copy", async (t) => {
  t.mock.method(console, "error", () => {});
  const res = await withDbDown("unreachable", () =>
    sessions(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" }, body: '{"amount":"5.00"}' })),
  );
  assert.deepEqual([res.status, (await res.json()).error], [503, one.RATE_LIMIT_DOWN]);
});

test("POST /api/demo-checkout with the store down: a plain 503 with the fixed message", async (t) => {
  t.mock.method(console, "error", () => {});
  const res = await withDbDown("unreachable", () => demo(ipReq("/api/demo-checkout", "203.0.113.30", { method: "POST" })));
  assert.deepEqual([res.status, await res.text()], [503, one.RATE_LIMIT_DOWN]);
});

test("public link checkouts (lib/server/links.ts): 20 a minute per IP shared across a restart; fail closed", async (t) => {
  const call = () => payLink(ipReq("/api/v1/public/links/nope/checkout", "203.0.113.40", { method: "POST" }), "nope").then(() => "ok", (e) => e.status);
  for (let i = 0; i < 20; i++) assert.equal(await call(), 404, `call ${i + 1}`);
  one.resetRateLimits();
  assert.equal(await call(), 429);
  await resetDb();
  t.mock.method(console, "error", () => {});
  assert.equal(await withDbDown("unreachable", call), 503);
});

test("GET /api/v1/capital/quote: shared across instances when the DB is up; per-instance memory when it is down", async (t) => {
  const call = (ip) => capitalQuote(ipReq("/api/v1/capital/quote", ip)).then((r) => r.status);
  for (let i = 0; i < 60; i++) assert.equal(await call("198.51.100.50"), 400);
  one.resetRateLimits();
  assert.equal(await call("198.51.100.50"), 429, "the DB window outlives the memory");
  t.mock.method(console, "error", () => {});
  await withDbDown("unconfigured", async () => {
    for (let i = 0; i < 60; i++) assert.equal(await call("198.51.100.51"), 400, "reads stay up without the database");
    assert.equal(await call("198.51.100.51"), 429, "and still limited per instance");
  });
});

// Every limit an API route (or the link/page checkout helper) applies goes through the shared limiter with its fail
// behaviour stated, and the limit values are the ones documented before this batch.
const EXPECTED = {
  "app/api/demo-checkout/route.ts": [["closed", "DEMO_LIMIT", "MINUTE_MS"]],
  "app/api/v1/capital/fund/route.ts": [["closed", "10", "60_000"]],
  "app/api/v1/capital/merchant/route.ts": [["memory", "30", "60_000"]],
  "app/api/v1/capital/offers/route.ts": [["memory", "60", "60_000"]],
  "app/api/v1/capital/offers/[id]/publish/route.ts": [["closed", "20", "60_000"]],
  "app/api/v1/capital/quote/route.ts": [["memory", "60", "60_000"]],
  "app/api/v1/capital/transfer-check/route.ts": [["memory", "60", "60_000"]],
  "app/api/v1/invoices/[id]/acknowledge/route.ts": [["closed", "ACKS_PER_MINUTE", "60_000"]], // main's 047 debtor ack: a DB write
  "app/api/v1/invoices/[id]/funds/route.ts": [["memory", "CHECKS_PER_MINUTE", "60_000"]], // batch 049: main's 032-P5 balance checks
  "app/api/v1/links/route.ts": [["closed", "LINKS_PER_MINUTE", "60_000"]], // main's 054 secret-key links: a write
  "app/api/v1/payments/[id]/refunds/sync/route.ts": [["closed", "SYNCS_PER_MINUTE", "60_000"]],
  "app/api/v1/quotes/route.ts": [["closed", "30", "60_000"]],
  "app/api/v1/reports/route.ts": [["memory", "30", "60_000"]], // main's 054 review M1: a read, Blockscout not the DB
  "app/api/v1/sessions/route.ts": [["closed", "SESSIONS_PER_MINUTE", "60_000"]],
  "app/api/v1/sessions/[id]/funds/route.ts": [["memory", "CHECKS_PER_MINUTE", "60_000"]],
  "app/api/v1/sessions/[id]/voucher/route.ts": [["closed", "CHANGES_PER_MINUTE", "60_000"]],
  "app/api/v1/vouchers/route.ts": [["closed", "30", "60 * 60_000"]],
  "app/api/v1/vouchers/[id]/publish/route.ts": [["closed", "30", "60 * 60_000"]],
  "app/api/v1/webhooks/deliveries/[id]/replay/route.ts": [["closed", "20", "60_000"]],
  "app/api/v1/webhooks/[id]/test/route.ts": [["closed", "20", "60_000"]],
  "lib/server/links.ts": [["closed", "CHECKOUTS_PER_MINUTE", "60_000"]],
};
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(`${dir}/${f}`).isDirectory() ? walk(`${dir}/${f}`) : [`${dir}/${f}`]));

test("every route limit uses the shared limiter, states its fail mode, and keeps its value", () => {
  const web = fileURLToPath(new URL("..", import.meta.url)).replaceAll("\\", "/");
  const files = [...walk(`${web}app/api`), `${web}lib/server/links.ts`, `${web}lib/server/pages.ts`].filter((f) => /\.ts$/.test(f));
  const found = {};
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(web.length);
    assert.doesNotMatch(src, /(?<![\w.])rateLimit\(/, `${rel} still calls the per-instance rateLimit()`);
    const uses = [...src.matchAll(/sharedRateLimit\(\s*`[^`]*`\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*"(closed|memory)"\s*\)/g)].map((m) => [m[3], m[1], m[2]]);
    if (uses.length) found[rel] = uses;
    // awaited, or returned from an arrow (limitCheckouts) whose callers await it: an un-awaited call never limits
    for (const m of src.matchAll(/(\S+)\s+sharedRateLimit\(/g)) assert.match(m[1], /^(await|=>|return)$/, `${rel}: un-awaited sharedRateLimit`);
  }
  assert.deepEqual(found, EXPECTED);
  const pages = readFileSync(`${web}lib/server/pages.ts`, "utf8");
  const links = readFileSync(`${web}lib/server/links.ts`, "utf8");
  assert.equal((pages.match(/await limitCheckouts\(request\)/g) ?? []).length, 1, "payPage awaits the checkout limit");
  assert.equal((links.match(/await limitCheckouts\(request\)/g) ?? []).length, 1, "payLink awaits the checkout limit");
  assert.doesNotMatch(pages + links, /(?<!await )limitCheckouts\(request\)/, "no un-awaited limitCheckouts call");
});
