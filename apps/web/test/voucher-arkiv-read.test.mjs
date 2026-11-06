// Batch 034 (FR-ARK-7, AT-12): at checkout applyVoucher reads the code's live Arkiv entity, by its keyed hash, from our
// writer (owner AND creator), and refuses the code when the entity is missing, expired or can't be read. Real SQL on
// PGlite; the Arkiv reader is mocked.
// Run from apps/web: node --experimental-test-module-mocks --test test/voucher-arkiv-read.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setupDb, resetDb, MERCHANT } from "./gw-helpers.mjs";

const ACCESS_KEY = "ak_test_secret/access+key";
const HASH_SECRET = "voucher-hash-secret-for-tests";
const WRITER = "0x3333333333333333333333333333333333333333";
const ENTITY_KEY = `0x${"ab".repeat(32)}`;
const CANT_CHECK = "We couldn't check this code right now. You can pay without it.";

// arkiv.entities answers the read; arkiv.fail makes fetch throw; arkiv.hang makes it never settle; arkiv.reads records
// each query's filters.
const arkiv = { entities: [], fail: null, hang: false, reads: [] };
const queryChain = () => {
  const q = {};
  const chain = {
    from: (schema) => ((q.type = schema.name), chain),
    where: (e) => ((q.where = e), chain),
    ownedBy: (a) => ((q.owner = a), chain),
    createdBy: (a) => ((q.creator = a), chain),
    limit: (n) => ((q.limit = n), chain),
    fetch: () => {
      arkiv.reads.push(q);
      if (arkiv.hang) return new Promise(() => {});
      if (arkiv.fail) return Promise.reject(arkiv.fail);
      return Promise.resolve({ entities: arkiv.entities });
    },
  };
  return chain;
};
mock.module("../lib/arkiv.ts", {
  namedExports: {
    arkivClients: () => ({ address: WRITER, reader: { select: () => queryChain() }, writer: {} }),
    redactArkivError: (err, key) => (err instanceof Error ? err.message : String(err)).replaceAll(key, "<access-key>"),
  },
});

const { applyVoucher } = await import("../lib/server/vouchers.ts");
const { recordCheckout } = await import("../lib/server/checkouts.ts");
const { query } = await import("../lib/server/db.ts");

const DAY = 24 * 60 * 60 * 1000;
const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const t = Date.now();
const unixS = (ms) => BigInt(Math.floor(ms / 1000));
const live = (expiresMs = t + DAY) => [{ $key: ENTITY_KEY, expires_at: { value: unixS(expiresMs) } }];
const hashOf = (code) => createHmac("sha256", HASH_SECRET).update(`${MERCHANT.toLowerCase()}:${code}`).digest("hex");

async function voucher(code, entityKey = ENTITY_KEY) {
  await query(
    "INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, created_at, arkiv_entity_key) VALUES ($1, $2, $3, 'percent', 10, $4, 5, $5, $6)",
    [`v_${code}`, MERCHANT.toLowerCase(), code, t + DAY, t, entityKey],
  );
}
let n = 0;
async function checkout() {
  const id = `ses_ark_${++n}`;
  await recordCheckout(id, "link", "lnk_1", MERCHANT, USDT(25), { now: t });
  return id;
}
const holds = async (sessionId) => (await query("SELECT 1 FROM app_gw_redemptions WHERE session_id = $1", [sessionId])).length;

before(setupDb);
beforeEach(async () => {
  await resetDb();
  Object.assign(arkiv, { entities: [], fail: null, hang: false, reads: [] });
  process.env.VOUCHER_HASH_SECRET = HASH_SECRET;
  process.env.ARKIV_ACCESS_KEY = ACCESS_KEY;
  process.env.ARKIV_PRIVATE_KEY = "not-a-key-arkivClients-is-mocked";
});

