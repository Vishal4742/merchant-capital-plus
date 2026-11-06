// claude-frontend checks for the invoice reads (ARCHITECTURE §2, Phase 3 MerchantPay): invoices(id), relayFee(), the
// invoice consumer rule, and the merchant's history from Blockscout's log index (untrusted: ids only, amounts and status
// come from the chain).
// Run from apps/web: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi, toHex } from "viem";

const { readInvoice, readRelayFee, readUsdtBalance, invoicePaid, merchantInvoices, paidLogs, readPayment } = await import("../lib/onchain.ts");

const MERCHANT_PAY = "0xab817593253a0a37de723072827d88fe0ca54251";
const MERCHANT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x4444444444444444444444444444444444444444";
const PAYER = "0x3333333333333333333333333333333333333333";

// a fake chain: invoices(id) and payments(id) from two tables, relayFee() a number; records every call
function chain({ invoices = {}, payments = {}, relayFee = 100_000n } = {}) {
  const calls = [];
  const read = async (req) => {
    calls.push(req);
    const [id] = req.args;
    if (req.functionName === "invoices") return invoices[id] ?? ["0x0000000000000000000000000000000000000000", 0n, 0, "0x0000000000000000000000000000000000000000", 0n, 0n];
    if (req.functionName === "payments") return payments[id] ?? ["0x0000000000000000000000000000000000000000", 0n, "0x0000000000000000000000000000000000000000", 0n];
    if (req.functionName === "relayFee") return relayFee;
    if (req.functionName === "balanceOf") return 7_000_000n;
    throw new Error(`unexpected ${req.functionName}`);
  };
  return { read, calls };
}
const openInvoice = (merchant = MERCHANT, amount = 25_000_000n, status = 1, paid = status === 2 ? amount : 0n) => [merchant, 1_900_000_000n, status, "0x0000000000000000000000000000000000000000", amount, paid];

test("invoices(id) is read with its status in words (None/Open/Paid/Cancelled)", async () => {
  const { read, calls } = chain({ invoices: { 7n: openInvoice(), 8n: openInvoice(MERCHANT, 5_000_000n, 2), 9n: openInvoice(MERCHANT, 1_000_000n, 3) } });
  assert.deepEqual(await readInvoice(MERCHANT_PAY, 7n, { read }), { id: 7n, merchant: MERCHANT, dueDate: 1_900_000_000n, status: "open", customer: "0x0000000000000000000000000000000000000000", amount: 25_000_000n, paid: 0n });
  assert.equal((await readInvoice(MERCHANT_PAY, 8n, { read })).status, "paid");
  assert.equal((await readInvoice(MERCHANT_PAY, 9n, { read })).status, "cancelled");
  assert.equal((await readInvoice(MERCHANT_PAY, 99n, { read })).status, "missing");
  assert.ok(calls.every((c) => c.address === MERCHANT_PAY && c.functionName === "invoices"));
});

test("a lagging backend is retried for invoices too, at the same block", async () => {
  const { read } = chain({ invoices: { 7n: openInvoice() } });
  let failures = 2;
  const blocks = [];
  const flaky = async (req) => {
    blocks.push(req.blockNumber);
    if (failures-- > 0) throw new Error("header not found");
    return read(req);
  };
  assert.equal((await readInvoice(MERCHANT_PAY, 7n, { read: flaky, blockNumber: 12n, gapMs: 0 })).status, "open");
  assert.deepEqual(blocks, [12n, 12n, 12n]);
});

