// Withdraw from Settlements (FR-GW-15, AT-18): the destination and amount checks (each refusal), bigint amount parsing,
// the server's balance read, and the merchant's own wallet sending exactly one USDT transfer. The wallet is a fake
// EIP-1193 provider; nothing is sent to a real chain. Run from apps/web: npm test
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, getAddress, parseAbi, toHex } from "viem";

// lib/merchant-wallet.ts imports the Nym harness; these tests never boot it
mock.module("@anon-rpc/browser-harness", { exports: { AnonRpcWorker: class {} } });

const { CAPITAL_MARKET, MERCHANT_PAY, NOT_ENOUGH_WBT, UNCONFIRMED, WRONG_NETWORK, checkAmount, checkDestination, quoteWithdraw, withdraw, withdrawError } = await import("../lib/withdraw.ts");
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
]);

const refused = (result) => (assert.equal(result.ok, false, `expected a refusal, got ${JSON.stringify(result, (_, v) => (typeof v === "bigint" ? `${v}n` : v))}`), result.error);

test("the copied contract addresses match packages/shared/contracts.ts", () => {
  assert.equal(MERCHANT_PAY.toLowerCase(), shared.addresses.merchantPay.toLowerCase());
  assert.equal(CAPITAL_MARKET.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
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
function fakeWallet({ balance = 70_710_000n, wbt = 10n ** 18n, rejectSend = false, noGas = false, lostReceipt = false } = {}) {
  const sent = [];
  const receipts = new Map();
  const state = { chainId: 1874 };
  const request = async ({ method, params }) => {
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
        return encodeAbiParameters([{ type: "bool" }], [true]);
      }
      case "eth_sendTransaction": {
        if (rejectSend) throw { code: 4001, message: "User rejected the request." };
        if (noGas) throw { code: -32000, message: "insufficient funds for gas * price + value" };
        const call = { to: params[0].to, from: params[0].from, ...decodeFunctionData({ abi, data: params[0].data }) };
        sent.push(call);
        const hash = `0x${sent.length.toString(16).padStart(64, "0")}`;
        if (!lostReceipt) receipts.set(hash, { transactionHash: hash, status: "0x1", blockNumber: "0x10", blockHash: `0x${"01".repeat(32)}`, logs: [], transactionIndex: "0x0", from: MERCHANT, to: call.to, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", contractAddress: null, logsBloom: `0x${"00".repeat(256)}`, type: "0x2" });
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
  return { provider: { request }, sent, state };
}

const connect = (provider) => connectMerchant(provider, MERCHANT, MERCHANT_PAY);

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