test("a live entity from our writer: the discount applies, after one read by the keyed hash, owner and creator", async () => {
  await voucher("SAVE10");
  arkiv.entities = live();
  const id = await checkout();
  assert.deepEqual(await applyVoucher(MERCHANT, "save10", id, USDT(25), t), { ok: true, discount: USDT(2.5), usdtAmount: USDT(22.5) });
  assert.equal(arkiv.reads.length, 1);
  const [read] = arkiv.reads;
  assert.equal(read.type, "mcplus.voucher.v1");
  assert.equal(JSON.stringify(read.where).includes(hashOf("SAVE10")), true, "queried by HMAC(merchant:CODE)");
  assert.ok(!JSON.stringify(read.where).includes("SAVE10"), "the plain code never goes to Arkiv");
  assert.deepEqual([read.owner, read.creator, read.limit], [WRITER, WRITER, 1]);
  assert.equal(await holds(id), 1);
});

test("no entity on Arkiv: the code is refused and nothing is held", async () => {
  await voucher("GONE");
  const id = await checkout();
  assert.deepEqual(await applyVoucher(MERCHANT, "GONE", id, USDT(25), t), { ok: false, reason: "That code isn't valid." });
  assert.equal(await holds(id), 0);
});

test("an entity past its expires_at: the code is refused as expired and nothing is held", async () => {
  await voucher("OLD");
  arkiv.entities = live(t - 1000);
  const id = await checkout();
  assert.deepEqual(await applyVoucher(MERCHANT, "OLD", id, USDT(25), t), { ok: false, reason: "That code has expired." });
  assert.equal(await holds(id), 0);
});

test("Arkiv throws: the code is refused with a plain reason, nothing is held, and the log has no code or key", async () => {
  await voucher("DOWN");
  arkiv.fail = new Error(`HTTP request failed. URL: https://rpc.example/${ACCESS_KEY}`);
  const logged = [];
  const spy = mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  const id = await checkout();
  try {
    assert.deepEqual(await applyVoucher(MERCHANT, "DOWN", id, USDT(25), t), { ok: false, reason: CANT_CHECK });
  } finally {
    spy.mock.restore();
  }
  assert.equal(await holds(id), 0, "the checkout stays payable at full price");
  assert.equal(logged.length, 1);
  for (const secret of [ACCESS_KEY, HASH_SECRET, "DOWN", hashOf("DOWN")]) assert.ok(!logged[0].includes(secret), `the log leaks ${secret}`);
});

test("Arkiv hangs: the code is refused within about 2 s and nothing is held", async () => {
  await voucher("SLOW");
  arkiv.hang = true;
  const spy = mock.method(console, "error", () => {});
  const id = await checkout();
  const started = Date.now();
  try {
    assert.deepEqual(await applyVoucher(MERCHANT, "SLOW", id, USDT(25), t), { ok: false, reason: CANT_CHECK });
  } finally {
    spy.mock.restore();
  }
  const took = Date.now() - started;
  assert.ok(took >= 1_500 && took < 3_500, `took ${took} ms`);
  assert.equal(await holds(id), 0);
});

test("a published voucher on a server missing its Arkiv settings: refused, never applied unchecked", async () => {
  await voucher("NOCONF");
  arkiv.entities = live();
  delete process.env.VOUCHER_HASH_SECRET;
  const spy = mock.method(console, "error", () => {});
  const id = await checkout();
  try {
    assert.deepEqual(await applyVoucher(MERCHANT, "NOCONF", id, USDT(25), t), { ok: false, reason: CANT_CHECK });
  } finally {
    spy.mock.restore();
  }
  assert.equal(arkiv.reads.length, 0);
  assert.equal(await holds(id), 0);
});

test("a voucher never published to Arkiv (no entity key) applies as before, with no Arkiv read", async () => {
  await voucher("LOCAL", null);
  const id = await checkout();
  assert.deepEqual(await applyVoucher(MERCHANT, "LOCAL", id, USDT(25), t), { ok: true, discount: USDT(2.5), usdtAmount: USDT(22.5) });
  assert.equal(arkiv.reads.length, 0);
});

test("a code Postgres already refuses is not read from Arkiv", async () => {
  await voucher("USED");
  await query("UPDATE app_gw_vouchers SET times_redeemed = max_redemptions WHERE id = 'v_USED'");
  const id = await checkout();
  assert.deepEqual(await applyVoucher(MERCHANT, "USED", id, USDT(25), t), { ok: false, reason: "That code has been used up." });
  assert.equal(arkiv.reads.length, 0);
});
