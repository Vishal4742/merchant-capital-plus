// claude-frontend checks for the hosted /l and /p pages (FR-GW-1, FR-GW-2): their plain form posts go to our routes,
// which open the checkout through the gateway's own modules (code review G4 M4: no HTTP call to ourselves) and answer
// 303, to the checkout or back to the page with a fixed message. Real links and pages on PGlite.
// Run from apps/web: node --experimental-test-module-mocks --test test/hosted-pages.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, params, MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";

const { POST: linkForm } = await import("../app/l/[slug]/checkout/route.ts");
const { POST: pageForm } = await import("../app/p/[slug]/checkout/route.ts");
const { POST: createLink } = await import("../app/api/v1/links/route.ts");
const { POST: cancelLink } = await import("../app/api/v1/links/[id]/cancel/route.ts");
const { POST: createPage } = await import("../app/api/v1/pages/route.ts");
const { getSession } = await import("../lib/sessions.ts");
const { checkoutOf } = await import("../lib/server/checkouts.ts");
const { setTestDb } = await import("../lib/server/db.ts");
const { closedLinkCopy } = await import("../lib/gateway-forms.ts");

const CHECKOUT = /^\/checkout\/([0-9a-f-]{36})$/;
const fetched = [];
before(async () => {
  await setupDb();
});
beforeEach(async () => {
  await resetDb();
  fetched.length = 0;
  // USDT prices need no rate: any fetch at all (to ourselves or anywhere) is recorded and fails
  mock.method(globalThis, "fetch", async (url) => {
    fetched.push(String(url));
    throw new Error(`unexpected fetch ${url}`);
  });
});

const newLink = async (body) => (await createLink(req("POST", "/api/v1/links", { body: { currency: "USDT", description: "Cold brew", single_use: false, ...body }, headers: signedIn() }))).json();
const newPage = async (body) => (await createPage(req("POST", "/api/v1/pages", { body: { title: "Bandra Beans menu", currency: "USDT", ...body }, headers: signedIn() }))).json();
const MENU = [
  { name: "Cold brew", price: "5" },
  { name: "Croissant", price: "3" },
  { name: "Banana bread", price: "3.5" },
];

