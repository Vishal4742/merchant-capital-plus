// Withdraw from Settlements (FR-GW-15, AT-18): the destination and amount checks (each refusal), bigint amount parsing,
// the server's balance read, and the merchant's own wallet sending exactly one USDT transfer. The wallet is a fake
// EIP-1193 provider; nothing is sent to a real chain. Run from apps/web: npm test
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, getAddress, parseAbi, toHex } from "viem";

// lib/merchant-wallet.ts imports the Nym harness; these tests never boot it
mock.module("@anon-rpc/browser-harness", { exports: { AnonRpcWorker: class {} } });

const { CANCELLED, CAPITAL_MARKET, CLAIM_TOKEN, INVESTOR_REGISTRY, MERCHANT_PAY, NOT_ENOUGH_WBT, NOT_THROUGH, REPLACED, UNCONFIRMED, WRONG_NETWORK, checkAmount, checkDestination, quoteWithdraw, sendStatus, withdraw, withdrawError } = await import("../lib/withdraw.ts");
const { connectMerchant, SENT_UNCONFIRMED } = await import("../lib/merchant-wallet.ts");
const { readUsdtBalance } = await import("../lib/onchain.ts");
const { USDT, plainUsdt } = await import("../lib/usdt.ts");
const shared = await import("../../../packages/shared/contracts.ts");

const MERCHANT = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const EXCHANGE = "0x8ba1f109551bD432803012645Ac136ddd64DBA72"; // a checksummed second address (AT-18)
const ONE_USDT = 1_000_000n;
const abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "error Error(string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const refused = (result) => (assert.equal(result.ok, false, `expected a refusal, got ${JSON.stringify(result, (_, v) => (typeof v === "bigint" ? `${v}n` : v))}`), result.error);

