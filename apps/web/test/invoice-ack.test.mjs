// Batch 047 (FR-INV-8, FR-ARK-4): the debtor acknowledges an invoice with an EIP-712 message (no transaction, no money),
// POST /api/v1/invoices/:id/acknowledge checks it against the invoice our server reads on chain and keeps the first
// valid one, and the offer book shows it. A real Postgres in-process (PGlite); the chain read is faked.
// Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { setupDb, resetDb, req, params } from "./gw-helpers.mjs";

const shop = privateKeyToAccount(generatePrivateKey()); // the merchant's own key: it can't vouch for itself
const debtor = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";
process.env.MERCHANT_ADDRESS = shop.address;
process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef";
process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
process.env.RELAYER_URL = "http://relayer.test";

let invoice;
let readFails;
mock.module("../lib/onchain.ts", {
  namedExports: {
    readInvoice: async (merchantPay, id) => {
      if (readFails) throw new Error("rpc down");
      return { id, ...invoice };
    },
    saleSettled: async () => null, // lib/settle.ts imports it
  },
});

const { POST: acknowledge } = await import("../app/api/v1/invoices/[id]/acknowledge/route.ts");
const { ackDomain, ackTypedData, ackTypes } = await import("../lib/invoice-ack.ts");
const { acksFor } = await import("../lib/server/invoice-acks.ts");
const { offerBook, offerTerms } = await import("../lib/server/capital-arkiv.ts");
const { query } = await import("../lib/server/db.ts");
const shared = await import("../../../packages/shared/contracts.ts");

const ID = "7";
before(setupDb);
beforeEach(async () => {
  await resetDb();
  invoice = { merchant: shop.address, dueDate: 1_900_000_000n, status: "open", amount: 25_000_000n, paid: 0n };
  readFails = false;
});

const terms = (over = {}) => ({ invoiceId: BigInt(ID), merchant: invoice.merchant, amount: invoice.amount, dueDate: invoice.dueDate, ...over });
async function signed({ signer = debtor, claimed = signer.address, over = {}, domain = ackDomain } = {}) {
  const typed = ackTypedData(terms(over), claimed);
  return { debtor: claimed, signature: await signer.signTypedData({ ...typed, domain }) };
}
const call = (body, id = ID, ip = "203.0.113.7") =>
  acknowledge(req("POST", `/api/v1/invoices/${id}/acknowledge`, { body, headers: { "x-forwarded-for": ip } }), params({ id }));
const rows = () => query("SELECT invoice_id, debtor, signature, signed_at::text AS signed_at FROM app_gw_invoice_acks");

test("the typed data: Merchant Capital+ v1 on chain 1874, CapitalMarket from packages/shared, the invoice's terms", () => {
  assert.deepEqual(ackDomain, { name: "Merchant Capital+", version: "1", chainId: 1874, verifyingContract: ackDomain.verifyingContract });
  assert.equal(ackDomain.verifyingContract.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
  assert.deepEqual(ackTypes.InvoiceAck.map((f) => `${f.type} ${f.name}`), ["uint256 invoiceId", "address merchant", "uint256 amount", "uint64 dueDate", "address debtor"]);
  const t = ackTypedData(terms(), debtor.address);
  assert.equal(t.primaryType, "InvoiceAck");
  assert.deepEqual(t.message, { invoiceId: 7n, merchant: shop.address, amount: 25_000_000n, dueDate: 1_900_000_000n, debtor: debtor.address });
});

test("a valid acknowledgement is stored once and answered with the debtor and the time", async () => {
  const body = await signed();
  const res = await call(body);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.acknowledged, true);
  assert.equal(data.debtor, debtor.address);
  assert.ok(Math.abs(Date.parse(data.signed_at) - Date.now()) < 5_000);
  const stored = await rows();
  assert.equal(stored.length, 1);
  assert.deepEqual([stored[0].invoice_id, stored[0].debtor, stored[0].signature], [ID, debtor.address, body.signature]);
});

