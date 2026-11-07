// Batch 051 (Stage 3): the v1 gateway after the cutover. Every handler that used the retired wallet cookie now resolves
// Whiteflow session → membership → role scope → the workspace's linked legacy merchant (032 R2-1 map). Spec acceptance
// 6–10. Network is off (fetch throws), so chain/Arkiv reads fail fast; an allowed caller is anything but 401/403/409.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

globalThis.fetch = async () => {
  throw new Error("network is off in this test");
};

const { setupDb, resetDb, req, params, signedIn, legacyCookie, seedWorkspace, seedMember, MERCHANT, OTHER_MERCHANT, ORIGIN } = await import("./gw-helpers.mjs");
const pg = await setupDb();
const { createKey } = await import("../lib/server/keys.ts");
const { dashboardWorkspace: currentWorkspaceFor } = await import("../lib/server/legacy.ts");
const { WF_SESSION_COOKIE } = await import("../lib/server/auth-sessions.ts");

const route = async (path) => import(`../app/api/v1/${path}/route.ts`);
const OWNER = "owner", DRAFT = "owner+operator", ALL = "all";
// [label, route folder, method, url, scope class, body, params] — the spec's R2-1 table, written out
const ROUTES = [
  ["keys GET", "keys", "GET", "/api/v1/keys", OWNER],
  ["keys POST", "keys", "POST", "/api/v1/keys", OWNER, { label: "Server", kind: "sk" }],
  ["keys/[id] DELETE", "keys/[id]", "DELETE", "/api/v1/keys/key_nope", OWNER, undefined, { id: "key_nope" }],
  ["webhooks GET", "webhooks", "GET", "/api/v1/webhooks", OWNER],
  ["webhooks POST", "webhooks", "POST", "/api/v1/webhooks", OWNER, { url: "https://127.0.0.1/hook" }],
  ["webhooks/[id] DELETE", "webhooks/[id]", "DELETE", "/api/v1/webhooks/wh_nope", OWNER, undefined, { id: "wh_nope" }],
  ["webhooks/[id]/test POST", "webhooks/[id]/test", "POST", "/api/v1/webhooks/wh_nope/test", OWNER, undefined, { id: "wh_nope" }],
  ["deliveries replay POST", "webhooks/deliveries/[id]/replay", "POST", "/api/v1/webhooks/deliveries/dlv_nope/replay", OWNER, undefined, { id: "dlv_nope" }],
  ["capital publish POST", "capital/offers/[id]/publish", "POST", "/api/v1/capital/offers/1/publish", OWNER, undefined, { id: "1" }],
  ["links POST", "links", "POST", "/api/v1/links", DRAFT, { currency: "USDT", description: "Cold brew", single_use: false, amount: "5" }],
  ["links cancel POST", "links/[id]/cancel", "POST", "/api/v1/links/lnk_nope/cancel", DRAFT, undefined, { id: "lnk_nope" }],
  ["pages POST", "pages", "POST", "/api/v1/pages", DRAFT, { title: "Tip jar" }],
  ["vouchers POST", "vouchers", "POST", "/api/v1/vouchers", DRAFT, { kind: "nope" }],
  ["vouchers deactivate POST", "vouchers/[id]/deactivate", "POST", "/api/v1/vouchers/v_nope/deactivate", DRAFT, undefined, { id: "v_nope" }],
  ["vouchers publish POST", "vouchers/[id]/publish", "POST", "/api/v1/vouchers/v_nope/publish", DRAFT, undefined, { id: "v_nope" }],
  ["refunds sync POST", "payments/[id]/refunds/sync", "POST", "/api/v1/payments/1/refunds/sync", DRAFT, { tx_hash: `0x${"ab".repeat(32)}` }, { id: "1" }],
  ["links GET", "links", "GET", "/api/v1/links", ALL],
  ["pages GET", "pages", "GET", "/api/v1/pages", ALL],
  ["vouchers GET", "vouchers", "GET", "/api/v1/vouchers", ALL],
  ["reports GET", "reports", "GET", "/api/v1/reports?from=2026-11-05&to=2026-11-05", ALL],
  ["reports.csv GET", "reports.csv", "GET", "/api/v1/reports.csv?from=2026-11-05&to=2026-11-05", ALL],
  ["settlements GET", "settlements", "GET", "/api/v1/settlements?from=2026-11-05&to=2026-11-05", ALL],
  ["capital/merchant GET", "capital/merchant", "GET", "/api/v1/capital/merchant", ALL],
  // main's assistant-connector routes (batch 052/054), cut over in the merge: invoices:read
  ["links/[id] GET", "links/[id]", "GET", "/api/v1/links/lnk_nope", ALL, undefined, { id: "lnk_nope" }],
  ["account GET", "account", "GET", "/api/v1/account", ALL],
  ["operations GET", "operations/[key]", "GET", "/api/v1/operations/op-nope", ALL, undefined, { key: "op-nope" }],
];
// the routes a linked sk_ key reaches: webhooks GET/POST (051) and main's connector routes (batch 052/054)
const KEY_ROUTES = new Set(["webhooks GET", "webhooks POST", "links POST", "links GET", "links/[id] GET", "reports GET", "account GET", "operations GET"]);
const allows = (cls, role) => cls === ALL || role === "owner" || (cls === DRAFT && role === "operator");

