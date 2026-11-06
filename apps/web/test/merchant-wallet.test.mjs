// claude-frontend checks for the merchant's own-wallet actions (FR-PAY-1, FR-PAY-2, FR-PAY-8): create and cancel an
// invoice, refund with an exact approval when the allowance is short, and MerchantPay's errors as plain merchant copy.
// The wallet is a fake EIP-1193 provider. The private-read tests at the end (FR-PRIV-1, FR-PRIV-3) add a fake Nym harness
// whose worker answers from the same fake chain. Run from apps/web: npm test
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, getAddress, parseAbi, toHex } from "viem";

// The fake Nym harness: a boot fails or waits for release(); its worker's fetch answers JSON-RPC from `chain` (a fake
// wallet's chain) and records each method in viaNym, or fails like a dead tunnel while nymDown.
let chain;
let boot = "manual";
let boots = 0;
let release;
let nymDown = false;
const viaNym = [];
class FakeWorker {
  constructor() {
    boots++;
    this.ready = boot === "fail" ? Promise.reject(new Error("boot failed")) : new Promise((resolve) => (release = resolve));
  }
  async fetch(_url, init) {
    const { id, method, params } = JSON.parse(init.body);
    viaNym.push(method);
    if (nymDown) throw new TypeError("Failed to fetch");
    try {
      return Response.json({ jsonrpc: "2.0", id, result: await chain.provider.request({ method, params }) });
    } catch (error) {
      return Response.json({ jsonrpc: "2.0", id, error: { code: error.code ?? -32603, message: error.message, data: error.data } });
    }
  }
  close() {}
}
mock.module("@anon-rpc/browser-harness", { exports: { AnonRpcWorker: FakeWorker } });

const { connectMerchant, createInvoice, cancelInvoice, refund, startPrivateReads, walletError } = await import("../lib/merchant-wallet.ts");
const { readMeter } = await import("../lib/read-meter.ts");

const MERCHANT = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const MERCHANT_PAY = "0xab817593253a0a37de723072827d88fe0ca54251";
const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const abi = parseAbi([
  "function createInvoice(address customer, uint128 amount, uint64 dueDate, bytes32 refHash) returns (uint256 id)",
  "function cancelInvoice(uint256 id)",
  "function refund(uint256 paymentId, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event InvoiceCreated(uint256 indexed id, address indexed merchant, address indexed customer, uint256 amount, uint64 dueDate, bytes32 refHash)",
  "error NotMerchant()",
  "error RefundTooLarge()",
  "error InvoiceNotOpen()",
  "error InvoiceFinanced()",
  "error Error(string)",
]);

