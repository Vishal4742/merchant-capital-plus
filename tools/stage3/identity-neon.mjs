// Stage 3 real-Postgres concurrency evidence (batch 050; frozen 032 spec R2-5, acceptance 3, 10 incl. R2-2, 13), run by
// whiteflow-f3. Targets ONLY the disposable wf_s2_web database (checked with current_database() before any DDL); only
// its wf_* tables are recreated. Reads only DATABASE_URL from the given .env (other secrets in that file are never
// loaded) and never prints it. Contenders are independent Node processes calling the real Stage 3 services through
// apps/web's production Neon HTTP driver; a holder keeps an interactive transaction open through the same package's
// WebSocket Pool with SELECT … FOR UPDATE on the contested row; the runner waits until pg_stat_activity shows the
// contenders waiting on a Lock, then the holder commits. Without the database config it FAILS (exit 1), never skips.
// Run from the repo root: node tools/stage3/identity-neon.mjs P:/WhiteFlow/.env
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { neon, Pool } = require("@neondatabase/serverless");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { sqlStatements } = await import("../../apps/web/db/statements.mjs");

let raw;
try {
  raw = parseEnv(readFileSync(process.argv[2] ?? "P:/WhiteFlow/.env", "utf8")).DATABASE_URL;
} catch {
  raw = undefined;
}
if (!raw) {
  console.log("FAIL  configuration: DATABASE_URL missing (this suite never skips)");
  process.exit(1);
}
const DB = "wf_s2_web";
const urlFor = (db) => {
  const u = new URL(raw);
  u.pathname = `/${db}`;
  return u.toString();
};
const TARGET = urlFor(DB);
const ORIGIN = "https://whiteflow.test";
const results = [];
const check = (name, ok, note) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n        ${note}`);
};
const id = (p) => `${p}_${randomBytes(8).toString("hex")}`;
const CHILD = fileURLToPath(new URL("./identity-child.mjs", import.meta.url));
const DB_DIR = new URL("../../apps/web/db/", import.meta.url);

const sql = neon(TARGET);
const [{ db }] = await sql.query("SELECT current_database() AS db");
if (db !== DB) throw new Error(`target mismatch: connected to ${db}, expected ${DB}`);
const wf = await sql.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'wf\\_%'");
if (wf.length) await sql.query(`DROP TABLE IF EXISTS ${wf.map((r) => r.t).join(", ")} CASCADE`);
const files = readdirSync(DB_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
for (const pass of [1, 2]) for (const f of files) for (const s of sqlStatements(readFileSync(new URL(f, DB_DIR), "utf8"))) await sql.query(s);
const tables = (await sql.query("SELECT string_agg(table_name, ',' ORDER BY table_name) AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'wf\\_%'"))[0].t;
check("schema: all web migrations (through 053) applied twice on the production driver", tables.split(",").length === 10, `wf tables: ${tables}`);

// the services in this process (to issue challenges) use the same target through the production adapter
process.env.DATABASE_URL = TARGET;
process.env.PUBLIC_ORIGIN = ORIGIN;
const policies = await import("../../apps/web/lib/server/policies.ts");
const { scopesFor } = await import("../../apps/web/lib/server/identity.ts");

const now = Date.now();
async function principal(wallet) {
  const p = id("pr"), s = id("ses");
  await sql.query("INSERT INTO wf_principals (id, privy_did, created_at, last_sign_in_at) VALUES ($1, $2, $3, $3)", [p, `did:privy:${randomBytes(10).toString("hex")}`, now]);
  if (wallet) await sql.query("INSERT INTO wf_principal_wallets (principal_id, address, updated_at) VALUES ($1, $2, $3)", [p, wallet.toLowerCase(), now]);
  await sql.query("INSERT INTO wf_sessions (id, token_hash, principal_id, created_at, last_auth_at, expires_at) VALUES ($1, $2, $3, $4, $4, $5)", [s, randomBytes(32).toString("hex"), p, now, now + 3_600_000]);
  return { principalId: p, sessionId: s };
}
async function business(owners) {
  const b = id("biz");
  await sql.query(
    "INSERT INTO wf_businesses (id, display_name, timezone, created_by, idem_key, request_hash, owner_count, created_at) VALUES ($1, 'Race Co', 'UTC', $2, $3, 'h', $4, $5)",
    [b, owners[0].principalId, id("k"), owners.length, now],
  );
  for (const o of owners) await sql.query("INSERT INTO wf_memberships (business_id, principal_id, role, created_at) VALUES ($1, $2, 'owner', $3)", [b, o.principalId, now]);
  return b;
}
const ctxOf = (who, businessId) => ({ principalId: who.principalId, businessId, role: "owner", sessionId: who.sessionId });
const serviceCtx = (who, businessId) => ({ ...ctxOf(who, businessId), scopes: scopesFor("owner"), source: "session", credentialId: who.sessionId, requestId: "stage3-runner" });

/** Holder: an interactive transaction over the WebSocket Pool keeping `lockSql` FOR UPDATE until release(). */
async function hold(lockSql, params) {
  const pool = new Pool({ connectionString: TARGET });
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query(lockSql, params);
  return {
    release: async () => {
      await client.query("COMMIT");
      client.release();
      await pool.end();
    },
  };
}
const lockWaits = async () => (await sql.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"))[0].n;

/** Fires the contenders together (barrier), waits until `minWaits` of them are blocked on a Lock behind the holder,
 *  then lets the holder commit. Returns each contender's JSON answer and the most lock waits seen. */
async function race(ops, holder, minWaits) {
  const kids = ops.map((op) => spawn(process.execPath, ["--disable-warning=ExperimentalWarning", CHILD], { env: { ...process.env, DATABASE_URL: TARGET, PUBLIC_ORIGIN: ORIGIN, WF_OP: JSON.stringify(op) }, stdio: ["pipe", "pipe", "pipe"] }));
  const bufs = kids.map(() => ({ out: "" }));
  kids.forEach((k, i) => k.stdout.on("data", (d) => (bufs[i].out += d)));
  const exited = kids.map((k) => new Promise((r) => k.on("exit", r)));
  await Promise.all(kids.map((k, i) => new Promise((res, rej) => {
    const t = setInterval(() => bufs[i].out.includes("READY") && (clearInterval(t), res()), 10);
    k.on("exit", (c) => (clearInterval(t), bufs[i].out.includes("READY") || rej(new Error(`child exited ${c} before READY`))));
  })));
  for (const k of kids) k.stdin.write("GO\n");
  let seen = 0;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    seen = Math.max(seen, await lockWaits());
    if (seen >= minWaits) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await holder.release();
  await Promise.all(exited);
  return { answers: bufs.map((b) => JSON.parse(b.out.split("\n").filter((l) => l.startsWith("{")).pop() ?? '{"ok":false,"error":"no output"}')), seen };
}
const statuses = (answers) => answers.map((a) => a.status).sort((x, y) => x - y).join(",");

// ---- acceptance 10: two Owners demote themselves at the same time → exactly one succeeds, one Owner remains
{
  const [a, b] = [await principal(), await principal()];
  const biz = await business([a, b]);
  const holder = await hold("SELECT id FROM wf_businesses WHERE id = $1 FOR UPDATE", [biz]);
  const { answers, seen } = await race([
    { kind: "role", ctx: ctxOf(a, biz), args: { principalId: a.principalId, role: "viewer", idempotencyKey: "d1" } },
    { kind: "role", ctx: ctxOf(b, biz), args: { principalId: b.principalId, role: "viewer", idempotencyKey: "d2" } },
  ], holder, 2);
  const [row] = await sql.query("SELECT owner_count, (SELECT count(*)::int FROM wf_memberships m WHERE m.business_id = b.id AND m.role = 'owner') AS real FROM wf_businesses b WHERE id = $1", [biz]);
  check("10: two Owners demote themselves concurrently (business row held, contenders waited on Lock)",
    seen >= 2 && statuses(answers) === "200,409" && row.owner_count === 1 && row.real === 1,
    `lock waits seen=${seen}; statuses=${statuses(answers)}; owner_count=${row.owner_count} real=${row.real}; 409 says: ${answers.find((x) => x.status === 409)?.error}`);
}

// ---- R2-2: Owner A removes B while B removes A → one succeeds, the other 409, at least one Owner remains
{
  const [a, b] = [await principal(), await principal()];
  const biz = await business([a, b]);
  const holder = await hold("SELECT id FROM wf_businesses WHERE id = $1 FOR UPDATE", [biz]);
  const { answers, seen } = await race([
    { kind: "remove", ctx: ctxOf(a, biz), args: { principalId: b.principalId, idempotencyKey: "x1" } },
    { kind: "remove", ctx: ctxOf(b, biz), args: { principalId: a.principalId, idempotencyKey: "x2" } },
  ], holder, 1);
  const [row] = await sql.query("SELECT owner_count, (SELECT count(*)::int FROM wf_memberships m WHERE m.business_id = b.id AND m.role = 'owner') AS real FROM wf_businesses b WHERE id = $1", [biz]);
  // The loser is refused either way: 409 when Postgres reports the deadlock (40P01) or the owner_count CHECK, or 403 when
  // the winner removed the loser first (the loser's own Owner membership is gone when its statement re-checks it, so it
  // has no authority any more: removal takes effect on the next request). The invariant is what must hold: exactly one
  // removal, exactly one Owner left, owner_count equal to the real count.
  const refused = answers.find((x) => x.status !== 200);
  check("10/R2-2: A removes B while B removes A → one removal, the other refused (409 or 403), one Owner left",
    seen >= 1 && answers.filter((x) => x.status === 200).length === 1 && [403, 409].includes(refused?.status) && row.owner_count === 1 && row.real === 1,
    `lock waits seen=${seen}; statuses=${statuses(answers)}; owner_count=${row.owner_count} real=${row.real}; refusal says: ${refused?.error}`);
}

/** A signed proof + approval pair for `owner` (in-process services, production driver), ready to activate. */
async function signedPair(owner, ownerWallet, biz, expected) {
  const recipient = privateKeyToAccount(generatePrivateKey());
  const proof = await policies.issueReceivingProof(serviceCtx(owner, biz), { address: recipient.address });
  const approval = await policies.issueOwnerApproval(serviceCtx(owner, biz), { proofNonce: proof.nonce, wallet: ownerWallet.address });
  return {
    proofNonce: proof.nonce, proofSignature: await recipient.signMessage({ message: proof.message }),
    approvalNonce: approval.nonce, approvalSignature: await ownerWallet.signMessage({ message: approval.message }),
    expectedCurrentVersion: expected,
  };
}

// ---- acceptance 13: two different activations for version 1 at once → one version 1, the other 409
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const a = await principal(wallet.address);
  const biz = await business([a]);
  const [p1, p2] = [await signedPair(a, wallet, biz, 0), await signedPair(a, wallet, biz, 0)];
  const holder = await hold("SELECT 1 FROM wf_memberships WHERE business_id = $1 AND principal_id = $2 FOR UPDATE", [biz, a.principalId]);
  const { answers, seen } = await race([
    { kind: "activate", ctx: ctxOf(a, biz), args: p1 },
    { kind: "activate", ctx: ctxOf(a, biz), args: p2 },
  ], holder, 2);
  const versions = await sql.query("SELECT version FROM wf_settlement_policies WHERE business_id = $1", [biz]);
  check("13: two policy activations for the same next version (actor membership held)",
    seen >= 2 && statuses(answers) === "200,409" && versions.length === 1 && versions[0].version === 1,
    `lock waits seen=${seen}; statuses=${statuses(answers)}; versions=${versions.map((v) => v.version).join(",")}`);
}

// ---- acceptance 3: one signed pair replayed by 3 processes at once → exactly one activation, both challenges consumed once
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const a = await principal(wallet.address);
  const biz = await business([a]);
  const pair = await signedPair(a, wallet, biz, 0);
  const holder = await hold("SELECT 1 FROM wf_memberships WHERE business_id = $1 AND principal_id = $2 FOR UPDATE", [biz, a.principalId]);
  const { answers, seen } = await race([1, 2, 3].map(() => ({ kind: "activate", ctx: ctxOf(a, biz), args: pair })), holder, 3);
  const versions = await sql.query("SELECT version FROM wf_settlement_policies WHERE business_id = $1", [biz]);
  const consumed = await sql.query("SELECT count(*)::int AS n FROM wf_challenges WHERE nonce IN ($1, $2) AND consumed_at IS NOT NULL", [pair.proofNonce, pair.approvalNonce]);
  check("3: one signed proof + approval replayed concurrently by 3 processes",
    seen >= 3 && statuses(answers) === "200,409,409" && versions.length === 1 && consumed[0].n === 2,
    `lock waits seen=${seen}; statuses=${statuses(answers)}; versions=${versions.length}; consumed=${consumed[0].n}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} Stage 3 real-Postgres checks passed (Neon production driver + WebSocket holder; ${DB})`);
process.exit(failed ? 1 : 0);
