// claude-frontend checks for lib/gateway-server.ts: the hosted pages, the counter view and the dashboard read the
// gateway's own modules directly (code review G4 M4), and get exactly what the API routes answer for the same data,
// in the shapes the screens read. Real rows on PGlite; the payment index is faked. Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
const MERCHANT_PAY = "0xab817593253a0a37de723072827d88fe0ca54251";

const server = await import("../lib/gateway-server.ts");
const { POST: createLink, GET: listLinks } = await import("../app/api/v1/links/route.ts");
const { POST: createPage, GET: listPages } = await import("../app/api/v1/pages/route.ts");
const { GET: publicLinkRoute } = await import("../app/api/v1/public/links/[slug]/route.ts");
const { GET: publicPageRoute } = await import("../app/api/v1/public/pages/[slug]/route.ts");
const { GET: listVouchers } = await import("../app/api/v1/vouchers/route.ts");
const { GET: reportRoute } = await import("../app/api/v1/reports/route.ts");
const { createKey, keyJson, listKeys } = await import("../lib/server/keys.ts");
const { listWebhooks } = await import("../lib/server/webhooks.ts");
const { keyOf, webhookOf } = await import("../lib/gateway-dev.ts");
const { HttpError } = await import("../lib/server/http.ts");
const { DbUnavailable } = await import("../lib/server/db.ts");
const { EXPLORER } = await import("../lib/usdt.ts");

