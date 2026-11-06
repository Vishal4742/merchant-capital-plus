// Batch 023: the checkout store, its locks, Idempotency-Key slots and used nonces live in Postgres, so they hold across
// Vercel instances. A second "instance" is the same module imported under another URL (?instance=2): its own module
// state, the same database, as two serverless instances would have. Run from apps/web: npm test
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setupDb, resetDb } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
delete process.env.MERCHANT_PAY_ADDRESS; // no chain here: the poll reads only the store
const MERCHANT = process.env.MERCHANT_ADDRESS;
const A = "0x3333333333333333333333333333333333333333", B = "0x4444444444444444444444444444444444444444";

const one = await import("../lib/sessions.ts");
const two = await import("../lib/sessions.ts?instance=2");
const { query } = await import("../lib/server/db.ts");
const routeOne = (await import("../app/api/v1/sessions/route.ts")).POST;
const routeTwo = (await import("../app/api/v1/sessions/route.ts?instance=2")).POST;
const { GET: statusRoute } = await import("../app/api/v1/sessions/[id]/route.ts");
const authOne = await import("../lib/auth.ts");
const authTwo = await import("../lib/auth.ts?instance=2");

before(setupDb);
beforeEach(resetDb);

const fresh = (over = {}) => one.createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: 25_000_000n, reference: "A-1", items: [], ...over });
const auth = { authorization: `Bearer ${process.env.SHOP_API_KEY}`, "content-type": "application/json" };
const create = (route, body, key) => route(new Request("http://shop.test/api/v1/sessions", { method: "POST", headers: { ...auth, "idempotency-key": key }, body: JSON.stringify(body) }));
const count = async (table) => Number((await query(`SELECT count(*)::text AS n FROM ${table}`))[0].n);

test("a checkout made on one instance opens on another, every field exact", async () => {
  const made = await fresh({ items: [{ name: "Cold brew", qty: 2, price: 12_500_000n }], returnUrl: "https://shop.example/done" });
  assert.deepEqual(await two.getSession(made.id), { ...made, returnUrl: "https://shop.example/done" });
  assert.equal(await two.getSession("00000000-0000-0000-0000-000000000000"), undefined);
});

test("bigint amounts round-trip exactly: 1,000.000001 USDT in units, prices, a priced amount, the payment, the attempt", async () => {
  const units = 1_000_000_001n;
  const huge = 2n ** 255n + 7n; // validBefore is a uint256: far past any float
  const s = await fresh({
    amount: units,
    items: [{ name: "Tea", qty: 1, price: units }],
    priced: { currency: "EUR", amount: 888_770_001n, rate: "0.88877", rateDate: "2026-11-06", fetchedAt: 1, source: "test" },
  });
  await one.markPending(s.id, { from: A, validBefore: huge, amount: units - 1n });
  let read = await two.getSession(s.id);
  assert.deepEqual([read.amount, read.items[0].price, read.priced.amount, read.pending.validBefore, read.pending.amount], [units, units, 888_770_001n, huge, units - 1n]);
  await one.recordPayment(s.id, { txHash: null, blockNumber: null, paymentId: "1", from: A, paidAt: 5, amount: units });
  read = await two.getSession(s.id);
  assert.deepEqual([read.payment.amount, read.pending], [units, undefined], "recording a payment clears the attempt");
  assert.equal((await query("SELECT amount::text FROM app_web_sessions WHERE id = $1", [s.id]))[0].amount, "1000000001");
});

test("two instances racing for one checkout's lock: exactly one wins; it holds until released", async () => {
  const s = await fresh();
  const won = await Promise.all([one.claimPayment(s.id), two.claimPayment(s.id), one.claimPayment(s.id), two.claimPayment(s.id)]);
  assert.equal(won.filter(Boolean).length, 1);
  assert.deepEqual([await one.isInFlight(s.id), await two.isInFlight(s.id)], [true, true], "both instances see it in flight");
  assert.equal(await two.claimPayment(s.id), null);
  await one.releasePayment(s.id, won.find(Boolean));
  const again = await two.claimPayment(s.id);
  assert.deepEqual([await two.isInFlight(s.id), typeof again], [true, "string"], "released, then re-taken");
  assert.ok(await one.claimPayment(one.invoiceLock("7")), "an invoice's lock is its own key");
});

