// Batch 051 (Stage 3): claiming a legacy merchant wallet for a Whiteflow workspace through the real v2 route handlers on
// PGlite, with real wallet signatures (viem). Spec acceptance 1, 2, 4, 5, 12 (3 = real-Postgres races,
// tools/stage3/legacy-neon.mjs).
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// CON-11: the V1 CapitalMarket obligations read (an RPC call in production), steered per test
let obligations = async () => false;
mock.module("../lib/server/policies.ts", { namedExports: { readV1Obligations: (address) => obligations(address) } });

const { setupDb, resetDb, req, seedWorkspace, seedMember, ORIGIN } = await import("./gw-helpers.mjs");
const pg = await setupDb();
const legacy = await import("../lib/server/legacy.ts");
const statusRoute = await import("../app/api/v2/legacy/route.ts");
const challengeRoute = await import("../app/api/v2/legacy/challenge/route.ts");
const claimRoute = await import("../app/api/v2/legacy/claim/route.ts");
const { createKey } = await import("../lib/server/keys.ts");

const UNLINKED = "0x00000000000000000000000000000000000000a1"; // the workspace's tag (it starts with no legacy link)
const OTHER_WS = "0x00000000000000000000000000000000000000b2";

let ip = 0;
const call = async (handler, method, path, { headers = {}, body, origin } = {}) => {
  const h = { ...headers, "x-forwarded-for": `10.1.0.${++ip % 250}` };
  if (origin !== undefined) {
    if (origin === null) delete h.origin;
    else h.origin = origin;
  }
  const res = await handler(req(method, path, { body, headers: h }));
  return { status: res.status, body: await res.json() };
};
const challenge = (headers, address, opts = {}) => call(challengeRoute.POST, "POST", "/api/v2/legacy/challenge", { headers, body: { address }, ...opts });
const claim = (headers, body, opts = {}) => call(claimRoute.POST, "POST", "/api/v2/legacy/claim", { headers, body, ...opts });
const status = (headers) => call(statusRoute.GET, "GET", "/api/v2/legacy", { headers, origin: null });

/** Challenge → the wallet signs → claim. `signer` defaults to the wallet itself. */
async function link(headers, wallet, { signer = wallet } = {}) {
  const c = await challenge(headers, wallet.address);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const signature = await signer.signMessage({ message: c.body.message });
  return { c, signature, r: await claim(headers, { nonce: c.body.nonce, signature }) };
}
const business = async (id) => (await pg.query("SELECT legacy_merchant, v1_obligations FROM wf_businesses WHERE id = $1", [id])).rows[0];
const consumed = async (nonce) => (await pg.query("SELECT consumed_at FROM wf_legacy_claim_challenges WHERE nonce = $1", [nonce])).rows[0]?.consumed_at ?? null;

beforeEach(async () => {
  await resetDb();
  obligations = async () => false;
});

