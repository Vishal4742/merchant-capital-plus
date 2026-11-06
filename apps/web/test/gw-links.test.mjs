// Batch 007 Builder A: payment links (FR-GW-1). Auth and scoping, validation, statuses, public render info and checkout.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-links.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";

const { POST: create, GET: list } = await import("../app/api/v1/links/route.ts");
const { POST: cancel } = await import("../app/api/v1/links/[id]/cancel/route.ts");
const { GET: publicLink } = await import("../app/api/v1/public/links/[slug]/route.ts");
const { POST: checkout } = await import("../app/api/v1/public/links/[slug]/checkout/route.ts");
const { getSession, currencyFields, SESSION_TTL_MS } = await import("../lib/sessions.ts");
const { checkoutOf, markCheckoutPaid } = await import("../lib/server/checkouts.ts");
const { QUOTE_TTL_MS } = await import("../lib/server/quotes.ts");
const today = () => new Date().toISOString().slice(0, 10);

let pg;
const fetchCalls = [];
before(async () => {
  pg = await setupDb();
});
beforeEach(async () => {
  await resetDb();
  fetchCalls.length = 0;
  // Frankfurter v2's answer (0.8 EUR per USD, dated today); any other URL fails the test (never the network).
  mock.method(globalThis, "fetch", async (url) => {
    fetchCalls.push(String(url));
    if (String(url).startsWith("https://api.frankfurter.dev/v2/rates?base=usd")) {
      return Response.json([{ date: new Date().toISOString().slice(0, 10), base: "USD", quote: "EUR", rate: 0.8 }]);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

let ip = 0;
const fromIp = () => ({ "x-forwarded-for": `10.0.0.${++ip}` });
const newLink = async (body, merchant = MERCHANT) => {
  const res = await create(req("POST", "/api/v1/links", { body: { currency: "USDT", description: "Cold brew", single_use: false, ...body }, headers: signedIn(merchant) }));
  return { res, data: await res.json() };
};
const links = async (merchant = MERCHANT) => (await (await list(req("GET", "/api/v1/links", { headers: signedIn(merchant) }))).json()).links;
const pay = (slug, body, headers = {}) => checkout(req("POST", `/api/v1/public/links/${slug}/checkout`, { body, headers: { ...fromIp(), ...headers } }), params({ slug }));
const sessionOf = (res) => getSession(new URL(res.headers.get("location")).pathname.split("/").pop());

test("dashboard routes need the signed-in merchant", async () => {
  assert.equal((await create(req("POST", "/api/v1/links", { body: { amount: "25.00", currency: "USDT", description: "x" } }))).status, 401);
  assert.equal((await list(req("GET", "/api/v1/links"))).status, 401);
  assert.equal((await cancel(req("POST", "/api/v1/links/lnk_x/cancel"), params({ id: "lnk_x" }))).status, 401);
});

test("creates a fixed USDT link and lists it newest first with its payments", async () => {
  assert.equal((await newLink({ amount: "25.00", expires_at: "2099-01-01T00:00:00Z" })).res.status, 400, "expiries over 5 years out are refused");
  const inAYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // relative: never goes stale (code review N3)
  const { res, data } = await newLink({ amount: "25.00", reference_id: "INV-7", single_use: true, expires_at: inAYear });
  assert.equal(res.status, 201);
  assert.match(data.id, /^lnk_/);
  assert.match(data.slug, /^[0-9A-Za-z]{10}$/);
  assert.equal(data.url, `/l/${data.slug}`);
  assert.deepEqual(
    { amount: data.amount, currency: data.currency, description: data.description, reference_id: data.reference_id, single_use: data.single_use, status: data.status, expires_at: data.expires_at },
    { amount: "25", currency: "USDT", description: "Cold brew", reference_id: "INV-7", single_use: true, status: "active", expires_at: inAYear },
  );
  assert.ok(!Number.isNaN(Date.parse(data.created_at)));
  await pg.query("UPDATE app_gw_links SET created_at = created_at - 1000");
  const second = (await newLink({ amount: null })).data;
  const all = await links();
  assert.deepEqual(all.map((l) => l.id), [second.id, data.id]);
  assert.equal(all[0].amount, null);
  assert.equal(all[1].payments, 0);
});

test("rejects bad input", async () => {
  for (const body of [
    { amount: "abc" },
    { amount: "0.50" }, // under 1 USDT
    { amount: "1000.01" }, // over the testnet cap
    { amount: "1.1234567" }, // more than 6 decimals
    { amount: 25 },
    { amount: "25.00", currency: "BTC" },
    { amount: "25.00", description: "" },
    { amount: "25.00", description: "x".repeat(201) },
    { amount: "25.00", expires_at: "2001-01-01T00:00:00Z" },
    { amount: "25.00", single_use: "yes" },
    { amount: "25.00", reference_id: "x".repeat(41) },
    { amount: "0", currency: "EUR" },
  ]) {
    const { res, data } = await newLink(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof data.error, "string");
  }
});

test("reference_id is unique per merchant", async () => {
  assert.equal((await newLink({ amount: "5.00", reference_id: "A-1" })).res.status, 201);
  const dup = await newLink({ amount: "6.00", reference_id: "A-1" });
  assert.equal(dup.res.status, 409);
  assert.equal((await newLink({ amount: "5.00", reference_id: "A-1" }, OTHER_MERCHANT)).res.status, 201);
  assert.equal((await newLink({ amount: "5.00" })).res.status, 201); // no reference_id never conflicts
  assert.equal((await newLink({ amount: "5.00" })).res.status, 201);
});

test("rows are scoped to the merchant: another merchant's id is a 404", async () => {
  const { data } = await newLink({ amount: "5.00" });
  assert.deepEqual(await links(OTHER_MERCHANT), []);
  const res = await cancel(req("POST", `/api/v1/links/${data.id}/cancel`, { headers: signedIn(OTHER_MERCHANT) }), params({ id: data.id }));
  assert.equal(res.status, 404);
  assert.equal((await links())[0].status, "active");
});

test("cancel → cancelled everywhere, and checkout answers 410", async () => {
  const { data } = await newLink({ amount: "5.00" });
  const res = await cancel(req("POST", `/api/v1/links/${data.id}/cancel`, { headers: signedIn() }), params({ id: data.id }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: data.id, status: "cancelled" });
  assert.equal((await links())[0].status, "cancelled");
  const pub = await (await publicLink(req("GET", `/api/v1/public/links/${data.slug}`), params({ slug: data.slug }))).json();
  assert.equal(pub.status, "cancelled");
  assert.equal((await pay(data.slug)).status, 410);
});

test("public render info has no merchant-private fields; unknown slug is a 404", async () => {
  const { data } = await newLink({ amount: "25.00", reference_id: "secret-ref" });
  const res = await publicLink(req("GET", `/api/v1/public/links/${data.slug}`), params({ slug: data.slug }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { slug: data.slug, merchant_name: "Bandra Beans", amount: "25", currency: "USDT", description: "Cold brew", status: "active", paid_at: null });
  assert.equal((await publicLink(req("GET", "/api/v1/public/links/nope"), params({ slug: "nope" }))).status, 404);
  assert.equal((await pay("nope")).status, 404);
});

test("checkout on a fixed link: 303 to the session, the stored price wins over the request", async () => {
  const { data } = await newLink({ amount: "25.00", reference_id: "INV-9" });
  const res = await pay(data.slug, { amount: "1.00" });
  assert.equal(res.status, 303);
  assert.match(new URL(res.headers.get("location")).pathname, /^\/checkout\/[0-9a-f-]{36}$/);
  const session = await sessionOf(res);
  assert.equal(session.merchant, "0x1111111111111111111111111111111111111111");
  assert.equal(session.merchantName, "Bandra Beans");
  assert.equal(session.amount, 25_000_000n);
  assert.equal(session.reference, "INV-9");
  assert.deepEqual(session.items, [{ name: "Cold brew", qty: 1, price: 25_000_000n }]);
  const row = await checkoutOf(session.id);
  assert.deepEqual({ kind: row.kind, refId: row.refId, merchant: row.merchant, usdtAmount: row.usdtAmount }, { kind: "link", refId: data.id, merchant: MERCHANT, usdtAmount: 25_000_000n });
  assert.equal(fetchCalls.length, 0);
});

test("JSON callers get the checkout URL instead of a redirect; the reference falls back to the slug", async () => {
  const { data } = await newLink({ amount: "3.00" });
  const res = await pay(data.slug, undefined, { accept: "application/json" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(new URL(body.checkout_url).pathname, `/checkout/${body.session_id}`);
  assert.equal((await getSession(body.session_id)).reference, data.slug);
});

test("open-amount link: the payer's amount (JSON or form), validated", async () => {
  const { data } = await newLink({ amount: null, currency: "USD" });
  assert.equal((await pay(data.slug)).status, 400);
  assert.equal((await pay(data.slug, { amount: "0.99" })).status, 400);
  assert.equal((await pay(data.slug, { amount: "1000.01" })).status, 400);
  assert.equal((await sessionOf(await pay(data.slug, { amount: "12.50" }))).amount, 12_500_000n);
  const form = await checkout(
    new Request(`http://localhost/api/v1/public/links/${data.slug}/checkout`, { method: "POST", headers: { ...fromIp(), "content-type": "application/x-www-form-urlencoded" }, body: "amount=7.25" }),
    params({ slug: data.slug }),
  );
  assert.equal(form.status, 303);
  assert.equal((await sessionOf(form)).amount, 7_250_000n);
});

test("single-use link: open checkouts may coexist until one is paid, then it is paid and 410", async () => {
  const { data } = await newLink({ amount: "5.00", single_use: true });
  const first = await sessionOf(await pay(data.slug));
  const second = await pay(data.slug);
  assert.equal(second.status, 303);
  assert.equal(await markCheckoutPaid(first.id), true);
  assert.equal(await markCheckoutPaid(first.id), false); // idempotent
  const [row] = await links();
  assert.equal(row.status, "paid");
  assert.equal(row.payments, 1);
  const pub = await (await publicLink(req("GET", `/api/v1/public/links/${data.slug}`), params({ slug: data.slug }))).json();
  assert.equal(pub.status, "paid");
  assert.equal((await pay(data.slug)).status, 410);
  // cancelled outranks paid
  await cancel(req("POST", `/api/v1/links/${data.id}/cancel`, { headers: signedIn() }), params({ id: data.id }));
  assert.equal((await links())[0].status, "cancelled");
});

test("public link: paid_at is the paid checkout's time once a single-use link is paid, else null", async () => {
  const once = (await newLink({ amount: "5.00", single_use: true })).data;
  const reusable = (await newLink({ amount: "5.00" })).data;
  const view = async (slug) => (await publicLink(req("GET", `/api/v1/public/links/${slug}`), params({ slug }))).json();
  assert.equal((await view(once.slug)).paid_at, null);
  const at = Date.parse("2026-11-06T08:30:00.000Z");
  await markCheckoutPaid((await sessionOf(await pay(once.slug))).id, at);
  await markCheckoutPaid((await sessionOf(await pay(reusable.slug))).id, at);
  const paid = await view(once.slug);
  assert.deepEqual([paid.status, paid.paid_at], ["paid", "2026-11-06T08:30:00.000Z"]);
  const active = await view(reusable.slug);
  assert.deepEqual([active.status, active.paid_at], ["active", null]);
});

test("a reusable link stays active after payments and counts them", async () => {
  const { data } = await newLink({ amount: "5.00" });
  await markCheckoutPaid((await sessionOf(await pay(data.slug))).id);
  await markCheckoutPaid((await sessionOf(await pay(data.slug))).id);
  const [row] = await links();
  assert.equal(row.status, "active");
  assert.equal(row.payments, 2);
});

test("an expired link shows expired and refuses checkout; paid outranks expired", async () => {
  const a = (await newLink({ amount: "5.00", expires_at: Date.now() + 60_000 })).data;
  const b = (await newLink({ amount: "5.00", single_use: true, expires_at: Date.now() + 60_000 })).data;
  await markCheckoutPaid((await sessionOf(await pay(b.slug))).id);
  await pg.query("UPDATE app_gw_links SET expires_at = 1");
  const byId = Object.fromEntries((await links()).map((l) => [l.id, l.status]));
  assert.deepEqual(byId, { [a.id]: "expired", [b.id]: "paid" });
  assert.equal((await pay(a.slug)).status, 410);
});

test("a fiat link converts at checkout with the live rate (EUR 20.00 at 0.8 per USD → 25.00 USDT)", async () => {
  const { data } = await newLink({ amount: "20.00", currency: "EUR" });
  assert.equal(data.amount, "20");
  assert.equal(fetchCalls.length, 1); // creation checks the price at today's rate (LOW); checkout reuses the cached rate
  const session = await sessionOf(await pay(data.slug));
  assert.equal(session.amount, 25_000_000n);
  assert.deepEqual(session.items, [{ name: "Cold brew", qty: 1, price: 20_000_000n }], "a priced session's items are in its currency");
  const row = await checkoutOf(session.id);
  assert.equal(row.usdtAmount, 25_000_000n);
  // AT-13: the checkout can show the EUR price, the rate (per 1 USD, the SDK's convention), its date and source
  assert.equal(row.fx.currency, "EUR");
  assert.equal(row.fx.amount, 20_000_000n);
  assert.equal(row.fx.rate, "0.8");
  assert.equal(row.fx.rateAt, new Date().toISOString().slice(0, 10));
  assert.match(row.fx.source, /Frankfurter/);
  assert.ok(row.fx.fetchedAt > 0);
  assert.match(fetchCalls[0], /\/v2\/rates\?base=usd&quotes=/);
  assert.equal(fetchCalls.length, 1);
  const big = (await newLink({ amount: "20.00", currency: "EUR" })).data;
  await pg.query("UPDATE app_gw_links SET amount = 1000000000 WHERE id = $1", [big.id]); // 1,000 EUR = 1,250 USDT, e.g. after the rate moved
  assert.equal((await pay(big.slug)).status, 400, "checkout still checks the total");
});

test("H1: a USDT link charges its price exactly; a USD price (fiat, 1:1) rounds up to the cent like sessions do", async () => {
  const usdt = await sessionOf(await pay((await newLink({ amount: "10.123456" })).data.slug));
  assert.equal(usdt.amount, 10_123_456n);
  assert.deepEqual(usdt.items, [{ name: "Cold brew", qty: 1, price: 10_123_456n }]);
  assert.equal((await checkoutOf(usdt.id)).usdtAmount, 10_123_456n);
  const usd = await sessionOf(await pay((await newLink({ amount: "12.345678", currency: "USD" })).data.slug));
  assert.equal(usd.amount, 12_350_000n, "12.345678 USD → 12.35 USDT (the merchant is never short)");
  assert.equal(usd.priced.amount, 12_345_678n, "the price the payer saw stays as set");
  assert.equal(fetchCalls.length, 0);
});

test("LOW: a fixed fiat link must be 1..1,000 USDT at today's rate when it is created", async () => {
  for (const amount of ["0.50", "800.01"]) {
    // at 0.8 EUR per USD: 0.63 and 1,000.02 USDT
    const { res, data } = await newLink({ amount, currency: "EUR" });
    assert.equal(res.status, 400, amount);
    assert.equal(data.error, "That price is outside 1 to 1,000 USDT at today's rate.");
  }
  assert.equal((await newLink({ amount: "800.00", currency: "EUR" })).res.status, 201); // exactly 1,000 USDT
  assert.equal((await newLink({ amount: "0.80", currency: "EUR" })).res.status, 201); // exactly 1 USDT
  assert.equal((await newLink({ amount: null, currency: "EUR" })).res.status, 201); // open: the payer's amount is checked at checkout
});

test("LOW: FX down at creation skips the price check (best effort; the checkout re-checks); every link still creates", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("FX source down");
  });
  assert.equal((await newLink({ amount: "20.00", currency: "EUR" })).res.status, 201);
  assert.equal((await newLink({ amount: null, currency: "EUR" })).res.status, 201);
  assert.equal((await newLink({ amount: "20.00", currency: "USD" })).res.status, 201);
  assert.equal((await newLink({ amount: "20.00" })).res.status, 201);
});

test("AT-13: an EUR link's session is priced and lives as long as the 10-min quote lock", async () => {
  const { data } = await newLink({ amount: "20.00", currency: "EUR" });
  const session = await sessionOf(await pay(data.slug));
  const { fetchedAt, ...priced } = session.priced;
  assert.deepEqual(priced, { currency: "EUR", amount: 20_000_000n, rate: "0.8", rateDate: today(), source: priced.source });
  assert.match(priced.source, /Frankfurter/);
  assert.ok(fetchedAt > 0);
  assert.deepEqual(currencyFields(session), { currency: "EUR", priced: { currency: "EUR", amount: "20.00", rate: "0.8", rateAt: today(), source: priced.source } });
  assert.equal(session.expiresAt - session.createdAt, QUOTE_TTL_MS);
  assert.equal(QUOTE_TTL_MS, 600_000);
});

test("a USD link is priced at rate 1 and keeps the 30-min session; a USDT link has no priced", async () => {
  const usd = await sessionOf(await pay((await newLink({ amount: "12.50", currency: "USD" })).data.slug));
  assert.equal(usd.priced.currency, "USD");
  assert.equal(usd.priced.amount, 12_500_000n);
  assert.equal(usd.priced.rate, "1");
  assert.equal(usd.expiresAt - usd.createdAt, SESSION_TTL_MS);
  const usdt = await sessionOf(await pay((await newLink({ amount: "12.50" })).data.slug));
  assert.equal(usdt.priced, undefined);
  assert.deepEqual(currencyFields(usdt), { currency: "USDT" });
  assert.equal(usdt.expiresAt - usdt.createdAt, SESSION_TTL_MS);
  assert.equal(SESSION_TTL_MS, 1_800_000);
  assert.equal(fetchCalls.length, 0); // USD and USDT need no rate source
});

test("checkout is rate-limited to 20 a minute per IP", async () => {
  const { data } = await newLink({ amount: "5.00" });
  const same = { "x-forwarded-for": "203.0.113.9" };
  for (let i = 0; i < 20; i += 1) assert.equal((await pay(data.slug, undefined, same)).status, 303);
  assert.equal((await pay(data.slug, undefined, same)).status, 429);
});
