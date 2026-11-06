// claude-frontend checks for the sessions API v2 (FR-GW-11, FR-GW-5, batch 006): currency and the locked FX quote,
// returnUrl, the 40-character reference, plain amounts and Idempotency-Key. Frankfurter and the chain are faked.
// Run from apps/web: npm test
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.MERCHANT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = "0x2222222222222222222222222222222222222222";
process.env.RELAYER_URL = "http://relayer.test";

let refunded = 0n;
mock.module("../lib/onchain.ts", {
  namedExports: {
    saleSettled: async () => null,
    readUsdtBalance: async () => 1_000_000_000n,
    readPayment: async () => ({ merchant: process.env.MERCHANT_ADDRESS, gross: 22_500_000n, payer: "0x5555555555555555555555555555555555555555", refunded }),
  },
});

// rates dated today: lib/fx.ts refuses one older than 7 days (security review 006 F1)
const RATE_DATE = new Date().toISOString().slice(0, 10);
const ROWS = ["AED:3.6725", "EUR:0.88877", "GBP:0.7423", "INR:94.5", "SGD:1.2775"].map((pair) => {
  const [quote, rate] = pair.split(":");
  return { date: RATE_DATE, base: "USD", quote, rate: Number(rate) };
});
let fxDown = false;
const fxCalls = [];
globalThis.fetch = async (url) => {
  fxCalls.push(String(url));
  if (fxDown) throw new TypeError("fetch failed");
  return Response.json(ROWS);
};

const { POST: createRoute } = await import("../app/api/v1/sessions/route.ts");
const { GET: statusRoute } = await import("../app/api/v1/sessions/[id]/route.ts");
const { createSession, getSession, recordPayment, SESSION_TTL_MS } = await import("../lib/sessions.ts");
const { QUOTE_LOCK_MS } = await import("../lib/fx.ts");

const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" };
async function create(body, headers = {}) {
  const res = await createRoute(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: { ...auth, ...headers }, body: JSON.stringify(body) }));
  return { res, data: await res.json() };
}
const poll = async (id) => (await statusRoute(new Request(`http://shop.test/api/v1/sessions/${id}`, { headers: auth }), { params: Promise.resolve({ id }) })).json();
const sessionCount = () => globalThis.__mcSessions.size;
const near = (iso, ms) => Math.abs(Date.parse(iso) - (Date.now() + ms)) < 2_000;
// lib/fx.ts keeps rates 15 minutes: step past that so the next quote has to fetch
async function past15Minutes(fn) {
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 16 * 60 * 1000 });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
  }
}

beforeEach(() => {
  fxDown = false;
  fxCalls.length = 0;
  refunded = 0n;
});

test("an EUR price becomes USDT at the locked quote: the reply has the asked currency, priced and a 10 min expiry", async () => {
  const { res, data } = await create({ amount: "20.00", currency: "EUR", reference: "A-7" });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(data).sort(), ["amount", "currency", "expiresAt", "id", "priced", "url"]);
  assert.equal(data.amount, "22.51", "20 ÷ 0.88877 = 22.5030…, up to the cent");
  assert.equal(data.currency, "EUR");
  assert.deepEqual(data.priced, { currency: "EUR", amount: "20.00", rate: "0.88877", rateAt: RATE_DATE, source: "frankfurter.dev" });
  assert.ok(near(data.expiresAt, QUOTE_LOCK_MS), "a quote lock is 10 minutes, and the checkout ends with it");
  const session = getSession(data.id);
  assert.equal(session.amount, 22_510_000n, "the USDT the contract charges is fixed at creation");
  assert.deepEqual([session.priced.currency, session.priced.amount, session.priced.rate], ["EUR", 20_000_000n, "0.88877"]);
});

test("USD is 1:1 with priced present and 30 min; USDT has no priced and no FX call", async () => {
  const usd = await create({ amount: "25.00", currency: "USD" });
  assert.deepEqual([usd.res.status, usd.data.amount, usd.data.currency, usd.data.priced.rate, usd.data.priced.currency], [201, "25.00", "USD", "1", "USD"]);
  assert.ok(near(usd.data.expiresAt, SESSION_TTL_MS));
  const usdt = await create({ amount: "25.00" });
  assert.deepEqual([usdt.data.currency, usdt.data.priced], ["USDT", undefined]);
  assert.ok(near(usdt.data.expiresAt, SESSION_TTL_MS));
  assert.equal(fxCalls.length, 0);
});

