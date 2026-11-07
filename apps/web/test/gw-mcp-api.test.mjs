// Batch 052 (FR-GW-16 proposed, FR-GW-1, FR-GW-6, FR-GW-9): the routes the Whiteflow merchant MCP uses with a secret
// key: links (create with a durable Idempotency-Key, list, read one with its paid checkouts), the account profile and
// the report. Real SQL on PGlite; the FX source and the chain index are faked, nothing leaves the process.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-mcp-api.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, seedWorkspace, signedIn, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_PAY_ADDRESS = "0xab817593253a0a37de723072827d88fe0ca54251";
process.env.RELAYER_URL = "https://relayer.test";

const { POST: createLinkRoute, GET: listLinksRoute } = await import("../app/api/v1/links/route.ts");
const { GET: getLinkRoute } = await import("../app/api/v1/links/[id]/route.ts");
const { GET: accountRoute } = await import("../app/api/v1/account/route.ts");
const { GET: reportRoute } = await import("../app/api/v1/reports/route.ts");
const { POST: sessionsRoute } = await import("../app/api/v1/sessions/route.ts");
const { createKey, revokeKey } = await import("../lib/server/keys.ts");
const { recordCheckout, markCheckoutPaid } = await import("../lib/server/checkouts.ts");
const { createSession, recordPayment } = await import("../lib/sessions.ts");
const { query } = await import("../lib/server/db.ts");

before(async () => {
  await setupDb();
});

let sk, otherSk, pk;
beforeEach(async () => {
  await resetDb();
  // batch 051: a secret key acts once its wallet is linked to a Whiteflow workspace (the key takes it in its INSERT)
  await seedWorkspace(MERCHANT);
  await seedWorkspace(OTHER_MERCHANT);
  sk = (await createKey(MERCHANT, "mcp", "sk")).key;
  otherSk = (await createKey(OTHER_MERCHANT, "mcp", "sk")).key;
  pk = (await createKey(MERCHANT, "browser", "pk")).key;
  // Frankfurter for the INR link's 1..1,000 USDT check (90 INR per USD); Blockscout for the report (no logs)
  mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.frankfurter.dev/v2/rates?base=usd")) {
      return Response.json([{ date: new Date().toISOString().slice(0, 10), base: "USD", quote: "INR", rate: 90 }]);
    }
    if (u.includes("module=logs")) return Response.json({ message: "No logs found", status: "0", result: [] });
    throw new Error(`unexpected fetch ${u}`);
  });
});

const bearer = (key, extra = {}) => ({ authorization: `Bearer ${key}`, ...extra });
const LINK = { amount: "15000.00", currency: "INR", description: "Acme website redesign", reference_id: "ACME-WEB" };
const post = (body, headers) => createLinkRoute(req("POST", "/api/v1/links", { body, headers }));

test("a secret key creates a link; a publishable key is 403 and no key 401; the session cookie still works", async () => {
  const res = await post(LINK, bearer(sk, { "idempotency-key": "create-1" }));
  assert.equal(res.status, 201);
  const link = await res.json();
  assert.match(link.id, /^lnk_/);
  assert.equal(link.amount, "15000");
  assert.equal(link.currency, "INR");
  assert.equal(link.status, "active");
  assert.match(link.url, /^\/l\/[0-9A-Za-z]{10}$/);
  assert.equal((await post({ ...LINK, reference_id: "B" }, bearer(pk))).status, 403);
  assert.equal((await post({ ...LINK, reference_id: "C" }, {})).status, 401);
  assert.equal((await post({ ...LINK, reference_id: "D" }, bearer("sk_test_notarealkeynotarealkeynotarealk"))).status, 401);
  // a secret-key write without an Idempotency-Key is refused, so its retries are always safe (batch 054)
  assert.equal((await post({ ...LINK, reference_id: "F" }, bearer(sk))).status, 400);
  assert.equal((await post({ ...LINK, reference_id: "E" }, signedIn())).status, 201);
});