let pg;
const indexAsked = [];
before(async () => {
  pg = await setupDb();
});
beforeEach(async () => {
  await resetDb();
  indexAsked.length = 0;
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://127.0.0.1:9";
  // the payment index has no payments yet; anything else fails the test (never the network)
  mock.method(globalThis, "fetch", async (url) => {
    if (String(url).startsWith(`${EXPLORER}/api?`)) {
      indexAsked.push(String(url));
      return Response.json({ status: "0", message: "No records found", result: [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

const body = async (res) => {
  assert.equal(res.status, 200);
  return res.json();
};
const withoutUrl = ({ url, ...rest }) => (assert.match(url, /^\/[lp]\//), rest);
const created = async (res) => {
  assert.equal(res.status, 201);
  return res.json();
};
const newLink = async (fields, merchant = MERCHANT) => created(await createLink(req("POST", "/api/v1/links", { body: { currency: "USDT", description: "Cold brew", single_use: false, ...fields }, headers: signedIn(merchant) })));
const newPage = async (fields) => created(await createPage(req("POST", "/api/v1/pages", { body: { title: "Bandra Beans menu", currency: "USDT", ...fields }, headers: signedIn() })));

test("a payer's link and page read as the public routes answer them; an unknown slug is null", async () => {
  const link = await newLink({ amount: "12.5", currency: "EUR", reference_id: "T4-0611" });
  const page = await newPage({ items: [{ name: "Cold brew", price: "5" }], color: "#b4532a", logo_url: "https://bandrabeans.example/logo.png" });
  const open = await newPage({ open_amount: { min: "2" } });
  assert.deepEqual(await server.publicLink(link.slug), await body(await publicLinkRoute(req("GET", "/"), params({ slug: link.slug }))));
  for (const p of [page, open]) assert.deepEqual(await server.publicPage(p.slug), await body(await publicPageRoute(req("GET", "/"), params({ slug: p.slug }))));
  assert.equal((await server.publicLink(link.slug)).merchant_name, "Bandra Beans");
  assert.equal(await server.publicLink("NoSuchLink"), null);
  assert.equal(await server.publicPage("NoSuchPage"), null);
});

test("the dashboard lists are the signed-in merchant's, as GET /api/v1/links and /pages answer them", async () => {
  await newLink({ amount: "25", expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  await newLink({});
  await newLink({ amount: "9" }, OTHER_MERCHANT);
  await newPage({ items: [{ name: "Cold brew", price: "5" }, { name: "Banana bread", price: "3.5" }] });
  const links = (await body(await listLinks(req("GET", "/api/v1/links", { headers: signedIn() })))).links;
  const pages = (await body(await listPages(req("GET", "/api/v1/pages", { headers: signedIn() })))).pages;
  assert.equal(links.length, 2, "only this merchant's");
  assert.deepEqual(await server.merchantLinks(MERCHANT), links.map(withoutUrl));
  assert.deepEqual(await server.merchantPages(MERCHANT), pages.map(withoutUrl));
  assert.deepEqual(await server.merchantLinks("0x3333333333333333333333333333333333333333"), []);
});

test("the vouchers list is the route's", async () => {
  await pg.query(
    `INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, times_redeemed, min_amount, arkiv_entity_key, created_at)
     VALUES ('vch_a', $1, 'SAVE10', 'percent', 10, $2, 100, 3, NULL, $3, $4), ('vch_b', $1, 'FLAT5', 'fixed', 5000000, $2, 50, 0, 20000000, NULL, $4)`,
    [MERCHANT.toLowerCase(), Date.now() + 86_400_000, `0x${"ab".repeat(32)}`, Date.now()],
  );
  const vouchers = await server.merchantVouchers(MERCHANT);
  assert.deepEqual(vouchers, (await body(await listVouchers(req("GET", "/api/v1/vouchers", { headers: signedIn() })))).vouchers);
  assert.deepEqual(vouchers.map((v) => [v.code, v.value, v.min_amount]).sort(), [["FLAT5", "5", "20"], ["SAVE10", "10", null]]);
});

test("a report covers the screen's India days, exactly as GET /api/v1/reports?tz=Asia/Kolkata answers", async () => {
  const range = { from: "2026-10-31", to: "2026-11-06" };
  const direct = await server.merchantReport(MERCHANT, range);
  const viaRoute = await body(await reportRoute(req("GET", `/api/v1/reports?from=${range.from}&to=${range.to}&tz=Asia/Kolkata`, { headers: signedIn() })));
  assert.deepEqual(direct, viaRoute);
  assert.deepEqual([direct.from, direct.to, direct.tz, direct.days.length], ["2026-10-31", "2026-11-06", "Asia/Kolkata", 7]);
  assert.ok(indexAsked.length > 0 && indexAsked.every((url) => url.includes(MERCHANT_PAY)), "read from MerchantPay's logs");
  delete process.env.MERCHANT_PAY_ADDRESS;
  const unset = await server.merchantReport(MERCHANT, range).catch((error) => server.readFailure("Reports", error));
  assert.equal(unset, "Payments aren't set up on this server yet.", "a sync throw still reaches the screen as a sentence");
});

test("a failed read is one plain sentence; the log names the error, never its message", () => {
  const logged = mock.method(console, "error", () => {});
  assert.equal(server.readFailure("Settlements", new HttpError(502, "The wallet balance isn't available right now. Try again in a minute.")), "The wallet balance isn't available right now. Try again in a minute.");
  assert.equal(server.readFailure("Links", new DbUnavailable()), "Links aren't available on this server yet.");
  const leak = new Error("connect ECONNREFUSED 10.0.0.7:5432 SELECT * FROM app_gw_links");
  assert.equal(server.readFailure("Links", leak), "We couldn't read your links right now. Try again in a minute.");
  assert.doesNotMatch(JSON.stringify(logged.mock.calls.map((c) => c.arguments)), /ECONNREFUSED|10\.0\.0\.7|SELECT/);
  logged.mock.restore();
});

test("the Developers screen's parsers read the backend's real keys and webhooks", async () => {
  await createKey(MERCHANT, "Shop server", "sk");
  await createKey(MERCHANT, "Pay button", "pk");
  await pg.query("INSERT INTO app_gw_webhooks (id, merchant, url, secret, created_at) VALUES ('whk_a', $1, 'https://bandrabeans.example/hooks', 'whsec_x', $2)", [MERCHANT.toLowerCase(), Date.now()]);
  const keys = (await listKeys(MERCHANT)).map(keyJson).map(keyOf);
  assert.deepEqual(keys.map((k) => k.kind).sort(), ["pk", "sk"]);
  const [hook] = (await listWebhooks(MERCHANT)).map(webhookOf);
  assert.equal(hook.url, "https://bandrabeans.example/hooks");
  assert.equal(JSON.stringify(hook).includes("whsec_"), false, "the signing secret is never listed");
});
