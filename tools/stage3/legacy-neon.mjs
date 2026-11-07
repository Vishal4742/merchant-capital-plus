// Batch 051 real-Postgres concurrency evidence (spec acceptance 3): the legacy claim under contention, run by
// whiteflow-ef. Targets ONLY the disposable wf_s2_web database (checked with current_database() before anything else).
// Nothing is dropped or truncated: the web migrations are idempotent (054 adds wf_legacy_claim_challenges) and every
// check uses fresh random rows. Reads only DATABASE_URL from the given .env (other secrets in that file are never
// loaded) and never prints it. Contenders are independent Node processes calling the real services through apps/web's
// production Neon HTTP driver; a holder keeps an interactive transaction open through the same package's WebSocket Pool
// with SELECT … FOR UPDATE; the runner waits until pg_stat_activity shows the contenders waiting on a Lock, then the
// holder commits. Without the database config it FAILS (exit 1), never skips.
// Run from the repo root: node tools/stage3/legacy-neon.mjs P:/WhiteFlow/.env
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
let target;
try {
  target = new URL(raw);
} catch {
  // never the parser's error: it quotes the whole input, password included (review 051 S-L4)
  console.log("FAIL  configuration: DATABASE_URL isn't a valid URL");
  process.exit(1);
}
target.pathname = `/${DB}`;
const TARGET = target.toString();
const ORIGIN = "https://whiteflow.test";
const results = [];
const check = (name, ok, note) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n        ${note}`);
};
const id = (p) => `${p}_${randomBytes(8).toString("hex")}`;
const CHILD = fileURLToPath(new URL("./legacy-child.mjs", import.meta.url));
const DB_DIR = new URL("../../apps/web/db/", import.meta.url);

const sql = neon(TARGET);
const [{ db }] = await sql.query("SELECT current_database() AS db");
if (db !== DB) throw new Error(`target mismatch: connected to ${db}, expected ${DB}`);
const files = readdirSync(DB_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
for (const pass of [1, 2]) for (const f of files) for (const s of sqlStatements(readFileSync(new URL(f, DB_DIR), "utf8"))) await sql.query(s);
const [{ n: has054 }] = await sql.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wf_legacy_claim_challenges'");
check("schema: all web migrations (through 054) applied twice on the production driver", has054 === 1, `wf_legacy_claim_challenges present: ${has054 === 1}`);

process.env.DATABASE_URL = TARGET;
process.env.PUBLIC_ORIGIN = ORIGIN;
const legacy = await import("../../apps/web/lib/server/legacy.ts");
const { scopesFor } = await import("../../apps/web/lib/server/identity.ts");

const now = Date.now();
async function principal() {
  const p = id("pr"), s = id("ses");
  await sql.query("INSERT INTO wf_principals (id, privy_did, created_at, last_sign_in_at) VALUES ($1, $2, $3, $3)", [p, `did:privy:${randomBytes(10).toString("hex")}`, now]);
  await sql.query("INSERT INTO wf_sessions (id, token_hash, principal_id, created_at, last_auth_at, expires_at) VALUES ($1, $2, $3, $4, $4, $5)", [s, randomBytes(32).toString("hex"), p, now, now + 3_600_000]);
  return { principalId: p, sessionId: s };
}
async function business(owners) {
  const b = id("biz");
  await sql.query(
    "INSERT INTO wf_businesses (id, display_name, timezone, created_by, idem_key, request_hash, owner_count, created_at) VALUES ($1, 'Legacy Race Co', 'UTC', $2, $3, 'h', $4, $5)",
    [b, owners[0].principalId, id("k"), owners.length, now],
  );
  for (const o of owners) await sql.query("INSERT INTO wf_memberships (business_id, principal_id, role, created_at) VALUES ($1, $2, 'owner', $3)", [b, o.principalId, now]);
  return b;
}
const ctxOf = (who, businessId) => ({ principalId: who.principalId, businessId, sessionId: who.sessionId });
const serviceCtx = (who, businessId) => ({ ...ctxOf(who, businessId), role: "owner", scopes: scopesFor("owner"), source: "session", credentialId: who.sessionId, requestId: "stage3-legacy-runner" });
/** A signed claim for `wallet` into `biz` by `owner` (challenge issued in-process through the production adapter). */
async function signedClaim(owner, biz, wallet) {
  const c = await legacy.issueClaimChallenge(serviceCtx(owner, biz), { address: wallet.address });
  return { nonce: c.nonce, signature: await wallet.signMessage({ message: c.message }) };
}

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

/** Fires the contenders (together, or `staged`: each only after the previous one is blocked on a Lock), waits until
 *  `minWaits` are blocked behind the holder, then lets it commit. Returns each answer and the most lock waits seen. */
async function race(ops, holder, minWaits, { staged = false } = {}) {
  const kids = ops.map((op) => spawn(process.execPath, ["--disable-warning=ExperimentalWarning", CHILD], { env: { ...process.env, DATABASE_URL: TARGET, PUBLIC_ORIGIN: ORIGIN, WF_OP: JSON.stringify(op) }, stdio: ["pipe", "pipe", "pipe"] }));
  const bufs = kids.map(() => ({ out: "" }));
  kids.forEach((k, i) => k.stdout.on("data", (d) => (bufs[i].out += d)));
  const exited = kids.map((k) => new Promise((r) => k.on("exit", r)));
  await Promise.all(kids.map((k, i) => new Promise((res, rej) => {
    const t = setInterval(() => bufs[i].out.includes("READY") && (clearInterval(t), res()), 10);
    k.on("exit", (c) => (clearInterval(t), bufs[i].out.includes("READY") || rej(new Error(`child exited ${c} before READY`))));
  })));
  let seen = 0;
  const deadline = Date.now() + 20_000;
  for (const [i, k] of kids.entries()) {
    k.stdin.write("GO\n");
    while (staged && Date.now() < deadline && (seen = Math.max(seen, await lockWaits())) < i + 1) await new Promise((r) => setTimeout(r, 100));
  }
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
const linkOf = async (biz) => (await sql.query("SELECT legacy_merchant FROM wf_businesses WHERE id = $1", [biz]))[0].legacy_merchant;
const consumedOf = async (nonce) => (await sql.query("SELECT consumed_at FROM wf_legacy_claim_challenges WHERE nonce = $1", [nonce]))[0].consumed_at;
const auditsFor = async (biz) => (await sql.query("SELECT actor_principal_id FROM wf_audit_events WHERE business_id = $1 AND action = 'legacy.claim'", [biz]));

// ---- 3a: one signed claim submitted by 3 processes at once → one link, the same 200 for all, one audit row, keys moved once
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const a = await principal();
  const biz = await business([a]);
  const keyId = id("key");
  await sql.query("INSERT INTO app_gw_keys (id, merchant, kind, label, prefix, key_hash, created_at) VALUES ($1, $2, 'sk', 'race', 'sk_test_race', $3, $4)", [keyId, wallet.address.toLowerCase(), randomBytes(32).toString("hex"), now]);
  const claim = await signedClaim(a, biz, wallet);
  const holder = await hold("SELECT id FROM wf_businesses WHERE id = $1 FOR UPDATE", [biz]);
  const { answers, seen } = await race([1, 2, 3].map(() => ({ kind: "claim", ctx: ctxOf(a, biz), args: claim })), holder, 3);
  const audits = await auditsFor(biz);
  const [key] = await sql.query("SELECT business_id FROM app_gw_keys WHERE id = $1", [keyId]);
  const same = answers.every((x) => x.ok && x.result.merchant === wallet.address);
  check("3a: one signed claim replayed concurrently by 3 processes (business row held, contenders waited on Lock)",
    seen >= 3 && statuses(answers) === "200,200,200" && same && (await linkOf(biz)) === wallet.address.toLowerCase() && audits.length === 1 && key.business_id === biz && (await consumedOf(claim.nonce)) !== null,
    `lock waits seen=${seen}; statuses=${statuses(answers)}; same answer=${same}; audits=${audits.length}; key moved=${key.business_id === biz}`);
}

// ---- 3b: two workspaces claim the same wallet at once → one link; the other 409 and its challenge stays unused
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const [a, b] = [await principal(), await principal()];
  const [bizA, bizB] = [await business([a]), await business([b])];
  const [ca, cb] = [await signedClaim(a, bizA, wallet), await signedClaim(b, bizB, wallet)];
  const holder = await hold("SELECT id FROM wf_businesses WHERE id IN ($1, $2) FOR UPDATE", [bizA, bizB]);
  const { answers, seen } = await race([
    { kind: "claim", ctx: ctxOf(a, bizA), args: ca },
    { kind: "claim", ctx: ctxOf(b, bizB), args: cb },
  ], holder, 2);
  const links = [await linkOf(bizA), await linkOf(bizB)].filter(Boolean);
  const loser = answers[0].status === 409 ? ca : cb;
  const loserUnused = (await consumedOf(loser.nonce)) === null;
  check("3b: two workspaces claim one wallet concurrently (both business rows held)",
    seen >= 2 && statuses(answers) === "200,409" && links.length === 1 && loserUnused,
    `lock waits seen=${seen}; statuses=${statuses(answers)}; linked workspaces=${links.length}; loser's challenge unused=${loserUnused}; 409 says: ${answers.find((x) => x.status === 409)?.error}`);
}