test("a lapsed lock (its instance died mid-payment) can be re-taken; a live one can't", async () => {
  const s = await fresh();
  const first = await one.claimPayment(s.id);
  assert.ok(first);
  assert.equal(await two.claimPayment(s.id), null, "live");
  await query("UPDATE app_web_locks SET until = now() - interval '1 second' WHERE key = $1", [s.id]);
  assert.equal(await one.isInFlight(s.id), false, "a lapsed lock isn't in flight");
  const retaken = await Promise.all([one.claimPayment(s.id), two.claimPayment(s.id)]);
  assert.equal(retaken.filter(Boolean).length, 1, "exactly one instance re-takes it");
  const [{ secs }] = await query("SELECT extract(epoch FROM until - now())::int AS secs FROM app_web_locks WHERE key = $1", [s.id]);
  assert.ok(secs > 290 && secs <= 300, `held for the full lock time again (${secs} s)`);
  // security 026 F1: the attempt that outlived its lapsed lock can't free the lock the later attempt took
  await one.releasePayment(s.id, first);
  assert.equal(await two.isInFlight(s.id), true, "a stale token deletes nothing");
  await one.releasePayment(s.id, retaken.find(Boolean));
  assert.equal(await two.isInFlight(s.id), false, "the owner's token releases it");
});

test("recordPayment: first write wins, even with two at once; both callers get the stored payment back", async () => {
  const s = await fresh();
  const relayed = { txHash: `0x${"ab".repeat(32)}`, blockNumber: "5", paymentId: "1", from: A, paidAt: 1, amount: 25_000_000n };
  const reconciled = { txHash: null, blockNumber: null, paymentId: "1", from: A, paidAt: 2, amount: 25_000_000n };
  const [x, y] = await Promise.all([one.recordPayment(s.id, relayed), two.recordPayment(s.id, reconciled)]);
  assert.deepEqual(x.payment, y.payment, "one payment is stored");
  assert.deepEqual((await one.recordPayment(s.id, reconciled)).payment, x.payment, "a later record never replaces it");
  await assert.rejects(one.recordPayment("no-such-checkout", relayed), /No such checkout/);
});

test("clearPending compares by value: a newer attempt stays, the same attempt (a fresh read) clears", async () => {
  const s = await fresh();
  const old = { from: A, validBefore: 100n, amount: 20_000_000n };
  await one.markPending(s.id, old);
  const newer = { from: B, validBefore: 200n };
  await two.markPending(s.id, newer); // arrived while instance one was reading the chain
  await one.clearPending(s.id, old);
  assert.deepEqual((await one.getSession(s.id)).pending, newer, "the newer attempt stays");
  await one.clearPending(s.id, { from: B, validBefore: 200n, amount: 1n });
  assert.deepEqual((await one.getSession(s.id)).pending, newer, "another price is another attempt");
  await one.clearPending(s.id, (await two.getSession(s.id)).pending); // a fresh object from another read
  assert.equal((await one.getSession(s.id)).pending, undefined);
  assert.equal(one.samePending(old, { ...old }), true);
  assert.equal(one.samePending(old, { ...old, amount: undefined }), false);
  await assert.rejects(one.markPending("no-such-checkout", old), /No such checkout/);
});

test("an invoice's attempt: stored as exact units, compare-and-clear keeps a newer attempt", async () => {
  await one.setInvoiceAttempt("7", { pending: { from: A, validBefore: 2n ** 70n } });
  const read = await two.invoiceAttempt("7");
  assert.equal(read.pending.validBefore, 2n ** 70n);
  await two.setInvoiceAttempt("7", { ...read, pending: { from: B, validBefore: 9n } });
  await one.clearInvoicePending("7", read.pending);
  assert.deepEqual((await one.invoiceAttempt("7")).pending, { from: B, validBefore: 9n });
  await one.clearInvoicePending("7", { from: B, validBefore: 9n });
  assert.deepEqual(await one.invoiceAttempt("7"), {});
  await one.setInvoiceAttempt("7", { receipt: { paymentId: "41", txHash: null } });
  assert.deepEqual(await two.invoiceAttempt("7"), { receipt: { paymentId: "41", txHash: null } });
  assert.deepEqual(await two.invoiceAttempt("8"), {});
});

test("listPayments: one merchant's paid checkouts, any address case, newest first, from any instance", async () => {
  const [early, late, open, other] = [await fresh(), await fresh(), await fresh(), await fresh({ merchant: B })];
  await one.recordPayment(early.id, { txHash: null, blockNumber: null, paymentId: "1", from: A, paidAt: 1_000, amount: 1n });
  await one.recordPayment(late.id, { txHash: null, blockNumber: null, paymentId: "2", from: A, paidAt: 2_000, amount: 2n });
  await one.recordPayment(other.id, { txHash: null, blockNumber: null, paymentId: "3", from: A, paidAt: 3_000, amount: 3n });
  const listed = await two.listPayments(MERCHANT.toUpperCase().replace("0X", "0x"));
  assert.deepEqual(listed.map((p) => [p.session.id, p.payment.paymentId]), [[late.id, "2"], [early.id, "1"]]);
  assert.ok(!listed.some((p) => p.session.id === open.id), "unpaid checkouts aren't payments");
});

