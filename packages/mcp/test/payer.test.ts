// Payer tools (FR-MCP-5): pay_checkout signs the browser's EIP-3009 sale authorization under caps; spending_report.
// Offline: a scripted fetch stands in for the checkout page and the pay route. No live payment. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { encodeAbiParameters, keccak256, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KIND_SALE, addresses, chainId, nonceParams, receiveWithAuthorizationTypes, usdtDomain } from "../../shared/contracts.ts";
import { readCheckoutPage } from "../src/tools/pay.ts";
import { createServer } from "../src/server.ts";
import { BASE, MERCHANT, MERCHANT_PAY, NOW, ORDER_REF, PAYER, SECRET, checkoutPage, connect, fakeFetch, tempFile, type Call } from "./helpers.ts";

const TX = `0x${"cd".repeat(32)}`;
const payer = privateKeyToAccount(PAYER as Hex);
const USDT = (n: number) => String(Math.round(n * 1e6));

/** The gateway: GET /checkout/:id serves the page for `amounts[id]`; POST /api/v1/sessions/:id/pay answers `pay`. */
function gateway(amounts: Record<string, string>, pay: (call: Call) => { status: number; body: unknown } | Error = () => ({ status: 200, body: { receiptId: "x", txHash: TX } }), page: Partial<Parameters<typeof checkoutPage>[0]> = {}) {
  return fakeFetch((call) => {
    const path = new URL(call.url).pathname;
    const view = /^\/checkout\/([\w-]+)$/.exec(path);
    if (view && call.method === "GET") return { status: 200, type: "text/html", body: checkoutPage({ id: view[1], amount: amounts[view[1]], ...page }) };
    if (/^\/api\/v1\/sessions\/[\w-]+\/pay$/.test(path) && call.method === "POST") return pay(call);
    return { status: 404, body: { error: "not here" } };
  });
}
const payerEnv = (extra: Record<string, string> = {}) => ({ MCP_PAYER_KEY: PAYER, ...extra });
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

test("the checkout page parser reads the sale terms from the live page's flight data", () => {
  const html = readFileSync(new URL("./fixtures/checkout-live.html", import.meta.url), "utf8");
  const terms = readCheckoutPage(html, "f2bf9e0f-8560-4f5b-bc04-25c3106abc35");
  assert.deepEqual(terms, {
    merchantPay: "0xab817593253a0a37de723072827d88fe0ca54251",
    merchant: "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1",
    orderRef: "0xd6ff7a4e6cf6dbbeaa3c11bfcb40e224bdc26863deff9cbf6a7a3ecf3213c54c",
    amount: 6_000_000n,
    expiresAt: 1793964727016,
    paid: false,
    pending: false,
  });
  assert.throws(() => readCheckoutPage(html, "another-id"), /checkout/);
  assert.throws(() => readCheckoutPage("<html>nothing</html>", "x"), /terms/);
});

test("pay_checkout signs exactly the browser's sale authorization and posts it once (FR-MCP-5)", async () => {
  const { calls, fetch } = gateway({ abc123: USDT(6) });
  const file = tempFile();
  const { call } = await connect(payerEnv(), fetch, { spendingFile: file });
  const result = await call("pay_checkout", { checkout: `${BASE}/checkout/abc123` });
  assert.equal(result.isError, false, result.text);

  const [post] = posts(calls);
  assert.equal(posts(calls).length, 1);
  assert.equal(post.url, `${BASE}/api/v1/sessions/abc123/pay`);
  assert.equal(post.headers.get("authorization"), null, "the pay route needs no key; never send the merchant's");
  const body = JSON.parse(post.body!);
  assert.deepEqual(Object.keys(body).sort(), ["amount", "from", "salt", "signature", "validBefore"]);
  assert.equal(body.from, payer.address);
  assert.equal(body.amount, USDT(6));
  assert.match(body.salt, /^0x[0-9a-f]{64}$/);
  const validBefore = BigInt(body.validBefore);
  assert.ok(validBefore <= BigInt(NOW / 1000 + 465) && validBefore > BigInt(NOW / 1000 + 30), "inside the relayer's window");

  // rebuilt independently from packages/shared, the same as apps/web/lib/pay.ts saleAuthorization
  const nonce = keccak256(encodeAbiParameters(nonceParams, [BigInt(chainId), MERCHANT_PAY, KIND_SALE, BigInt(MERCHANT), ORDER_REF as Hex, 6_000_000n, body.salt]));
  const valid = await verifyTypedData({
    address: payer.address,
    domain: usdtDomain,
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: payer.address, to: addresses.merchantPay, value: 6_000_000n, validAfter: 0n, validBefore, nonce },
    signature: body.signature,
  });
  assert.equal(valid, true);

  const out = JSON.parse(result.text);
  assert.equal(out.txHash, TX);
  assert.equal(out.explorer, `https://explorer.testnet.whitechain.io/tx/${TX}`);
  assert.equal(out.amount, "6.00");
  assert.ok(!result.text.toLowerCase().includes(PAYER.slice(2)));
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.payments[0].status, "paid");
  assert.equal(saved.payments[0].txHash, TX);
});

