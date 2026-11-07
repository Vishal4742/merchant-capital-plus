// Batch 047 (FR-INV-8, FR-ARK-4): the debtor acknowledges an invoice with an EIP-712 message (no transaction, no money),
// POST /api/v1/invoices/:id/acknowledge checks it against the invoice our server reads on chain and keeps each key's
// first ack (at most 5 unchecked ones). The offer book shows an ack only when the invoice names that wallet on chain
// (security review 047 H1, round 2), as "Acknowledged by the wallet the merchant named"; the merchant's invoice list
// also shows an unchecked wallet's ack.
// A real Postgres in-process (PGlite); the chain read is faked. Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zeroAddress } from "viem";
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
const { MAX_UNBOUND_ACKS, acksFor, ackView } = await import("../lib/server/invoice-acks.ts");
const { offerBook, offerTerms } = await import("../lib/server/capital-arkiv.ts");
const { query } = await import("../lib/server/db.ts");
const shared = await import("../../../packages/shared/contracts.ts");

const ID = "7";
const DUE = 1_900_000_000n;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 3)); // a later signed_at (unix ms) for "oldest first"
before(setupDb);
beforeEach(async () => {
  await resetDb();
  invoice = { merchant: shop.address, dueDate: DUE, status: "open", customer: zeroAddress, amount: 25_000_000n, paid: 0n };
  readFails = false;
});

const terms = (over = {}) => ({ merchantPay: MERCHANT_PAY, invoiceId: BigInt(ID), merchant: invoice.merchant, amount: invoice.amount, dueDate: invoice.dueDate, ...over });
async function signed({ signer = debtor, claimed = signer.address, over = {}, domain = ackDomain } = {}) {
  const typed = ackTypedData(terms(over), claimed);
  return { debtor: claimed, signature: await signer.signTypedData({ ...typed, domain }) };
}
const call = (body, id = ID, ip = "203.0.113.7") =>
  acknowledge(req("POST", `/api/v1/invoices/${id}/acknowledge`, { body, headers: { "x-forwarded-for": ip } }), params({ id }));
const rows = () => query("SELECT invoice_id, debtor, merchant, amount::text AS amount, due_date::text AS due_date, customer_bound, signature, signed_at::text AS signed_at FROM app_gw_invoice_acks ORDER BY signed_at");

test("the typed data: WhiteFlow v1 on chain 1874, CapitalMarket from packages/shared, MerchantPay and the invoice", () => {
  assert.deepEqual(ackDomain, { name: "WhiteFlow", version: "1", chainId: 1874, verifyingContract: ackDomain.verifyingContract });
  assert.equal(ackDomain.verifyingContract.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
  assert.deepEqual(ackTypes.InvoiceAck.map((f) => `${f.type} ${f.name}`), ["address merchantPay", "uint256 invoiceId", "address merchant", "uint256 amount", "uint64 dueDate", "address debtor"]);
  const t = ackTypedData(terms(), debtor.address);
  assert.equal(t.primaryType, "InvoiceAck");
  assert.deepEqual(t.message, { merchantPay: MERCHANT_PAY, invoiceId: 7n, merchant: shop.address, amount: 25_000_000n, dueDate: DUE, debtor: debtor.address });
});

test("a valid acknowledgement is stored with the invoice's terms; with no customer named it is not verified", async () => {
  const body = await signed();
  const res = await call(body);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual([data.acknowledged, data.debtor, data.verified], [true, debtor.address, false]);
  assert.ok(Math.abs(Date.parse(data.signed_at) - Date.now()) < 5_000);
  const [row, ...rest] = await rows();
  assert.equal(rest.length, 0);
  assert.deepEqual([row.invoice_id, row.debtor, row.merchant, row.amount, row.due_date, row.customer_bound, row.signature], [ID, debtor.address, shop.address, "25000000", String(DUE), false, body.signature]);
});

test("H1: an invoice that names its customer wallet takes that wallet's ack only, and marks it verified", async () => {
  invoice = { ...invoice, customer: debtor.address };
  const other = await call(await signed({ signer: someoneElse }));
  assert.equal(other.status, 403);
  assert.match((await other.json()).error, /names its customer's wallet/);
  assert.equal((await rows()).length, 0);
  const res = await call(await signed());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).verified, true);
  assert.equal((await rows())[0].customer_bound, true);
});