test("a revoked key is 401 everywhere the connector goes, and the error never repeats the key", async () => {
  const [{ id }] = await query("SELECT id FROM app_gw_keys WHERE merchant = $1 AND kind = 'sk'", [MERCHANT.toLowerCase()]);
  assert.equal(await revokeKey(MERCHANT, id), true);
  for (const res of [
    await post(LINK, bearer(sk)),
    await listLinksRoute(req("GET", "/api/v1/links", { headers: bearer(sk) })),
    await accountRoute(req("GET", "/api/v1/account", { headers: bearer(sk) })),
    await reportRoute(req("GET", "/api/v1/reports", { headers: bearer(sk) })),
  ]) {
    assert.equal(res.status, 401);
    assert.ok(!(await res.text()).includes(sk));
  }
});

test("Idempotency-Key: same key and body → the same link, marked replayed; a different body → 422; no key → a new link", async () => {
  const first = await post(LINK, bearer(sk, { "idempotency-key": "k-1" }));
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("idempotent-replayed"), null);
  const a = await first.json();
  // the same request with its keys in another order is the same request (canonical hash)
  const reordered = JSON.stringify({ reference_id: LINK.reference_id, description: LINK.description, currency: "INR", amount: "15000.00" });
  const again = await post(reordered, bearer(sk, { "idempotency-key": "k-1" }));
  assert.equal(again.status, 201);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal((await again.json()).id, a.id);
  const changed = await post({ ...LINK, amount: "16000.00" }, bearer(sk, { "idempotency-key": "k-1" }));
  assert.equal(changed.status, 422);
  // a deliberate second link needs a new key (or none) and its own reference_id
  const second = await post({ ...LINK, reference_id: "ACME-WEB-2" }, bearer(sk, { "idempotency-key": "k-2" }));
  assert.equal(second.status, 201);
  assert.notEqual((await second.json()).id, a.id);
  const [{ n }] = await query("SELECT count(*)::text AS n FROM app_gw_links WHERE merchant = $1", [MERCHANT.toLowerCase()]);
  assert.equal(n, "2");
});

test("a refused create frees the key, so the corrected retry with the same key succeeds", async () => {
  const bad = await post({ ...LINK, amount: "-5" }, bearer(sk, { "idempotency-key": "k-fix" }));
  assert.equal(bad.status, 400);
  const fixed = await post({ ...LINK, amount: "15000.00" }, bearer(sk, { "idempotency-key": "k-fix" }));
  assert.equal(fixed.status, 201);
});

test("two merchants' keys and a checkout's key never share an idempotency slot", async () => {
  const mine = await (await post(LINK, bearer(sk, { "idempotency-key": "same" }))).json();
  const theirs = await post(LINK, bearer(otherSk, { "idempotency-key": "same" }));
  assert.equal(theirs.status, 201);
  assert.notEqual((await theirs.json()).id, mine.id);
  // the sessions route's slot for the same merchant and key is its own: a checkout is created, not the link replayed
  const checkout = await sessionsRoute(req("POST", "/api/v1/sessions", { body: { amount: "5.00" }, headers: bearer(sk, { "idempotency-key": "same" }) }));
  assert.equal(checkout.status, 201);
  assert.equal(checkout.headers.get("idempotent-replayed"), null);
  assert.ok((await checkout.json()).url.includes("/checkout/"));
});

test("sessions keep their idempotency (shared helper): the same key replays the same checkout", async () => {
  const body = { amount: "5.00", reference: "A-1" };
  const one = await (await sessionsRoute(req("POST", "/api/v1/sessions", { body, headers: bearer(sk, { "idempotency-key": "s-1" }) }))).json();
  const two = await sessionsRoute(req("POST", "/api/v1/sessions", { body, headers: bearer(sk, { "idempotency-key": "s-1" }) }));
  assert.equal(two.headers.get("idempotent-replayed"), "true");
  assert.equal((await two.json()).id, one.id);
  const other = await sessionsRoute(req("POST", "/api/v1/sessions", { body: { amount: "6.00" }, headers: bearer(sk, { "idempotency-key": "s-1" }) }));
  assert.equal(other.status, 422);
});

