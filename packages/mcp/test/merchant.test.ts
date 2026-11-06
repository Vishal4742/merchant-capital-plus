// Merchant tools (FR-MCP-1, FR-MCP-2, FR-MCP-3) and the AT-16 path, offline with a scripted fetch. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.ts";
import { BASE, PAYER, SECRET, connect, fakeFetch, tempFile } from "./helpers.ts";

const TX = `0x${"ab".repeat(32)}`;
const EXPLORER = `https://explorer.testnet.whitechain.io/tx/${TX}`;
const MERCHANT_TOOLS = ["create_checkout", "get_checkout", "list_payments", "sales_summary"];
const noNetwork = () => fakeFetch(() => new Error("no network in this test"));

test("without MCP_PAYER_KEY only the four merchant tools exist: nothing pays, signs, refunds or edits keys (FR-MCP-3, FR-MCP-5)", async () => {
  const { client } = await connect({ MCP_SECRET_KEY: SECRET }, noNetwork().fetch);
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, MERCHANT_TOOLS);
});

test("with MCP_PAYER_KEY the payer tools are added", async () => {
  const { client } = await connect({ MCP_SECRET_KEY: SECRET, MCP_PAYER_KEY: PAYER }, noNetwork().fetch);
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...MERCHANT_TOOLS, "pay_checkout", "spending_report"].sort());
});

test("a payer-only server has no merchant tools", async () => {
  const { client } = await connect({ MCP_PAYER_KEY: PAYER }, noNetwork().fetch);
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["pay_checkout", "spending_report"]);
});

test("startup refuses bad config, and the error never repeats the key", () => {
  const make = (env: Record<string, string>) => () => createServer({ env, fetch: noNetwork().fetch, spendingFile: tempFile() });
  assert.throws(make({}), /MCP_SECRET_KEY/);
  assert.throws(make({ MCP_SECRET_KEY: "pk_test_AbCdEfGhIjKlMnOpQrStUvWxYz012345" }), (error: Error) => /sk_test_/.test(error.message) && !error.message.includes("pk_test_AbCd"));
  assert.throws(make({ MCP_SECRET_KEY: SECRET, MCP_PAYER_KEY: "0x1234" }), (error: Error) => /MCP_PAYER_KEY/.test(error.message) && !error.message.includes("0x1234"));
  assert.throws(make({ MCP_SECRET_KEY: SECRET, MCP_BASE_URL: "http://gateway.test" }), /https/);
});

