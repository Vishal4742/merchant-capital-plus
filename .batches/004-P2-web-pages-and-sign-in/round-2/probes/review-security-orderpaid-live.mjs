// Live check on chain 1874: does the deployed MerchantPay refuse a second paySale for an already-paid order,
// with a fresh salt and a junk signature (OrderPaid must fire before the USDT pull)? eth_call only, no tx, no key.
import { createRequire } from "node:module";
const require = createRequire("/Users/vg890/ethglobal/apps/web/package.json");
const { createPublicClient, http, parseAbi, decodeEventLog, toHex, toFunctionSelector, BaseError } = require("viem");
const { whitechainSepolia } = require("viem/chains");
const MP = "0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7";
const TX = "0xae155c49b9e10c098ff3f6146dd29256c75a52acaac85a3367e0c8e30e3cfb1a";
const abi = parseAbi([
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
  "function paySale(address merchant, bytes32 orderRef, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "function saleOf(address merchant, bytes32 orderRef) view returns (uint256)",
  "error OrderPaid()",
]);
const c = createPublicClient({ chain: whitechainSepolia, transport: http("https://rpc.ankr.com/whitechain_testnet", { timeout: 15000 }) });
const receipt = await c.getTransactionReceipt({ hash: TX });
const log = receipt.logs.find((l) => l.address.toLowerCase() === MP.toLowerCase() && (() => { try { return decodeEventLog({ abi, ...l }).eventName === "Paid"; } catch { return false; } })());
const { args } = decodeEventLog({ abi, ...log });
const paidId = await c.readContract({ address: MP, abi, functionName: "saleOf", args: [args.merchant, args.orderRef] });
const paused = await c.readContract({ address: MP, abi: parseAbi(["function paused() view returns (bool)"]), functionName: "paused" });
const out = { pausedOnChain: paused, saleOf: paidId.toString(), selectors: { OrderPaid: toFunctionSelector("OrderPaid()"), EnforcedPause: toFunctionSelector("EnforcedPause()") } };
const fresh = `0x${"ab".repeat(32)}`; // an order never paid: the same call must get past OrderPaid and fail in the USDT pull
for (const [label, from, orderRef] of [["paid order, same payer, fresh salt", args.payer, args.orderRef], ["paid order, another payer, fresh salt", "0x000000000000000000000000000000000000dEaD", args.orderRef], ["control: unpaid order", args.payer, fresh]]) {
  try {
    await c.simulateContract({ address: MP, abi, functionName: "paySale", account: "0x000000000000000000000000000000000000bEEF",
      // eth_call only: clear the paused byte in slot 0 (the deployed contract is paused, EnforcedPause fires first)
      stateOverride: [{ address: MP, stateDiff: [{ slot: `0x${"0".repeat(64)}`, value: "0x000000000000000000000000b4e7ede967e108858ddb5d88b25fdc70723b714d" }] }],
      args: [args.merchant, orderRef, from, args.gross, 0n, BigInt(Math.floor(Date.now() / 1000) + 400), toHex(crypto.getRandomValues(new Uint8Array(32))), 27, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`] });
    out[label] = "DID NOT REVERT";
  } catch (e) {
    const err = e instanceof BaseError ? e.walk((x) => x?.data?.errorName) : null;
    const rev = e instanceof BaseError ? e.walk((x) => x?.signature || x?.raw) : null; out[label] = err?.data ? [err.data.errorName, ...(err.data.args ?? [])].join(": ") : rev?.signature ?? rev?.raw ?? (e.shortMessage ?? String(e)).split("\n")[0];
  }
}
console.log(JSON.stringify(out));
