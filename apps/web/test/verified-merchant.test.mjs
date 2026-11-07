// claude-frontend batch 056: the shop's name with a verified tick at the top of every pay sheet (FR-PAY-7), shown only
// for a shop we actually checked (SRS v3.0 FR-BIZ-5): today the operator-configured shop. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SHOP = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const { merchantVerified } = await import("../lib/server/http.ts");

const withShop = (fn) => {
  const saved = { a: process.env.MERCHANT_ADDRESS, k: process.env.SHOP_API_KEY };
  process.env.MERCHANT_ADDRESS = SHOP;
  process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
  try { fn(); } finally {
    for (const [name, value] of [["MERCHANT_ADDRESS", saved.a], ["SHOP_API_KEY", saved.k]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
};

test("merchantVerified: the configured shop in any letter case, nobody else", () => {
  withShop(() => {
    assert.equal(merchantVerified(SHOP), true);
    assert.equal(merchantVerified(SHOP.toLowerCase()), true);
    assert.equal(merchantVerified("0x000000000000000000000000000000000000dEaD"), false);
  });
});

test("merchantVerified: with no shop configured, nobody is verified", () => {
  const saved = process.env.MERCHANT_ADDRESS;
  delete process.env.MERCHANT_ADDRESS;
  try { assert.equal(merchantVerified(SHOP), false); } finally { if (saved !== undefined) process.env.MERCHANT_ADDRESS = saved; }
});

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the tick is drawn only when verified, and has a plain accessible name", () => {
  const badge = src("components/MerchantName.tsx");
  assert.match(badge, /verified && /);
  assert.match(badge, /aria-label="Verified merchant"/);
});

test("every pay sheet puts the name and the tick at the top", () => {
  const hosted = src("components/gateway/Hosted.tsx");
  assert.match(hosted, /<MerchantName name=\{link\.merchant_name\} verified=\{link\.merchant_verified\}/);
  assert.match(hosted, /<MerchantName name=\{page\.merchant_name\} verified=\{page\.merchant_verified/);
  assert.match(src("components/Checkout.tsx"), /<h1 className="title">\s*<MerchantName name=\{merchantName\} verified=\{verified\}/);
  assert.match(src("components/InvoicePay.tsx"), /<MerchantName name=\{merchantName\} verified=\{verified\}/);
  assert.match(src("app/checkout/[sessionId]/page.tsx"), /verified=\{merchantVerified\(session\.merchant\)\}/);
  assert.match(src("app/pay/[invoiceId]/page.tsx"), /verified=\{merchantVerified\(shop\.merchant\)\}/);
});