test("the approval never outlives the checkout", async () => {
  const expiresAt = NOW + 120_000;
  const { calls, fetch } = gateway({ abc123: USDT(2) }, undefined, { expiresAt });
  const { call } = await connect(payerEnv(), fetch);
  assert.equal((await call("pay_checkout", { checkout: "abc123" })).isError, false);
  assert.equal(JSON.parse(posts(calls)[0].body!).validBefore, String(Math.floor(expiresAt / 1000)));
});

test("refuses a payment above the per-payment cap (default 10 USDT) before signing (FR-MCP-5)", async () => {
  const { calls, fetch } = gateway({ big: USDT(10.000001), ten: USDT(10) });
  const { call } = await connect(payerEnv(), fetch);
  const result = await call("pay_checkout", { checkout: "big" });
  assert.equal(result.isError, true);
  assert.match(result.text, /per-payment limit of 10\.00 USDT/);
  assert.equal(posts(calls).length, 0);
  assert.equal((await call("pay_checkout", { checkout: "ten" })).isError, false, "exactly the cap is allowed");
});

test("refuses a payment that would pass the day cap (default 25 USDT); the report shows what was spent (FR-MCP-5)", async () => {
  const { calls, fetch } = gateway({ a: USDT(10), b: USDT(10), c: USDT(6), d: USDT(5) });
  const { call } = await connect(payerEnv(), fetch);
  assert.equal((await call("pay_checkout", { checkout: "a" })).isError, false);
  assert.equal((await call("pay_checkout", { checkout: "b" })).isError, false);
  const third = await call("pay_checkout", { checkout: "c" });
  assert.equal(third.isError, true);
  assert.match(third.text, /daily limit of 25\.00 USDT/);
  assert.equal((await call("pay_checkout", { checkout: "d" })).isError, false, "20 + 5 = 25 is allowed");
  assert.equal(posts(calls).length, 3);

  const report = JSON.parse((await call("spending_report")).text);
  assert.equal(report.spentToday, "25.00");
  assert.equal(report.remainingToday, "0.00");
  assert.deepEqual(report.limits, { perPayment: "10.00", perDay: "25.00" });
  assert.equal(report.payments.length, 3);
  assert.ok(report.payments.every((p: { txHash: string; explorer: string }) => p.txHash === TX && p.explorer.endsWith(TX)));
});

test("the day resets at UTC midnight, and the spending file survives a restart", async () => {
  const file = tempFile();
  const { fetch } = gateway({ a: USDT(10), b: USDT(10), c: USDT(10) }, undefined, { expiresAt: Date.parse("2026-11-07T01:00:00Z") });
  let now = NOW;
  const first = await connect(payerEnv(), fetch, { spendingFile: file, now: () => now });
  await first.call("pay_checkout", { checkout: "a" });
  await first.call("pay_checkout", { checkout: "b" });
  const restarted = await connect(payerEnv(), fetch, { spendingFile: file, now: () => now });
  assert.equal((await restarted.call("pay_checkout", { checkout: "c" })).isError, true, "20 already spent today, from the file");
  now = Date.parse("2026-11-07T00:00:01Z");
  assert.equal((await restarted.call("pay_checkout", { checkout: "c" })).isError, false, "a new UTC day");
});

test("caps can be lowered or raised by env, never above 100 USDT (FR-MCP-5)", async () => {
  const make = (extra: Record<string, string>) => () => createServer({ env: { MCP_BASE_URL: BASE, ...payerEnv(extra) }, fetch: gateway({}).fetch, spendingFile: tempFile() });
  assert.throws(make({ MCP_MAX_PER_PAYMENT: "100.01" }), /100/);
  assert.throws(make({ MCP_MAX_PER_DAY: "101" }), /100/);
  assert.throws(make({ MCP_MAX_PER_DAY: "0" }), /MCP_MAX_PER_DAY/);
  assert.throws(make({ MCP_MAX_PER_PAYMENT: "lots" }), /MCP_MAX_PER_PAYMENT/);
  assert.throws(make({ MCP_MAX_PER_PAYMENT: "30", MCP_MAX_PER_DAY: "20" }), /MCP_MAX_PER_DAY/);

  const { calls, fetch } = gateway({ a: USDT(40), b: USDT(70) });
  const { call } = await connect(payerEnv({ MCP_MAX_PER_PAYMENT: "50", MCP_MAX_PER_DAY: "100" }), fetch);
  assert.equal((await call("pay_checkout", { checkout: "a" })).isError, false);
  assert.equal((await call("pay_checkout", { checkout: "b" })).isError, true);
  assert.equal(posts(calls).length, 1);
});