test("refused, nothing stored: wrong signer, tampered amount, merchant or due date, wrong chain or contract", async () => {
  const cases = {
    "wrong signer": await signed({ signer: someoneElse, claimed: debtor.address }),
    "tampered amount": await signed({ over: { amount: 1_000_000n } }),
    "tampered merchant": await signed({ over: { merchant: someoneElse.address } }),
    "tampered due date": await signed({ over: { dueDate: 2_000_000_000n } }),
    "another invoice": await signed({ over: { invoiceId: 8n } }),
    "wrong chain": await signed({ domain: { ...ackDomain, chainId: 1 } }),
    "wrong contract": await signed({ domain: { ...ackDomain, verifyingContract: MERCHANT_PAY } }),
  };
  for (const [name, body] of Object.entries(cases)) {
    const res = await call(body);
    assert.equal(res.status, 400, name);
    assert.match((await res.json()).error, /doesn't match the invoice/, name);
  }
  // the server rebuilds the message from the chain: an amount the browser sends is never read
  assert.equal((await call({ ...(await signed({ over: { amount: 1n } })), amount: "1" })).status, 400);
  assert.equal((await rows()).length, 0);
});

test("malformed bodies are 400s: no debtor, not an address, a short signature, not JSON", async () => {
  const good = await signed();
  for (const body of [{ signature: good.signature }, { ...good, debtor: "0x123" }, { ...good, signature: "0x1234" }, "not json"]) {
    assert.equal((await call(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await rows()).length, 0);
});

test("idempotent: the same debtor again is a no-op with the first time; another debtor gets 409", async () => {
  const first = await (await call(await signed())).json();
  const again = await call(await signed());
  assert.equal(again.status, 200);
  assert.equal((await again.json()).signed_at, first.signed_at, "the first ack's time, unchanged");
  const other = await call(await signed({ signer: someoneElse }));
  assert.equal(other.status, 409);
  assert.match((await other.json()).error, /already acknowledged/);
  const stored = await rows();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].debtor, debtor.address, "the first valid ack wins");
});

test("only our shop's open invoices, and never by the shop itself", async () => {
  assert.equal((await call(await signed({ signer: shop }))).status, 400, "the merchant can't acknowledge its own invoice");
  invoice = { ...invoice, status: "paid", paid: invoice.amount };
  assert.equal((await call(await signed())).status, 409, "paid");
  invoice = { ...invoice, status: "cancelled", paid: 0n };
  assert.equal((await call(await signed())).status, 410, "cancelled");
  invoice = { ...invoice, status: "missing" };
  assert.equal((await call(await signed())).status, 404, "missing");
  invoice = { ...invoice, status: "open", merchant: someoneElse.address };
  assert.equal((await call(await signed())).status, 404, "another shop's invoice");
  assert.equal((await call(await signed(), "abc")).status, 404, "not an id");
  invoice = { ...invoice, merchant: shop.address };
  readFails = true;
  assert.equal((await call(await signed())).status, 503, "the chain can't be read: nothing stored");
  assert.equal((await rows()).length, 0);
});

// The browser side (lib/sign-sale.ts signAck) against the route: this browser's guest key, and a wallet's provider.
const textTerms = () => ({ invoiceId: ID, merchant: invoice.merchant, amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString() });

test("the guest key's acknowledgement (the default way in) is accepted by the route", async () => {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  const { signAck, guestAddress } = await import("../lib/sign-sale.ts");
  const body = await signAck(textTerms());
  assert.equal(body.debtor, guestAddress());
  assert.equal((await call(body)).status, 200);
});

test("a wallet acknowledges with one eth_signTypedData_v4 and no transaction method", async () => {
  const { connectPayer } = await import("../lib/payer-wallet.ts");
  const { signAck } = await import("../lib/sign-sale.ts");
  const calls = [];
  const provider = {
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [debtor.address.toLowerCase()];
      if (method === "eth_chainId") return "0x752"; // 1874
      if (method !== "eth_signTypedData_v4") throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      const { domain, types: { EIP712Domain, ...types }, primaryType, message: m } = JSON.parse(params[1]);
      assert.ok(EIP712Domain);
      return debtor.signTypedData({ domain, types, primaryType, message: { ...m, invoiceId: BigInt(m.invoiceId), amount: BigInt(m.amount), dueDate: BigInt(m.dueDate) } });
    },
    on() {},
    removeListener() {},
  };
  const body = await signAck(textTerms(), await connectPayer(provider));
  assert.equal(body.debtor.toLowerCase(), debtor.address.toLowerCase());
  assert.equal((await call(body)).status, 200);
  assert.equal(calls.filter((m) => m === "eth_signTypedData_v4").length, 1);
  assert.ok(!calls.some((m) => /sendTransaction|signTransaction|sendCalls/.test(m)), calls.join(","));
});

test("a part-paid invoice can still be acknowledged: the debtor signs the whole invoice amount", async () => {
  invoice = { ...invoice, paid: 5_000_000n };
  assert.equal((await call(await signed())).status, 200);
});

test("rate limited per IP: the 11th call in a minute is a 429, another IP still gets through", async () => {
  const body = await signed();
  for (let i = 0; i < 10; i++) assert.equal((await call(body)).status, 200, `call ${i + 1}`);
  assert.equal((await call(body)).status, 429);
  assert.equal((await call(body, ID, "198.51.100.9")).status, 200);
});

test("acksFor reads only this MerchantPay's invoices (ids restart on a redeploy)", async () => {
  await call(await signed());
  const mine = await acksFor(MERCHANT_PAY, [7n, 8n]);
  assert.deepEqual([...mine.keys()], ["7"]);
  assert.equal(mine.get("7").debtor, debtor.address);
  assert.equal((await acksFor("0x3333333333333333333333333333333333333333", [7n])).size, 0);
  assert.equal((await acksFor(MERCHANT_PAY, [])).size, 0);
});

