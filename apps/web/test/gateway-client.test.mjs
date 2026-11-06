// claude-frontend checks for lib/gateway-client.ts (FR-GW-1, FR-GW-2): the browser's typed client for claude-contracts'
// gateway routes (API.md, batch 007). Shapes are parsed from snake_case, anything malformed is refused, and every failure
// is one plain sentence. fetch is faked; test/gateway-server.test.mjs runs the same parsers over real PGlite rows.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayError, gatewayClient } from "../lib/gateway-client.ts";

// the API's shapes (API.md): a fixed link, and an items page
const LINK = { id: "lnk_CoLdBrEw01", slug: "CoLdBrEw01", url: "/l/CoLdBrEw01", amount: "12.5", currency: "USD", description: "Two cold brews, table 4", reference_id: null, single_use: true, status: "active", expires_at: null, created_at: "2026-11-06T03:00:00.000Z", payments: 0 };
const PAGE = { id: "page_BaNdRaMeNu", slug: "BaNdRaMeNu", url: "/p/BaNdRaMeNu", title: "Order ahead", description: null, logo_url: "https://bandrabeans.example/logo.png", color: "#B4532A", currency: "USD", items: [{ name: "Cold brew", price: "5" }], open_amount: null, created_at: "2026-11-06T03:00:00.000Z", payments: 12 };
const LINK_BODY = { amount: "25.00", currency: "USD", description: "Cold brew", single_use: true };
const PAGE_BODY = { title: "Order ahead", currency: "USD", items: [{ name: "Cold brew", price: "5.00" }] };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status) => new Response("<!doctype html><title>404</title>", { status, headers: { "content-type": "text/html" } });

/** A client whose fetch answers `reply(url, init)` and records each call. */
function fake(reply) {
  const calls = [];
  const client = gatewayClient({
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return reply(String(url), init);
    },
  });
  return { client, calls };
}

async function refused(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GatewayError, `a GatewayError, got ${error}`);
    return error;
  }
  assert.fail("expected the call to fail");
}

test("an answer that doesn't match the contract is refused, never shown half-read", async () => {
  const good = LINK;
  const broken = [
    { ...good, status: "refunded" }, // not a link status
    { ...good, amount: "25,00" }, // not a decimal
    { ...good, amount: 25 }, // a number, not a string
    { ...good, currency: "BTC" },
    { ...good, slug: "../../admin" },
    { ...good, single_use: "yes" },
    { ...good, payments: -1 },
  ];
  for (const link of broken) {
    const { client } = fake(() => json(link, 201));
    const error = await refused(client.createLink(LINK_BODY));
    assert.match(error.message, /couldn't read/, JSON.stringify(link));
  }
  for (const bad of [{ ...PAGE, color: "red;background:url(x)" }, { ...PAGE, logo_url: "javascript:alert(1)" }, { ...PAGE, logo_url: "http://plain.example/logo.png" }, { ...PAGE, items: [] }, { ...PAGE, open_amount: { min: "1", max: null } }]) {
    const { client } = fake(() => json(bad, 201));
    await refused(client.createPage(PAGE_BODY));
  }
  const { client } = fake(() => json({ nope: true }, 201));
  await refused(client.createLink(LINK_BODY));
});

test("errors become plain sentences", async () => {
  const cases = [
    // the route isn't on this server (claude-contracts' backend not merged): Next's own HTML 404
    [() => html(404), /^Links aren't available on this server yet\.$/, 503],
    [() => json({ error: "No such payment link." }, 404), /^No such payment link\.$/, 404],
    [() => json({ error: "Sign in to your merchant dashboard first." }, 401), /Sign in/, 401],
    [() => json({ error: "You already have a link with that reference_id." }, 409), /already have a link/, 409],
    [() => html(502), /gateway had a problem/, 502],
    [() => json({ error: "x".repeat(5000) }, 400), /^x{1,300}$/, 400],
  ];
  for (const [reply, message, status] of cases) {
    const { client } = fake(reply);
    const error = await refused(client.createLink(LINK_BODY));
    assert.match(error.message, message);
    assert.equal(error.status, status);
  }
  const pages = fake(() => html(404));
  assert.equal((await refused(pages.client.createPage(PAGE_BODY))).message, "Pages aren't available on this server yet.");
  const offline = gatewayClient({ fetch: async () => { throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.7:5432"); } });
  const error = await refused(offline.createLink(LINK_BODY));
  assert.equal(error.status, 0);
  assert.doesNotMatch(error.message, /ECONNREFUSED|10\.0\.0\.7/, "never the transport's own text");
});

test("create and cancel send JSON to the contract's routes", async () => {
  const { client, calls } = fake(() => json(LINK, 201));
  const body = LINK_BODY;
  const created = await client.createLink(body);
  assert.equal(created.slug, LINK.slug);
  assert.deepEqual(Object.keys(created).sort(), ["amount", "created_at", "currency", "description", "expires_at", "id", "payments", "reference_id", "single_use", "slug", "status"]);
  assert.equal(calls[0].url, "/api/v1/links");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), body);

  const cancel = fake(() => json({ id: "lnk_a/b", status: "cancelled" }));
  await cancel.client.cancelLink("lnk_a/b");
  assert.equal(cancel.calls[0].url, "/api/v1/links/lnk_a%2Fb/cancel", "the id is encoded into the path");
  assert.equal(cancel.calls[0].init.method, "POST");

  const p = fake(() => json(PAGE, 201));
  assert.equal((await p.client.createPage(PAGE_BODY)).slug, PAGE.slug);
  assert.equal(p.calls[0].url, "/api/v1/pages");
});
