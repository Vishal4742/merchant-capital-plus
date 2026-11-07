// Batch 050 (Stage 3): the business journey through the real v2 route handlers on PGlite, with real ES256 Privy tokens
// (a throwaway P-256 key stands in for Privy's) and real wallet signatures (viem). Covers the frozen 032 acceptance
// list: sign-in, workspace, roles, receiving proof, Owner approval, immutable versions, last Owner, logout.
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

let advance = async () => false; // CON-11: V1 CapitalMarket obligations read (RPC in production; capital-obligations.test.mjs tests the rule)
mock.module("../lib/server/capital.ts", { namedExports: { v1Obligations: (a) => advance(a) } });

const ORIGIN = "http://localhost";
const APP_ID = "clabcdefghijklmnopqrstuvw";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
process.env.PUBLIC_ORIGIN = ORIGIN;
process.env.NEXT_PUBLIC_PRIVY_APP_ID = APP_ID;
process.env.PRIVY_VERIFICATION_KEY = publicKey.export({ type: "spki", format: "pem" });

const { setupDb, resetDb, req, params } = await import("./gw-helpers.mjs");
let pg = await setupDb(); // reassigned by test 15, which installs a fresh database after simulating an outage
const privyRoute = await import("../app/api/v2/auth/privy/route.ts");
const signoutRoute = await import("../app/api/v2/auth/signout/route.ts");
const meRoute = await import("../app/api/v2/me/route.ts");
const activeRoute = await import("../app/api/v2/me/active-business/route.ts");
const bizRoute = await import("../app/api/v2/businesses/route.ts");
const membersRoute = await import("../app/api/v2/business/members/route.ts");
const memberRoute = await import("../app/api/v2/business/members/[principalId]/route.ts");
const policyRoute = await import("../app/api/v2/business/policy/route.ts");
const proofRoute = await import("../app/api/v2/business/policy/proof/route.ts");
const approvalRoute = await import("../app/api/v2/business/policy/approval/route.ts");
const walletsRoute = await import("../app/api/v2/business/approval-wallets/route.ts");
const walletsConfirmRoute = await import("../app/api/v2/business/approval-wallets/confirm/route.ts");
const noticesRoute = await import("../app/api/v2/me/notifications/route.ts");
const { isDbDown } = await import("../lib/server/v2.ts");

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims) => {
  const input = `${b64({ alg: "ES256", typ: "JWT" })}.${b64(claims)}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};
const s = () => Math.floor(Date.now() / 1000);
let ip = 0;
/** A Privy user: a DID, an optional email and the external wallets Privy verified (viem accounts). */
function user(name, { email = `${name}@example.com`, wallets = 1 } = {}) {
  const accounts = Array.from({ length: wallets }, () => privateKeyToAccount(generatePrivateKey()));
  const did = `did:privy:${name}${"x".repeat(20)}`;
  const linked = [...(email ? [{ type: "email", address: email }] : []), ...accounts.map((a) => ({ type: "wallet", address: a.address, chain_type: "ethereum", wallet_client_type: "metamask" }))];
  const claims = { iss: "privy.io", aud: APP_ID, sub: did, iat: s() - 5, exp: s() + 3600 };
  return { name, did, email, accounts, access: jwt({ ...claims, sid: `sid_${name}` }), identity: jwt({ ...claims, linked_accounts: JSON.stringify(linked) }) };
}

/** The same Privy user signing in again with another set of linked wallets (e.g. after someone took over the email). */
function relink(u, accounts) {
  const linked = [...(u.email ? [{ type: "email", address: u.email }] : []), ...accounts.map((acc) => ({ type: "wallet", address: acc.address, chain_type: "ethereum", wallet_client_type: "metamask" }))];
  const claims = { iss: "privy.io", aud: APP_ID, sub: u.did, iat: s() - 5, exp: s() + 3600 };
  return { ...u, accounts, access: jwt({ ...claims, sid: `sid_${u.name}_relinked` }), identity: jwt({ ...claims, linked_accounts: JSON.stringify(linked) }) };
}

const call = async (handler, method, path, { cookie, body, origin = ORIGIN, auth, p } = {}) => {
  const headers = { "x-forwarded-for": `10.0.0.${++ip % 250}` };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (auth) headers.authorization = auth;
  const res = await handler(req(method, path, { body, headers }), p ? params(p) : undefined);
  return { status: res.status, body: await res.json(), setCookie: res.headers.get("set-cookie") };
};
async function signIn(u, over = {}) {
  const r = await call(privyRoute.POST, "POST", "/api/v2/auth/privy", { auth: `Bearer ${over.access ?? u.access}`, body: { idToken: over.identity ?? u.identity }, origin: over.origin });
  return { ...r, cookie: r.setCookie ? r.setCookie.split(";")[0] : undefined };
}
const me = (cookie) => call(meRoute.GET, "GET", "/api/v2/me", { cookie, origin: null });
const create = (cookie, displayName = "Acme Studio", key = "k1") =>
  call(bizRoute.POST, "POST", "/api/v2/businesses", { cookie, body: { displayName, timezone: "Asia/Kolkata", idempotencyKey: key } });
const addMember = (cookie, body) => call(membersRoute.POST, "POST", "/api/v2/business/members", { cookie, body });
const setRole = (cookie, principalId, role, key) => call(memberRoute.PATCH, "PATCH", `/api/v2/business/members/${principalId}`, { cookie, body: { role, idempotencyKey: key }, p: { principalId } });
const remove = (cookie, principalId, key) => call(memberRoute.DELETE, "DELETE", `/api/v2/business/members/${principalId}?idempotencyKey=${key}`, { cookie, p: { principalId } });

let activations = 0; // a fresh idempotency key per activation request (round 2, L3)
/** The full receiving-policy step: proof (recipient signs) → approval (approver signs) → activate. */
async function activate(cookie, recipient, approver, expected = 0, over = {}) {
  const proof = await call(proofRoute.POST, "POST", "/api/v2/business/policy/proof", { cookie, body: { address: recipient.address } });
  if (proof.status !== 200) return { stage: "proof", ...proof };
  const approval = await call(approvalRoute.POST, "POST", "/api/v2/business/policy/approval", { cookie, body: { proofNonce: proof.body.nonce, wallet: approver.address } });
  if (approval.status !== 200) return { stage: "approval", ...approval, proof };
  const body = {
    proofNonce: proof.body.nonce, proofSignature: await (over.proofSigner ?? recipient).signMessage({ message: proof.body.message }),
    approvalNonce: approval.body.nonce, approvalSignature: await (over.approvalSigner ?? approver).signMessage({ message: approval.body.message }),
    expectedCurrentVersion: expected, idempotencyKey: `act-${++activations}`, ...over.body,
  };
  const done = await call(policyRoute.POST, "POST", "/api/v2/business/policy", { cookie, body });
  return { stage: "activate", ...done, proof, approval, sent: body };
}

beforeEach(async () => {
  await resetDb();
  advance = async () => false;
});

test("1, 4, 5: Privy sign-in starts a revocable session; /me shows the verified email and wallets; logout kills a copied cookie", async () => {
  const a = user("alice");
  const r = await signIn(a);
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /^wf_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800$/);
  const m = await me(r.cookie);
  assert.equal(m.status, 200);
  assert.deepEqual([m.body.principal.email, m.body.principal.wallets, m.body.businesses, m.body.active], ["alice@example.com", [a.accounts[0].address.toLowerCase()], [], null]);
  const copied = r.cookie;
  assert.equal((await call(signoutRoute.POST, "POST", "/api/v2/auth/signout", { cookie: r.cookie })).status, 200);
  assert.equal((await me(copied)).status, 401, "a copied cookie dies at logout");
  const { rows } = await pg.query("SELECT action FROM wf_audit_events ORDER BY at, action");
  assert.deepEqual(rows.map((x) => x.action).sort(), ["auth.sign_in", "auth.sign_out"]);
});

test("2: forged, mismatched or cross-site sign-ins are refused; without the Privy config sign-in is off (503)", async () => {
  const a = user("alice"), b = user("bob");
  assert.equal((await signIn(a, { identity: b.identity })).status, 401, "identity token of another user");
  assert.equal((await signIn(a, { access: `${a.access.slice(0, -4)}AAAA` })).status, 401, "tampered signature");
  assert.equal((await signIn(a, { origin: "https://evil.example" })).status, 403, "login CSRF");
  const key = process.env.PRIVY_VERIFICATION_KEY;
  delete process.env.PRIVY_VERIFICATION_KEY;
  try {
    assert.equal((await signIn(a)).status, 503);
  } finally {
    process.env.PRIVY_VERIFICATION_KEY = key;
  }
  const { rows } = await pg.query("SELECT count(*)::int AS n FROM wf_sessions");
  assert.equal(rows[0].n, 0, "no session for any refused attempt");
});

test("5: an expired or revoked session is 401", async () => {
  const r = await signIn(user("alice"));
  await pg.query("UPDATE wf_sessions SET expires_at = 1");
  assert.equal((await me(r.cookie)).status, 401);
  assert.equal((await me("wf_session=forged")).status, 401);
});

test("workspace: creation makes you the Owner and the active workspace; 10b same key + other payload → 409; replay → same workspace", async () => {
  const a = await signIn(user("alice"));
  const c = await create(a.cookie);
  assert.equal(c.status, 201);
  assert.equal((await create(a.cookie)).body.id, c.body.id, "same key, same request: the same workspace");
  assert.equal((await create(a.cookie, "Another name")).status, 409);
  const m = await me(a.cookie);
  assert.deepEqual(m.body.active, { id: c.body.id, role: "owner" });
  assert.equal((await create(a.cookie, "Bad\u0000", "k2")).status, 400);
  assert.equal((await call(bizRoute.POST, "POST", "/api/v2/businesses", { cookie: a.cookie, body: { displayName: "X", timezone: "Mars/Base", idempotencyKey: "k3" } })).status, 400);
});

test("6, 7, 8, 9: roles are enforced in every service; guessed ids are 404; a removed member loses access on the next request", async () => {
  const [ua, ub, uc] = [user("alice"), user("bob"), user("carol", { wallets: 0 })];
  const a = await signIn(ua), b = await signIn(ub), c = await signIn(uc);
  const biz = (await create(a.cookie)).body.id;
  assert.equal((await addMember(a.cookie, { wallet: ub.accounts[0].address, role: "operator", idempotencyKey: "m1" })).status, 201);
  assert.equal((await addMember(a.cookie, { email: "CAROL@example.com", role: "viewer", idempotencyKey: "m2" })).status, 201);
  assert.equal((await addMember(a.cookie, { email: "nobody@example.com", role: "viewer", idempotencyKey: "m3" })).status, 404);
  assert.equal((await addMember(a.cookie, { email: "carol@example.com", role: "viewer", idempotencyKey: "m4" })).status, 409, "already a member");
  for (const x of [b, c]) assert.equal((await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: x.cookie, body: { businessId: biz } })).status, 200);
  assert.equal((await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: b.cookie, body: { businessId: "biz_guessed" } })).status, 404);
  // Operator and Viewer: read yes; members, policy no (403)
  assert.equal((await call(membersRoute.GET, "GET", "/api/v2/business/members", { cookie: c.cookie, origin: null })).status, 200);
  for (const x of [b, c]) {
    assert.equal((await addMember(x.cookie, { wallet: ua.accounts[0].address, role: "owner", idempotencyKey: "e1" })).status, 403);
    assert.equal((await call(proofRoute.POST, "POST", "/api/v2/business/policy/proof", { cookie: x.cookie, body: { address: ub.accounts[0].address } })).status, 403);
    assert.equal((await setRole(x.cookie, (await me(x.cookie)).body.principal.id, "owner", "e2")).status, 403, "no self-promotion");
  }
  // a foreign workspace's member id is 404 from here
  const d = await signIn(user("dave"));
  await create(d.cookie, "Other Co", "d1");
  const dave = (await me(d.cookie)).body.principal.id;
  assert.equal((await setRole(a.cookie, dave, "viewer", "g1")).status, 404);
  // removal takes effect on the very next request
  const bob = (await me(b.cookie)).body.principal.id;
  assert.equal((await remove(a.cookie, bob, "r1")).status, 200);
  assert.equal((await call(membersRoute.GET, "GET", "/api/v2/business/members", { cookie: b.cookie, origin: null })).status, 401);
  assert.equal((await me(b.cookie)).body.active, null);
  // a mutation from another site is refused even with a valid cookie (CSRF)
  assert.equal((await call(membersRoute.POST, "POST", "/api/v2/business/members", { cookie: a.cookie, origin: "https://evil.example", body: { wallet: ub.accounts[0].address, role: "owner", idempotencyKey: "x2" } })).status, 403);
});

test("10: a workspace never loses its last Owner; two Owners may hand over; idempotent replays answer the same", async () => {
  const [ua, ub] = [user("alice"), user("bob")];
  const a = await signIn(ua), b = await signIn(ub);
  await create(a.cookie);
  const alice = (await me(a.cookie)).body.principal.id;
  assert.equal((await setRole(a.cookie, alice, "viewer", "s1")).status, 409, "last Owner can't demote themself");
  assert.equal((await remove(a.cookie, alice, "s2")).status, 409, "or leave");
  assert.equal((await addMember(a.cookie, { wallet: ub.accounts[0].address, role: "owner", idempotencyKey: "s3" })).status, 201);
  assert.equal((await setRole(a.cookie, alice, "operator", "s4")).status, 200);
  assert.equal((await setRole(a.cookie, alice, "operator", "s4")).status, 403, "now an Operator: no member rights (replay is checked after the role)");
  const { rows } = await pg.query("SELECT owner_count, (SELECT count(*)::int FROM wf_memberships m WHERE m.business_id = b.id AND m.role = 'owner') AS real FROM wf_businesses b");
  assert.deepEqual(rows[0], { owner_count: 1, real: 1 });
  void b;
});

test("round 2 (M1): a replayed member write gets its stored answer; the same key with another payload is 409", async () => {
  const [ua, ub] = [user("alice"), user("bob")];
  const a = await signIn(ua);
  await signIn(ub);
  await create(a.cookie);
  const add = (role) => addMember(a.cookie, { wallet: ub.accounts[0].address, role, idempotencyKey: "m1" });
  const first = await add("viewer");
  assert.equal(first.status, 201);
  const again = await add("viewer");
  assert.deepEqual([again.status, again.body], [first.status, first.body], "replay: the stored answer, not 'already in this workspace'");
  assert.equal((await add("operator")).status, 409, "same key, different payload");
  const bob = first.body.principalId;
  const r1 = await setRole(a.cookie, bob, "operator", "m2");
  assert.equal(r1.status, 200);
  const r2 = await setRole(a.cookie, bob, "operator", "m2");
  assert.deepEqual([r2.status, r2.body], [r1.status, r1.body]);
  const rm = await remove(a.cookie, bob, "m3");
  assert.equal(rm.status, 200);
  const rm2 = await remove(a.cookie, bob, "m3");
  assert.deepEqual([rm2.status, rm2.body], [rm.status, rm.body], "removal replay: the stored answer, not 404");
});

test("round 2 (M2): the team list shows a member's email and linked wallets only to that member; adds are rate-limited", async () => {
  const [ua, ub] = [user("alice"), user("bobby", { wallets: 2 })];
  const a = await signIn(ua);
  const b = await signIn(ub);
  const biz = (await create(a.cookie)).body.id;
  assert.equal((await addMember(a.cookie, { wallet: ub.accounts[0].address, role: "viewer", idempotencyKey: "v1" })).status, 201);
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: b.cookie, body: { businessId: biz } });
  const list = async (cookie) => (await call(membersRoute.GET, "GET", "/api/v2/business/members", { cookie, origin: null })).body.members;
  const byOwner = await list(a.cookie);
  const self = byOwner.find((m) => m.you), other = byOwner.find((m) => !m.you);
  assert.deepEqual([self.email, self.wallets], ["alice@example.com", [ua.accounts[0].address.toLowerCase()]], "your own details");
  assert.deepEqual([other.email, other.wallets, other.label], [null, [], "bo...@example.com"], "another member: a masked label only");
  assert.ok(!JSON.stringify(byOwner).includes(ub.accounts[1].address.toLowerCase()), "no other linked wallet leaks");
  const byViewer = await list(b.cookie);
  assert.deepEqual(byViewer.find((m) => !m.you), { ...byViewer.find((m) => !m.you), email: null, wallets: [], label: "al...@example.com" });
  // adds: at most 10 a minute per Owner (enumeration of who has signed up is slowed; known/unknown still differ)
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await addMember(a.cookie, { email: `nobody${i}@example.com`, role: "viewer", idempotencyKey: `n${i}` })).status);
  assert.deepEqual(statuses, [404, 404, 404, 404, 404, 404, 404, 404, 404, 429, 429], "the add above counted: 10 a minute");
});

test("10 (race): two Owners demoting themselves at once on one connection still leave exactly one Owner", async () => {
  const [ua, ub] = [user("alice"), user("bob")];
  const a = await signIn(ua), b = await signIn(ub);
  const biz = (await create(a.cookie)).body.id;
  await addMember(a.cookie, { wallet: ub.accounts[0].address, role: "owner", idempotencyKey: "o1" });
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: b.cookie, body: { businessId: biz } });
  const [alice, bob] = [(await me(a.cookie)).body.principal.id, (await me(b.cookie)).body.principal.id];
  const results = await Promise.all([setRole(a.cookie, alice, "viewer", "r1"), setRole(b.cookie, bob, "viewer", "r2")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const { rows } = await pg.query("SELECT owner_count FROM wf_businesses");
  assert.equal(rows[0].owner_count, 1);
});

test("FR-BIZ-3/4: receiving proof + Owner approval activate version 1; GET shows it; history is immutable; replays are 409", async () => {
  const ua = user("alice");
  const recipient = privateKeyToAccount(generatePrivateKey());
  const a = await signIn(ua);
  await create(a.cookie);
  assert.deepEqual((await call(policyRoute.GET, "GET", "/api/v2/business/policy", { cookie: a.cookie, origin: null })).body, { current: null, history: [] });
  const r = await activate(a.cookie, recipient, ua.accounts[0]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.version, r.body.recipient, r.body.chainId, r.body.v1Obligations], [1, recipient.address.toLowerCase(), 1874, false]);
  assert.equal(r.body.token, "0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7");
  assert.match(r.proof.body.message, /^localhost wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n\nWhiteflow receiving-wallet proof/);
  assert.match(r.proof.body.message, /Chain ID: 1874/);
  assert.ok(r.approval.body.message.includes(`urn:whiteflow:policy:${r.body.policyHash}`), "the approval binds the policy hash (EIP-4361 resource)");
  // the same request again (same idempotency key) gets the stored answer (round 2, L3); the same signed pair under a
  // new key is refused: both challenges were consumed
  const same = await call(policyRoute.POST, "POST", "/api/v2/business/policy", { cookie: a.cookie, body: r.sent });
  assert.deepEqual([same.status, same.body], [201, r.body]);
  assert.equal((await call(policyRoute.POST, "POST", "/api/v2/business/policy", { cookie: a.cookie, body: { ...r.sent, idempotencyKey: "fresh-key" } })).status, 409);
  assert.equal((await call(policyRoute.POST, "POST", "/api/v2/business/policy", { cookie: a.cookie, body: { ...r.sent, idempotencyKey: undefined } })).status, 400, "the key is required");
  const g = await call(policyRoute.GET, "GET", "/api/v2/business/policy", { cookie: a.cookie, origin: null });
  assert.equal(g.body.current.version, 1);
  // version 2 needs expectedCurrentVersion 1; a stale expectation is 409 and consumes nothing new
  const recipient2 = privateKeyToAccount(generatePrivateKey());
  assert.equal((await activate(a.cookie, recipient2, ua.accounts[0], 0)).status, 409);
  const v2 = await activate(a.cookie, recipient2, ua.accounts[0], 1);
  assert.equal(v2.status, 201);
  const history = (await call(policyRoute.GET, "GET", "/api/v2/business/policy", { cookie: a.cookie, origin: null })).body.history;
  assert.deepEqual(history.map((p) => [p.version, p.recipient]), [[2, recipient2.address.toLowerCase()], [1, recipient.address.toLowerCase()]]);
  assert.equal(history[1].policyHash, r.body.policyHash, "version 1 never changes (14)");
});

test("11, 12: the proof must be signed by the receiving wallet, the approval by the Owner's Privy-verified wallet; purposes don't swap", async () => {
  const ua = user("alice", { wallets: 2 });
  const recipient = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const a = await signIn(ua);
  await create(a.cookie);
  assert.equal((await activate(a.cookie, recipient, ua.accounts[0], 0, { proofSigner: ua.accounts[0] })).status, 400, "proof signed by the approver");
  assert.equal((await activate(a.cookie, recipient, ua.accounts[0], 0, { approvalSigner: recipient })).status, 400, "approval signed by the recipient");
  const notLinked = await activate(a.cookie, recipient, stranger);
  assert.deepEqual([notLinked.stage, notLinked.status], ["approval", 403], "an unlinked wallet can't approve");
  // swap the nonces: a receiving proof can't be presented as an approval and vice versa
  const ok = await activate(a.cookie, recipient, ua.accounts[1], 0, { body: {} });
  assert.equal(ok.status, 201, "the second linked wallet approves");
  const p = await call(proofRoute.POST, "POST", "/api/v2/business/policy/proof", { cookie: a.cookie, body: { address: recipient.address } });
  const swapped = await call(policyRoute.POST, "POST", "/api/v2/business/policy", {
    cookie: a.cookie, body: { proofNonce: p.body.nonce, proofSignature: await recipient.signMessage({ message: p.body.message }), approvalNonce: p.body.nonce, approvalSignature: await recipient.signMessage({ message: p.body.message }), expectedCurrentVersion: 1, idempotencyKey: "swap-1" },
  });
  assert.equal(swapped.status, 409);
  assert.equal((await call(proofRoute.POST, "POST", "/api/v2/business/policy/proof", { cookie: a.cookie, body: { address: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" } })).status, 400, "not the token address");
});

test("an email-only Owner can't approve until a wallet is linked (step-up fails closed)", async () => {
  const ue = user("erin", { wallets: 0 });
  const e = await signIn(ue);
  await create(e.cookie);
  const someWallet = privateKeyToAccount(generatePrivateKey());
  const r = await activate(e.cookie, someWallet, someWallet);
  assert.deepEqual([r.stage, r.status], ["approval", 403]);
  assert.match(r.body.error, /Link one in the sign-in dialog/);
});

test("CON-11: a failed Capital obligations read refuses activation (503) and consumes nothing; an advance is recorded on the policy", async () => {
  const ua = user("alice");
  const recipient = privateKeyToAccount(generatePrivateKey());
  const a = await signIn(ua);
  await create(a.cookie);
  advance = async () => { throw new Error("rpc down"); };
  const down = await activate(a.cookie, recipient, ua.accounts[0]);
  assert.equal(down.status, 503);
  advance = async () => true;
  const again = await call(policyRoute.POST, "POST", "/api/v2/business/policy", { cookie: a.cookie, body: down.sent });
  assert.equal(again.status, 201, "the same signed pair still works: nothing was consumed by the refusal");
  assert.equal(again.body.v1Obligations, true);
});

test("15: with the database unreachable every v2 route fails closed with 503 and changes nothing", async () => {
  const { setTestDb } = await import("../lib/server/db.ts");
  const down = Object.assign(new Error("fetch failed"), { name: "NeonDbError", sourceError: new Error("ECONNREFUSED") });
  setTestDb({ query: async () => { throw down; }, transaction: async () => { throw down; } });
  try {
    assert.equal((await signIn(user("alice"))).status, 503);
    assert.equal((await me("wf_session=abc")).status, 503);
    // every other v2 route too (round 2, L5: the title claimed more than two routes were checked)
    const cookie = "wf_session=abc";
    const p = { principalId: "pr_x" };
    const routes = [
      [signoutRoute.POST, "POST", "/api/v2/auth/signout"], [activeRoute.POST, "POST", "/api/v2/me/active-business", { businessId: "biz_x" }],
      [bizRoute.POST, "POST", "/api/v2/businesses", { displayName: "X", timezone: "UTC", idempotencyKey: "k" }],
      [membersRoute.GET, "GET", "/api/v2/business/members"], [membersRoute.POST, "POST", "/api/v2/business/members", { email: "x@example.com", role: "viewer", idempotencyKey: "k" }],
      [memberRoute.PATCH, "PATCH", "/api/v2/business/members/pr_x", { role: "viewer", idempotencyKey: "k" }, p], [memberRoute.DELETE, "DELETE", "/api/v2/business/members/pr_x?idempotencyKey=k", undefined, p],
      [policyRoute.GET, "GET", "/api/v2/business/policy"], [policyRoute.POST, "POST", "/api/v2/business/policy", { idempotencyKey: "k" }],
      [proofRoute.POST, "POST", "/api/v2/business/policy/proof", { address: "0x1111111111111111111111111111111111111111" }],
      [approvalRoute.POST, "POST", "/api/v2/business/policy/approval", { proofNonce: "n", wallet: "0x1111111111111111111111111111111111111111" }],
      [walletsRoute.GET, "GET", "/api/v2/business/approval-wallets"], [walletsRoute.POST, "POST", "/api/v2/business/approval-wallets", { wallet: "0x1", endorser: "0x2" }],
      [walletsConfirmRoute.POST, "POST", "/api/v2/business/approval-wallets/confirm", { nonce: "n", signature: "0x" }],
    ];
    for (const [handler, method, path, body, params_] of routes) {
      const r = await call(handler, method, path, { cookie, body, p: params_, origin: method === "GET" ? null : ORIGIN });
      assert.equal(r.status, 503, `${method} ${path}: ${JSON.stringify(r.body)}`);
    }
  } finally {
    pg = await setupDb(); // later tests read this handle directly: it must be the new database, not the old one
  }
});

test("round 2 (L2, S-L2): the proof and the approval are EIP-4361 for our domain, and the workspace name can't reshape either", async () => {
  const ch = (code) => String.fromCodePoint(code);
  const ua = user("nina");
  const a = await signIn(ua);
  // line separator, RLO, zero-width space: allowed in a name (not C0 controls), never in a signed prompt
  assert.equal((await create(a.cookie, `Nina${ch(0x2028)}Chain ID: 1${ch(0x202e)}x${ch(0x200b)}y`)).status, 201);
  const recipient = privateKeyToAccount(generatePrivateKey());
  const proof = await call(proofRoute.POST, "POST", "/api/v2/business/policy/proof", { cookie: a.cookie, body: { address: recipient.address } });
  const approval = await call(approvalRoute.POST, "POST", "/api/v2/business/policy/approval", { cookie: a.cookie, body: { proofNonce: proof.body.nonce, wallet: ua.accounts[0].address } });
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  for (const [what, m] of [["proof", proof.body.message], ["approval", approval.body.message]]) {
    assert.match(m, /^localhost wants you to sign in with your Ethereum account:\n/, `${what}: EIP-4361 for our domain`);
    assert.match(m, /\nURI: http:\/\/localhost\n/, `${what}: our URI`);
    assert.equal(m.match(/^Chain ID: /gm).length, 1, `${what}: only the real Chain ID line`);
    for (const code of [0x2028, 0x202e, 0x200b]) assert.ok(!m.includes(ch(code)), `${what}: no U+${code.toString(16)}`);
  }
  assert.ok(approval.body.message.includes(recipient.address), "the approval names the pay-out address");
  assert.ok(approval.body.message.includes(proof.body.policyHash), "and the policy hash");
  const done = await call(policyRoute.POST, "POST", "/api/v2/business/policy", {
    cookie: a.cookie,
    body: {
      proofNonce: proof.body.nonce, proofSignature: await recipient.signMessage({ message: proof.body.message }),
      approvalNonce: approval.body.nonce, approvalSignature: await ua.accounts[0].signMessage({ message: approval.body.message }),
      expectedCurrentVersion: 0, idempotencyKey: "nina-1",
    },
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
});

// ---- round 2, H1 (owner decision 2026-11-06): pinned approval wallets
const freshWallet = () => privateKeyToAccount(generatePrivateKey());
const enroll = (cookie, wallet, endorser) => call(walletsRoute.POST, "POST", "/api/v2/business/approval-wallets", { cookie, body: { wallet, endorser } });
const confirmEnroll = (cookie, nonce, signature) => call(walletsConfirmRoute.POST, "POST", "/api/v2/business/approval-wallets/confirm", { cookie, body: { nonce, signature } });
const enrolled = (cookie) => call(walletsRoute.GET, "GET", "/api/v2/business/approval-wallets", { cookie, origin: null });
const notices = async (kind) => (await pg.query("SELECT principal_id, detail FROM wf_notifications WHERE kind = $1 ORDER BY principal_id", [kind])).rows;

test("H1: the first activation pins its approval wallet; a wallet linked later (e.g. after an email takeover) can't approve", async () => {
  const ua = user("alice");
  const a = await signIn(ua);
  await create(a.cookie);
  assert.deepEqual((await enrolled(a.cookie)).body, { wallets: [], firstPinOpen: true });
  assert.equal((await activate(a.cookie, freshWallet(), ua.accounts[0])).status, 201);
  const list = (await enrolled(a.cookie)).body;
  assert.deepEqual([list.firstPinOpen, list.wallets.map((w) => [w.wallet, w.you, w.endorsedBy])], [false, [[ua.accounts[0].address, true, null]]], "pinned, checksummed");
  // someone signs in as alice (same Privy user, e.g. a taken-over email) and links their own wallet
  const evil = freshWallet();
  const t = await signIn(relink(ua, [evil]));
  assert.equal(t.status, 200);
  const r = await activate(t.cookie, freshWallet(), evil, 1);
  assert.deepEqual([r.stage, r.status], ["approval", 403], "a newly linked wallet isn't an enrolled approval wallet");
  assert.match(r.body.error, /enrolled approval wallet/);
  // the new link was announced to every Owner of alice's workspaces (alice herself here)
  const linked = await notices("wallet.linked");
  const shortEvil = `${evil.address.toLowerCase().slice(0, 6)}...${evil.address.toLowerCase().slice(-4)}`;
  assert.ok(linked.some((n) => n.detail.wallet === shortEvil), JSON.stringify(linked));
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM wf_settlement_policies")).rows[0].n, 1, "still one version");
});

test("H1: an enrolled approval wallet endorses another; only then can it approve; every Owner is told", async () => {
  const [ua, ub] = [user("alice"), user("bobby")];
  const [a1, b1] = [ua.accounts[0], ub.accounts[0]];
  const a = await signIn(ua), b = await signIn(ub);
  const biz = (await create(a.cookie)).body.id;
  assert.equal((await activate(a.cookie, freshWallet(), a1)).status, 201); // pins a1
  assert.equal((await addMember(a.cookie, { wallet: b1.address, role: "owner", idempotencyKey: "own-b" })).status, 201);
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: b.cookie, body: { businessId: biz } });
  const blocked = await activate(b.cookie, freshWallet(), b1, 1);
  assert.deepEqual([blocked.stage, blocked.status], ["approval", 403], "bob's wallet isn't enrolled yet");
  assert.equal((await enroll(b.cookie, b1.address, b1.address)).status, 403, "a wallet can't endorse itself");
  assert.equal((await enroll(b.cookie, freshWallet().address, a1.address)).status, 400, "only a wallet Privy verified for you");
  const c = await enroll(b.cookie, b1.address, a1.address); // bob asks; alice's enrolled wallet must sign
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.match(c.body.message, new RegExp(`^localhost wants you to sign in with your Ethereum account:\\n${a1.address}\\n`));
  assert.ok(c.body.message.includes(b1.address), "the message names the wallet being enrolled");
  assert.equal((await confirmEnroll(b.cookie, c.body.nonce, await b1.signMessage({ message: c.body.message }))).status, 403, "not signed by the endorser");
  const done = await confirmEnroll(b.cookie, c.body.nonce, await a1.signMessage({ message: c.body.message }));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(await confirmEnroll(b.cookie, c.body.nonce, await a1.signMessage({ message: c.body.message })), done, "a replay is the same answer");
  assert.equal((await activate(b.cookie, freshWallet(), b1, 1)).status, 201, "now bob approves version 2");
  const all = (await pg.query("SELECT kind, principal_id FROM wf_notifications ORDER BY kind")).rows;
  const told = all.filter((n) => n.kind === "approval_wallet.enrolled").map((n) => n.principal_id).sort();
  assert.ok(told.length, `notices: ${JSON.stringify(all)}`);
  const [alice, bob] = [(await me(a.cookie)).body.principal.id, (await me(b.cookie)).body.principal.id];
  assert.deepEqual(told, [alice, bob].sort(), "every Owner, the requester included");
  assert.equal((await enroll(b.cookie, b1.address, a1.address)).status, 409, "already enrolled");
});

test("H1: an endorser must be an enrolled wallet of a current Owner; Operators and Viewers can't enroll", async () => {
  const [ua, ub] = [user("alice"), user("bobby")];
  const [a1, b1] = [ua.accounts[0], ub.accounts[0]];
  const a = await signIn(ua), b = await signIn(ub);
  const biz = (await create(a.cookie)).body.id;
  assert.equal((await activate(a.cookie, freshWallet(), a1)).status, 201);
  assert.equal((await addMember(a.cookie, { wallet: b1.address, role: "operator", idempotencyKey: "op-b" })).status, 201);
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: b.cookie, body: { businessId: biz } });
  assert.equal((await enroll(b.cookie, b1.address, a1.address)).status, 403, "an Operator can't enroll");
  assert.equal((await enroll(a.cookie, a1.address, a1.address)).status, 409, "already enrolled");
  // the endorsement is checked again at confirm: alice issues a request, then loses her Owner role before it's signed
  const second = freshWallet();
  const a2 = await signIn(relink(ua, [a1, second]));
  const c = await enroll(a2.cookie, second.address, a1.address);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const bob = (await me(b.cookie)).body.principal.id;
  const promoted = await setRole(a2.cookie, bob, "owner", "promote-b");
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  const alice = (await me(a2.cookie)).body.principal.id;
  assert.equal((await setRole(a2.cookie, alice, "viewer", "demote-a")).status, 200);
  assert.equal((await confirmEnroll(a2.cookie, c.body.nonce, await a1.signMessage({ message: c.body.message }))).status, 403, "no longer an Owner");
});

test("NFR-17 (round 2, L5): no token, signature, signed message or session cookie in logs, audit rows or notices", async () => {
  const logged = [];
  const original = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const k of Object.keys(original)) console[k] = (...args) => logged.push(args.map(String).join(" "));
  const secrets = [];
  try {
    const ua = user("alice", { wallets: 2 });
    const [a1, a2w] = ua.accounts;
    secrets.push(ua.access, ua.identity);
    assert.equal((await signIn(ua, { access: `${ua.access}x` })).status, 401, "a bad token is refused (and logged by reason only)");
    const a = await signIn(ua);
    secrets.push(a.cookie.split("=")[1]);
    await create(a.cookie);
    const recipient = freshWallet();
    const bad = await activate(a.cookie, recipient, a1, 0, { approvalSigner: a2w }); // a wrong approval signature first
    assert.equal(bad.status, 400);
    secrets.push(bad.sent.proofSignature, bad.sent.approvalSignature, bad.proof.body.message, bad.approval.body.message);
    const good = await activate(a.cookie, freshWallet(), a1);
    assert.equal(good.status, 201);
    secrets.push(good.sent.proofSignature, good.sent.approvalSignature, good.proof.body.message, good.approval.body.message);
    const c = await enroll(a.cookie, a2w.address, a1.address);
    const sig = await a1.signMessage({ message: c.body.message });
    secrets.push(c.body.message, sig);
    assert.equal((await confirmEnroll(a.cookie, c.body.nonce, sig)).status, 200);
  } finally {
    Object.assign(console, original);
  }
  const rows = JSON.stringify((await pg.query("SELECT * FROM wf_audit_events")).rows) + JSON.stringify((await pg.query("SELECT * FROM wf_notifications")).rows);
  const logs = logged.join("\n");
  assert.ok(logs.includes("sign-in refused"), "the refusal was logged (by reason)");
  for (const secret of secrets) {
    assert.ok(!logs.includes(secret), `not in logs: ${secret.slice(0, 12)}…`);
    assert.ok(!rows.includes(secret), `not in audit or notices: ${secret.slice(0, 12)}…`);
  }
});

// ---- round 3 (independent review of round 2)
/** Two Owners: alice (pinned a1) and bobby (b1, endorsed by a1); returns cookies, ids and wallets. */
async function twoOwners() {
  const [ua, ub] = [user("alice"), user("bobby")];
  const [a1, b1] = [ua.accounts[0], ub.accounts[0]];
  const a = await signIn(ua), b = await signIn(ub);
  const biz = (await create(a.cookie)).body.id;
  assert.equal((await activate(a.cookie, freshWallet(), a1)).status, 201);
  assert.equal((await addMember(a.cookie, { wallet: b1.address, role: "owner", idempotencyKey: "own-b" })).status, 201);
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: b.cookie, body: { businessId: biz } });
  const c = await enroll(b.cookie, b1.address, a1.address);
  assert.equal((await confirmEnroll(b.cookie, c.body.nonce, await a1.signMessage({ message: c.body.message }))).status, 200);
  const [alice, bob] = [(await me(a.cookie)).body.principal.id, (await me(b.cookie)).body.principal.id];
  return { ua, ub, a1, b1, a, b, biz, alice, bob };
}

test("round 3 (S-H1): demoting or removing an Owner revokes their approval wallets; coming back needs a fresh endorsement", async () => {
  const t = await twoOwners();
  // an approval issued while bob's wallet is enrolled …
  const recipient = freshWallet();
  const proof = await call(proofRoute.POST, "POST", "/api/v2/business/policy/proof", { cookie: t.b.cookie, body: { address: recipient.address } });
  const approval = await call(approvalRoute.POST, "POST", "/api/v2/business/policy/approval", { cookie: t.b.cookie, body: { proofNonce: proof.body.nonce, wallet: t.b1.address } });
  assert.equal(approval.status, 200);
  // … then bob is demoted and promoted again (e.g. from a taken-over Owner login)
  assert.equal((await setRole(t.a.cookie, t.bob, "viewer", "d1")).status, 200);
  assert.equal((await setRole(t.a.cookie, t.bob, "owner", "p1")).status, 200);
  const late = await call(policyRoute.POST, "POST", "/api/v2/business/policy", {
    cookie: t.b.cookie,
    body: {
      proofNonce: proof.body.nonce, proofSignature: await recipient.signMessage({ message: proof.body.message }),
      approvalNonce: approval.body.nonce, approvalSignature: await t.b1.signMessage({ message: approval.body.message }),
      expectedCurrentVersion: 1, idempotencyKey: "late-1",
    },
  });
  assert.equal(late.status, 409, "the activation statement itself refuses a revoked approval wallet");
  const again = await activate(t.b.cookie, freshWallet(), t.b1, 1);
  assert.deepEqual([again.stage, again.status], ["approval", 403], "and a new approval with it is refused up front");
  assert.deepEqual((await enrolled(t.a.cookie)).body.wallets.map((w) => w.wallet), [t.a1.address], "the list shows active wallets of current Owners only");
  const revoked = await notices("approval_wallet.revoked");
  assert.deepEqual(revoked.map((n) => n.principal_id).sort(), [t.alice, t.bob].sort(), "every Owner is told");
  // a fresh endorsement brings it back
  const c = await enroll(t.b.cookie, t.b1.address, t.a1.address);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await confirmEnroll(t.b.cookie, c.body.nonce, await t.a1.signMessage({ message: c.body.message }))).status, 200);
  assert.equal((await activate(t.b.cookie, freshWallet(), t.b1, 1)).status, 201);
  // removal revokes too
  assert.equal((await remove(t.a.cookie, t.bob, "rm-b")).status, 200);
  assert.equal((await addMember(t.a.cookie, { wallet: t.b1.address, role: "owner", idempotencyKey: "own-b-again" })).status, 201);
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: t.b.cookie, body: { businessId: t.biz } });
  const back = await activate(t.b.cookie, freshWallet(), t.b1, 2);
  assert.deepEqual([back.stage, back.status], ["approval", 403], "re-added: no approval without a new endorsement");
});

test("round 3 (C-M2): the endorser is re-checked at confirm, with the requester still an Owner", async () => {
  const t = await twoOwners();
  const second = freshWallet();
  const b2 = await signIn(relink(t.ub, [t.b1, second]));
  const c = await enroll(b2.cookie, second.address, t.a1.address); // bob asks alice's a1 to endorse
  assert.equal(c.status, 200);
  assert.equal((await setRole(b2.cookie, t.alice, "viewer", "demote-a")).status, 200); // bob demotes alice before a1 signs
  const r = await confirmEnroll(b2.cookie, c.body.nonce, await t.a1.signMessage({ message: c.body.message }));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(r.body.error, /endorsing wallet/);
});

test("round 3 (C-M1): two identical member writes at once both get the stored answer", async () => {
  const [ua, ub] = [user("alice"), user("bobby")];
  const a = await signIn(ua);
  await signIn(ub);
  await create(a.cookie);
  const add = () => addMember(a.cookie, { wallet: ub.accounts[0].address, role: "viewer", idempotencyKey: "same-add" });
  const adds = await Promise.all([add(), add()]);
  assert.deepEqual(adds.map((r) => r.status), [201, 201], JSON.stringify(adds.map((r) => r.body)));
  assert.deepEqual(adds[0].body, adds[1].body);
  const bob = adds[0].body.principalId;
  const rms = await Promise.all([remove(a.cookie, bob, "same-rm"), remove(a.cookie, bob, "same-rm")]);
  assert.deepEqual(rms.map((r) => r.status), [200, 200], JSON.stringify(rms.map((r) => r.body)));
});

test("round 3 (S-M1): an Owner reads their notices, including the pin by the first activation", async () => {
  const ua = user("alice");
  const a = await signIn(ua);
  await create(a.cookie);
  assert.equal((await activate(a.cookie, freshWallet(), ua.accounts[0])).status, 201);
  const r = await call(noticesRoute.GET, "GET", "/api/v2/me/notifications", { cookie: a.cookie, origin: null });
  assert.equal(r.status, 200);
  assert.ok(r.body.notifications.some((n) => n.kind === "approval_wallet.pinned" && n.text.includes("approval wallet")), JSON.stringify(r.body));
  assert.equal((await call(noticesRoute.GET, "GET", "/api/v2/me/notifications", { origin: null })).status, 401);
});

test("round 3 (lows): masked approver for non-Owners, the endorsement names who asks, replays don't re-look-up, 08P01 isn't an outage", async () => {
  const t = await twoOwners();
  // S-L2: a Viewer sees the approving wallet shortened, an Owner in full
  const uc = user("carol");
  const c = await signIn(uc);
  assert.equal((await addMember(t.a.cookie, { wallet: uc.accounts[0].address, role: "viewer", idempotencyKey: "view-c" })).status, 201);
  await call(activeRoute.POST, "POST", "/api/v2/me/active-business", { cookie: c.cookie, body: { businessId: t.biz } });
  const asViewer = (await call(policyRoute.GET, "GET", "/api/v2/business/policy", { cookie: c.cookie, origin: null })).body.current;
  const asOwner = (await call(policyRoute.GET, "GET", "/api/v2/business/policy", { cookie: t.a.cookie, origin: null })).body.current;
  assert.equal(asOwner.approvalWallet, t.a1.address.toLowerCase());
  assert.notEqual(asViewer.approvalWallet, asOwner.approvalWallet);
  assert.match(asViewer.approvalWallet, /^0x[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/);
  // S-L3: the endorsement message says who asks (masked)
  const second = freshWallet();
  const b2 = await signIn(relink(t.ub, [t.b1, second]));
  const req2 = await enroll(b2.cookie, second.address, t.a1.address);
  assert.ok(req2.body.message.includes("bo...@example.com"), req2.body.message);
  // C-L6: a wallet unlinked before confirm gets a clear answer, and the challenge stays usable
  const b3 = await signIn(relink(t.ub, [t.b1]));
  const r = await confirmEnroll(b3.cookie, req2.body.nonce, await t.a1.signMessage({ message: req2.body.message }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no longer linked/);
  // C-L1: an add replay returns the stored answer even after the person's wallet is unlinked
  const ud = user("dave");
  await signIn(ud);
  const first = await addMember(t.a.cookie, { wallet: ud.accounts[0].address, role: "viewer", idempotencyKey: "add-d" });
  assert.equal(first.status, 201);
  await signIn(relink(ud, [freshWallet()]));
  const replay = await addMember(t.a.cookie, { wallet: ud.accounts[0].address, role: "viewer", idempotencyKey: "add-d" });
  assert.deepEqual([replay.status, replay.body], [201, first.body]);
  // C-L4: a protocol error (e.g. a parameter-count bug) is not reported as "database down"
  assert.equal(isDbDown({ code: "08P01" }), false);
  assert.equal(isDbDown({ code: "08006" }), true);
});