test("create_checkout posts the checkout with the secret key and returns the hosted URL; no payment (FR-MCP-2, AT-16)", async () => {
  const { calls, fetch } = fakeFetch(() => ({ status: 201, body: { id: "abc123", url: `${BASE}/checkout/abc123`, amount: "5.00", currency: "USD", priced: { currency: "USD", amount: "5.00", rate: "1", rateAt: "2026-11-06", source: "peg" }, expiresAt: "2026-11-06T12:30:00.000Z" } }));
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  const result = await call("create_checkout", { amount: "5", currency: "USD", description: "Coffee for two" });
  assert.equal(result.isError, false, result.text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/api/v1/sessions`);
  assert.equal(calls[0].headers.get("authorization"), `Bearer ${SECRET}`);
  assert.ok(calls[0].headers.get("idempotency-key"), "a retried create must not make a second checkout");
  assert.deepEqual(JSON.parse(calls[0].body!), { amount: "5", currency: "USD", reference: "Coffee for two" });
  const out = JSON.parse(result.text);
  assert.equal(out.url, `${BASE}/checkout/abc123`);
  assert.equal(out.id, "abc123");
  assert.equal(out.amountUsdt, "5.00");
  assert.ok(!result.text.includes(SECRET));
});

test("create_checkout validates before any request: amount format, currency list, description length (FR-MCP-3)", async () => {
  const { calls, fetch } = noNetwork();
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  for (const amount of ["1.1234567", "-1", "abc", "1e3", "0", "0.000000", " 5", ""]) {
    const result = await call("create_checkout", { amount, currency: "USDT" });
    assert.equal(result.isError, true, `amount ${JSON.stringify(amount)} must be refused`);
  }
  assert.equal((await call("create_checkout", { amount: "5", currency: "BTC" })).isError, true);
  assert.equal((await call("create_checkout", { amount: "5", currency: "USDT", description: "x".repeat(41) })).isError, true);
  assert.match((await call("create_checkout", { amount: "5.1234567", currency: "USDT" })).text, /6 decimals/);
  assert.equal(calls.length, 0);
});

test("get_checkout takes an id or the hosted URL; once paid it gives the tx hash and its explorer link (FR-MCP-2, AT-16)", async () => {
  const { calls, fetch } = fakeFetch(() => ({ status: 200, body: { id: "abc123", status: "paid", amount: "5.00", currency: "USD", reference: "Coffee", paymentId: "41", txHash: TX, refunded: "0.00" } }));
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  for (const checkout of ["abc123", `${BASE}/checkout/abc123`]) {
    const result = await call("get_checkout", { checkout });
    assert.equal(result.isError, false, result.text);
    const out = JSON.parse(result.text);
    assert.equal(out.status, "paid");
    assert.equal(out.txHash, TX);
    assert.equal(out.explorer, EXPLORER);
  }
  assert.ok(calls.every((c) => c.url === `${BASE}/api/v1/sessions/abc123` && c.headers.get("authorization") === `Bearer ${SECRET}`));
});

test("get_checkout refuses a URL on another site and a malformed id, before any request", async () => {
  const { calls, fetch } = noNetwork();
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  assert.equal((await call("get_checkout", { checkout: "https://evil.test/checkout/abc123" })).isError, true);
  assert.equal((await call("get_checkout", { checkout: "../keys" })).isError, true);
  assert.equal(calls.length, 0);
});

test("list_payments passes the limit and links each tx; a bad limit is refused (FR-MCP-2, FR-MCP-3, AT-16)", async () => {
  const { calls, fetch } = fakeFetch(() => ({ status: 200, body: { data: [{ paymentId: "41", sessionId: "abc123", invoiceId: null, amount: "5.00", refunded: "0.00", txHash: TX, paidAt: "2026-11-06T11:00:00.000Z", reference: "Coffee" }], next: null } }));
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  const result = await call("list_payments", { limit: 5 });
  assert.equal(result.isError, false, result.text);
  assert.equal(calls[0].url, `${BASE}/api/v1/payments?limit=5`);
  const out = JSON.parse(result.text);
  assert.equal(out.payments[0].sessionId, "abc123");
  assert.equal(out.payments[0].explorer, EXPLORER);
  for (const limit of [0, 101, 1.5]) assert.equal((await call("list_payments", { limit })).isError, true);
  assert.equal(calls.length, 1);
});

test("sales_summary pages through payments and sums gross, refunded and count for the dates, inclusive (FR-MCP-2)", async () => {
  const pages: Record<string, unknown> = {
    first: { data: [
      { paymentId: "9", amount: "1.00", refunded: "0.00", txHash: TX, paidAt: "2026-11-07T00:00:01.000Z" }, // after `to`
      { paymentId: "8", amount: "10.50", refunded: "2.25", txHash: TX, paidAt: "2026-11-06T23:59:59.000Z" },
      { paymentId: "7", amount: "1,000.00", refunded: "0.00", txHash: TX, paidAt: "2026-11-06T08:00:00.000Z" },
    ], next: "7" },
    "7": { data: [
      { paymentId: "6", amount: "0.000001", refunded: "0.00", txHash: TX, paidAt: "2026-11-05T00:00:00.000Z" },
      { paymentId: "5", amount: "3.00", refunded: "0.00", txHash: TX, paidAt: "2026-11-04T23:59:59.000Z" }, // before `from`: stop
    ], next: "5" },
  };
  const { calls, fetch } = fakeFetch((c) => ({ status: 200, body: pages[new URL(c.url).searchParams.get("cursor") ?? "first"] }));
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  const result = await call("sales_summary", { from: "2026-11-05", to: "2026-11-06" });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(JSON.parse(result.text), { from: "2026-11-05", to: "2026-11-06", count: 3, gross: "1010.500001", refunded: "2.25", net: "1008.250001", currency: "USDT", complete: true });
  assert.equal(calls.length, 2, "stops at the first payment older than `from`");
  assert.equal(calls[0].url, `${BASE}/api/v1/payments?limit=100`);
});

test("sales_summary refuses bad dates before any request", async () => {
  const { calls, fetch } = noNetwork();
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  for (const [from, to] of [["2026-11-06", "2026-11-05"], ["6 Nov", "2026-11-06"], ["2026-02-30", "2026-03-01"]]) {
    assert.equal((await call("sales_summary", { from, to })).isError, true, `${from}..${to}`);
  }
  assert.equal(calls.length, 0);
});

test("API errors come back as their plain reason, naming MCP_SECRET_KEY, with the key scrubbed (FR-MCP-3)", async () => {
  const { fetch } = fakeFetch(() => ({ status: 401, body: { error: `Missing or wrong API key: ${SECRET}` } }));
  const { call } = await connect({ MCP_SECRET_KEY: SECRET }, fetch);
  const result = await call("get_checkout", { checkout: "abc123" });
  assert.equal(result.isError, true);
  assert.match(result.text, /Missing or wrong API key/);
  assert.match(result.text, /MCP_SECRET_KEY/);
  assert.ok(!result.text.includes(SECRET));
});

test("a network failure is a plain reason without either key (FR-MCP-3)", async () => {
  const { fetch } = fakeFetch(() => new Error(`connect ECONNREFUSED (key ${SECRET}, payer ${PAYER.slice(2).toUpperCase()})`));
  const { call } = await connect({ MCP_SECRET_KEY: SECRET, MCP_PAYER_KEY: PAYER }, fetch);
  const result = await call("list_payments", {});
  assert.equal(result.isError, true);
  assert.match(result.text, /reach the gateway/);
  assert.ok(!result.text.includes(SECRET));
  assert.ok(!result.text.toLowerCase().includes(PAYER.slice(2)));
});