test("every listed currency is accepted; anything else is a 400", async () => {
  for (const currency of ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"]) {
    assert.equal((await create({ amount: currency === "INR" ? "2000" : "25.00", currency })).res.status, 201, currency);
  }
  for (const currency of ["JPY", "eur", "", 5, null]) {
    const { res, data } = await create({ amount: "25.00", currency });
    assert.equal(res.status, 400, String(currency));
    assert.match(data.error, /currency must be one of USDT, USD, EUR, GBP, INR, AED, SGD/);
  }
});

test("items are priced in the checkout's currency and must add up in it", async () => {
  const items = [{ name: "Cold brew", qty: 2, price: "8.00" }, { name: "Banana bread", qty: 1, price: "4.00" }];
  const { res, data } = await create({ amount: "20.00", currency: "EUR", items });
  assert.equal(res.status, 201);
  assert.deepEqual(getSession(data.id).items.map((item) => item.price), [8_000_000n, 4_000_000n], "item prices stay in EUR");
  const wrong = await create({ amount: "25.00", currency: "EUR", items });
  assert.equal(wrong.res.status, 400);
  assert.match(wrong.data.error, /add up to 20\.00 EUR, but amount is 25\.00 EUR/);
});

test("when the FX rate can't be fetched, an EUR checkout is a 503 in plain words and nothing is created", async () => {
  fxDown = true;
  const before = sessionCount();
  const { res, data } = await past15Minutes(() => create({ amount: "20.00", currency: "GBP" }));
  assert.equal(res.status, 503);
  assert.equal(data.error, "Prices in GBP are unavailable right now");
  assert.equal(sessionCount(), before);
  assert.equal((await past15Minutes(() => create({ amount: "20.00", currency: "USD" }))).res.status, 201, "USD needs no rate");
});

test("the converted amount must still be 1.00–10,000.00 USDT", async () => {
  const small = await create({ amount: "50", currency: "INR" });
  assert.equal(small.res.status, 400);
  assert.match(small.data.error, /between 1\.00 and 10,000\.00 USDT \(50\.00 INR is 0\.53 USDT\)/);
  assert.equal((await create({ amount: "9000.00", currency: "GBP" })).res.status, 400, "9,000 GBP is over 10,000 USDT");
});

test("returnUrl: http or https up to 200 characters is kept; any other scheme or a longer one is a 400", async () => {
  const { res, data } = await create({ amount: "25.00", returnUrl: "https://shop.example/thanks?order=42" });
  assert.equal(res.status, 201);
  assert.equal(getSession(data.id).returnUrl, "https://shop.example/thanks?order=42");
  assert.equal((await create({ amount: "25.00", returnUrl: "http://localhost:3000/" })).res.status, 201);
  for (const returnUrl of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "ftp://shop.example/", "/thanks", "shop.example", `https://shop.example/${"a".repeat(180)}`, 42]) {
    const bad = await create({ amount: "25.00", returnUrl });
    assert.equal(bad.res.status, 400, String(returnUrl));
    assert.match(bad.data.error, /returnUrl must be an http or https URL of at most 200 characters/);
  }
});

test("a reference over 40 characters is a 400, never silently cut (claude-sdk)", async () => {
  const { res, data } = await create({ amount: "25.00", reference: "x".repeat(41) });
  assert.equal(res.status, 400);
  assert.equal(data.error, "reference must be at most 40 characters.");
  const ok = await create({ amount: "25.00", reference: ` ${"x".repeat(40)} ` });
  assert.equal(getSession(ok.data.id).reference, "x".repeat(40), "trimmed, then counted");
  assert.equal((await create({ amount: "25.00", reference: 42 })).res.status, 400);
});

test("amounts in every reply are plain decimals (1234.50, never 1,234.50)", async () => {
  const { data } = await create({ amount: "1234.50", currency: "USD" });
  assert.deepEqual([data.amount, data.priced.amount], ["1234.50", "1234.50"]);
  const polled = await poll(data.id);
  assert.equal(polled.amount, "1234.50");
});

