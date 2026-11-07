// Stage 2 production-adapter verification of the webhook outbox/lease and shared rate limits (batch 031), run by
// whiteflow-ef. Targets ONLY wf_s2_web (clean) and wf_s2_web_prev (previous schema), each checked with
// current_database() before any DDL; only app_gw_*/app_web_* tables inside those disposable databases are recreated.
// Reads only DATABASE_URL from the given .env (other secrets in that file are never loaded), never prints it, and hands
// the derived URL to child processes through their environment only. Children are released together by one GO.
// Run from the repo root: node tools/stage2/web-neon.mjs P:/Whiteflow/.env
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { neon } = require("@neondatabase/serverless");
const { sqlStatements } = await import("../../apps/web/db/statements.mjs");

const raw = parseEnv(readFileSync(process.argv[2] ?? "P:/Whiteflow/.env", "utf8")).DATABASE_URL;
if (!raw) {
  console.log("BLOCKED: DATABASE_URL missing");
  process.exit(2);
}
const urlFor = (db) => {
  const u = new URL(raw);
  u.pathname = `/${db}`;
  return u.toString();
};
const results = [];
const check = (name, ok, note) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n        ${note}`);
};
const id = (p) => `${p}_${randomBytes(6).toString("hex")}`;
const CHILD = fileURLToPath(new URL("./web-child.mjs", import.meta.url));
const DB_DIR = new URL("../../apps/web/db/", import.meta.url);
const files = readdirSync(DB_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();

async function target(db) {
  const sql = neon(urlFor(db));
  const [r] = await sql.query("SELECT current_database() AS db");
  if (r.db !== db) throw new Error(`target mismatch: connected to ${r.db}, expected ${db}`);
  return sql;
}
async function dropAppTables(sql) {
  const rows = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE 'app_gw_%' OR table_name LIKE 'app_web_%')");
  if (rows.length) await sql.query(`DROP TABLE IF EXISTS ${rows.map((r) => r.table_name).join(", ")} CASCADE`);
}
async function migrate(sql, list) {
  for (const f of list) for (const s of sqlStatements(readFileSync(new URL(f, DB_DIR), "utf8"))) await sql.query(s);
}
async function race(db, ops) {
  const kids = ops.map((op) => spawn(process.execPath, ["--disable-warning=ExperimentalWarning", CHILD], { env: { ...process.env, DATABASE_URL: urlFor(db), WF_OP: JSON.stringify(op) }, stdio: ["pipe", "pipe", "pipe"] }));
  const bufs = kids.map(() => ({ out: "" }));
  kids.forEach((k, i) => k.stdout.on("data", (d) => (bufs[i].out += d)));
  const exited = kids.map((k) => new Promise((r) => k.on("exit", r)));
  await Promise.all(
    kids.map(
      (k, i) =>
        new Promise((res, rej) => {
          const t = setInterval(() => {
            if (bufs[i].out.includes("READY")) {
              clearInterval(t);
              res();
            }
          }, 10);
          k.on("exit", (c) => {
            clearInterval(t);
            if (!bufs[i].out.includes("READY")) rej(new Error(`child exited ${c} before READY`));
          });
        }),
    ),
  );
  for (const k of kids) k.stdin.write("GO\n");
  await Promise.all(exited);
  return bufs.map((b) => JSON.parse(b.out.split("\n").filter((l) => l.startsWith("{")).pop() ?? '{"ok":false,"error":"no output"}'));
}

// ---- clean target
const db = await target("wf_s2_web");
await dropAppTables(db);
await migrate(db, files);
await migrate(db, files);
const leasedCol = (await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'app_gw_deliveries' AND column_name = 'leased_until'"))[0].n;
const rlTable = (await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'app_web_rate_limits'"))[0].n;
check(`clean schema: ${files.length} migrations applied twice`, leasedCol === 1 && rlTable === 1, `leased_until column=${leasedCol}; app_web_rate_limits=${rlTable}`);

const merchant = `0x${randomBytes(20).toString("hex")}`;
const hooks = [id("whk"), id("whk"), id("whk")];
for (const h of hooks) await db.query("INSERT INTO app_gw_webhooks (id, merchant, url, secret, created_at) VALUES ($1, $2, 'https://shop.example/h', 'whsec_test', 1)", [h, merchant]);
const T = 1_800_000_000_000;
const key = `paid:${id("sess")}`;
const evt = id("evt");
const enq = await race("wf_s2_web", Array.from({ length: 10 }, (_, i) => ({ sql: "SQL_ENQUEUE_ONCE", params: [key, T, evt, "payment.succeeded", `{"n":${i}}`, T + 60_000, merchant] })));
const markers = (await db.query("SELECT count(*)::int AS n FROM app_gw_events WHERE key = $1", [key]))[0].n;
const dels = await db.query("SELECT id FROM app_gw_deliveries WHERE event_id = $1 ORDER BY id", [evt]);
const queuedBy = enq.filter((r) => r.ok && r.rows.length > 0).length;
check("enqueue-once race: 10 processes, one key, 3 endpoints", enq.every((r) => r.ok) && markers === 1 && dels.length === 3 && queuedBy === 1, `markers=${markers} deliveries=${dels.length} processes that queued=${queuedBy}`);

const d = dels[0].id;
const claims = await race("wf_s2_web", Array.from({ length: 10 }, () => ({ sql: "SQL_CLAIM_LEASE", params: [d, T + 60_000, T] })));
const winners = claims.filter((r) => r.ok && r.rows.length === 1).length;
check("claim race: 10 processes, one delivery", winners === 1, `winners=${winners}`);

const take = await race("wf_s2_web", Array.from({ length: 6 }, () => ({ sql: "SQL_CLAIM_LEASE", params: [d, T + 121_000, T + 61_000] })));
const takers = take.filter((r) => r.ok && r.rows.length === 1).length;
check("lease expiry → reclaim: after the first lease ends, 6 processes race; exactly one takes over", takers === 1, `takers=${takers}`);

const [stale, fresh] = await race("wf_s2_web", [
  { sql: "SQL_OUTCOME", params: [d, 1, "failed", null, 500, T + 60_000] },
  { sql: "SQL_OUTCOME", params: [d, 1, "succeeded", null, 204, T + 121_000] },
]);
const final = (await db.query("SELECT status, response_status FROM app_gw_deliveries WHERE id = $1", [d]))[0];
check("fenced outcome after takeover: stale holder's update drops, new holder's stands", stale.rows.length === 0 && fresh.rows.length === 1 && final.status === "succeeded", `stale rows=${stale.rows.length} new rows=${fresh.rows.length} final=${final.status}/${final.response_status}`);

const A = id("whk");
const B = id("whk");
for (const h of [A, B]) await db.query("INSERT INTO app_gw_webhooks (id, merchant, url, secret, created_at) VALUES ($1, $2, 'https://shop.example/f', 'whsec_test', 1)", [h, merchant]);
for (let i = 0; i < 10; i++) await db.query("INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, 'payment.succeeded', '{}', 'pending', $5, $5)", [id("dlv"), A, merchant, id("evt"), T + i]);
await db.query("INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, 'payment.succeeded', '{}', 'pending', $5, $5)", [id("dlv"), B, merchant, id("evt"), T + 100]);
const disp = await race("wf_s2_web", Array.from({ length: 4 }, () => ({ sql: "SQL_DISPATCH_CLAIM", params: [T + 200_000, T + 260_000, 30, 3] })));
const claimed = disp.flatMap((r) => (r.ok ? r.rows.map((x) => x.id) : []));
const dup = claimed.length - new Set(claimed).size;
const owner = new Map((await db.query("SELECT id, webhook_id FROM app_gw_deliveries WHERE id = ANY($1)", [claimed])).map((r) => [r.id, r.webhook_id]));
let maxPerDestPerClaim = 0;
for (const r of disp) {
  const per = {};
  for (const x of r.rows ?? []) per[owner.get(x.id)] = (per[owner.get(x.id)] ?? 0) + 1;
  maxPerDestPerClaim = Math.max(maxPerDestPerClaim, ...Object.values(per), 0);
}
const aClaimed = claimed.filter((x) => owner.get(x) === A).length;
const bClaimed = claimed.filter((x) => owner.get(x) === B).length;
check("fair dispatch claim: 4 concurrent dispatchers, 10 due on A + 1 on B (+2 still due from earlier), cap 3", disp.every((r) => r.ok) && dup === 0 && bClaimed === 1 && maxPerDestPerClaim <= 3, `claimed=${claimed.length} duplicates=${dup} A=${aClaimed} B=${bClaimed} max per destination in any one claim=${maxPerDestPerClaim}`);

const rk = id("rl");
const counts = await race("wf_s2_web", Array.from({ length: 12 }, () => ({ sql: "RATE_LIMIT_SQL", params: [rk, T, 60_000] })));
const got = counts.map((r) => Number(r.rows?.[0]?.count)).sort((x, y) => x - y);
check("shared rate limit: 12 concurrent increments of one key", got.join(",") === Array.from({ length: 12 }, (_, i) => i + 1).join(","), `counts=${got.join(",")}`);

// ---- previous-schema target: migrations ≤ 050 + synthetic rows → all files twice → rows preserved
const prev = await target("wf_s2_web_prev");
await dropAppTables(prev);
await migrate(prev, files.filter((f) => f <= "050"));
const ph = id("whk");
await prev.query("INSERT INTO app_gw_webhooks (id, merchant, url, secret, created_at) VALUES ($1, '0xmerchant', 'https://shop.example/p', 'whsec_test', 1)", [ph]);
for (let i = 0; i < 4; i++) await prev.query("INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, attempts, next_attempt_at, created_at) VALUES ($1, $2, '0xmerchant', $3, 'payment.succeeded', '{}', $4, $5, $6, $6)", [id("dlv"), ph, id("evt"), i % 2 ? "succeeded" : "pending", i, T]);
await prev.query("INSERT INTO app_gw_events (key, created_at) VALUES ('paid:legacy', 1)");
const before = (await prev.query("SELECT count(*)::int AS n, sum(attempts)::int AS a FROM app_gw_deliveries"))[0];
await migrate(prev, files);
await migrate(prev, files);
const after = (await prev.query("SELECT count(*)::int AS n, sum(attempts)::int AS a, count(*) FILTER (WHERE leased_until IS NULL)::int AS unleased FROM app_gw_deliveries"))[0];
const ev = (await prev.query("SELECT count(*)::int AS n FROM app_gw_events"))[0].n;
check("previous schema (≤050 + synthetic rows) → 051/052 applied twice: rows preserved", before.n === 4 && after.n === 4 && after.a === before.a && after.unleased === 4 && ev === 1, `deliveries ${before.n}→${after.n}; attempts sum kept; leased_until NULL on all ${after.unleased}; event markers ${ev}`);

const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} production-adapter checks passed (Neon HTTP driver; wf_s2_web + wf_s2_web_prev)`);
process.exit(failed ? 1 : 0);