async function hit([, folder, method, url, , body, p], headers) {
  const mod = await route(folder);
  const res = await mod[method](req(method, url, { body, headers }), p ? params(p) : undefined);
  return { status: res.status, text: await res.text() };
}

beforeEach(resetDb);

test("R2-1: every cut-over handler admits exactly the roles in the spec table (spec 6, AT-28)", async () => {
  const members = { owner: { headers: signedIn() }, operator: await seedMember(MERCHANT, "operator"), viewer: await seedMember(MERCHANT, "viewer") };
  for (const r of ROUTES) {
    for (const [role, m] of Object.entries(members)) {
      const { status, text } = await hit(r, m.headers);
      // allowed = reached the service: not refused (401/403/409) and not crashed (500); 4xx/502/503 come from the service.
      // Known exception, outside this batch: the capital services (capital.ts, capital-arkiv.ts) answer 500, not 502,
      // when the RPC/Arkiv is unreachable, and the network is off here (follow-up for those files' owner).
      const crashed = status === 500 && !["capital publish POST", "capital/merchant GET"].includes(r[0]);
      if (allows(r[4], role)) assert.ok(![401, 403, 409].includes(status) && !crashed, `${r[0]} as ${role}: ${status} ${text}`);
      else assert.equal(status, 403, `${r[0]} as ${role}: ${status} ${text}`);
    }
  }
});