// ---- 3c: Owner A claims while Owner B removes A → either A (still an Owner then) linked it, or 403 and nothing linked
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const [a, b] = [await principal(), await principal()];
  const biz = await business([a, b]);
  const claim = await signedClaim(a, biz, wallet);
  const holder = await hold("SELECT id FROM wf_businesses WHERE id = $1 FOR UPDATE", [biz]);
  const { answers, seen } = await race([
    { kind: "claim", ctx: ctxOf(a, biz), args: claim },
    { kind: "remove", ctx: ctxOf(b, biz), args: { principalId: a.principalId, idempotencyKey: "rm-a" } },
  ], holder, 1);
  const [claimed, removed] = answers;
  const link = await linkOf(biz);
  const audits = await auditsFor(biz);
  const [{ n: aLeft }] = await sql.query("SELECT count(*)::int AS n FROM wf_memberships WHERE business_id = $1 AND principal_id = $2", [biz, a.principalId]);
  const linkedByOwner = claimed.status === 200 && link === wallet.address.toLowerCase() && audits.length === 1 && audits[0].actor_principal_id === a.principalId;
  const refusedClean = claimed.status === 403 && link === null && audits.length === 0 && (await consumedOf(claim.nonce)) === null;
  check("3c: a claim races the removal of its Owner (business row held)",
    seen >= 1 && removed.status === 200 && aLeft === 0 && (linkedByOwner || refusedClean),
    `lock waits seen=${seen}; claim=${claimed.status} remove=${removed.status}; outcome=${linkedByOwner ? "linked while still Owner" : refusedClean ? "403, nothing linked" : "INCONSISTENT"}; A's membership left=${aLeft}`);
}

