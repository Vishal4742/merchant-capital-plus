// claude-frontend checks for lib/gateway-forms.ts: the dashboard's link and page forms (FR-GW-1, FR-GW-2) are checked
// before anything is sent, and the hosted pages' plain form posts become the gateway's checkout bodies.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKOUT_ERRORS, checkoutErrorCode, linkBody, liveTotal, pageBody, pageCheckoutBody, pageQuantities, pageTotal } from "../lib/gateway-forms.ts";

const NOW = Date.UTC(2026, 10, 6, 6, 0);
const link = (over = {}) => ({ amount: "25.00", open: false, currency: "USD", description: "Cold brew", expires: "", reusable: false, ...over });

test("a link: the amount, currency and description it will be sent with", () => {
  assert.deepEqual(linkBody(link(), NOW), { ok: true, value: { amount: "25.00", currency: "USD", description: "Cold brew", single_use: true } });
  assert.deepEqual(linkBody(link({ open: true, amount: "ignored", reusable: true }), NOW), { ok: true, value: { amount: null, currency: "USD", description: "Cold brew", single_use: false } });
  assert.equal(linkBody(link({ description: "  Tip jar  " }), NOW).value.description, "Tip jar");
  assert.equal(linkBody(link({ currency: "INR", amount: "2000" }), NOW).value.amount, "2000", "a non-dollar price may pass 1,000");
});

test("a link: what is refused, in plain words", () => {
  const error = (over) => {
    const r = linkBody(link(over), NOW);
    assert.equal(r.ok, false, JSON.stringify(over));
    return r.error;
  };
  assert.match(error({ amount: "" }), /amount like 25\.00/);
  assert.match(error({ amount: "25,00" }), /amount like 25\.00/);
  assert.match(error({ amount: "0" }), /amount like 25\.00/);
  assert.match(error({ amount: "1.1234567" }), /amount like 25\.00/);
  assert.match(error({ amount: "0.50" }), /1\.00 to 1,000\.00 USD/, "USD runs 1 to 1,000 (MerchantPay's minimum, the testnet cap)");
  assert.match(error({ amount: "1000.01" }), /1\.00 to 1,000\.00 USD/);
  assert.match(error({ currency: "BTC" }), /currency/i);
  assert.match(error({ currency: "USDT" }), /currency/i, "the dashboard prices in the six currencies");
  assert.match(error({ description: "   " }), /what the link is for/i);
  assert.match(error({ description: "x".repeat(201) }), /200/);
  assert.match(error({ expires: "2026-11-05T00:00" }), /future/, "a time already past, in any time zone");
  assert.match(error({ expires: "not a date" }), /future/);
  assert.match(error({ expires: "2032-01-01T00:00" }), /5 years/);
});

test("a link's expiry is sent as an ISO time", () => {
  const r = linkBody(link({ expires: "2026-11-30T18:00:00Z" }), NOW);
  assert.equal(r.value.expires_at, "2026-11-30T18:00:00.000Z");
});

const page = (over = {}) => ({
  title: "Bandra Beans menu",
  description: "",
  logoUrl: "",
  color: "#1723e2",
  currency: "USD",
  mode: "items",
  items: [
    { name: "Cold brew", price: "5.00" },
    { name: "Croissant", price: "3.50" },
  ],
  min: "",
  max: "",
  ...over,
});

test("a page with items, or an open amount", () => {
  assert.deepEqual(pageBody(page()), {
    ok: true,
    value: { title: "Bandra Beans menu", color: "#1723E2", currency: "USD", items: [{ name: "Cold brew", price: "5.00" }, { name: "Croissant", price: "3.50" }] },
  });
  const open = pageBody(page({ mode: "open", min: "5", max: "50", description: "Tips for the team", logoUrl: "https://cdn.example/logo.png" }));
  assert.deepEqual(open.value, { title: "Bandra Beans menu", description: "Tips for the team", logo_url: "https://cdn.example/logo.png", color: "#1723E2", currency: "USD", open_amount: { min: "5", max: "50" } });
  assert.deepEqual(pageBody(page({ mode: "open" })).value.open_amount, {}, "no bounds: the customer enters any amount");
});