test("an Owner links a legacy wallet: business linked, the wallet's keys join it, one audit row, every Owner told (spec 1)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  const second = await seedMember(UNLINKED, "owner", "second", { linked: false });
  const key = await createKey(wallet.address, "Shop server", "sk");
  const before = (await pg.query("SELECT id, merchant, kind, label, prefix, key_hash, created_at, revoked_at FROM app_gw_keys ORDER BY id")).rows;

  const { c, r } = await link(owner.headers, wallet);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { merchant: wallet.address, v1Obligations: false });
  assert.match(c.body.message, new RegExp(`^${new URL(ORIGIN).host} wants you to sign in with your Ethereum account:\\n${wallet.address}`));
  assert.match(c.body.message, /Chain ID: 1874/);
  assert.ok(c.body.message.includes(`urn:whiteflow:business:${owner.businessId}`));

  assert.deepEqual(await business(owner.businessId), { legacy_merchant: wallet.address.toLowerCase(), v1_obligations: false });
  const keys = (await pg.query("SELECT id, business_id FROM app_gw_keys")).rows;
  assert.deepEqual(keys, [{ id: key.record.id, business_id: owner.businessId }]);
  const after = (await pg.query("SELECT id, merchant, kind, label, prefix, key_hash, created_at, revoked_at FROM app_gw_keys ORDER BY id")).rows;
  assert.deepEqual(after, before, "no key column other than business_id changes");

  const audit = (await pg.query("SELECT action, business_id, actor_principal_id, role, source, target, outcome, detail FROM wf_audit_events WHERE action = 'legacy.claim'")).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].business_id, owner.businessId);
  assert.equal(audit[0].actor_principal_id, owner.principalId);
  assert.equal(audit[0].role, "owner");
  assert.equal(audit[0].target, wallet.address.toLowerCase());
  assert.deepEqual(audit[0].detail, { v1Obligations: false, keysLinked: 1 });
  const told = (await pg.query("SELECT principal_id FROM wf_notifications WHERE kind = 'legacy.linked' ORDER BY principal_id")).rows.map((x) => x.principal_id);
  assert.deepEqual(told, [owner.principalId, second.principalId].sort());

  assert.deepEqual(await status(owner.headers), {
    status: 200,
    body: { workspace: { id: owner.businessId, displayName: "Seed 000000", role: "owner" }, linked: wallet.address, v1Obligations: false },
  });
});

test("a wrong signer is refused and the challenge stays usable; a replay returns the same answer once (spec 2)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  const { c, r } = await link(owner.headers, wallet, { signer: stranger });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(await consumed(c.body.nonce), null, "a wrong signature never consumes the challenge");
  assert.equal((await business(owner.businessId)).legacy_merchant, null);

  const signature = await wallet.signMessage({ message: c.body.message });
  const first = await claim(owner.headers, { nonce: c.body.nonce, signature });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await claim(owner.headers, { nonce: c.body.nonce, signature });
  assert.deepEqual(again, first, "the same nonce again is the same answer (idempotent replay)");
  const audits = (await pg.query("SELECT count(*)::int AS n FROM wf_audit_events WHERE action = 'legacy.claim'")).rows[0].n;
  assert.equal(audits, 1);

  // a signature over an altered message recovers another address: refused
  const fresh = await seedWorkspace(OTHER_WS, { linked: false });
  const c2 = await challenge(fresh.headers, stranger.address);
  const altered = await stranger.signMessage({ message: c2.body.message.replace("1874", "1") });
  assert.equal((await claim(fresh.headers, { nonce: c2.body.nonce, signature: altered })).status, 403);
  assert.equal(await consumed(c2.body.nonce), null);
});

test("a challenge works only for the principal and workspace it was issued to, and only until it expires (spec 2)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const a = await seedWorkspace(UNLINKED, { linked: false });
  const b = await seedWorkspace(OTHER_WS, { linked: false });
  const coOwner = await seedMember(UNLINKED, "owner", "co", { linked: false });
  const c = await challenge(a.headers, wallet.address);
  const signature = await wallet.signMessage({ message: c.body.message });
  assert.equal((await claim(b.headers, { nonce: c.body.nonce, signature })).status, 409, "another workspace's Owner");
  assert.equal((await claim(coOwner.headers, { nonce: c.body.nonce, signature })).status, 409, "another Owner of the same workspace");
  assert.equal(await consumed(c.body.nonce), null);

  const ctx = { principalId: a.principalId, businessId: a.businessId, role: "owner", scopes: new Set(["business:manage"]), source: "session", credentialId: `ses_seed_owner${UNLINKED.slice(2)}`, requestId: "r1" };
  await assert.rejects(legacy.claimLegacyMerchant(ctx, { nonce: c.body.nonce, signature }, { now: c.body.expiresAt + 1 }), (err) => err.status === 409);
  assert.equal((await business(a.businessId)).legacy_merchant, null);
  assert.equal((await claim(a.headers, { nonce: "not a nonce!", signature })).status, 409);
  assert.equal((await claim(a.headers, { nonce: c.body.nonce, signature: "0x1234" })).status, 400);
});