// ---- 3d: the same race, staged: B's removal is already waiting (holding A's membership row) when A's claim arrives →
// A's claim waits on that row, sees no Owner membership once B commits, and is refused with nothing linked (R2-2: 403)
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const [a, b] = [await principal(), await principal()];
  const biz = await business([a, b]);
  const claim = await signedClaim(a, biz, wallet);
  const holder = await hold("SELECT id FROM wf_businesses WHERE id = $1 FOR UPDATE", [biz]);
  const { answers, seen } = await race([
    { kind: "remove", ctx: ctxOf(b, biz), args: { principalId: a.principalId, idempotencyKey: "rm-a2" } },
    { kind: "claim", ctx: ctxOf(a, biz), args: claim },
  ], holder, 2, { staged: true });
  const [removed, claimed] = answers;
  const link = await linkOf(biz);
  const audits = await auditsFor(biz);
  const unused = (await consumedOf(claim.nonce)) === null;
  check("3d: the removal is already waiting when the claim arrives (staged; business row held)",
    seen >= 2 && removed.status === 200 && claimed.status === 403 && link === null && audits.length === 0 && unused,
    `lock waits seen=${seen}; remove=${removed.status} claim=${claimed.status}; linked=${link !== null}; claim audits=${audits.length}; challenge unused=${unused}`);
}

// ---- 3e: Owner A claims while Owner B demotes A to Viewer (staged: the demotion already waiting) → A's claim is
// refused (403) and nothing is linked; the demotion stands
{
  const wallet = privateKeyToAccount(generatePrivateKey());
  const [a, b] = [await principal(), await principal()];
  const biz = await business([a, b]);
  const claim = await signedClaim(a, biz, wallet);
  const holder = await hold("SELECT id FROM wf_businesses WHERE id = $1 FOR UPDATE", [biz]);
  const { answers, seen } = await race([
    { kind: "role", ctx: ctxOf(b, biz), args: { principalId: a.principalId, role: "viewer", idempotencyKey: "demote-a" } },
    { kind: "claim", ctx: ctxOf(a, biz), args: claim },
  ], holder, 2, { staged: true });
  const [demoted, claimed] = answers;
  const [{ role }] = await sql.query("SELECT role FROM wf_memberships WHERE business_id = $1 AND principal_id = $2", [biz, a.principalId]);
  const link = await linkOf(biz);
  const unused = (await consumedOf(claim.nonce)) === null;
  check("3e: a claim races the demotion of its Owner (staged; business row held)",
    seen >= 2 && demoted.status === 200 && role === "viewer" && claimed.status === 403 && link === null && unused,
    `lock waits seen=${seen}; demote=${demoted.status} claim=${claimed.status}; A's role=${role}; linked=${link !== null}; challenge unused=${unused}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} batch 051 real-Postgres checks passed (Neon production driver + WebSocket holder; ${DB})`);
process.exit(failed ? 1 : 0);