test("the copied contract addresses match packages/shared/contracts.ts", () => {
  assert.equal(MERCHANT_PAY.toLowerCase(), shared.addresses.merchantPay.toLowerCase());
  assert.equal(CAPITAL_MARKET.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
  assert.equal(CLAIM_TOKEN.toLowerCase(), shared.addresses.claimToken.toLowerCase());
  assert.equal(INVESTOR_REGISTRY.toLowerCase(), shared.addresses.investorRegistry.toLowerCase());
  assert.equal(USDT.toLowerCase(), shared.addresses.usdt.toLowerCase());
});

test("a destination is accepted checksummed or all lower case, and comes back checksummed", () => {
  assert.deepEqual(checkDestination(EXCHANGE, MERCHANT), { ok: true, value: EXCHANGE });
  assert.deepEqual(checkDestination(`  ${EXCHANGE.toLowerCase()}  `, MERCHANT), { ok: true, value: EXCHANGE });
});

test("each refused destination has its own plain reason", () => {
  const cases = [
    ["", /Enter the address/],
    ["   ", /Enter the address/],
    ["0x1234", /isn't a wallet address/],
    [`${EXCHANGE}00`, /isn't a wallet address/],
    ["8ba1f109551bD432803012645Ac136ddd64DBA72", /isn't a wallet address/],
    ["0x8BA1F109551BD432803012645AC136DDD64DBA72", /checksum/], // all upper case is not EIP-55
    ["0x8ba1f109551bd432803012645Ac136ddd64DBA72", /checksum/], // one letter's case flipped
    ["0x0000000000000000000000000000000000000000", /zero address/],
    [MERCHANT, /own address/],
    [MERCHANT.toLowerCase(), /own address/],
    [shared.addresses.merchantPay, /MerchantPay contract/],
    [getAddress(shared.addresses.capitalMarket), /CapitalMarket contract/],
    [shared.addresses.claimToken, /ClaimToken contract/],
    [shared.addresses.investorRegistry, /InvestorRegistry contract/],
    [shared.addresses.usdt, /USDT contract/],
    [shared.addresses.usdt.toLowerCase(), /USDT contract/],
  ];
  for (const [text, reason] of cases) assert.match(refused(checkDestination(text, MERCHANT)), reason, `"${text}"`);
});

test("amounts are bigint base units, never floats", () => {
  const balance = 70_710_000n;
  assert.deepEqual(checkAmount("1", balance), { ok: true, value: ONE_USDT });
  assert.deepEqual(checkAmount(" 1.5 ", balance), { ok: true, value: 1_500_000n });
  assert.deepEqual(checkAmount("0.000001", balance), { ok: true, value: 1n });
  assert.deepEqual(checkAmount("0.3", balance), { ok: true, value: 300_000n }); // 0.1 + 0.2 style float drift can't happen
  assert.deepEqual(checkAmount("70.71", balance), { ok: true, value: balance });
  const huge = 123_456_789_012_345_678_901n; // past Number.MAX_SAFE_INTEGER, still exact
  assert.deepEqual(checkAmount("123456789012345.678901", huge), { ok: true, value: huge });
});

test("Max fills the exact balance, down to the last base unit", () => {
  for (const balance of [1n, 123_456n, 70_710_000n, 1_234_567_890_123n]) assert.deepEqual(checkAmount(plainUsdt(balance), balance), { ok: true, value: balance });
});

test("each refused amount has its own plain reason", () => {
  const balance = 70_710_000n;
  for (const text of ["", "abc", "1.2345678", "-1", "1e6", "1,000", ".5", "1.", "0x10", "Infinity", "NaN"]) assert.match(refused(checkAmount(text, balance)), /like 25\.00, with at most 6 decimals/, `"${text}"`);
  assert.match(refused(checkAmount("0", balance)), /above 0/);
  assert.match(refused(checkAmount("0.000000", balance)), /above 0/);
  assert.match(refused(checkAmount("70.710001", balance)), /more than the 70\.71 USDT in your wallet/);
  assert.match(refused(checkAmount("1", 0n)), /more than the 0\.00 USDT/);
});

test("the balance read is USDT.balanceOf(merchant) on chain, as an exact bigint, retried on a flaky read", async () => {
  const reads = [];
  let fails = 1;
  const read = async (req) => {
    reads.push(req);
    if (fails-- > 0) throw new Error("header not found");
    return 70_710_000n;
  };
  assert.equal(await readUsdtBalance(MERCHANT, { read, gapMs: 0 }), 70_710_000n);
  assert.equal(reads.length, 2);
  for (const req of reads) assert.deepEqual([req.address, req.functionName, req.args], [USDT, "balanceOf", [MERCHANT]]);
  await assert.rejects(readUsdtBalance(MERCHANT, { read: async () => Promise.reject(new Error("rpc down")), tries: 2, gapMs: 0 }), /rpc down/);
});

// The fake wallet: transfer behaves like TetherTokenV2 (OZ ERC20: "exceeds balance"), every eth_sendTransaction is
// recorded and mined at once unless the receipt is lost; `state.chainId` can change under the page like a real wallet.
function fakeWallet({ balance = 70_710_000n, wbt = 10n ** 18n, rejectSend = false, noGas = false, lostReceipt = false, returnsFalse = false, noTransferLog = false } = {}) {
  const sent = [];
  const receipts = new Map();
  const state = { chainId: 1874 };
  const calls = []; // every RPC method in order, so a test can see what happened before a receipt was asked for
  const request = async ({ method, params }) => {
    calls.push(method);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [MERCHANT];
      case "eth_chainId":
        return toHex(state.chainId);
      case "wallet_switchEthereumChain":
        state.chainId = Number(params[0].chainId);
        return null;
      case "eth_getBalance":
        return toHex(wbt);
      case "eth_call": {
        const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
        if (functionName === "balanceOf") return encodeAbiParameters([{ type: "uint256" }], [balance]);
        if (args[1] > balance) throw { code: 3, message: "execution reverted", data: encodeErrorResult({ abi, errorName: "Error", args: ["ERC20: transfer amount exceeds balance"] }) };
        return encodeAbiParameters([{ type: "bool" }], [!returnsFalse]);
      }
      case "eth_sendTransaction": {
        if (rejectSend) throw { code: 4001, message: "User rejected the request." };
        if (noGas) throw { code: -32000, message: "insufficient funds for gas * price + value" };
        const call = { to: params[0].to, from: params[0].from, ...decodeFunctionData({ abi, data: params[0].data }) };
        sent.push(call);
        const hash = `0x${sent.length.toString(16).padStart(64, "0")}`;
        // TetherTokenV2's Transfer(from, to, value), as a mined transfer logs it
        const logs = noTransferLog ? [] : [{ address: USDT.toLowerCase(), topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from: call.from, to: call.args[0] } }), data: encodeAbiParameters([{ type: "uint256" }], [call.args[1]]), blockNumber: "0x10", transactionHash: hash, logIndex: "0x0", blockHash: `0x${"01".repeat(32)}`, transactionIndex: "0x0", removed: false }];
        if (!lostReceipt) receipts.set(hash, { transactionHash: hash, status: "0x1", blockNumber: "0x10", blockHash: `0x${"01".repeat(32)}`, logs, transactionIndex: "0x0", from: MERCHANT, to: call.to, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", contractAddress: null, logsBloom: `0x${"00".repeat(256)}`, type: "0x2" });
        return hash;
      }
      case "wallet_sendTransaction": // what MetaMask answers, so viem rethrows the eth_sendTransaction error
        throw { code: -32601, message: "The method does not exist / is not available." };
      case "eth_getTransactionReceipt":
        if (lostReceipt) throw { code: -32603, message: "receipt read failed" };
        return receipts.get(params[0]) ?? null;
      case "eth_getTransactionByHash": // mined, so viem asks for the receipt again at once instead of waiting
        return lostReceipt ? { hash: params[0], blockNumber: "0x10", blockHash: `0x${"01".repeat(32)}`, transactionIndex: "0x0", from: MERCHANT, to: USDT, nonce: "0x0", value: "0x0", gas: "0x30000", input: "0x", type: "0x2" } : null;
      case "eth_blockNumber":
        return "0x10";
      case "eth_estimateGas":
        return "0x30000";
      default:
        throw new Error(`fake wallet: unexpected ${method}`);
    }
  };
  return { provider: { request }, sent, state, calls };
}

const connect = (provider) => connectMerchant(provider, MERCHANT, MERCHANT_PAY);

test("the hash is handed out as soon as the wallet sends, before any receipt is read (042, UX review MEDIUM 1)", async () => {
  const { provider, calls } = fakeWallet();
  const seen = [];
  const hash = await withdraw(await connect(provider), EXCHANGE, ONE_USDT, (sentHash) => seen.push([sentHash, calls.length]));
  assert.equal(seen.length, 1, "onSent once");
  const [[sentHash, callsBefore]] = seen;
  assert.equal(sentHash, hash, "the same hash the confirmed send returns");
  assert.equal(calls[callsBefore - 1], "eth_sendTransaction", "right after the wallet returned it");
  assert.ok(!calls.slice(0, callsBefore).includes("eth_getTransactionReceipt"), "before any receipt read");
  assert.ok(calls.slice(callsBefore).includes("eth_getTransactionReceipt"), "the receipt is still awaited after");
});

test("onSent carries the hash of an unconfirmed send, and isn't called when nothing was sent", async () => {
  const lost = fakeWallet({ lostReceipt: true });
  const seen = [];
  const error = await withdraw(await connect(lost.provider), EXCHANGE, ONE_USDT, (h) => seen.push(h)).catch((e) => e);
  assert.deepEqual(seen, [error.hash]);
  for (const options of [{ balance: 500_000n }, { rejectSend: true }, { returnsFalse: true }]) {
    const { provider } = fakeWallet(options);
    const none = [];
    await withdraw(await connect(provider), EXCHANGE, ONE_USDT, (h) => none.push(h)).catch(() => {});
    assert.deepEqual(none, [], JSON.stringify(options, (_, v) => (typeof v === "bigint" ? `${v}n` : v)));
  }
});

test("the wrong-network copy names the network the way the app does (042, UX review LOW 4)", () => {
  assert.match(WRONG_NETWORK, /Whitechain Testnet \(chain 1874\)/);
  assert.doesNotMatch(WRONG_NETWORK, /Sepolia/);
});

test("AT-18: withdrawing 1 USDT sends exactly one transfer of 1_000_000 units to that address, from the merchant's wallet", async () => {
  const { provider, sent } = fakeWallet();
  const hash = await withdraw(await connect(provider), EXCHANGE, ONE_USDT);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(sent.length, 1);
  const [{ to, from, functionName, args }] = sent;
  assert.deepEqual([to.toLowerCase(), from.toLowerCase(), functionName, args], [USDT.toLowerCase(), MERCHANT.toLowerCase(), "transfer", [EXCHANGE, ONE_USDT]]);
});

test("the network fee estimate covers the transfer itself, and too little WBT for it stops before the wallet asks", async () => {
  const calls = [];
  const estimate = async (_client, call) => (calls.push(call), 307_596_507_003_300n); // read from chain 1874 for a USDT transfer
  const rich = fakeWallet();
  assert.equal(await quoteWithdraw(await connect(rich.provider), EXCHANGE, ONE_USDT, estimate), 307_596_507_003_300n);
  assert.deepEqual([calls[0].address, calls[0].functionName, calls[0].args, calls[0].account], [USDT, "transfer", [EXCHANGE, ONE_USDT], MERCHANT]);
  const poor = fakeWallet({ wbt: 1_000n });
  const error = await quoteWithdraw(await connect(poor.provider), EXCHANGE, ONE_USDT, estimate).catch((e) => e);
  assert.equal(withdrawError(error), NOT_ENOUGH_WBT);
  assert.equal(poor.sent.length, 0);
});

test("more than the wallet holds now is refused by the dry run, before anything is sent", async () => {
  const { provider, sent } = fakeWallet({ balance: 500_000n });
  const error = await withdraw(await connect(provider), EXCHANGE, ONE_USDT).catch((e) => e);
  assert.match(withdrawError(error), /doesn't have that much USDT now/);
  assert.equal(sent.length, 0);
});

test("plain errors: rejected in the wallet, no WBT for gas, wrong network", async () => {
  const rejected = fakeWallet({ rejectSend: true });
  assert.equal(withdrawError(await withdraw(await connect(rejected.provider), EXCHANGE, ONE_USDT).catch((e) => e)), "You cancelled the request in your wallet.");
  const noGas = fakeWallet({ noGas: true });
  assert.equal(withdrawError(await withdraw(await connect(noGas.provider), EXCHANGE, ONE_USDT).catch((e) => e)), NOT_ENOUGH_WBT);
  const moved = fakeWallet();
  const w = await connect(moved.provider);
  moved.state.chainId = 1; // the merchant switched networks between Review and Send
  assert.equal(withdrawError(await withdraw(w, EXCHANGE, ONE_USDT).catch((e) => e)), WRONG_NETWORK);
  assert.equal(moved.sent.length, 0);
});

test("sent but unconfirmed keeps the tx hash for its link, so the merchant checks before sending again", async () => {
  const { provider, sent } = fakeWallet({ lostReceipt: true });
  const error = await withdraw(await connect(provider), EXCHANGE, ONE_USDT).catch((e) => e);
  assert.equal(error.message, SENT_UNCONFIRMED);
  assert.match(error.hash, /^0x[0-9a-f]{64}$/);
  assert.equal(withdrawError(error), UNCONFIRMED);
  assert.equal(sent.length, 1);
});

test("Check again after an unconfirmed send: pending while there's no receipt, then sent or failed from the receipt (033 M2)", async () => {
  const lost = fakeWallet({ lostReceipt: true });
  const w = await connect(lost.provider);
  const { hash } = await withdraw(w, EXCHANGE, ONE_USDT).catch((e) => e);
  assert.equal(await sendStatus(w, hash), "pending");
  const ok = fakeWallet();
  const w2 = await connect(ok.provider);
  assert.equal(await sendStatus(w2, await withdraw(w2, EXCHANGE, ONE_USDT)), "sent");
  const reverted = { ...w2, reader: { getTransactionReceipt: async () => ({ status: "reverted" }) } };
  assert.equal(await sendStatus(reverted, hash), "failed");
  assert.equal(NOT_THROUGH, "That didn't go through, and nothing moved. Try again.");
});

// viem 2.57's waitForTransactionReceipt resolves with the REPLACEMENT's receipt when the wallet replaces the tx, and
// calls onReplaced first. These stub that one call on a real connected wallet (security review of #35, MEDIUM).
const H2 = `0x${"ab".repeat(32)}`;
function replacedWith(w, reason, logs = []) {
  const receipt = { transactionHash: H2, status: "success", logs };
  const waitForTransactionReceipt = async ({ onReplaced }) => {
    onReplaced?.({ reason, replacedTransaction: {}, transaction: { hash: H2 }, transactionReceipt: receipt });
    return receipt;
  };
  return { ...w, reader: { ...w.reader, waitForTransactionReceipt } };
}

test("Cancel in the wallet (a 0-value self-tx on the same nonce) is never shown as Sent", async () => {
  const { provider, sent } = fakeWallet();
  const seen = [];
  const error = await withdraw(replacedWith(await connect(provider), "cancelled"), EXCHANGE, ONE_USDT, (h) => seen.push(h)).catch((e) => e);
  assert.equal(withdrawError(error), CANCELLED);
  assert.equal(error.hash, undefined, "no hash: nothing moved, so Send is offered again");
  assert.equal(sent.length, 1);
  assert.equal(seen.length, 1);
});

test("a transfer replaced by a different transaction is never shown as Sent", async () => {
  const { provider } = fakeWallet();
  const error = await withdraw(replacedWith(await connect(provider), "replaced"), EXCHANGE, ONE_USDT).catch((e) => e);
  assert.equal(withdrawError(error), REPLACED);
});

test("a repriced transfer (same call, higher fee) counts once its receipt has the Transfer, and links the new hash", async () => {
  const { provider } = fakeWallet();
  const w = await connect(provider);
  const transfer = { address: USDT, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from: MERCHANT, to: EXCHANGE } }), data: encodeAbiParameters([{ type: "uint256" }], [ONE_USDT]), blockNumber: 16n, transactionHash: H2, logIndex: 0, blockHash: `0x${"01".repeat(32)}`, transactionIndex: 0, removed: false };
  assert.equal(await withdraw(replacedWith(w, "repriced", [transfer]), EXCHANGE, ONE_USDT), H2);
  const wrongAmount = { ...transfer, data: encodeAbiParameters([{ type: "uint256" }], [ONE_USDT - 1n]) };
  assert.equal(withdrawError(await withdraw(replacedWith(w, "repriced", [wrongAmount]), EXCHANGE, ONE_USDT).catch((e) => e)), NOT_THROUGH);
  const otherToken = { ...transfer, address: CAPITAL_MARKET };
  assert.equal(withdrawError(await withdraw(replacedWith(w, "repriced", [otherToken]), EXCHANGE, ONE_USDT).catch((e) => e)), NOT_THROUGH);
});

test("a success receipt without USDT's Transfer(merchant → to, amount) is not shown as Sent", async () => {
  const { provider } = fakeWallet({ noTransferLog: true });
  const error = await withdraw(await connect(provider), EXCHANGE, ONE_USDT).catch((e) => e);
  assert.equal(withdrawError(error), NOT_THROUGH);
  assert.equal(error.hash, undefined);
});

test("a transfer whose dry run returns false is refused before the wallet is asked (033 L2)", async () => {
  const { provider, sent } = fakeWallet({ returnsFalse: true });
  const error = await withdraw(await connect(provider), EXCHANGE, ONE_USDT).catch((e) => e);
  assert.match(withdrawError(error), /USDT refused this transfer/);
  assert.equal(sent.length, 0);
});