test("one link per workspace and per wallet: a linked workspace can't start another, a linked wallet can't be taken (spec 2)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const a = await seedWorkspace(UNLINKED, { linked: false });
  const b = await seedWorkspace(OTHER_WS, { linked: false });
  const cb = await challenge(b.headers, wallet.address); // issued before a links it
  assert.equal((await link(a.headers, wallet)).r.status, 200);
  assert.equal((await challenge(a.headers, privateKeyToAccount(generatePrivateKey()).address)).status, 409, "already linked");

  const r = await claim(b.headers, { nonce: cb.body.nonce, signature: await wallet.signMessage({ message: cb.body.message }) });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already linked to another workspace/);
  assert.equal(await consumed(cb.body.nonce), null, "the losing statement aborted: its challenge is unused");
  assert.equal((await business(b.businessId)).legacy_merchant, null);
});

test("CON-11: V1 obligations set the flag; a failed obligations read links nothing (spec 4, AT-47)", async () => {
  const owed = privateKeyToAccount(generatePrivateKey());
  const a = await seedWorkspace(UNLINKED, { linked: false });
  obligations = async () => {
    throw new Error("rpc down");
  };
  const { c, r } = await link(a.headers, owed);
  assert.equal(r.status, 503);
  assert.equal(await consumed(c.body.nonce), null);
  assert.equal((await business(a.businessId)).legacy_merchant, null);

  obligations = async (address) => address.toLowerCase() === owed.address.toLowerCase();
  const again = await claim(a.headers, { nonce: c.body.nonce, signature: await owed.signMessage({ message: c.body.message }) });
  assert.equal(again.status, 200);
  assert.deepEqual(await business(a.businessId), { legacy_merchant: owed.address.toLowerCase(), v1_obligations: true });
  assert.equal(again.body.v1Obligations, true);
});

test("only an Owner on our own site can claim (spec 5, AT-28)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  const operator = await seedMember(UNLINKED, "operator", "op", { linked: false });
  const viewer = await seedMember(UNLINKED, "viewer", "vw", { linked: false });
  assert.equal((await challenge(operator.headers, wallet.address)).status, 403);
  assert.equal((await challenge(viewer.headers, wallet.address)).status, 403);
  assert.equal((await challenge({ origin: ORIGIN }, wallet.address)).status, 401);
  assert.equal((await challenge({ authorization: "Bearer sk_test_abcdefghijklmnopqrstuvwxyz012345", origin: ORIGIN }, wallet.address)).status, 401);
  assert.equal((await challenge(owner.headers, wallet.address, { origin: "https://evil.example" })).status, 403);
  assert.equal((await challenge(owner.headers, wallet.address, { origin: null })).status, 403);

  const c = await challenge(owner.headers, wallet.address);
  const signature = await wallet.signMessage({ message: c.body.message });
  assert.equal((await claim(operator.headers, { nonce: c.body.nonce, signature })).status, 403);
  assert.equal((await claim(viewer.headers, { nonce: c.body.nonce, signature })).status, 403);
  assert.equal((await claim(owner.headers, { nonce: c.body.nonce, signature }, { origin: "https://evil.example" })).status, 403);
  assert.equal(await consumed(c.body.nonce), null);

  assert.equal((await status(viewer.headers)).body.workspace.role, "viewer");
  assert.equal((await status({})).status, 401);
  assert.equal((await challenge(owner.headers, "0x1234")).status, 400);
});

test("refused claims are limited per principal: a usable challenge can't be replayed into endless chain reads (review S-M1)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  let reads = 0;
  obligations = async () => {
    reads += 1;
    throw new Error("rpc down");
  };
  const c = await challenge(owner.headers, wallet.address);
  const good = await wallet.signMessage({ message: c.body.message });
  const bad = await stranger.signMessage({ message: c.body.message });
  const seen = [];
  for (let i = 0; i < 12; i++) seen.push((await claim(owner.headers, { nonce: c.body.nonce, signature: i % 2 ? good : bad })).status);
  assert.deepEqual(seen, [403, 503, 403, 503, 403, 503, 403, 503, 403, 503, 429, 429]);
  assert.equal(reads, 5, "one chain read per attempt that got past the signature check, none after the limit");
  assert.equal(await consumed(c.body.nonce), null);
});

