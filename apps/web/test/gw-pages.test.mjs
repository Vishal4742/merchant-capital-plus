// Batch 007 Builder A: payment pages (FR-GW-2). Auth and scoping, validation, public render info and checkout,
// prices only from the stored page. Run from apps/web: node --experimental-test-module-mocks --test test/gw-pages.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";

const { POST: create, GET: list } = await import("../app/api/v1/pages/route.ts");
const { GET: publicPage } = await import("../app/api/v1/public/pages/[slug]/route.ts");
const { POST: checkout } = await import("../app/api/v1/public/pages/[slug]/checkout/route.ts");
const { getSession, currencyFields, SESSION_TTL_MS } = await import("../lib/sessions.ts");
const { checkoutOf, markCheckoutPaid } = await import("../lib/server/checkouts.ts");
const { QUOTE_TTL_MS, createQuote } = await import("../lib/server/quotes.ts");
const today = () => new Date().toISOString().slice(0, 10);

const fetchCalls = [];
let eurRate; // EUR per USD in the mocked source; 0.8 unless a test sets it before the first fetch
before(async () => {
  await setupDb();
});
beforeEach(async () => {
  await resetDb();
  fetchCalls.length = 0;
  eurRate = 0.8;
  mock.method(globalThis, "fetch", async (url) => {
    fetchCalls.push(String(url));
    if (String(url).startsWith("https://api.frankfurter.dev/v2/rates?base=usd")) {
      const date = new Date().toISOString().slice(0, 10); // fresh: the 7-day rule would refuse a fixed date
      return Response.json([{ date, base: "USD", quote: "EUR", rate: eurRate }]);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

const MENU = [
  { name: "Cold brew", price: "4.50" },
  { name: "Banana bread", price: "3.25" },
  { name: "Cookie", price: "0.50" },
];
let ip = 0;
const newPage = async (body, merchant = MERCHANT) => {
  const res = await create(req("POST", "/api/v1/pages", { body: { title: "Bandra Beans menu", currency: "USDT", items: MENU, ...body }, headers: signedIn(merchant) }));
  return { res, data: await res.json() };
};
const pages = async (merchant = MERCHANT) => (await (await list(req("GET", "/api/v1/pages", { headers: signedIn(merchant) }))).json()).pages;
const pay = (slug, body, headers = {}) => checkout(req("POST", `/api/v1/public/pages/${slug}/checkout`, { body, headers: { "x-forwarded-for": `10.1.0.${++ip}`, ...headers } }), params({ slug }));
const sessionOf = (res) => getSession(new URL(res.headers.get("location")).pathname.split("/").pop());

test("dashboard routes need the signed-in merchant", async () => {
  assert.equal((await create(req("POST", "/api/v1/pages", { body: { title: "x", currency: "USDT", items: MENU } }))).status, 401);
  assert.equal((await list(req("GET", "/api/v1/pages"))).status, 401);
});

test("creates an items page and lists it with payments, scoped to the merchant", async () => {
  const { res, data } = await newPage({ description: "Order ahead", logo_url: "https://example.com/logo.png", color: "#1a2b3c" });
  assert.equal(res.status, 201);
  assert.match(data.id, /^page_/);
  assert.equal(data.url, `/p/${data.slug}`);
  assert.deepEqual(
    { title: data.title, description: data.description, logo_url: data.logo_url, color: data.color, currency: data.currency, items: data.items, open_amount: data.open_amount },
    { title: "Bandra Beans menu", description: "Order ahead", logo_url: "https://example.com/logo.png", color: "#1A2B3C", currency: "USDT", items: [{ name: "Cold brew", price: "4.5" }, { name: "Banana bread", price: "3.25" }, { name: "Cookie", price: "0.5" }], open_amount: null },
  );
  const [row] = await pages();
  assert.equal(row.id, data.id);
  assert.equal(row.payments, 0);
  assert.deepEqual(await pages(OTHER_MERCHANT), []);
});

test("creates an open-amount page", async () => {
  const { res, data } = await newPage({ items: undefined, open_amount: { min: "5.00", max: "500.00" }, currency: "USD" });
  assert.equal(res.status, 201);
  assert.deepEqual([data.items, data.open_amount, data.description, data.logo_url, data.color], [null, { min: "5", max: "500" }, null, null, null]);
  assert.deepEqual((await newPage({ items: undefined, open_amount: {} })).data.open_amount, { min: null, max: null });
});

test("rejects bad input", async () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `Item ${i}`, price: "1.00" }));
  for (const body of [
    { title: "" },
    { title: "x".repeat(81) },
    { currency: "BTC" },
    { items: undefined }, // neither items nor open_amount
    { open_amount: {} }, // both
    { items: [] },
    { items: many },
    { items: [{ name: "Tea", price: "1.00" }, { name: "Tea", price: "2.00" }] },
    { items: [{ name: "", price: "1.00" }] },
    { items: [{ name: "Tea", price: "free" }] },
    { items: [{ name: "Tea", price: "0" }] },
    { items: "Tea" },
    { color: "blue" },
    { logo_url: "http://example.com/logo.png" },
    { logo_url: "javascript:alert(1)" },
    { items: undefined, open_amount: { min: "50.00", max: "5.00" } },
    { items: undefined, open_amount: { min: "abc" } },
    { items: undefined, open_amount: "any" },
  ]) {
    const { res, data } = await newPage(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof data.error, "string");
  }
});

test("public render info has no merchant-private fields; unknown slug is a 404", async () => {
  const { data } = await newPage({ description: "Order ahead", color: "#123456" });
  const res = await publicPage(req("GET", `/api/v1/public/pages/${data.slug}`), params({ slug: data.slug }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    slug: data.slug,
    title: "Bandra Beans menu",
    description: "Order ahead",
    logo_url: null,
    color: "#123456",
    currency: "USDT",
    items: data.items,
    open_amount: null,
    merchant_name: "Bandra Beans",
  });
  assert.equal((await publicPage(req("GET", "/api/v1/public/pages/nope"), params({ slug: "nope" }))).status, 404);
  assert.equal((await pay("nope", { items: [{ name: "Cookie", qty: 2 }] })).status, 404);
});

test("checkout: line items priced from the stored page only, 303 to the session, checkout row recorded", async () => {
  const { data } = await newPage();
  const res = await pay(data.slug, { items: [{ name: "Cold brew", qty: 2, price: "0.01" }, { name: "Cookie", qty: 1 }], amount: "1.00" });
  assert.equal(res.status, 303);
  const session = await sessionOf(res);
  assert.deepEqual(session.items, [{ name: "Cold brew", qty: 2, price: 4_500_000n }, { name: "Cookie", qty: 1, price: 500_000n }]);
  assert.equal(session.amount, 9_500_000n);
  assert.equal(session.priced, undefined); // USDT: no priced, the 30-min session
  assert.equal(session.expiresAt - session.createdAt, SESSION_TTL_MS);
  assert.equal(session.reference, data.slug);
  assert.equal(session.merchant, "0x1111111111111111111111111111111111111111");
  const row = await checkoutOf(session.id);
  assert.deepEqual({ kind: row.kind, refId: row.refId, usdtAmount: row.usdtAmount }, { kind: "page", refId: data.id, usdtAmount: 9_500_000n });
  await markCheckoutPaid(session.id);
  assert.equal((await pages())[0].payments, 1);
});

test("checkout rejects unknown, duplicate and out-of-range items, and totals outside 1..1,000 USDT", async () => {
  const { data } = await newPage();
  for (const body of [
    {},
    { items: [] },
    { items: "Cookie" },
    { items: [{ name: "Latte", qty: 1 }] },
    { items: [{ name: "Cookie", qty: 2 }, { name: "Cookie", qty: 1 }] },
    { items: [{ name: "Cold brew", qty: 0 }] },
    { items: [{ name: "Cold brew", qty: 101 }] },
    { items: [{ name: "Cold brew", qty: 1.5 }] },
    { items: [{ name: "Cold brew", qty: "2" }] },
    { items: [{ name: "Cookie", qty: 1 }] }, // 0.50 USDT: under the 1 USDT minimum
  ]) {
    const res = await pay(data.slug, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const pricey = (await newPage({ items: [{ name: "Espresso machine", price: "600.00" }] })).data;
  assert.equal((await pay(pricey.slug, { items: [{ name: "Espresso machine", qty: 2 }] })).status, 400);
  assert.equal((await pay(pricey.slug, { items: [{ name: "Espresso machine", qty: 1 }] })).status, 303);
});

test("open-amount page: the payer's amount within the page's min and max; JSON callers get the URL", async () => {
  const { data } = await newPage({ title: "Tip jar", items: undefined, open_amount: { min: "5.00", max: "50.00" } });
  for (const amount of [undefined, "4.99", "50.01", "abc"]) assert.equal((await pay(data.slug, { amount })).status, 400, String(amount));
  const res = await pay(data.slug, { amount: "20.00" }, { accept: "application/json" });
  assert.equal(res.status, 200);
  const body = await res.json();
  const session = await getSession(body.session_id);
  assert.equal(new URL(body.checkout_url).pathname, `/checkout/${session.id}`);
  assert.equal(session.amount, 20_000_000n);
  assert.deepEqual(session.items, [{ name: "Tip jar", qty: 1, price: 20_000_000n }]);
  const open = (await newPage({ items: undefined, open_amount: {} })).data; // no bounds: only the USDT rule
  assert.equal((await pay(open.slug, { amount: "1000.01" })).status, 400);
  assert.equal((await pay(open.slug, { amount: "1000" })).status, 303);
});

test("a fiat page converts the cart total once at the live rate; the session is priced, items stay in EUR, 10-min lock (AT-13)", async () => {
  const { data } = await newPage({ currency: "EUR" });
  const session = await sessionOf(await pay(data.slug, { items: [{ name: "Cold brew", qty: 3 }, { name: "Banana bread", qty: 1 }] }));
  // H1: 16.75 EUR at 0.8 EUR per USD = 20.9375 → 20.94, rounded up once (per line it was 5.63 × 3 + 4.07 = 20.96)
  assert.equal(session.amount, 20_940_000n);
  assert.deepEqual(session.items, [{ name: "Cold brew", qty: 3, price: 4_500_000n }, { name: "Banana bread", qty: 1, price: 3_250_000n }]);
  const { fetchedAt, ...priced } = session.priced;
  assert.deepEqual(priced, { currency: "EUR", amount: 16_750_000n, rate: "0.8", rateDate: today(), source: priced.source });
  assert.match(priced.source, /Frankfurter/);
  assert.ok(fetchedAt > 0);
  assert.deepEqual(currencyFields(session).priced, { currency: "EUR", amount: "16.75", rate: "0.8", rateAt: today(), source: priced.source });
  assert.equal(session.expiresAt - session.createdAt, QUOTE_TTL_MS);
  assert.equal((await checkoutOf(session.id)).fx.amount, 16_750_000n); // the checkout row's fx is unchanged
  assert.equal(fetchCalls.length, 1);
});

test("H1: 2 × 10 EUR at 0.88875 charges 22.51, the same as a quote for 20 EUR", async () => {
  eurRate = 0.88875;
  const { data } = await newPage({ currency: "EUR", items: [{ name: "Thali", price: "10.00" }] });
  const session = await sessionOf(await pay(data.slug, { items: [{ name: "Thali", qty: 2 }] }));
  assert.equal(session.amount, 22_510_000n); // per line it was 11.26 × 2 = 22.52
  assert.equal(session.amount, (await createQuote("20.00", "EUR")).usdtAmount);
  assert.equal((await checkoutOf(session.id)).usdtAmount, 22_510_000n);
});

test("LOW: a page's prices must be payable at today's rate when it is created", async () => {
  for (const body of [
    { currency: "EUR", items: [{ name: "Tea", price: "1.00" }, { name: "Espresso machine", price: "800.01" }] }, // 1,000.02 USDT at 0.8
    { currency: "EUR", items: undefined, open_amount: { min: "800.01" } },
    { currency: "USDT", items: [{ name: "Espresso machine", price: "1000.01" }] },
  ]) {
    const { res, data } = await newPage(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(data.error, "That price is outside 1 to 1,000 USDT at today's rate.");
  }
  for (const body of [
    { currency: "EUR", items: [{ name: "Cookie", price: "0.40" }, { name: "Espresso machine", price: "800.00" }] }, // a cheap item adds up in a cart
    { currency: "EUR", items: undefined, open_amount: { min: "800.00", max: "5000.00" } }, // a max above 1,000 still leaves amounts to pay
  ]) {
    assert.equal((await newPage(body)).res.status, 201, JSON.stringify(body));
  }
});

test("LOW: FX down at creation skips the price check (best effort; the checkout re-checks); every page still creates", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("FX source down");
  });
  assert.equal((await newPage({ currency: "EUR" })).res.status, 201);
  assert.equal((await newPage({ currency: "EUR", items: undefined, open_amount: { min: "5.00" } })).res.status, 201);
  assert.equal((await newPage({ currency: "EUR", items: undefined, open_amount: { max: "50.00" } })).res.status, 201);
  assert.equal((await newPage({ currency: "USDT" })).res.status, 201);
});

test("a USD open-amount page is priced at rate 1 and keeps the 30-min session", async () => {
  const { data } = await newPage({ title: "Tip jar", items: undefined, open_amount: {}, currency: "USD" });
  const session = await getSession((await (await pay(data.slug, { amount: "20.00" }, { accept: "application/json" })).json()).session_id);
  assert.equal(session.amount, 20_000_000n);
  assert.deepEqual([session.priced.currency, session.priced.amount, session.priced.rate], ["USD", 20_000_000n, "1"]);
  assert.equal(session.expiresAt - session.createdAt, SESSION_TTL_MS);
  assert.equal(fetchCalls.length, 0);
});

test("checkout is rate-limited to 20 a minute per IP", async () => {
  const { data } = await newPage();
  const same = { "x-forwarded-for": "203.0.113.10" };
  const body = { items: [{ name: "Cold brew", qty: 1 }] };
  for (let i = 0; i < 20; i += 1) assert.equal((await pay(data.slug, body, same)).status, 303);
  assert.equal((await pay(data.slug, body, same)).status, 429);
});