test("signed out, the retired wallet cookie, and an unlinked workspace get 401, 401 and 409 everywhere (spec 6, 7)", async () => {
  const unlinked = await seedWorkspace("0x00000000000000000000000000000000000000c3", { linked: false });
  for (const r of ROUTES) {
    assert.equal((await hit(r, { origin: ORIGIN })).status, 401, `${r[0]} signed out`);
    assert.equal((await hit(r, legacyCookie())).status, 401, `${r[0]} with the old mc_session cookie`);
    const u = await hit(r, unlinked.headers);
    assert.equal(u.status, 409, `${r[0]} unlinked: ${u.text}`);
    assert.match(u.text, /isn't linked to a merchant account yet/);
  }
});

test("dashboard mutations need our own origin (CSRF) (spec 6)", async () => {
  for (const r of ROUTES.filter(([, , method]) => method !== "GET")) {
    const { cookie } = signedIn();
    assert.equal((await hit(r, { cookie })).status, 403, `${r[0]} without Origin`);
    assert.equal((await hit(r, { cookie, origin: "https://evil.example" })).status, 403, `${r[0]} from another site`);
  }
});

test("removal and demotion take effect on the next request (spec 8, FR-AUTH-2)", async () => {
  const links = ROUTES.find(([label]) => label === "links GET");
  const create = ROUTES.find(([label]) => label === "links POST");
  const viewer = await seedMember(MERCHANT, "viewer");
  const operator = await seedMember(MERCHANT, "operator");
  assert.equal((await hit(links, viewer.headers)).status, 200);
  assert.equal((await hit(create, operator.headers)).status, 201);
  await pg.query("DELETE FROM wf_memberships WHERE principal_id = $1", [viewer.principalId]);
  await pg.query("UPDATE wf_memberships SET role = 'viewer' WHERE principal_id = $1", [operator.principalId]);
  assert.equal((await hit(links, viewer.headers)).status, 401, "no workspace any more");
  assert.equal((await hit(create, operator.headers)).status, 403, "a Viewer now");
  await pg.query("UPDATE wf_sessions SET revoked_at = 1 WHERE principal_id = $1", [operator.principalId]);
  assert.equal((await hit(links, operator.headers)).status, 401, "a revoked session");
});

test("keys: a linked sk_ key manages its own workspace's webhooks; unlinked sk_ → 409; pk_ → 401; new keys carry the workspace (spec 9)", async () => {
  const owner = await seedWorkspace(MERCHANT);
  const keysRoute = await route("keys");
  const hooks = await route("webhooks");
  const made = await keysRoute.POST(req("POST", "/api/v1/keys", { body: { label: "Server", kind: "sk" }, headers: owner.headers }));
  assert.equal(made.status, 201);
  const { key, id } = await made.json();
  assert.deepEqual((await pg.query("SELECT business_id FROM app_gw_keys WHERE id = $1", [id])).rows, [{ business_id: owner.businessId }]);

  const bearer = (k) => ({ authorization: `Bearer ${k}` });
  const listed = await hooks.GET(req("GET", "/api/v1/webhooks", { headers: bearer(key) }));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { webhooks: [] });
  assert.equal((await hooks.POST(req("POST", "/api/v1/webhooks", { body: { url: "https://127.0.0.1/x" }, headers: bearer(key) }))).status, 400, "the key reaches the service (a private host is refused there)");

  const loose = await createKey(OTHER_MERCHANT, "Old server", "sk"); // a key of a wallet nobody linked
  const refused = await hooks.GET(req("GET", "/api/v1/webhooks", { headers: bearer(loose.key) }));
  assert.equal(refused.status, 409);
  // a key whose merchant isn't the wallet its workspace linked (rows edited by hand) acts for nobody
  const odd = await createKey(OTHER_MERCHANT, "Odd server", "sk");
  await pg.query("UPDATE app_gw_keys SET business_id = $2 WHERE id = $1", [odd.record.id, owner.businessId]);
  assert.equal((await hooks.GET(req("GET", "/api/v1/webhooks", { headers: bearer(odd.key) }))).status, 409);
  const pk = await createKey(MERCHANT, "Browser", "pk");
  assert.equal((await hooks.GET(req("GET", "/api/v1/webhooks", { headers: bearer(pk.key) }))).status, 401);
  assert.equal((await hooks.GET(req("GET", "/api/v1/webhooks", { headers: bearer("sk_test_nope") }))).status, 401);

  // only the key routes take a key: everything else still needs a signed-in member
  for (const r of ROUTES.filter(([label]) => !KEY_ROUTES.has(label))) {
    assert.equal((await hit(r, { ...bearer(key), origin: ORIGIN })).status, 401, `${r[0]} with a secret key`);
  }
  // main's connector routes reach their service with the linked key (links POST: 400, it needs an Idempotency-Key), and
  // answer a publishable key 403 (batch 052), where webhooks keep the 401 above
  for (const r of ROUTES.filter(([label]) => KEY_ROUTES.has(label) && !label.startsWith("webhooks"))) {
    const { status, text } = await hit(r, { ...bearer(key), origin: ORIGIN });
    assert.ok(![401, 403, 409, 500].includes(status), `${r[0]} with a secret key: ${status} ${text}`);
    assert.equal((await hit(r, { ...bearer(pk.key), origin: ORIGIN })).status, 403, `${r[0]} with a publishable key`);
    assert.equal((await hit(r, { ...bearer(loose.key), origin: ORIGIN })).status, 409, `${r[0]} with an unlinked key`);
  }
});

test("tenant isolation: another workspace's ids are 404 (spec 10, AT-27)", async () => {
  const create = await route("links");
  const made = await create.POST(req("POST", "/api/v1/links", { body: { currency: "USDT", description: "Mine", single_use: false, amount: "5" }, headers: signedIn(MERCHANT) }));
  assert.equal(made.status, 201);
  const { id } = await made.json();
  const cancel = await route("links/[id]/cancel");
  const theirs = await cancel.POST(req("POST", `/api/v1/links/${id}/cancel`, { headers: signedIn(OTHER_MERCHANT) }), params({ id }));
  assert.equal(theirs.status, 404);
  const mine = await cancel.POST(req("POST", `/api/v1/links/${id}/cancel`, { headers: signedIn(MERCHANT) }), params({ id }));
  assert.equal(mine.status, 200);
});