test("GET /api/v1/links/{id}: the merchant's link with its paid checkouts; another merchant's id or a junk id is 404", async () => {
  const link = await (await post({ amount: "25.00", currency: "USDT", description: "Consulting", single_use: true }, bearer(sk, { "idempotency-key": "read-1" }))).json();
  const read = (id, key = sk) => getLinkRoute(req("GET", `/api/v1/links/${id}`, { headers: bearer(key) }), params({ id }));

  const before = await (await read(link.id)).json();
  assert.equal(before.status, "active");
  assert.equal(before.payments, 0);
  assert.deepEqual(before.paid_checkouts, []);

  // a paid checkout, recorded the way the pay route records one (sessions.payment + checkouts.paid_at)
  const session = await createSession({ merchant: MERCHANT, merchantName: "x", amount: 25_000_000n, reference: "ref", items: [] }, Date.now());
  await recordCheckout(session.id, "link", link.id, MERCHANT, 25_000_000n);
  const tx = `0x${"ab".repeat(32)}`;
  await recordPayment(session.id, { txHash: tx, blockNumber: "7", paymentId: "42", from: OTHER_MERCHANT, paidAt: Date.now(), amount: 25_000_000n });
  await markCheckoutPaid(session.id);

  const after = await (await read(link.id)).json();
  assert.equal(after.status, "paid");
  assert.equal(after.payments, 1);
  assert.equal(after.paid_checkouts.length, 1);
  assert.deepEqual({ ...after.paid_checkouts[0], paid_at: undefined }, { session_id: session.id, payment_id: "42", amount: "25", currency: "USDT", tx_hash: tx, paid_at: undefined });

  assert.equal((await read(link.id, otherSk)).status, 404);
  assert.equal((await read("lnk_doesnotexist")).status, 404);
  assert.equal((await read("../../etc")).status, 404);
  // a publishable key and a revoked secret key can't read it either (review 052 F6)
  assert.equal((await read(link.id, pk)).status, 403);
  const [{ id: keyId }] = await query("SELECT id FROM app_gw_keys WHERE merchant = $1 AND kind = 'sk'", [MERCHANT.toLowerCase()]);
  await revokeKey(MERCHANT, keyId);
  assert.equal((await read(link.id)).status, 401);
  const listed = await (await listLinksRoute(req("GET", "/api/v1/links", { headers: bearer(otherSk) }))).json();
  assert.deepEqual(listed.links, []);
});

test("GET /api/v1/account: the key's own merchant and the server's real limits; no key material; pk 403", async () => {
  const res = await accountRoute(req("GET", "/api/v1/account", { headers: bearer(sk) }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(sk));
  const account = JSON.parse(text);
  assert.equal(account.merchant.address.toLowerCase(), MERCHANT.toLowerCase());
  assert.equal(account.environment, "test");
  assert.equal(account.network.chain_id, 1874);
  assert.deepEqual(account.settlement, { asset: "USDT", token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", decimals: 6 });
  assert.deepEqual(account.price_currencies, ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"]);
  assert.deepEqual(account.payment_limits, { currency: "USDT", min: "1.00", max: "1000.00" });
  assert.equal(account.timezone, null);
  assert.equal(account.credential.type, "secret_key");
  assert.match(account.credential.key_id, /^key_/);
  assert.equal(account.capabilities.invoices, false);
  assert.equal((await accountRoute(req("GET", "/api/v1/account", { headers: bearer(pk) }))).status, 403);
  assert.equal((await accountRoute(req("GET", "/api/v1/account"))).status, 401);
});

test("GET /api/v1/reports works with a secret key, in the asked time zone; pk 403", async () => {
  const res = await reportRoute(req("GET", "/api/v1/reports?from=2026-11-01&to=2026-11-07&tz=Asia/Kolkata", { headers: bearer(sk) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totals.gross, "0");
  // the zone the connector asks for is the one the report uses (review 052 F6), and a bad one is a 400
  assert.deepEqual([body.from, body.to, body.tz, body.days.length], ["2026-11-01", "2026-11-07", "Asia/Kolkata", 7]);
  assert.equal((await reportRoute(req("GET", "/api/v1/reports?tz=Mars/Olympus", { headers: bearer(sk) }))).status, 400);
  assert.equal((await reportRoute(req("GET", "/api/v1/reports", { headers: bearer(pk) }))).status, 403);
});

test("GET /api/v1/reports is rate limited per merchant: 30 a minute, then 429 (each call reads the chain index; review M1)", async () => {
  const get = () => reportRoute(req("GET", "/api/v1/reports", { headers: bearer(otherSk) }));
  for (let i = 0; i < 30; i++) assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 429);
});
