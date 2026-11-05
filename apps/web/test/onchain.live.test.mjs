// Live check of the consumer rule against the deployed MerchantPay on chain 1874, using the contracts lane's smoke
// sale. Skipped unless LIVE=1, so `npm test` stays offline: LIVE=1 node --test test/onchain.live.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, decodeEventLog, http, parseAbi } from "viem";
import { whitechainSepolia } from "viem/chains";

const MERCHANT_PAY = "0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7";
const SMOKE_SALE_TX = "0xae155c49b9e10c098ff3f6146dd29256c75a52acaac85a3367e0c8e30e3cfb1a";
const paid = parseAbi(["event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)"]);

test("the smoke sale settles at its exact amount and payer; a wrong amount, order or payer doesn't", { skip: !process.env.LIVE }, async () => {
  const { saleSettled } = await import("../lib/onchain.ts");
  const client = createPublicClient({ chain: whitechainSepolia, transport: http("https://rpc.ankr.com/whitechain_testnet", { timeout: 20_000 }) });
  const receipt = await client.getTransactionReceipt({ hash: SMOKE_SALE_TX });
  const log = receipt.logs.find((l) => l.address.toLowerCase() === MERCHANT_PAY.toLowerCase());
  const { args } = decodeEventLog({ abi: paid, data: log.data, topics: log.topics });
  const sale = { merchantPay: MERCHANT_PAY, merchant: args.merchant, orderRef: args.orderRef, amount: args.gross, payer: args.payer };
  assert.equal(await saleSettled(sale, { blockNumber: receipt.blockNumber }), args.paymentId.toString());
  assert.equal(await saleSettled({ ...sale, amount: args.gross - 1n }), null);
  assert.equal(await saleSettled({ ...sale, orderRef: `0x${"ab".repeat(32)}` }), null);
  assert.equal(await saleSettled({ ...sale, payer: "0x5555555555555555555555555555555555555555" }), null);
});