test("Idempotency-Key: the same key and body give the first checkout back; another body is a 422; a refused request isn't kept", async () => {
  const body = { amount: "20.00", currency: "EUR", reference: "A-9" };
  const first = await create(body, { "idempotency-key": "k-1" });
  const again = await create(body, { "idempotency-key": "k-1" });
  assert.deepEqual([first.res.status, again.res.status], [201, 201]);
  assert.deepEqual(again.data, first.data);
  const other = await create({ ...body, amount: "30.00" }, { "idempotency-key": "k-1" });
  assert.equal(other.res.status, 422);
  assert.match(other.data.error, /Idempotency-Key/);
  fxDown = true;
  assert.equal((await past15Minutes(() => create(body, { "idempotency-key": "k-2" }))).res.status, 503);
  fxDown = false;
  assert.equal((await create(body, { "idempotency-key": "k-2" })).res.status, 201, "a retry after a 503 creates the checkout");
  assert.equal((await create(body, { "idempotency-key": "x".repeat(256) })).res.status, 400);
});

test("Idempotency-Key: two requests at the same moment create one checkout", async () => {
  const before = sessionCount();
  const [a, b] = await Promise.all([create({ amount: "20.00", currency: "EUR" }, { "idempotency-key": "k-3" }), create({ amount: "20.00", currency: "EUR" }, { "idempotency-key": "k-3" })]);
  assert.equal(a.data.id, b.data.id);
  assert.equal(sessionCount(), before + 1);
});

test("GET adds currency, priced and refunded (read from payments(id) on chain once paid)", async () => {
  const { data } = await create({ amount: "20.00", currency: "EUR", reference: "A-10" });
  const open = await poll(data.id);
  assert.deepEqual([open.status, open.currency, open.priced, open.refunded, open.amount], ["open", "EUR", data.priced, "0.00", "22.51"]);
  recordPayment(data.id, { txHash: `0x${"ab".repeat(32)}`, blockNumber: "1", paymentId: "9", from: "0x5555555555555555555555555555555555555555", paidAt: Date.now() });
  refunded = 2_500_000n;
  const paid = await poll(data.id);
  assert.deepEqual([paid.status, paid.paymentId, paid.refunded], ["paid", "9", "2.50"]);
  const usdt = await poll((await create({ amount: "25.00" })).data.id);
  assert.deepEqual([usdt.currency, usdt.priced], ["USDT", undefined]);
});

// Security review 006 F4: the checkout links to the URL as parsed, and the rule lives in createSession too, so a route
// that calls it directly (claude-contracts' links and pages) can't skip it.
test("returnUrl is stored as the parsed URL, so a leading control character can't turn it into a link on our site", async () => {
  const { res, data } = await create({ amount: "25.00", returnUrl: "\u0000https://shop.example/thanks" });
  assert.equal(res.status, 201);
  assert.equal(getSession(data.id).returnUrl, "https://shop.example/thanks");
  assert.equal(getSession((await create({ amount: "25.00", returnUrl: "HTTPS://Shop.Example" })).data.id).returnUrl, "https://shop.example/");
});

test("createSession itself refuses a returnUrl that isn't http or https, and keeps the parsed one", () => {
  const input = { merchant: process.env.MERCHANT_ADDRESS, merchantName: "Bandra Beans", amount: 25_000_000n, reference: "", items: [] };
  assert.throws(() => createSession({ ...input, returnUrl: "javascript:alert(1)" }), /returnUrl must be an http or https URL/);
  assert.throws(() => createSession({ ...input, returnUrl: `https://shop.example/${"a".repeat(180)}` }), /returnUrl/);
  assert.equal(createSession({ ...input, returnUrl: " https://shop.example " }).returnUrl, "https://shop.example/");
  assert.equal(createSession(input).returnUrl, undefined);
});

// Security review 006 F6: the Idempotency-Key store is capped (oldest dropped), so a shop can't grow it without limit.
test("Idempotency-Key: the store keeps the newest 1,000 keys and forgets the oldest", async () => {
  const body = (n) => ({ amount: "25.00", reference: `cap-${n}` });
  for (let n = 0; n <= 1000; n++) assert.equal((await create(body(n), { "idempotency-key": `cap-${n}` })).res.status, 201);
  assert.equal((await create(body(9999), { "idempotency-key": "cap-0" })).res.status, 201, "the oldest key was dropped: a new body is a new checkout");
  assert.equal((await create(body(9999), { "idempotency-key": "cap-1000" })).res.status, 422, "the newest is kept");
});
