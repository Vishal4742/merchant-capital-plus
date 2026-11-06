// claude-frontend checks for lib/gateway-client.ts (FR-GW-1, FR-GW-2): the typed client for claude-contracts' gateway
// routes (API.md, batch 007). Shapes are parsed from snake_case, anything malformed is refused, and every failure is
// one plain sentence. fetch is faked. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayError, gatewayClient } from "../lib/gateway-client.ts";
import { PREVIEW_LINKS, PREVIEW_PAGES } from "../lib/gateway-preview.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status) => new Response("<!doctype html><title>404</title>", { status, headers: { "content-type": "text/html" } });

/** A client whose fetch answers `reply(url, init)` and records each call. */
function fake(reply, transport = {}) {
  const calls = [];
  const client = gatewayClient({
    ...transport,
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

test("lists links and reads every snake_case field", async () => {
  const { client, calls } = fake(() => json({ links: PREVIEW_LINKS }));
  const links = await client.listLinks();
  assert.equal(calls[0].url, "/api/v1/links");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(links.length, PREVIEW_LINKS.length);
  const open = links.find((l) => l.amount === null);
  assert.ok(open, "an open-amount link parses with amount null");
  const first = links[0];
  assert.deepEqual(Object.keys(first).sort(), ["amount", "created_at", "currency", "description", "expires_at", "id", "payments", "reference_id", "single_use", "slug", "status"]);
  assert.equal(typeof first.single_use, "boolean");
  assert.equal(typeof first.payments, "number");
  assert.ok(links.some((l) => l.expires_at !== null) && links.some((l) => l.reference_id === null));
});

test("lists pages: items pages and open-amount pages", async () => {
  const { client } = fake(() => json({ pages: PREVIEW_PAGES }));
  const pages = await client.listPages();
  const items = pages.find((p) => p.items), open = pages.find((p) => p.open_amount);
  assert.ok(items.items.length >= 2 && items.open_amount === null);
  assert.deepEqual(Object.keys(items.items[0]).sort(), ["name", "price"]);
  assert.equal(open.items, null);
  assert.ok("min" in open.open_amount && "max" in open.open_amount);
  assert.match(items.color, /^#[0-9A-F]{6}$/i);
  assert.match(items.logo_url, /^https:\/\//);
});

test("public reads take the slug and carry the merchant's name", async () => {
  const link = PREVIEW_LINKS[0];
  const { client, calls } = fake(() => json({ slug: link.slug, merchant_name: "Bandra Beans", amount: "25", currency: "USD", description: "Cold brew", status: "active" }));
  const got = await client.publicLink(link.slug);
  assert.equal(calls[0].url, `/api/v1/public/links/${link.slug}`);
  assert.deepEqual(got, { slug: link.slug, merchant_name: "Bandra Beans", amount: "25", currency: "USD", description: "Cold brew", status: "active" });
  const page = PREVIEW_PAGES[0];
  const p = fake(() => json({ slug: page.slug, title: page.title, description: page.description, logo_url: page.logo_url, color: page.color, currency: page.currency, items: page.items, open_amount: page.open_amount, merchant_name: "Bandra Beans" }));
  assert.equal((await p.client.publicPage(page.slug)).merchant_name, "Bandra Beans");
});

test("an answer that doesn't match the contract is refused, never shown half-read", async () => {
  const good = PREVIEW_LINKS[0];
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
    const { client } = fake(() => json({ links: [link] }));
    const error = await refused(client.listLinks());
    assert.match(error.message, /couldn't read/, JSON.stringify(link));
  }
  const page = PREVIEW_PAGES[0];
  for (const bad of [{ ...page, color: "red;background:url(x)" }, { ...page, logo_url: "javascript:alert(1)" }, { ...page, logo_url: "http://plain.example/logo.png" }, { ...page, items: [] }]) {
    const { client } = fake(() => json({ pages: [bad] }));
    await refused(client.listPages());
  }
  const { client } = fake(() => json({ nope: true }));
  await refused(client.listLinks());
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
    const error = await refused(client.listLinks());
    assert.match(error.message, message);
    assert.equal(error.status, status);
  }
  const pages = fake(() => html(404));
  assert.equal((await refused(pages.client.listPages())).message, "Pages aren't available on this server yet.");
  const offline = gatewayClient({ fetch: async () => { throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.7:5432"); } });
  const error = await refused(offline.listLinks());
  assert.equal(error.status, 0);
  assert.doesNotMatch(error.message, /ECONNREFUSED|10\.0\.0\.7/, "never the transport's own text");
});

test("create and cancel send JSON to the contract's routes", async () => {
  const link = PREVIEW_LINKS[0];
  const { client, calls } = fake(() => json(link, 201));
  const body = { amount: "25.00", currency: "USD", description: "Cold brew", single_use: true };
  assert.equal((await client.createLink(body)).slug, link.slug);
  assert.equal(calls[0].url, "/api/v1/links");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), body);

  const cancel = fake(() => json({ id: "lnk_a/b", status: "cancelled" }));
  await cancel.client.cancelLink("lnk_a/b");
  assert.equal(cancel.calls[0].url, "/api/v1/links/lnk_a%2Fb/cancel", "the id is encoded into the path");
  assert.equal(cancel.calls[0].init.method, "POST");

  const page = PREVIEW_PAGES[0];
  const p = fake(() => json(page, 201));
  assert.equal((await p.client.createPage({ title: page.title, currency: "USD", items: [{ name: "Cold brew", price: "5.00" }] })).slug, page.slug);
  assert.equal(p.calls[0].url, "/api/v1/pages");
});

test("a server-side client calls its base URL with the forwarded headers", async () => {
  const { client, calls } = fake(() => json({ links: [] }), { base: "https://shop.example", headers: { cookie: "mc_session=abc", "x-forwarded-for": "203.0.113.9" } });
  await client.listLinks();
  assert.equal(calls[0].url, "https://shop.example/api/v1/links");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("cookie"), "mc_session=abc");
  assert.equal(headers.get("x-forwarded-for"), "203.0.113.9");
  assert.equal(headers.get("accept"), "application/json");
});

test("a public checkout returns only a well-formed session id", async () => {
  const id = "0b6c2a8e-6f1d-4c39-9d2b-8f1e3a5c7d90";
  const { client, calls } = fake(() => json({ checkout_url: "https://evil.example/phish", session_id: id }));
  assert.equal(await client.checkout("links", "AbCdEfGhIj", { amount: "12.50" }), id, "the URL from the answer is never used");
  assert.equal(calls[0].url, "/api/v1/public/links/AbCdEfGhIj/checkout");
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: "12.50" });
  assert.equal(new Headers(calls[0].init.headers).get("accept"), "application/json", "JSON, not the 303");
  const bad = fake(() => json({ checkout_url: "/checkout/x", session_id: "../../merchant" }));
  await refused(bad.client.checkout("links", "AbCdEfGhIj", {}));
  const gone = fake(() => json({ error: "This payment link is paid." }, 410));
  assert.equal((await refused(gone.client.checkout("links", "AbCdEfGhIj", {}))).status, 410);
});
