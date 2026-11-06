// claude-contracts checks for API keys (SRS FR-GW-6, FR-PAY-4 key half): shown once, hash only, scoped, revocable.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-keys.test.mjs
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MERCHANT, OTHER_MERCHANT, params, req, resetDb, setupDb, signedIn } from "./gw-helpers.mjs";

let pg;
before(async () => {
  pg = await setupDb();
});
beforeEach(resetDb);

const { POST, GET } = await import("../app/api/v1/keys/route.ts");
const { DELETE } = await import("../app/api/v1/keys/[id]/route.ts");
const { authenticateKey, MAX_KEYS } = await import("../lib/server/keys.ts");

const create = async (body = { label: "Shop server", kind: "sk" }, merchant = MERCHANT) => POST(req("POST", "/api/v1/keys", { body, headers: signedIn(merchant) }));
const bearer = (key) => req("POST", "/api/v1/sessions", { headers: { authorization: `Bearer ${key}` } });

test("every key route needs the dashboard cookie", async () => {
  assert.equal((await POST(req("POST", "/api/v1/keys", { body: { label: "x" } }))).status, 401);
  assert.equal((await GET(req("GET", "/api/v1/keys"))).status, 401);
  assert.equal((await DELETE(req("DELETE", "/api/v1/keys/key_x"), params({ id: "key_x" }))).status, 401);
});

test("a new sk key is shown once, stored only as a hash, and authenticates", async () => {
  const res = await create();
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.key, /^sk_test_[A-Za-z0-9_-]{32}$/);
  assert.equal(body.prefix, body.key.slice(0, 12));
  const { rows } = await pg.query("SELECT * FROM app_gw_keys");
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(body.key), "the plain key is never stored");
  const listed = await (await GET(req("GET", "/api/v1/keys", { headers: signedIn() }))).json();
  assert.equal(listed.keys.length, 1);
  assert.equal(listed.keys[0].key, undefined, "the list never returns the key");
  const who = await authenticateKey(bearer(body.key));
  assert.equal(who.merchant.toLowerCase(), MERCHANT);
  assert.equal(who.kind, "sk");
  const used = await (await GET(req("GET", "/api/v1/keys", { headers: signedIn() }))).json();
  assert.ok(used.keys[0].last_used_at, "last_used_at is set after use");
});

test("pk keys are labelled pk; bad kinds and labels are refused", async () => {
  const pk = await (await create({ label: "Button", kind: "pk" })).json();
  assert.match(pk.key, /^pk_test_/);
  assert.equal((await authenticateKey(bearer(pk.key))).kind, "pk");
  assert.equal((await create({ label: "x", kind: "live" })).status, 400);
  assert.equal((await create({ kind: "sk" })).status, 400);
  assert.equal((await create({ label: "x".repeat(61), kind: "sk" })).status, 400);
});

test("unknown, malformed and revoked keys don't authenticate", async () => {
  assert.equal(await authenticateKey(bearer("sk_test_" + "A".repeat(32))), null);
  assert.equal(await authenticateKey(bearer("not-a-key")), null);
  assert.equal(await authenticateKey(req("GET", "/x")), null);
  const { id, key } = await (await create()).json();
  assert.equal((await DELETE(req("DELETE", `/api/v1/keys/${id}`, { headers: signedIn() }), params({ id }))).status, 200);
  assert.equal(await authenticateKey(bearer(key)), null);
  assert.equal((await DELETE(req("DELETE", `/api/v1/keys/${id}`, { headers: signedIn() }), params({ id }))).status, 404, "revoking twice is a 404");
});

test("another merchant can't see or revoke my key", async () => {
  const { id } = await (await create()).json();
  const theirs = await (await GET(req("GET", "/api/v1/keys", { headers: signedIn(OTHER_MERCHANT) }))).json();
  assert.equal(theirs.keys.length, 0);
  assert.equal((await DELETE(req("DELETE", `/api/v1/keys/${id}`, { headers: signedIn(OTHER_MERCHANT) }), params({ id }))).status, 404);
});

test(`at most ${MAX_KEYS} live keys per merchant`, async () => {
  for (let i = 0; i < MAX_KEYS; i++) assert.equal((await create({ label: `k${i}`, kind: "sk" })).status, 201);
  assert.equal((await create({ label: "one too many", kind: "sk" })).status, 409);
});
