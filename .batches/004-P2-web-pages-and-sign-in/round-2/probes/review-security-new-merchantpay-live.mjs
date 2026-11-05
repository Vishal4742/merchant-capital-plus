// The new MerchantPay (0x8eff…248f): paused? same saleNonce encoding as apps/web/lib/pay.ts? OrderPaid on a paid sale?
import { createRequire } from "node:module";
const require = createRequire("/Users/vg890/ethglobal/apps/web/package.json");
const { createPublicClient, http, parseAbi, parseAbiItem, toHex, BaseError } = require("viem");
const { whitechainSepolia } = require("viem/chains");
const { saleNonce, KIND_SALE } = await import("/Users/vg890/ethglobal/apps/web/lib/pay.ts");
const MP = "0x8effc3e20e99af309cb367e33716b1e7ca71248f";
const abi = parseAbi([
  "function paused() view returns (bool)",
  "function KIND_SALE() view returns (uint8)",
  "function saleNonce(address merchant, bytes32 orderRef, uint256 amount, bytes32 salt) view returns (bytes32)",
  "function saleOf(address merchant, bytes32 orderRef) view returns (uint256)",
  "function paySale(address merchant, bytes32 orderRef, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "error OrderPaid()",
]);
const c = createPublicClient({ chain: whitechainSepolia, transport: http("https://rpc.ankr.com/whitechain_testnet", { timeout: 15000 }) });
const v = { merchant: "0xb4e7ede967e108858ddb5d88b25fdc70723b714d", orderRef: `0x${"5a".repeat(32)}`, amount: 25_000_000n, salt: `0x${"c3".repeat(32)}` };
const onchain = await c.readContract({ address: MP, abi, functionName: "saleNonce", args: [v.merchant, v.orderRef, v.amount, v.salt] });
const ours = saleNonce({ merchantPay: MP, merchant: v.merchant, orderRef: v.orderRef, amount: v.amount }, v.salt);
const out = { paused: await c.readContract({ address: MP, abi, functionName: "paused" }), KIND_SALE: await c.readContract({ address: MP, abi, functionName: "KIND_SALE" }), webKindSale: KIND_SALE, nonceMatchesWeb: onchain === ours };
const latest = await c.getBlockNumber();
let logs = [];
for (let to = latest, i = 0; i < 20 && logs.length === 0; i++, to -= 5000n) {
  logs = await c.getLogs({ address: MP, event: parseAbiItem("event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)"), fromBlock: to - 4999n, toBlock: to }).catch(() => []);
}
const sale = logs.find((l) => l.args.orderRef !== `0x${"0".repeat(64)}`);
out.paidSaleFound = Boolean(sale);
if (sale) {
  try {
    await c.simulateContract({ address: MP, abi, functionName: "paySale", account: "0x000000000000000000000000000000000000bEEF",
      args: [sale.args.merchant, sale.args.orderRef, sale.args.payer, sale.args.gross, 0n, BigInt(Math.floor(Date.now() / 1000) + 400), toHex(crypto.getRandomValues(new Uint8Array(32))), 27, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`] });
    out.secondPaySale = "DID NOT REVERT";
  } catch (e) {
    const err = e instanceof BaseError ? e.walk((x) => x?.data?.errorName) : null;
    out.secondPaySale = err?.data?.errorName ?? (e.shortMessage ?? String(e)).split("\n")[0];
  }
}
console.log(JSON.stringify(out));