// The fake wallet: answers eth_call like the chain would (a `reverts` entry forces a MerchantPay error), records every
// eth_sendTransaction, and mines each one at once with a receipt (InvoiceCreated for createInvoice). refund behaves
// like MerchantPay over TetherTokenV2: RefundTooLarge above what's left, then transferFrom checks the merchant's
// balance before its allowance, with USDT's own reason strings (security review F2, code review F2).
function fakeWallet({ account = MERCHANT, chainId = 1874, allowance = 0n, balance = 1_000_000_000n, left = 25_000_000n, reverts = {}, rejectSend = false, newId = 7n, bareRevert = false } = {}) {
  const sent = [];
  const receipts = new Map();
  const decode = ({ data }) => decodeFunctionData({ abi, data });
  const request = async ({ method, params }) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account];
      case "eth_chainId":
        return toHex(chainId);
      case "wallet_switchEthereumChain":
        chainId = Number(params[0].chainId);
        return null;
      case "eth_call": {
        const { functionName } = decode(params[0]);
        const { args } = decode(params[0]);
        const revert = (errorName, reason) => {
          throw { code: 3, message: "execution reverted", data: encodeErrorResult({ abi, errorName, args: reason === undefined ? undefined : [reason] }) };
        };
        if (reverts[functionName]) revert(reverts[functionName]);
        if (functionName === "refund") {
          if (bareRevert) throw { code: 3, message: "execution reverted" }; // a wallet that sends no revert data
          if (args[1] > left) revert("RefundTooLarge");
          if (balance < args[1]) revert("Error", "ERC20: transfer amount exceeds balance");
          // TetherTokenV2 is OZ ERC20Upgradeable 4.4: its allowance reason, read on chain 1874 (security review 005 F-N5)
          if (allowance < args[1]) revert("Error", "ERC20: transfer amount exceeds allowance");
        }
        if (functionName === "allowance") return encodeAbiParameters([{ type: "uint256" }], [allowance]);
        if (functionName === "balanceOf") return encodeAbiParameters([{ type: "uint256" }], [balance]);
        if (functionName === "createInvoice") return encodeAbiParameters([{ type: "uint256" }], [newId]);
        if (functionName === "approve") return encodeAbiParameters([{ type: "bool" }], [true]);
        return "0x";
      }
      case "eth_sendTransaction": {
        if (rejectSend) throw { code: 4001, message: "User rejected the request." };
        const call = { to: params[0].to, from: params[0].from, ...decode(params[0]) };
        sent.push(call);
        if (call.functionName === "approve") allowance = call.args[1];
        const hash = `0x${(sent.length).toString(16).padStart(64, "0")}`;
        const logs = call.functionName === "createInvoice"
          ? [{ address: MERCHANT_PAY.toLowerCase(), topics: encodeEventTopics({ abi, eventName: "InvoiceCreated", args: { id: newId, merchant: MERCHANT, customer: call.args[0] } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }, { type: "bytes32" }], [call.args[1], call.args[2], call.args[3]]), blockNumber: "0x10", transactionHash: hash, logIndex: "0x0", blockHash: `0x${"01".repeat(32)}`, transactionIndex: "0x0", removed: false }]
          : [];
        receipts.set(hash, { transactionHash: hash, status: "0x1", blockNumber: "0x10", blockHash: `0x${"01".repeat(32)}`, logs, transactionIndex: "0x0", from: MERCHANT, to: call.to, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", contractAddress: null, logsBloom: `0x${"00".repeat(256)}`, type: "0x2" });
        return hash;
      }
      case "eth_getTransactionReceipt":
        return receipts.get(params[0]) ?? null;
      case "eth_getTransactionByHash":
        return null;
      case "eth_blockNumber":
        return "0x10";
      case "eth_estimateGas":
        return "0x30000";
      default:
        throw new Error(`fake wallet: unexpected ${method}`);
    }
  };
  return { provider: { request }, sent };
}

test("create: the wallet sends createInvoice(no customer, amount, due date, random refHash) and the new id comes from InvoiceCreated", async () => {
  const { provider, sent } = fakeWallet({ newId: 12n });
  const w = await connectMerchant(provider, MERCHANT, MERCHANT_PAY);
  const id = await createInvoice(w, 25_000_000n, 1_900_000_000n);
  assert.equal(id, 12n);
  assert.equal(sent.length, 1);
  const [{ to, functionName, args }] = sent;
  assert.deepEqual([to.toLowerCase(), functionName, args[0], args[1], args[2]], [MERCHANT_PAY.toLowerCase(), "createInvoice", "0x0000000000000000000000000000000000000000", 25_000_000n, 1_900_000_000n]);
  assert.match(args[3], /^0x[0-9a-f]{64}$/);
  const again = fakeWallet();
  await createInvoice(await connectMerchant(again.provider, MERCHANT, MERCHANT_PAY), 25_000_000n, 1_900_000_000n);
  assert.notEqual(again.sent[0].args[3], args[3], "a fresh random refHash each time, never a hash of the label");
});

test("the wallet must be the signed-in merchant, and is moved to chain 1874 first", async () => {
  const other = fakeWallet({ account: "0x4444444444444444444444444444444444444444" });
  await assert.rejects(connectMerchant(other.provider, MERCHANT, MERCHANT_PAY), /Switch your wallet to 0x37F9…42B1/);
  const wrongChain = fakeWallet({ chainId: 1 });
  const w = await connectMerchant(wrongChain.provider, MERCHANT, MERCHANT_PAY);
  assert.equal(await w.wallet.getChainId(), 1874);
  await assert.rejects(connectMerchant(undefined, MERCHANT, MERCHANT_PAY), /No browser wallet found/);
});