test("v1 mutations leave an audit row naming the member and role (FR-AUTH-5)", async () => {
  const operator = await seedMember(MERCHANT, "operator");
  const create = ROUTES.find(([label]) => label === "links POST");
  const res = await hit(create, operator.headers);
  assert.equal(res.status, 201);
  const { id } = JSON.parse(res.text);
  const rows = (await pg.query("SELECT business_id, actor_principal_id, role, source, action, target, outcome FROM wf_audit_events WHERE action LIKE 'v1.%'")).rows;
  assert.deepEqual(rows, [{ business_id: operator.businessId, actor_principal_id: operator.principalId, role: "operator", source: "session", action: "v1.links.create", target: id, outcome: "ok" }]);
});

test("audit rows for the other mutations that succeed offline; refused or failed calls leave none (FR-AUTH-5)", async () => {
  const owner = await seedWorkspace(MERCHANT);
  const call = async (folder, method, url, { body, p, headers = owner.headers } = {}) => {
    const mod = await route(folder);
    const res = await mod[method](req(method, url, { body, headers }), p ? params(p) : undefined);
    return { status: res.status, body: await res.json() };
  };
  const key = await call("keys", "POST", "/api/v1/keys", { body: { label: "Server", kind: "sk" } });
  assert.equal(key.status, 201);
  assert.equal((await call("keys/[id]", "DELETE", `/api/v1/keys/${key.body.id}`, { p: { id: key.body.id } })).status, 200);
  const link = await call("links", "POST", "/api/v1/links", { body: { currency: "USDT", description: "Tea", single_use: false, amount: "5" } });
  assert.equal((await call("links/[id]/cancel", "POST", `/api/v1/links/${link.body.id}/cancel`, { p: { id: link.body.id } })).status, 200);
  const page = await call("pages", "POST", "/api/v1/pages", { body: { title: "Menu", currency: "USDT", items: [{ name: "Tea", price: "2.00" }] } });
  assert.equal(page.status, 201, JSON.stringify(page.body));
  // refused (Viewer) and failed (unknown id) calls write nothing
  const viewer = await seedMember(MERCHANT, "viewer");
  assert.equal((await call("links", "POST", "/api/v1/links", { body: { currency: "USDT", description: "x", single_use: false, amount: "5" }, headers: viewer.headers })).status, 403);
  assert.equal((await call("keys/[id]", "DELETE", "/api/v1/keys/key_nope", { p: { id: "key_nope" } })).status, 404);
  const rows = (await pg.query("SELECT action, target, role FROM wf_audit_events WHERE action LIKE 'v1.%' ORDER BY at, action")).rows;
  const expected = [
    { action: "v1.keys.create", target: key.body.id, role: "owner" },
    { action: "v1.keys.revoke", target: key.body.id, role: "owner" },
    { action: "v1.links.create", target: link.body.id, role: "owner" },
    { action: "v1.links.cancel", target: link.body.id, role: "owner" },
    { action: "v1.pages.create", target: page.body.id, role: "owner" },
  ];
  assert.deepEqual(rows.map((r) => r.action).sort(), expected.map((r) => r.action).sort());
  for (const e of expected) assert.ok(rows.some((r) => r.action === e.action && r.target === e.target && r.role === e.role), e.action);
});

test("dashboard pages: the workspace session resolves the linked merchant; the old cookie resolves nothing (spec 7)", async () => {
  const owner = await seedWorkspace(MERCHANT);
  const viewer = await seedMember(MERCHANT, "viewer");
  const token = (headers) => headers.cookie.split("=")[1];
  const ws = await currentWorkspaceFor(token(owner.headers));
  assert.equal(ws.merchant.toLowerCase(), MERCHANT);
  assert.equal(ws.role, "owner");
  assert.ok(ws.scopes.has("keys:manage"));
  const vw = await currentWorkspaceFor(token(viewer.headers));
  assert.equal(vw.role, "viewer");
  assert.equal(vw.scopes.has("keys:manage"), false);
  assert.equal(await currentWorkspaceFor(undefined), null);
  assert.equal(await currentWorkspaceFor(decodeURIComponent(legacyCookie().cookie.split("=")[1])), null);
  const unlinked = await seedWorkspace("0x00000000000000000000000000000000000000d4", { linked: false });
  assert.equal(await currentWorkspaceFor(token(unlinked.headers)), null);
  assert.equal(WF_SESSION_COOKIE, "wf_session");
});