// The offer book (GET /api/v1/capital/offers): chain offers faked like test/capital-arkiv.test.mjs.
const NOW = Math.floor(Date.now() / 1000);
const offer = (o = {}) => ({ claimId: 1n, kind: "invoice", merchant: shop.address, offerDeadline: NOW + 3600, bps: 0, cancelled: false, settled: false, invoiceId: 7n, face: 25_000_000n, price: 24_000_000n, maturity: NOW + 30 * 86400, sold: 0n, ...o });
const tuple = (o) => [o.kind === "advance" ? 2 : 1, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];
function book(offers) {
  const read = async (r) => {
    if (r.functionName === "offerCount") return BigInt(Object.keys(offers).length);
    if (r.functionName === "offers") return tuple(offers[String(r.args[0])]);
    throw new Error(`unexpected ${r.functionName}`);
  };
  return offerBook({ read, arkiv: { rows: async () => [], create: async () => "0x", patch: async () => {} } });
}

test("offers: debtor_acknowledged and the short debtor for an acknowledged invoice; false/null otherwise (FR-INV-8)", async () => {
  await call(await signed());
  const offers = await book({ 1: offer(), 2: offer({ claimId: 2n, invoiceId: 8n }), 3: offer({ claimId: 3n, kind: "advance", invoiceId: 0n, bps: 2000 }) });
  const [acked, notYet, advance] = offers;
  assert.equal(acked.debtor_acknowledged, true);
  assert.equal(acked.debtor_ack.debtor, `${debtor.address.slice(0, 6)}…${debtor.address.slice(-4)}`, "the short address only");
  assert.ok(Date.parse(acked.debtor_ack.signed_at) > 0);
  assert.deepEqual(Object.keys(acked.debtor_ack).sort(), ["debtor", "signed_at"], "never the signature");
  assert.equal(notYet.debtor_acknowledged, false);
  assert.equal(notYet.debtor_ack, null);
  assert.equal(advance.debtor_acknowledged, false, "an advance has no debtor");
  assert.doesNotMatch(JSON.stringify(offers), new RegExp(debtor.address.slice(2), "i"), "no full debtor address in the public book");
});

test("offers: an unreadable ack store still shows the book, as not acknowledged, and logs it", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...a) => logged.push(a.join(" ")));
  await query("ALTER TABLE app_gw_invoice_acks RENAME TO app_gw_invoice_acks_gone");
  try {
    const [o] = await book({ 1: offer() });
    assert.equal(o.debtor_acknowledged, false);
    assert.equal(logged.length, 1);
  } finally {
    await query("ALTER TABLE app_gw_invoice_acks_gone RENAME TO app_gw_invoice_acks");
  }
});

test("FR-ARK-4: the Arkiv entity carries no debtor and no signature", async () => {
  await call(await signed());
  const keys = Object.keys(offerTerms(offer()));
  assert.ok(!keys.some((k) => /debtor|signature|acknowledg/i.test(k)), keys.join(","));
});

// UI states: a client component can't render in node:test, so the states are pinned in the source (the house pattern).
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("pay page: the action shows only for an open invoice with no ack; plain copy; guest, browser wallet and Privy", () => {
  const sheet = source("components/InvoicePay.tsx");
  assert.match(sheet, /\{payable && terms && <InvoiceAck terms=\{ackTerms\} ack=\{ack\} \/>\}/, "only while the invoice can be paid");
  const ack = source("components/InvoiceAck.tsx");
  assert.match(ack, /You confirm you owe this invoice\. This doesn&apos;t pay it and moves no money\./);
  assert.match(ack, /if \(acked\) \{\s*return \(\s*<p role="status"[^>]*>\s*Acknowledged ✓/, "acknowledged: no button, the time instead");
  assert.match(ack, />\s*\{busy === "guest" \? "Acknowledging…" : "Acknowledge this invoice"\}/, "the default way: this browser's key");
  assert.match(ack, /data-pay-option="wallet"/, "only the wallet block says wallet (FR-PAY-7)");
  assert.match(ack, /connectVia\(via\)/, "the same connect as paying (browser wallet or Privy)");
  assert.match(ack, /\{privy && \(/, "Privy only with its app ID");
  assert.match(ack, /finally \{\s*endWalletSession\(\);/, "the wallet session ends after every attempt");
  assert.match(ack, /\/api\/v1\/invoices\/\$\{terms\.invoiceId\}\/acknowledge/);
  assert.doesNotMatch(ack, /eth_sendTransaction|sendTransaction|writeContract/, "a message, never a transaction");
  const page = source("app/pay/[invoiceId]/page.tsx");
  assert.match(page, /acksFor\(pay\.merchantPay, \[BigInt\(invoiceId\)\]\)/, "the server reads the ack");
});

test("investor and merchant views: Debtor acknowledged ✓ or Not acknowledged yet", () => {
  const view = source("components/DebtorAck.tsx");
  assert.match(view, /Debtor acknowledged ✓/);
  assert.match(view, /Not acknowledged yet/);
  assert.match(source("components/capital/investor/OfferBook.tsx"), /\{o\.kind === "invoice" && <DebtorAck ack=\{o\.debtor_ack\} \/>\}/);
  assert.match(source("components/capital/merchant/MyOffers.tsx"), /\{!advance && <DebtorAck ack=\{o\.debtor_ack\} \/>\}/);
  assert.match(source("components/merchant/Invoices.tsx"), /\{invoice\.status === "open" && <DebtorAck ack=\{invoice\.ack\} \/>\}/);
});