test("cancel sends cancelInvoice(id); an invoice that isn't open says so in plain words before anything is sent", async () => {
  const { provider, sent } = fakeWallet();
  await cancelInvoice(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 7n);
  assert.deepEqual([sent[0].functionName, sent[0].args], ["cancelInvoice", [7n]]);
  const closed = fakeWallet({ reverts: { cancelInvoice: "InvoiceNotOpen" } });
  const error = await cancelInvoice(await connectMerchant(closed.provider, MERCHANT, MERCHANT_PAY), 7n).catch((e) => e);
  assert.equal(walletError(error), "This invoice is already paid, part paid or cancelled, so it can't be cancelled.");
  assert.equal(closed.sent.length, 0);
  const financed = fakeWallet({ reverts: { cancelInvoice: "InvoiceFinanced" } });
  const sold = await cancelInvoice(await connectMerchant(financed.provider, MERCHANT, MERCHANT_PAY), 7n).catch((e) => e);
  assert.equal(walletError(sold), "Investors have funded this invoice, so it can't be cancelled.");
});

test("refund with a short allowance approves exactly the refund amount, then refunds", async () => {
  const { provider, sent } = fakeWallet({ allowance: 400_000n });
  await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n);
  assert.deepEqual(sent.map((s) => [s.to.toLowerCase(), s.functionName, s.args]), [
    [USDT.toLowerCase(), "approve", [getAddress(MERCHANT_PAY), 1_500_000n]],
    [MERCHANT_PAY.toLowerCase(), "refund", [3n, 1_500_000n]],
  ]);
});

test("refund from a wallet without enough USDT stops with plain copy before any approval is sent (security F2)", async () => {
  const { provider, sent } = fakeWallet({ allowance: 0n, balance: 1_000_000n });
  const error = await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n).catch((e) => e);
  assert.equal(walletError(error), "Your wallet doesn't have enough USDT for this refund.");
  assert.equal(sent.length, 0, "no approval spent on a refund that can't work");
});

test("a refund above what's left on the payment (re-read on chain at send time) is refused before anything is sent", async () => {
  const { provider, sent } = fakeWallet({ allowance: 5_000_000n, left: 1_000_000n });
  const error = await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n).catch((e) => e);
  assert.equal(walletError(error), "That's more than is left to refund on this payment.");
  assert.equal(sent.length, 0);
});

test("refund with enough allowance sends only the refund", async () => {
  const { provider, sent } = fakeWallet({ allowance: 5_000_000n });
  await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n);
  assert.deepEqual(sent.map((s) => s.functionName), ["refund"]);
});

test("MerchantPay's refund errors are plain merchant copy, and nothing (not even the approval) is sent", async () => {
  for (const [errorName, copy] of [
    ["NotMerchant", "Switch to the wallet that received this payment."],
    ["RefundTooLarge", "That's more than is left to refund on this payment."],
  ]) {
    const { provider, sent } = fakeWallet({ reverts: { refund: errorName } });
    const error = await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n).catch((e) => e);
    assert.equal(walletError(error), copy);
    assert.equal(sent.length, 0, `${errorName}: no approval spent on a refund that can't work`);
  }
});

test("a request cancelled in the wallet says so", async () => {
  const { provider } = fakeWallet({ allowance: 5_000_000n, rejectSend: true });
  const error = await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n).catch((e) => e);
  assert.equal(walletError(error), "You cancelled the request in your wallet.");
});

test("a dry run that fails for any reason but the allowance stops the refund before an approval (security F-N5)", async () => {
  const { provider, sent } = fakeWallet({ allowance: 0n, bareRevert: true });
  await assert.rejects(refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n));
  assert.equal(sent.length, 0, "nothing approved for a refund whose failure we can't explain");
});

