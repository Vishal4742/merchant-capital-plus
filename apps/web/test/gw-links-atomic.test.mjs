// Batch 054 (production review F1, FR-MCP-15, FR-GW-16): a link and its replayable reply commit together, so no failure
// boundary can turn one request into two links. The test database (PGlite, every migration) is wrapped to inject a
// failure exactly where the review found one: after the INSERT, after the commit (reply lost), in the reply storage,
// and in an abandoned slot. Run from apps/web: node --experimental-test-module-mocks --test test/gw-links-atomic.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, seedWorkspace, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

const { setTestDb, query } = await import("../lib/server/db.ts");
const { POST: createLinkRoute } = await import("../app/api/v1/links/route.ts");
const { POST: sessionsRoute } = await import("../app/api/v1/sessions/route.ts");
const { createKey } = await import("../lib/server/keys.ts");

let pg;
/** One-shot faults: `before` throws instead of running a matching statement; `after` runs it (and commits) and then
 *  throws, as if the reply were lost on the way back. */
const faults = { before: null, after: null };
const trip = (kind, text) => {
  const f = faults[kind];
  if (f && f(text)) {
    faults[kind] = null;
    throw new Error(`injected ${kind}-statement failure`);
  }
};
before(async () => {
  pg = await setupDb();
  setTestDb({
    query: async (text, values) => {
      trip("before", text);
      const rows = (await pg.query(text, values)).rows;
      trip("after", text);
      return rows;
    },
    transaction: async (statements) => {
      const results = await pg.transaction(async (tx) => {
        const out = [];
        for (const s of statements) {
          trip("before", s.text);
          out.push((await tx.query(s.text, s.params ?? [])).rows);
        }
        return out;
      });
      for (const s of statements) trip("after", s.text); // committed: the reply is what's lost
      return results;
    },
  });
});

let sk, otherSk;
beforeEach(async () => {
  await resetDb();
  faults.before = faults.after = null;
  // batch 051: a secret key acts once its wallet is linked to a WhiteFlow workspace (this file wraps setTestDb itself,
  // so it seeds directly, as gw-outbox does)
  await seedWorkspace(MERCHANT);
  await seedWorkspace(OTHER_MERCHANT);
  sk = (await createKey(MERCHANT, "mcp", "sk")).key;
  otherSk = (await createKey(OTHER_MERCHANT, "mcp", "sk")).key;
  mock.method(globalThis, "fetch", async (url) => {
    throw new Error(`unexpected fetch ${url}`);
  });
});

const BODY = { amount: "10.00", currency: "USDT", description: "Coffee beans" };
const post = (body = BODY, key = "op-key-0001", secret = sk) =>
  createLinkRoute(req("POST", "/api/v1/links", { body, headers: { authorization: `Bearer ${secret}`, ...(key ? { "idempotency-key": key } : {}) } }));
const links = async () => Number((await query("SELECT count(*)::text AS n FROM app_gw_links"))[0].n);
const ageSlots = () => query("UPDATE app_web_idempotency SET created_at = created_at - 400000");

test("a failure right after the INSERT (the old post-insert read) can't make a second link on retry", async () => {
  faults.before = (text) => text.includes("FROM app_gw_checkouts");
  await post();
  const retry = await post();
  assert.equal(retry.status, 201);
  assert.equal(await links(), 1);
});

test("a commit whose reply was lost is replayed on retry, never re-created", async () => {
  faults.after = (text) => text.includes("INSERT INTO app_gw_links");
  const first = await post();
  assert.equal(first.status, 500);
  const retry = await post();
  assert.equal(retry.status, 201);
  assert.equal(retry.headers.get("idempotent-replayed"), "true");
  assert.equal(await links(), 1);
});

test("if storing the reply fails, nothing was created: even after the slot is abandoned, the retry makes exactly one", async () => {
  faults.before = (text) => text.includes("UPDATE app_web_idempotency SET status");
  const first = await post();
  assert.equal(first.status, 500);
  await ageSlots(); // more than 5 minutes later
  assert.equal((await post()).status, 201);
  assert.equal(await links(), 1);
});

test("a failure before the commit frees the key; a slot left by a dead request (>5 min) never hides a created link", async () => {
  faults.before = (text) => text.includes("INSERT INTO app_gw_links");
  assert.equal((await post()).status, 500);
  assert.equal(await links(), 0);
  assert.equal((await post()).status, 201);
  assert.equal(await links(), 1);
  // a dead request's unanswered slot (nothing committed) is freed after 5 minutes and the key works
  await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, 'dead', 'x', $2)", [`links:${MERCHANT.toLowerCase()}:op-key-dead`, Date.now() - 400_000]);
  assert.equal((await post({ ...BODY, description: "Tea" }, "op-key-dead")).status, 201);
  assert.equal(await links(), 2);
});

test("a reference conflict rolls the whole write back: 409, the key is freed, no half-stored reply", async () => {
  assert.equal((await post({ ...BODY, reference_id: "ORDER-1" }, "op-key-a")).status, 201);
  const clash = await post({ ...BODY, reference_id: "ORDER-1" }, "op-key-b");
  assert.equal(clash.status, 409);
  const [slot] = await query("SELECT status FROM app_web_idempotency WHERE slot = $1", [`links:${MERCHANT.toLowerCase()}:op-key-b`]);
  assert.equal(slot, undefined);
  assert.equal((await post({ ...BODY, reference_id: "ORDER-2" }, "op-key-b")).status, 201, "the corrected retry with the same key works");
  assert.equal(await links(), 2);
});

test("a secret-key write must carry an Idempotency-Key (the dashboard session keeps it optional)", async () => {
  const res = await post(BODY, null);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Idempotency-Key/);
  assert.equal(await links(), 0);
});

test("GET /api/v1/operations/{key}: the caller's own write, succeeded or pending; another merchant's is 404", async () => {
  const { GET: operationRoute } = await import("../app/api/v1/operations/[key]/route.ts");
  const created = await (await post()).json();
  const read = (key, secret = sk) => operationRoute(req("GET", `/api/v1/operations/${key}`, { headers: { authorization: `Bearer ${secret}` } }), params({ key }));
  const op = await (await read("op-key-0001")).json();
  assert.deepEqual({ ...op, created_at: undefined }, { idempotency_key: "op-key-0001", route: "links", state: "succeeded", http_status: 201, result_id: created.id, created_at: undefined });
  assert.equal((await read("op-key-0001", otherSk)).status, 404);
  assert.equal((await read("never-used-key")).status, 404);
  await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, 'live', 'x', $2)", [`links:${MERCHANT.toLowerCase()}:in-flight-key`, Date.now()]);
  assert.equal((await (await read("in-flight-key")).json()).state, "pending");
  // a slot that stored no reply within ABANDONED_MS died with its instance and is free again: 404, never "pending" (review L1)
  await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, 'dead', 'x', $2)", [`links:${MERCHANT.toLowerCase()}:dead-key`, Date.now() - 6 * 60_000]);
  assert.equal((await read("dead-key")).status, 404);
  // a checkout's key is found too
  const checkout = await sessionsRoute(req("POST", "/api/v1/sessions", { body: { amount: "5.00" }, headers: { authorization: `Bearer ${sk}`, "idempotency-key": "co-key-0001" } }));
  const session = await checkout.json();
  const coOp = await (await read("co-key-0001")).json();
  assert.deepEqual([coOp.route, coOp.state, coOp.result_id], ["sessions", "succeeded", session.id]);
});