test("a page: what is refused", () => {
  const error = (over) => {
    const r = pageBody(page(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    return r.error;
  };
  assert.match(error({ title: " " }), /title/i);
  assert.match(error({ logoUrl: "http://cdn.example/logo.png" }), /https/);
  assert.match(error({ logoUrl: "https://user:pass@cdn.example/logo.png" }), /https/);
  assert.match(error({ logoUrl: "javascript:alert(1)" }), /https/);
  assert.match(error({ color: "red" }), /colour/);
  assert.match(error({ items: [] }), /at least one item/);
  assert.match(error({ items: Array.from({ length: 21 }, (_, i) => ({ name: `Item ${i}`, price: "1" })) }), /20/);
  assert.match(error({ items: [{ name: "Cold brew", price: "5" }, { name: "Cold brew", price: "6" }] }), /twice/);
  assert.match(error({ items: [{ name: "", price: "5" }] }), /name/);
  assert.match(error({ items: [{ name: "Cold brew", price: "free" }] }), /Cold brew/);
  assert.match(error({ mode: "open", min: "50", max: "5" }), /lowest/);
  assert.match(error({ mode: "open", min: "abc" }), /amount like/);
});

test("the hosted page's form becomes the checkout body", () => {
  const form = (entries) => new URLSearchParams(entries);
  assert.deepEqual(pageCheckoutBody(form([["qty:Cold brew", "2"], ["qty:Croissant", "0"]])), { ok: true, value: { items: [{ name: "Cold brew", qty: 2 }] } });
  assert.deepEqual(pageCheckoutBody(form([["amount", " 12.50 "]])), { ok: true, value: { amount: "12.50" } });
  assert.deepEqual(pageCheckoutBody(form([["qty:Cold brew", "0"]])), { ok: false, error: "items" }, "nothing chosen");
  assert.deepEqual(pageCheckoutBody(form([["qty:Cold brew", "101"]])), { ok: false, error: "items" });
  assert.deepEqual(pageCheckoutBody(form([["qty:Cold brew", "1.5"]])), { ok: false, error: "items" });
  assert.deepEqual(pageCheckoutBody(form([["qty:Cold brew", "-1"]])), { ok: false, error: "items" });
  assert.deepEqual(pageCheckoutBody(form([["amount", "1e3"]])), { ok: false, error: "amount" });
  assert.deepEqual(pageCheckoutBody(form([])), { ok: false, error: "items" });
});

test("the server-side total of the chosen items", () => {
  const items = [
    { name: "Cold brew", price: "5" },
    { name: "Croissant", price: "3.50" },
  ];
  const qty = pageQuantities(new URLSearchParams([["qty:Cold brew", "2"], ["qty:Croissant", "junk"]]), items);
  assert.deepEqual(qty, [{ name: "Cold brew", price: "5", qty: 2 }, { name: "Croissant", price: "3.50", qty: 0 }], "a bad quantity shows as 0");
  assert.equal(pageTotal(qty), "10.00");
  assert.equal(pageTotal(pageQuantities(new URLSearchParams([["qty:Cold brew", "100"], ["qty:Croissant", "3"]]), items)), "510.50");
});

test("a checkout that fails sends the customer back with a fixed message, never the gateway's text", () => {
  assert.equal(checkoutErrorCode(400, "amount"), "amount");
  assert.equal(checkoutErrorCode(400, "items"), "items");
  assert.equal(checkoutErrorCode(400, "fixed"), "closed", "a fixed link the customer can't change");
  assert.equal(checkoutErrorCode(410, "fixed"), "closed");
  assert.equal(checkoutErrorCode(404, "items"), "closed");
  assert.equal(checkoutErrorCode(429, "amount"), "busy");
  for (const status of [0, 500, 502, 503]) assert.equal(checkoutErrorCode(status, "amount"), "down");
  for (const message of Object.values(CHECKOUT_ERRORS)) assert.doesNotMatch(message, /\b(sign|signature|gas|chain|blockchain|wallet|wbt|nonce|usdt)\b/i);
});

// G4 UX review M1: the payment page's total updates as quantities change, and 0 keeps "Continue to pay" disabled.
test("liveTotal: price × quantity per row; blank, fractional, negative and over-100 quantities count as 0", () => {
  const prices = ["10.00", "5.50"];
  assert.equal(liveTotal(prices, ["0", "0"]), 0n, "nothing chosen: the button stays disabled");
  assert.equal(liveTotal(prices, ["1", "2"]), 21_000_000n);
  assert.equal(liveTotal(prices, ["", "1.5"]), 0n);
  assert.equal(liveTotal(prices, ["-1", "101"]), 0n);
  assert.equal(liveTotal(prices, ["100", "0"]), 1_000_000_000n, "100 of one item is the form's limit");
  assert.equal(liveTotal(["oops", "2.00"], ["3", "1"]), 2_000_000n, "an unreadable price adds nothing");
});