test("refuses a checkout URL on another site, and a page naming another MerchantPay, before signing", async () => {
  const off = gateway({ abc123: USDT(1) });
  const { call } = await connect(payerEnv(), off.fetch);
  assert.match((await call("pay_checkout", { checkout: "https://evil.test/checkout/abc123" })).text, /gateway\.test/);
  assert.equal(off.calls.length, 0);

  const swapped = gateway({ abc123: USDT(1) }, undefined, { merchantPay: `0x${"66".repeat(20)}` });
  const other = await connect(payerEnv(), swapped.fetch);
  const result = await other.call("pay_checkout", { checkout: "abc123" });
  assert.equal(result.isError, true);
  assert.match(result.text, /MerchantPay/);
  assert.equal(posts(swapped.calls).length, 0);
});

test("refuses a paid, pending or nearly expired checkout before signing", async () => {
  for (const page of [{ paid: true }, { pending: true }, { expiresAt: NOW + 45_000 }]) {
    const { calls, fetch } = gateway({ abc123: USDT(1) }, undefined, page);
    const { call } = await connect(payerEnv(), fetch);
    assert.equal((await call("pay_checkout", { checkout: "abc123" })).isError, true, JSON.stringify(page));
    assert.equal(posts(calls).length, 0);
  }
});

test("a refusal (4xx) is not counted; an unknown outcome (5xx, no answer) is counted and never retried (FR-MCP-5)", async () => {
  const file = tempFile();
  const replies: Record<string, { status: number; body: unknown } | Error> = {
    a: { status: 400, body: { error: `This is a demo: the wallet has no test USDT. ${PAYER}` } },
    b: { status: 504, body: { error: "We couldn't confirm this payment yet." } },
    c: new Error("socket hang up"),
  };
  const { calls, fetch } = gateway({ a: USDT(9), b: USDT(9), c: USDT(9), d: USDT(9) }, (c) => replies[c.url.split("/").at(-2)!]);
  const { call } = await connect(payerEnv(), fetch, { spendingFile: file });

  const refused = await call("pay_checkout", { checkout: "a" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /no test USDT/);
  assert.match(refused.text, /Nothing was charged/);
  assert.ok(!refused.text.toLowerCase().includes(PAYER.slice(2)), "the payer key is redacted even when the gateway echoes it");

  const unknown = await call("pay_checkout", { checkout: "b" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /Don't pay again/);
  assert.equal((await call("pay_checkout", { checkout: "c" })).isError, true);
  assert.equal(posts(calls).length, 3, "one POST per attempt: a payment is never retried");

  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(saved.payments.map((p: { checkoutId: string; status: string }) => [p.checkoutId, p.status]), [["b", "unknown"], ["c", "unknown"]]);
  const blocked = await call("pay_checkout", { checkout: "d" });
  assert.match(blocked.text, /daily limit/, "18 USDT of unknown outcomes + 9 passes 25 (and c ran, so the refused a was not counted)");
});

test("a concurrent second call waits for the first, so two payments can't both slip under the day cap", async () => {
  const { calls, fetch } = gateway({ a: USDT(10), b: USDT(10), c: USDT(10) });
  const { call } = await connect(payerEnv(), fetch);
  const results = await Promise.all(["a", "b", "c"].map((checkout) => call("pay_checkout", { checkout })));
  assert.deepEqual(results.map((r) => r.isError), [false, false, true]);
  assert.equal(posts(calls).length, 2);
});

test("a corrupt spending file stops payments instead of resetting the budget", async () => {
  const file = tempFile();
  writeFileSync(file, "{not json");
  const { calls, fetch } = gateway({ a: USDT(1) });
  const { call } = await connect(payerEnv(), fetch, { spendingFile: file });
  const result = await call("pay_checkout", { checkout: "a" });
  assert.equal(result.isError, true);
  assert.match(result.text, /spending file/);
  assert.equal(posts(calls).length, 0);
});