test("the balance is read before any approval, so a short wallet never spends an approval (security F-N5)", async () => {
  const { provider, sent } = fakeWallet({ allowance: 0n, balance: 1_499_999n, bareRevert: true });
  const error = await refund(await connectMerchant(provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n).catch((e) => e);
  assert.equal(walletError(error), "Your wallet doesn't have enough USDT for this refund.");
  assert.equal(sent.length, 0);
});

// ---- Private reads (FR-PRIV-1, FR-PRIV-3, NFR-13). These run last and in order: they share one page's boot.
const CHAIN_READS = ["eth_call", "eth_getTransactionReceipt", "eth_blockNumber", "eth_getTransactionByHash"];
const until = async (check) => {
  while (!check()) await new Promise((resolve) => setImmediate(resolve));
};
/** The fake wallet's provider, recording every method the dashboard sends to it. */
function recorded(provider) {
  const methods = [];
  return { methods, provider: { request: (args) => (methods.push(args.method), provider.request(args)) } };
}

test("importing the dashboard's wallet code starts no Nym boot: a merchant page starts it after first paint", () => {
  assert.equal(boots, 0, "the tests above connected, read and sent without ever booting Nym");
  assert.equal(readMeter().status, "idle");
});

test("a failed boot leaves every read on the wallet's own RPC, counted plain", async () => {
  boot = "fail";
  startPrivateReads();
  await until(() => readMeter().status === "failed");
  chain = fakeWallet({ allowance: 5_000_000n });
  const before = readMeter();
  await refund(await connectMerchant(chain.provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n);
  assert.deepEqual(chain.sent.map((s) => s.functionName), ["refund"]);
  assert.equal(viaNym.length, 0);
  assert.equal(readMeter().private, before.private);
  assert.ok(readMeter().plain > before.plain);
});

test("while Nym boots, a refund doesn't wait for it: its reads go through the wallet at once, counted plain", async () => {
  boot = "manual";
  startPrivateReads();
  assert.equal(readMeter().status, "connecting");
  chain = fakeWallet({ allowance: 5_000_000n });
  const before = readMeter();
  await refund(await connectMerchant(chain.provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n);
  assert.equal(readMeter().status, "connecting", "the refund finished before the boot did");
  assert.equal(viaNym.length, 0);
  assert.ok(readMeter().plain > before.plain);
  assert.equal(boots, 2, "one boot per start, never one per read");
});

test("once Nym is ready, every read goes through it (counted private) and every send still goes through the wallet", async () => {
  release();
  await until(() => readMeter().status === "ready");
  chain = fakeWallet({ allowance: 400_000n });
  const wallet = recorded(chain.provider);
  const before = readMeter();
  await refund(await connectMerchant(wallet.provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n);
  assert.deepEqual(chain.sent.map((s) => s.functionName), ["approve", "refund"]);
  assert.ok(viaNym.length > 0 && viaNym.every((method) => CHAIN_READS.includes(method)), `Nym saw only reads: ${viaNym}`);
  assert.deepEqual(wallet.methods.filter((method) => CHAIN_READS.includes(method)), [], "no read went through the wallet");
  assert.equal(wallet.methods.filter((method) => method === "eth_sendTransaction").length, 2);
  assert.equal(readMeter().private - before.private, viaNym.length);
  assert.equal(readMeter().plain, before.plain);
  // a revert read through Nym is an answer: still MerchantPay's plain copy, and Nym stays on
  chain = fakeWallet({ reverts: { refund: "RefundTooLarge" } });
  const error = await refund(await connectMerchant(chain.provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n).catch((e) => e);
  assert.equal(walletError(error), "That's more than is left to refund on this payment.");
  assert.equal(chain.sent.length, 0);
  assert.equal(readMeter().status, "ready");
});

test("a Nym read that fails goes to the wallet instead (counted plain) and the meter shows Nym off", async () => {
  nymDown = true;
  chain = fakeWallet({ allowance: 5_000_000n });
  const wallet = recorded(chain.provider);
  const before = readMeter();
  await refund(await connectMerchant(wallet.provider, MERCHANT, MERCHANT_PAY), 3n, 1_500_000n);
  assert.deepEqual(chain.sent.map((s) => s.functionName), ["refund"]);
  assert.equal(readMeter().status, "failed");
  assert.ok(wallet.methods.includes("eth_call"));
  assert.equal(readMeter().private, before.private, "a read Nym never answered isn't counted private");
});