test("refused, nothing stored: wrong signer, tampered terms, another MerchantPay, wrong chain or contract", async () => {
  const cases = {
    "wrong signer": await signed({ signer: someoneElse, claimed: debtor.address }),
    "tampered amount": await signed({ over: { amount: 1_000_000n } }),
    "tampered merchant": await signed({ over: { merchant: someoneElse.address } }),
    "tampered due date": await signed({ over: { dueDate: 2_000_000_000n } }),
    "another invoice": await signed({ over: { invoiceId: 8n } }),
    "another MerchantPay": await signed({ over: { merchantPay: someoneElse.address } }),
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

test("M1: each key keeps its own first ack; the same key again is a no-op with its first time", async () => {
  const first = await (await call(await signed())).json();
  await tick();
  const other = await call(await signed({ signer: someoneElse }));
  assert.equal(other.status, 200, "a second pay-link holder adds its own ack: the first can't squat the invoice");
  const again = await call(await signed());
  assert.equal(again.status, 200);
  assert.equal((await again.json()).signed_at, first.signed_at, "the first ack's time, unchanged");
  const stored = await rows();
  assert.deepEqual(stored.map((r) => r.debtor), [debtor.address, someoneElse.address]);
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
const textTerms = () => ({ merchantPay: MERCHANT_PAY, invoiceId: ID, merchant: invoice.merchant, amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString() });

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

test("cap: an invoice keeps at most 5 unchecked acks; a 6th key gets 409, a key already in still gets its own", async () => {
  const keys = Array.from({ length: MAX_UNBOUND_ACKS }, () => privateKeyToAccount(generatePrivateKey()));
  for (const key of keys) assert.equal((await call(await signed({ signer: key }))).status, 200);
  const sixth = await call(await signed({ signer: debtor }));
  assert.equal(sixth.status, 409);
  assert.match((await sixth.json()).error, /already has 5 acknowledgements, the most we keep/);
  assert.equal((await call(await signed({ signer: keys[0] }))).status, 200, "a no-op for a key already in");
  assert.equal((await rows()).length, MAX_UNBOUND_ACKS);
});

test("acksFor reads a bounded number of rows (LIMIT: the cap per invoice, plus one for a race)", async () => {
  for (let i = 0; i < 9; i++) {
    await query("INSERT INTO app_gw_invoice_acks VALUES ($1, '7', $2, $3, 25000000, 1900000000, false, '0x', $4)", [MERCHANT_PAY.toLowerCase(), `0x${String(i).repeat(40)}`, shop.address, i]);
  }
  assert.equal((await acksFor(MERCHANT_PAY, [7n])).get("7").length, MAX_UNBOUND_ACKS + 1);
});

test("rate limited per IP: the 11th call in a minute is a 429, another IP still gets through", async () => {
  const body = await signed();
  for (let i = 0; i < 10; i++) assert.equal((await call(body)).status, 200, `call ${i + 1}`);
  assert.equal((await call(body)).status, 429);
  assert.equal((await call(body, ID, "198.51.100.9")).status, 200);
});

test("acksFor reads only this MerchantPay's invoices, oldest first; ackView matches the terms and counts (L1)", async () => {
  await call(await signed());
  await tick();
  await call(await signed({ signer: someoneElse }));
  const mine = await acksFor(MERCHANT_PAY, [7n, 8n]);
  assert.deepEqual([...mine.keys()], ["7"]);
  assert.deepEqual(mine.get("7").map((a) => a.debtor), [debtor.address, someoneElse.address]);
  assert.equal((await acksFor("0x3333333333333333333333333333333333333333", [7n])).size, 0);
  assert.equal((await acksFor(MERCHANT_PAY, [])).size, 0);
  const same = { merchant: shop.address, amount: 25_000_000n, dueDate: DUE };
  const view = ackView(mine.get("7"), same);
  assert.deepEqual({ ...view, signed_at: typeof view.signed_at }, { verified: false, debtor: short(debtor.address), signed_at: "string", count: 2 });
  assert.equal(ackView(mine.get("7"), { ...same, amount: 1n }), null, "another amount");
  assert.equal(ackView(mine.get("7"), { ...same, dueDate: 1n }), null, "another due date");
  assert.equal(ackView(mine.get("7"), { ...same, merchant: someoneElse.address }), null, "another merchant");
  assert.equal(ackView([], same), null);
});

// The offer book (GET /api/v1/capital/offers): chain offers faked like test/capital-arkiv.test.mjs.
const NOW = Math.floor(Date.now() / 1000);
const offer = (o = {}) => ({ claimId: 1n, kind: "invoice", merchant: shop.address, offerDeadline: NOW + 3600, bps: 0, cancelled: false, settled: false, invoiceId: 7n, face: 25_000_000n, price: 24_000_000n, maturity: Number(DUE), sold: 0n, ...o });
const tuple = (o) => [o.kind === "advance" ? 2 : 1, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];
function book(offers) {
  const read = async (r) => {
    if (r.functionName === "offerCount") return BigInt(Object.keys(offers).length);
    if (r.functionName === "offers") return tuple(offers[String(r.args[0])]);
    throw new Error(`unexpected ${r.functionName}`);
  };
  return offerBook({ read, arkiv: { rows: async () => [], create: async () => "0x", patch: async () => {} } });
}

test("offers: a pay-link holder's ack never reaches investors (round 2 M); a named customer's is true (H1)", async () => {
  await call(await signed());
  await tick();
  await call(await signed({ signer: someoneElse }));
  const [linkHolders, notYet, advance] = await book({ 1: offer(), 2: offer({ claimId: 2n, invoiceId: 8n }), 3: offer({ claimId: 3n, kind: "advance", invoiceId: 0n, bps: 2000 }) });
  assert.equal(linkHolders.debtor_acknowledged, false, "nobody's identity was checked");
  assert.equal(linkHolders.debtor_ack, null, "anyone can ack an invoice with no named customer: the book shows only a verified ack");
  assert.deepEqual([notYet.debtor_acknowledged, notYet.debtor_ack], [false, null]);
  assert.deepEqual([advance.debtor_acknowledged, advance.debtor_ack], [false, null], "an advance has no debtor");
  assert.doesNotMatch(JSON.stringify([linkHolders, notYet, advance]), new RegExp(`${debtor.address.slice(2)}|signature`, "i"), "the short address only, never the signature");

  await resetDb();
  invoice = { ...invoice, customer: debtor.address };
  await call(await signed());
  const [bound] = await book({ 1: offer() });
  assert.equal(bound.debtor_acknowledged, true);
  assert.deepEqual({ ...bound.debtor_ack, signed_at: typeof bound.debtor_ack.signed_at }, { verified: true, debtor: short(debtor.address), signed_at: "string", count: 1 });
});

test("offers L1: an ack joins only our shop's offer with the same face and maturity as the signed invoice", async () => {
  invoice = { ...invoice, customer: debtor.address }; // a verified ack, so only the terms can keep it out of the book
  await call(await signed());
  const [same, other, face, maturity] = await book({
    1: offer(),
    2: offer({ claimId: 2n, merchant: someoneElse.address }),
    3: offer({ claimId: 3n, face: 30_000_000n, price: 29_000_000n }),
    4: offer({ claimId: 4n, maturity: Number(DUE) + 60 }),
  });
  assert.equal(same.debtor_ack?.verified, true, "the control: same terms, shown");
  for (const [name, o] of Object.entries({ other, face, maturity })) assert.equal(o.debtor_ack, null, name);
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

test("FR-ARK-4: the Arkiv entity carries no debtor and no signature", () => {
  const keys = Object.keys(offerTerms(offer()));
  assert.ok(!keys.some((k) => /debtor|signature|acknowledg/i.test(k)), keys.join(","));
});

// UI states: a client component can't render in node:test, so the states are pinned in the source (the house pattern).
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("pay page: the action only while the invoice can be paid; plain copy; guest, browser wallet and Privy", () => {
  const sheet = source("components/InvoicePay.tsx");
  assert.match(sheet, /\{payable && terms && <InvoiceAck terms=\{ackTerms\} acks=\{acks\} customer=\{ackCustomer\} guest=\{guest\.address\} \/>\}/);
  const ack = source("components/InvoiceAck.tsx");
  assert.match(ack, /You confirm you owe this invoice\. This doesn&apos;t pay it and moves no money\./);
  assert.match(ack, />\s*\{busy === "guest" \? "Acknowledging…" : "Acknowledge this invoice"\}/, "the default way: this browser's key");
  assert.match(ack, /data-pay-option="wallet"/, "only the wallet block says wallet (FR-PAY-7)");
  assert.match(ack, /connectVia\(via\)/, "the same connect as paying (browser wallet or Privy)");
  assert.match(ack, /\{privy && \(/, "Privy only with its app ID");
  assert.match(ack, /finally \{\s*endWalletSession\(\);/, "the wallet session ends after every attempt");
  assert.match(ack, /\/api\/v1\/invoices\/\$\{terms\.invoiceId\}\/acknowledge/);
  assert.doesNotMatch(ack, /eth_sendTransaction|sendTransaction|writeContract/, "a message, never a transaction");
  const page = source("app/pay/[invoiceId]/page.tsx");
  assert.match(page, /acksFor\(pay\.merchantPay, \[BigInt\(invoiceId\)\]\)/, "the server reads the acks");
});

test("pay page M1: this key's own ack vs another key's, the count, and the named customer wallet", () => {
  const ack = source("components/InvoiceAck.tsx");
  assert.match(ack, /const same = \(a: string, b: string\) => a\.toLowerCase\(\) === b\.toLowerCase\(\);/);
  assert.match(ack, /guest && acks\.find\(\(a\) => same\(a\.debtor, short\(guest\)\)\)/, "the stored short debtor against this browser's key");
  assert.match(ack, /You acknowledged this invoice/);
  assert.match(ack, /Acknowledged by another key \(\{others\[0\]\.debtor\}\)/);
  assert.match(ack, /\$\{ackCount\(count\)\} acknowledgements/, "the count, shown up to 5+");
  assert.match(ack, /Only the customer wallet this invoice names \(\{customer\}\) can acknowledge it\./);
});

test("investor and merchant views: the named wallet's ack is stated plainly, no ✓; any other is an unchecked wallet's", () => {
  const view = source("components/DebtorAck.tsx");
  assert.match(view, /if \(ack\.verified\) \{\s*return \(\s*<span className="block text-xs text-ink">\s*Acknowledged by the wallet the merchant named · <span className="data">\{ack\.debtor\}<\/span>/);
  assert.doesNotMatch(view, /✓|text-positive/, "round 2 M: the merchant can name its own second wallet, so no tick and no success colour");
  assert.doesNotMatch(view, /Debtor acknowledged/, "re-review copy: the shop chooses the wallet, so not 'Debtor'");
  assert.match(view, /Acknowledged by an unchecked wallet · <span className="data">\{ack\.debtor\}<\/span>/);
  assert.match(view, /\$\{ackCount\(ack\.count\)\} acknowledgements/);
  assert.match(view, /Not acknowledged yet/);
  const offerBookUi = source("components/capital/investor/OfferBook.tsx");
  assert.match(offerBookUi, /\{o\.kind === "invoice" && <DebtorAck ack=\{o\.debtor_ack\} \/>\}/);
  assert.match(offerBookUi, /the shop chooses this wallet; it is not an identity check\./, "one line explains the label");
  assert.doesNotMatch(offerBookUi, /✓/);
  assert.match(source("components/capital/merchant/MyOffers.tsx"), /\{!advance && <DebtorAck ack=\{o\.debtor_ack\} \/>\}/);
  assert.match(source("components/merchant/Invoices.tsx"), /\{invoice\.status === "open" && <DebtorAck ack=\{invoice\.ack\} \/>\}/);
});

test("the merchant's invoice form: an optional customer wallet, checked, sent to createInvoice", () => {
  const form = source("components/merchant/Invoices.tsx");
  assert.match(form, /Customer wallet \(optional\)/);
  assert.match(form, /createInvoice\(w, amount, BigInt\(Math\.floor\(dueMs \/ 1000\)\), customer\)/);
  assert.match(form, /!isAddress\(wallet\)/, "a typo is caught before the wallet opens");
  assert.match(form, /wallet !== getAddress\(wallet\)\) return setError\("Paste the checksummed address/, "all lowercase has no checksum: a typo would bind the wrong wallet");
  assert.doesNotMatch(form, /Debtor acknowledged/);
});

test("the count shows up to 5+, the same cap the route keeps (re-review LOW)", () => {
  const view = source("components/DebtorAck.tsx");
  const cap = Number(/export const ACK_CAP = (\d+);/.exec(view)?.[1]);
  assert.equal(cap, MAX_UNBOUND_ACKS);
  assert.match(view, /export const ackCount = \(n: number\) => \(n >= ACK_CAP \? `\$\{ACK_CAP\}\+` : String\(n\)\);/);
});
