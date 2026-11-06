// Batch 032 (FR-PAY-16, FR-PRIV-1): GET /api/v1/sessions/:id/funds and /api/v1/invoices/:id/funds?payer=0x…, our
// server's answer to "does this payer hold enough USDT for this?", asked before the hold (the guest) and before a
// wallet's approval prompt. The answer is one boolean: never the balance, never an address. Real SQL on PGlite; the
// chain is faked. Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, req, params, MERCHANT, OTHER_MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef"; // merchantConfig(): /pay serves only the shop's invoices
const MERCHANT_PAY = "0x3333333333333333333333333333333333333333";
const PAYER = "0x5555555555555555555555555555555555555555";
const FEE = 100_000n;

let balance;
let balanceFails;
const balanceReads = [];
let invoice;
let invoiceFails;
mock.module("../lib/onchain.ts", {
  namedExports: {
    readUsdtBalance: async (owner) => {
      balanceReads.push(owner);
      if (balanceFails) throw new Error("rpc down");
      return balance;
    },
    readInvoice: async (merchantPay, id) => {
      if (invoiceFails) throw new Error("rpc down");
      return { id, ...invoice };
    },
    readRelayFee: async () => FEE,
    saleSettled: async () => null,
    invoicePaid: async () => false,
    readPayment: async () => ({ merchant: MERCHANT, gross: 1n, payer: MERCHANT, refunded: 0n }),
  },
});

const sessionFunds = await import("../app/api/v1/sessions/[id]/funds/route.ts");
const invoiceFunds = await import("../app/api/v1/invoices/[id]/funds/route.ts");
const voucherRoute = await import("../app/api/v1/sessions/[id]/voucher/route.ts");
const { createSession } = await import("../lib/sessions.ts");
const { recordCheckout } = await import("../lib/server/checkouts.ts");
const { query } = await import("../lib/server/db.ts");

const IP = { "x-forwarded-for": "203.0.113.9" };
before(setupDb);
beforeEach(async () => {
  await resetDb();
  balance = 0n;
  balanceFails = false;
  balanceReads.length = 0;
  invoice = { merchant: MERCHANT, dueDate: 1_900_000_000n, status: "open", amount: 25_000_000n, paid: 0n };
  invoiceFails = false;
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://relayer.test";
});

async function ask(route, id, payer = PAYER, headers = IP) {
  const query = payer === null ? "" : `?payer=${encodeURIComponent(payer)}`;
  const res = await route.GET(req("GET", `/funds${query}`, { headers }), params({ id }));
  return { status: res.status, data: await res.json(), cache: res.headers.get("cache-control") };
}
const shopCheckout = async (amount = 5_000_000n) => (await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount, reference: "", items: [] })).id;

test("a checkout: enough at exactly the amount, short below it, and the answer is one boolean (no balance, no address)", async () => {
  const id = await shopCheckout();
  balance = 5_000_000n;
  const enough = await ask(sessionFunds, id);
  assert.equal(enough.status, 200);
  assert.deepEqual(enough.data, { enough: true });
  assert.match(enough.cache, /no-store/);
  balance = 4_999_999n;
  const short = await ask(sessionFunds, id);
  assert.deepEqual(short.data, { enough: false });
  assert.deepEqual(Object.keys(short.data), ["enough"]);
  assert.ok(!JSON.stringify(short.data).includes(PAYER.slice(2)));
  assert.deepEqual(balanceReads, [PAYER, PAYER]); // the asked payer's balance, read on our server (FR-PRIV-1)
});

test("a link checkout with a code held: enough means enough for the amount due now", async () => {
  const session = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount: 100_000_000n, reference: "", items: [] });
  await recordCheckout(session.id, "link", "lnk_test", MERCHANT, 100_000_000n);
  await query("INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
    "vch_half",
    MERCHANT.toLowerCase(),
    "HALF",
    "percent",
    "50",
    Date.now() + 86_400_000,
    5,
    Date.now(),
  ]);
  balance = 60_000_000n;
  assert.deepEqual((await ask(sessionFunds, session.id)).data, { enough: false });
  const applied = await voucherRoute.POST(req("POST", `/api/v1/sessions/${session.id}/voucher`, { body: { code: "HALF" }, headers: IP }), params({ id: session.id }));
  assert.equal(applied.status, 200);
  assert.deepEqual((await ask(sessionFunds, session.id)).data, { enough: true });
});

test("a checkout: a bad payer is 400, an unknown checkout 404, a chain that can't be read 503 (never a guess)", async () => {
  const id = await shopCheckout();
  assert.equal((await ask(sessionFunds, id, "0x123")).status, 400);
  assert.equal((await ask(sessionFunds, id, null)).status, 400);
  assert.equal((await ask(sessionFunds, "00000000-0000-4000-8000-000000000000")).status, 404);
  balanceFails = true;
  const down = await ask(sessionFunds, id);
  assert.equal(down.status, 503);
  assert.equal(down.data.enough, undefined);
});

test("checks are rate limited per IP", async () => {
  const id = await shopCheckout();
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await ask(sessionFunds, id)).status);
  assert.equal(statuses.at(-1), 429);
  assert.equal(statuses.filter((s) => s === 200).length, 30);
  assert.equal((await ask(sessionFunds, id, PAYER, { "x-forwarded-for": "198.51.100.4" })).status, 200);
});

test("an invoice: enough means what is still owed plus the fee on top", async () => {
  invoice = { ...invoice, paid: 5_000_000n }; // 20.00 still owed
  balance = 20_000_000n; // owed, but not the fee
  assert.deepEqual((await ask(invoiceFunds, "7")).data, { enough: false });
  balance = 20_100_000n;
  const enough = await ask(invoiceFunds, "7");
  assert.equal(enough.status, 200);
  assert.deepEqual(enough.data, { enough: true });
  assert.match(enough.cache, /no-store/);
});

test("an invoice: another shop's, a bad id, a bad payer are refused; a chain that can't be read is 503", async () => {
  balance = 1_000_000_000n;
  invoice = { ...invoice, merchant: OTHER_MERCHANT };
  assert.equal((await ask(invoiceFunds, "7")).status, 404);
  invoice = { ...invoice, merchant: MERCHANT };
  assert.equal((await ask(invoiceFunds, "0")).status, 404);
  assert.equal((await ask(invoiceFunds, "abc")).status, 404);
  assert.equal((await ask(invoiceFunds, "7", "nope")).status, 400);
  invoiceFails = true;
  assert.equal((await ask(invoiceFunds, "7")).status, 503);
  invoiceFails = false;
  balanceFails = true;
  assert.equal((await ask(invoiceFunds, "7")).status, 503);
});