test("the invoice consumer rule: this payer's payment of exactly amount + fee, to the invoice's merchant, and paid rose by amount", async () => {
  const rule = { merchantPay: MERCHANT_PAY, invoiceId: 7n, paymentId: 41n, amount: 25_000_000n, fee: 100_000n, payer: PAYER, paidBefore: 0n };
  const paid = { invoices: { 7n: openInvoice(MERCHANT, 25_000_000n, 2) }, payments: { 41n: [MERCHANT, 25_100_000n, PAYER, 0n] } };
  const { read, calls } = chain(paid);
  assert.equal(await invoicePaid(rule, { read, blockNumber: 5n }), true);
  assert.ok(calls.every((c) => c.blockNumber === 5n), "read at the relay's block");
  // a partial payment: 20.00 of the 25.00 still owed lands, the invoice stays open, and that is a confirmed payment
  const partial = { ...rule, amount: 20_000_000n, paidBefore: 0n };
  assert.equal(await invoicePaid(partial, chain({ invoices: { 7n: openInvoice(MERCHANT, 25_000_000n, 1, 20_000_000n) }, payments: { 41n: [MERCHANT, 20_100_000n, PAYER, 0n] } })), true);
  assert.equal(await invoicePaid(rule, chain({ ...paid, payments: { 41n: [MERCHANT, 25_000_000n, PAYER, 0n] } })), false, "gross without the fee");
  assert.equal(await invoicePaid(rule, chain({ ...paid, payments: { 41n: [MERCHANT, 24_900_000n, PAYER, 0n] } })), false, "another amount");
  assert.equal(await invoicePaid(rule, chain({ ...paid, payments: { 41n: [MERCHANT, 25_100_000n, OTHER, 0n] } })), false, "someone else's payment");
  assert.equal(await invoicePaid(rule, chain({ ...paid, payments: { 41n: [OTHER, 25_100_000n, PAYER, 0n] } })), false, "another merchant's payment");
  assert.equal(await invoicePaid(rule, chain({ ...paid, invoices: { 7n: openInvoice() } })), false, "paid didn't rise: the payment went elsewhere");
  assert.equal(await invoicePaid({ ...rule, paidBefore: 5_000_000n }, chain(paid)), false, "paid rose by less than amount");
  assert.equal(await invoicePaid({ ...rule, amount: 20_000_000n }, chain({ ...paid, payments: { 41n: [MERCHANT, 20_100_000n, PAYER, 0n] } })), false, "paid rose by more than amount (O5)");
  assert.equal(await invoicePaid(rule, chain({ ...paid, payments: {} })), false, "no such payment");
});

test("relayFee() is read on the server, retried like every read", async () => {
  const { read, calls } = chain({ relayFee: 150_000n });
  assert.equal(await readRelayFee(MERCHANT_PAY, { read }), 150_000n);
  assert.deepEqual([calls[0].address, calls[0].functionName], [MERCHANT_PAY, "relayFee"]);
  let failures = 1;
  const flaky = async (req) => {
    if (failures-- > 0) throw new Error("header not found");
    return read(req);
  };
  assert.equal(await readRelayFee(MERCHANT_PAY, { read: flaky, gapMs: 0 }), 150_000n);
});

test("the guest's balance is USDT.balanceOf(owner), read on the server", async () => {
  const { read, calls } = chain();
  assert.equal(await readUsdtBalance(PAYER, { read }), 7_000_000n);
  assert.deepEqual([calls[0].address, calls[0].functionName, calls[0].args], ["0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", "balanceOf", [PAYER]]);
});

test("the balance read is retried like every other read, so one RPC hiccup doesn't switch the guard off (security 005 F-N3)", async () => {
  const { read } = chain();
  let failures = 1;
  const flaky = async (req) => {
    if (failures-- > 0) throw new Error("header not found");
    return read(req);
  };
  assert.equal(await readUsdtBalance(PAYER, { read: flaky, gapMs: 0, tries: 2 }), 7_000_000n);
  await assert.rejects(readUsdtBalance(PAYER, { read: async () => { throw new Error("down"); }, gapMs: 0, tries: 2 }), /down/);
});

test("payments(id) is read whole: merchant, gross, payer, refunded", async () => {
  const { read } = chain({ payments: { 1n: [MERCHANT, 2_000_000n, PAYER, 1_000_000n] } });
  assert.deepEqual(await readPayment(MERCHANT_PAY, 1n, { read }), { merchant: MERCHANT, gross: 2_000_000n, payer: PAYER, refunded: 1_000_000n });
});

// Blockscout's etherscan-style getLogs, filtered by MerchantPay and the indexed merchant (topic2)
const events = parseAbi([
  "event InvoiceCreated(uint256 indexed id, address indexed merchant, address indexed customer, uint256 amount, uint64 dueDate, bytes32 refHash)",
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
]);
const tx = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const created = (id, merchant = MERCHANT, address = MERCHANT_PAY) => ({
  address: address.toLowerCase(),
  topics: encodeEventTopics({ abi: events, eventName: "InvoiceCreated", args: { id, merchant, customer: "0x0000000000000000000000000000000000000000" } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }, { type: "bytes32" }], [25_000_000n, 1_900_000_000n, `0x${"aa".repeat(32)}`]),
  transactionHash: tx(id),
  timeStamp: toHex(1_793_900_000),
});
const paidLog = (paymentId, invoiceId, merchant = MERCHANT) => ({
  address: MERCHANT_PAY.toLowerCase(),
  topics: encodeEventTopics({ abi: events, eventName: "Paid", args: { paymentId, merchant, payer: PAYER } }),
  data: encodeAbiParameters(Array(6).fill({ type: "uint256" }).map((t, i) => (i === 1 ? { type: "bytes32" } : t)), [invoiceId, `0x${"00".repeat(32)}`, 25_000_000n, 100_000n, 0n, 24_900_000n]),
  transactionHash: tx(100n + paymentId),
  timeStamp: toHex(1_793_900_100),
});