let ip = 0;
/** The customer's form post, from its own address, with a forged Host (security review 010 F1). */
const form = (route, path, slug, entries, from = `198.51.100.${++ip}`) =>
  route(
    new Request(`http://127.0.0.1:3117${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "evil.example:47123", "x-forwarded-for": from },
      body: new URLSearchParams(entries).toString(),
    }),
    params({ slug }),
  );
const location = (res) => {
  assert.equal(res.status, 303);
  return res.headers.get("location");
};
const sessionAt = (res) => {
  const [, id] = location(res).match(CHECKOUT) ?? assert.fail(`not a checkout: ${res.headers.get("location")}`);
  return getSession(id);
};

test("a fixed link's form opens a checkout at the stored price: 303 to our own checkout path, nothing fetched", async () => {
  const link = await newLink({ amount: "25.00", reference_id: "T4-0611" });
  const session = sessionAt(await form(linkForm, `/l/${link.slug}/checkout`, link.slug, []));
  assert.equal(session.amount, 25_000_000n);
  assert.equal(session.reference, "T4-0611");
  assert.equal(session.merchantName, "Bandra Beans");
  const row = await checkoutOf(session.id);
  assert.deepEqual({ kind: row.kind, refId: row.refId }, { kind: "link", refId: link.id });
  const tampered = sessionAt(await form(linkForm, `/l/${link.slug}/checkout`, link.slug, [["amount", "1.00"]]));
  assert.equal(tampered.amount, 25_000_000n, "a fixed link's stored price wins over a posted amount");
  assert.deepEqual(fetched, [], "no HTTP call: not to ourselves, not to the forged Host");
});

test("an open link takes the amount the customer typed", async () => {
  const link = await newLink({});
  assert.equal(sessionAt(await form(linkForm, `/l/${link.slug}/checkout`, link.slug, [["amount", " 12.50 "]])).amount, 12_500_000n);
});

test("a link that can't be paid sends the customer back with a fixed message code", async () => {
  const open = await newLink({});
  assert.equal(location(await form(linkForm, `/l/${open.slug}/checkout`, open.slug, [["amount", "9999999"]])), `/l/${open.slug}?amount=9999999&error=amount`);
  const cancelled = await newLink({ amount: "5" });
  await cancelLink(req("POST", `/api/v1/links/${cancelled.id}/cancel`, { headers: signedIn() }), params({ id: cancelled.id }));
  assert.equal(location(await form(linkForm, `/l/${cancelled.slug}/checkout`, cancelled.slug, [])), `/l/${cancelled.slug}?error=closed`);
  assert.equal(location(await form(linkForm, "/l/NoSuchLink/checkout", "NoSuchLink", [])), "/l/NoSuchLink?error=closed");
});

test("the checkout limit counts each payer, not our server: 20 a minute per address, then busy", async () => {
  const link = await newLink({ amount: "5" });
  const from = (address) => form(linkForm, `/l/${link.slug}/checkout`, link.slug, [], address);
  for (let i = 0; i < 20; i++) assert.match(location(await from("203.0.113.7")), CHECKOUT, `checkout ${i + 1}`);
  assert.equal(location(await from("203.0.113.7")), `/l/${link.slug}?error=busy`, "the 21st from the same payer");
  assert.match(location(await from("203.0.113.8")), CHECKOUT, "another payer is not held up");
});

test("a bad amount or slug is refused before the gateway is asked", async () => {
  assert.equal(location(await form(linkForm, "/l/AbCdEfGhIj/checkout", "AbCdEfGhIj", [["amount", "12,50"]])), "/l/AbCdEfGhIj?amount=12%2C50&error=amount");
  assert.equal((await form(linkForm, "/l/../checkout", "..", [])).status, 404);
  assert.equal((await form(pageForm, "/p/a%2Fb/checkout", "a/b", [])).status, 404);
});

test("a page's form sends the chosen items and quantities; prices come from the stored page", async () => {
  const page = await newPage({ items: MENU });
  const session = sessionAt(await form(pageForm, `/p/${page.slug}/checkout`, page.slug, [["qty:Cold brew", "2"], ["qty:Croissant", "0"], ["qty:Banana bread", "1"]]));
  assert.deepEqual(session.items, [
    { name: "Cold brew", qty: 2, price: 5_000_000n },
    { name: "Banana bread", qty: 1, price: 3_500_000n },
  ]);
  assert.equal(session.amount, 13_500_000n);
  assert.equal((await checkoutOf(session.id)).refId, page.id);
});

test("a page that can't be paid goes back with the customer's choices kept", async () => {
  const page = await newPage({ items: MENU });
  const back = async (entries) => location(await form(pageForm, `/p/${page.slug}/checkout`, page.slug, entries));
  assert.equal(await back([["qty:Cold brew", "0"]]), `/p/${page.slug}?qty%3ACold+brew=0&error=items`, "nothing chosen");
  assert.equal(await back([["qty:Espresso", "1"]]), `/p/${page.slug}?qty%3AEspresso=1&error=items`, "not on this page");
  const open = await newPage({ open_amount: { min: "5", max: "50" } });
  assert.equal(location(await form(pageForm, `/p/${open.slug}/checkout`, open.slug, [["amount", "2"]])), `/p/${open.slug}?amount=2&error=amount`);
  assert.match(location(await form(pageForm, `/p/${open.slug}/checkout`, open.slug, [["amount", "7.25"]])), CHECKOUT);
});

test("every closed link state has its own plain copy", () => {
  for (const status of ["paid", "expired", "cancelled"]) {
    const copy = closedLinkCopy(status, "Bandra Beans");
    assert.ok(copy.title && copy.body.includes("Bandra Beans"), status);
    assert.doesNotMatch(`${copy.title} ${copy.body}`, /\b(sign|signature|gas|chain|blockchain|wallet|wbt|nonce)\b/i);
  }
  assert.notEqual(closedLinkCopy("paid", "x").title, closedLinkCopy("expired", "x").title);
});

// last: it takes the database away (no DATABASE_URL in tests, so the gateway's modules throw DbUnavailable)
test("no database: the customer goes back with the 'try again' message, never an error page", async () => {
  setTestDb(undefined);
  assert.equal(location(await form(linkForm, "/l/AbCdEfGhIj/checkout", "AbCdEfGhIj", [])), "/l/AbCdEfGhIj?error=down");
  assert.equal(location(await form(pageForm, "/p/AbCdEfGhIj/checkout", "AbCdEfGhIj", [["qty:Cold brew", "1"]])), "/p/AbCdEfGhIj?qty%3ACold+brew=1&error=down");
});