test("a wallet linked elsewhere is refused before the chain read; one already linked here answers as linked (review S-M1)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const a = await seedWorkspace(UNLINKED, { linked: false });
  const b = await seedWorkspace(OTHER_WS, { linked: false });
  const cb = await challenge(b.headers, wallet.address);
  const ca2 = await challenge(a.headers, wallet.address); // a second challenge of a's, issued before a links
  assert.equal((await link(a.headers, wallet)).r.status, 200);
  let reads = 0;
  obligations = async () => {
    reads += 1;
    return false;
  };
  assert.equal((await claim(b.headers, { nonce: cb.body.nonce, signature: await wallet.signMessage({ message: cb.body.message }) })).status, 409);
  const again = await claim(a.headers, { nonce: ca2.body.nonce, signature: await wallet.signMessage({ message: ca2.body.message }) });
  assert.deepEqual(again, { status: 200, body: { merchant: wallet.address, v1Obligations: false } });
  assert.equal(reads, 0, "neither refusal nor the already-linked answer reads the chain");
});

const ch = (code) => String.fromCodePoint(code);
test("the workspace name can't reshape the signed message: control, format and separator characters become spaces (review S-L2)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  // line separator, RLO, LRI, NEL, zero-width space, LRM, an astral tag character
  const name = `Acme${ch(0x2028)}Chain ID: 1${ch(0x202e)}evil${ch(0x2066)}x${ch(0x85)}y${ch(0x200b)}z${ch(0x200e)}w${ch(0xe0041)}v`;
  await pg.query("UPDATE wf_businesses SET display_name = $2 WHERE id = $1", [owner.businessId, name]);
  const c = await challenge(owner.headers, wallet.address);
  assert.equal(c.status, 200);
  for (const code of [0x85, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x200e, 0xe0041]) assert.ok(!c.body.message.includes(ch(code)), code.toString(16));
  assert.ok(c.body.message.includes('"Acme Chain ID: 1 evil x y z w v"'));
  assert.equal(c.body.message.match(/^Chain ID: /gm).length, 1, "only the real Chain ID line");
});

test("a signed-in principal without a workspace sees workspace: null", async () => {
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  await pg.query("UPDATE wf_sessions SET active_business_id = NULL");
  assert.deepEqual(await status(owner.headers), { status: 200, body: { workspace: null } });
});

test("NFR-17: no signature or challenge message in logs, audit detail or the claim response (spec 12)", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const owner = await seedWorkspace(UNLINKED, { linked: false });
  const logged = [];
  const original = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const k of Object.keys(original)) console[k] = (...args) => logged.push(args.map(String).join(" "));
  let sent;
  try {
    const bad = await link(owner.headers, wallet, { signer: stranger });
    const signature = await wallet.signMessage({ message: bad.c.body.message });
    sent = [bad.signature, signature, bad.c.body.message];
    const ok = await claim(owner.headers, { nonce: bad.c.body.nonce, signature });
    assert.equal(ok.status, 200);
    for (const secret of sent) assert.ok(!JSON.stringify(ok.body).includes(secret));
  } finally {
    Object.assign(console, original);
  }
  const rows = JSON.stringify((await pg.query("SELECT * FROM wf_audit_events")).rows) + JSON.stringify((await pg.query("SELECT * FROM wf_notifications")).rows);
  for (const secret of [...sent, sent[2].split("\n").find((l) => l.startsWith("Nonce: "))]) {
    assert.ok(!logged.join("\n").includes(secret), "not in logs");
    assert.ok(!rows.includes(secret), "not in audit or notifications");
  }
});