let blockscout;
const urls = [];
beforeEach(() => {
  urls.length = 0;
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return blockscout();
  };
});

test("the merchant's invoices: ids from the log index, status from the chain, newest first, other merchants dropped", async () => {
  blockscout = async () => Response.json({ message: "OK", status: "1", result: [created(7n), created(9n), created(8n, OTHER), created(10n, MERCHANT, OTHER), { junk: true }] });
  const { read } = chain({ invoices: { 7n: openInvoice(), 9n: openInvoice(MERCHANT, 5_000_000n, 2), 8n: openInvoice(OTHER) } });
  const list = await merchantInvoices(MERCHANT_PAY, MERCHANT, read);
  assert.deepEqual(list.map((i) => [i.id, i.status, i.amount]), [[9n, "paid", 5_000_000n], [7n, "open", 25_000_000n]], "the chain's amount and status, not the log's");
  const [q] = urls;
  assert.equal(q.origin + q.pathname, "https://explorer.testnet.whitechain.io/api");
  assert.equal(q.searchParams.get("address"), MERCHANT_PAY);
  assert.equal(q.searchParams.get("topic2"), `0x${"0".repeat(24)}${MERCHANT.slice(2).toLowerCase()}`);
  assert.equal(q.searchParams.get("topic0_2_opr"), "and");
});

test("an empty index is an empty list; a failing one throws (the page says it couldn't load)", async () => {
  blockscout = async () => Response.json({ message: "No logs found", status: "0", result: [] });
  assert.deepEqual(await merchantInvoices(MERCHANT_PAY, MERCHANT, chain().read), []);
  blockscout = async () => new Response("bad gateway", { status: 502 });
  await assert.rejects(merchantInvoices(MERCHANT_PAY, MERCHANT, chain().read));
  blockscout = async () => Response.json({ message: "Error", status: "0", result: null });
  await assert.rejects(merchantInvoices(MERCHANT_PAY, MERCHANT, chain().read));
});

test("the merchant's payments from the log index: payment id, invoice id, tx hash and time", async () => {
  blockscout = async () => Response.json({ message: "OK", status: "1", result: [paidLog(1n, 0n), paidLog(2n, 7n), paidLog(3n, 0n, OTHER)] });
  const logs = await paidLogs(MERCHANT_PAY, { merchant: MERCHANT });
  assert.deepEqual(logs.map((l) => [l.paymentId, l.invoiceId, l.gross, l.txHash, l.time]), [
    [1n, 0n, 25_000_000n, tx(101n), 1_793_900_100_000],
    [2n, 7n, 25_000_000n, tx(102n), 1_793_900_100_000],
  ]);
  blockscout = async () => Response.json({ message: "OK", status: "1", result: [paidLog(2n, 7n)] });
  const [one] = await paidLogs(MERCHANT_PAY, { paymentId: 2n });
  assert.equal(one.invoiceId, 7n);
  assert.equal(urls.at(-1).searchParams.get("topic1"), tx(2n), "a receipt looks its payment up by id (topic1)");
});

// viem's decodeEventLog picks the event by topic0 and ignores eventName, so an index that answers with another
// event's log must be dropped by name (found by claude-contracts' reports builder, 03:31).
test("a log of another event in the index answer is dropped, never read as a payment or an invoice", async () => {
  blockscout = async () => Response.json({ message: "OK", status: "1", result: [created(9n), paidLog(1n, 0n)] });
  assert.deepEqual((await paidLogs(MERCHANT_PAY, { merchant: MERCHANT })).map((l) => l.paymentId), [1n]);
  blockscout = async () => Response.json({ message: "OK", status: "1", result: [paidLog(1n, 0n), created(9n)] });
  const open = [MERCHANT, 1_900_000_000n, 1, "0x0000000000000000000000000000000000000000", 25_000_000n, 0n];
  const { read, calls } = chain({ invoices: { 9: open, 1: open } });
  assert.deepEqual((await merchantInvoices(MERCHANT_PAY, MERCHANT, read)).map((i) => i.id), [9n]);
  assert.deepEqual(calls.map((c) => c.args[0]), [9n], "the Paid log's payment id is never read as an invoice id");
});