test("Idempotency-Key across instances: two at once create one checkout; another body is a 422; a refusal frees the key", async () => {
  const body = { amount: "25.00", reference: "IK-1" };
  const [a, b] = await Promise.all([create(routeOne, body, "k-1"), create(routeTwo, body, "k-1")]);
  const [da, db] = [await a.json(), await b.json()];
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.deepEqual(da, db, "the second gets the first one's reply");
  assert.equal(await count("app_web_sessions"), 1);
  const other = await create(routeTwo, { ...body, amount: "30.00" }, "k-1");
  assert.deepEqual([other.status, (await other.json()).error], [422, "This Idempotency-Key was already used for a different request."]);
  assert.equal((await create(routeOne, { amount: "0.10" }, "k-2")).status, 400);
  assert.equal((await create(routeTwo, { amount: "25.00" }, "k-2")).status, 201, "a refused request frees its key, on any instance");
  assert.equal(await count("app_web_sessions"), 2);
});

test("Idempotency-Key: a slot left by an instance that died mid-create frees after 300 s (the function's max duration); one still creating makes the next wait", async () => {
  const merchantSlot = `${MERCHANT.toLowerCase()}:k-3`;
  const hash = "stale";
  await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, 'dead', $2, $3)", [merchantSlot, hash, Date.now() - 301_000]);
  assert.equal((await create(routeOne, { amount: "25.00" }, "k-3")).status, 201, "the dead request's slot was freed");
  await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, 'slow', $2, $3)", [`${MERCHANT.toLowerCase()}:k-4`, hash, Date.now()]);
  assert.equal((await create(routeOne, { amount: "25.00" }, "k-4")).status, 422, "a different body is refused at once, even while the first is creating");
  // the same body waits for the first request's stored reply, then returns it (no second checkout)
  const sameHash = createHash("sha256").update(JSON.stringify({ amount: "25.00" })).digest("hex");
  await query("INSERT INTO app_web_idempotency (slot, owner, hash, created_at) VALUES ($1, 'slow', $2, $3)", [`${MERCHANT.toLowerCase()}:k-5`, sameHash, Date.now()]);
  const before = await count("app_web_sessions");
  const waiting = create(routeTwo, { amount: "25.00" }, "k-5");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await query("UPDATE app_web_idempotency SET status = 201, body = $2::jsonb WHERE slot = $1", [`${MERCHANT.toLowerCase()}:k-5`, JSON.stringify({ id: "the-first-reply" })]);
  const res = await waiting;
  assert.deepEqual([res.status, await res.json(), await count("app_web_sessions")], [201, { id: "the-first-reply" }, before]);
});

test("a sign-in nonce is single use across instances: a replay on another instance, or two at once, only one wins", async () => {
  assert.equal(await authOne.consumeNonce("nonce-aaaaaaaa"), true);
  assert.equal(await authTwo.consumeNonce("nonce-aaaaaaaa"), false, "the replay on another instance is refused");
  const raced = await Promise.all([authOne.consumeNonce("nonce-bbbbbbbb"), authTwo.consumeNonce("nonce-bbbbbbbb")]);
  assert.equal(raced.filter(Boolean).length, 1);
  // a used nonce is forgotten only after its cookie would have expired anyway (5 min + 60 s skew)
  const later = Date.now() + (authOne.NONCE_TTL_S * 1000 + 60_000) + 1;
  assert.equal(await authOne.consumeNonce("nonce-cccccccc", later), true);
  assert.equal(await count("app_web_nonces"), 1, "the expired ones were cleaned on the way");
});

test("GET /api/v1/sessions/:id: once paid with a code, amount is what was charged (G4 code LOW 4)", async () => {
  const s = await fresh({ amount: 100_000_000n });
  await one.recordPayment(s.id, { txHash: null, blockNumber: null, paymentId: "9", from: A, paidAt: Date.now(), amount: 50_000_000n });
  const res = await statusRoute(new Request(`http://shop.test/api/v1/sessions/${s.id}`, { headers: auth }), { params: Promise.resolve({ id: s.id }) });
  const body = await res.json();
  assert.deepEqual([res.status, body.status, body.amount], [200, "paid", "50.00"]);
  const open = await fresh({ amount: 100_000_000n });
  const unpaid = await (await statusRoute(new Request(`http://shop.test/api/v1/sessions/${open.id}`, { headers: auth }), { params: Promise.resolve({ id: open.id }) })).json();
  assert.equal(unpaid.amount, "100.00", "unpaid: the checkout's amount");
});

test("no checkout, lock, idempotency or nonce state is kept in process memory", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const path of ["../lib/sessions.ts", "../lib/auth.ts", "../app/api/v1/sessions/route.ts"]) {
    assert.doesNotMatch(source(path), /new (Map|WeakMap)\b|globalThis/, path);
  }
  assert.doesNotMatch(source("../lib/sessions.ts"), /new Set\b/);
});
