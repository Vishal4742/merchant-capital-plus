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

test("the final MerchantPay 0xab81…4251: relayFee is 0.10 USDT, and each Paid log in the index matches payments(id) on chain", { skip: !process.env.LIVE }, async () => {
  const { paidLogs, readPayment, readRelayFee, readInvoice } = await import("../lib/onchain.ts");
  const FINAL = "0xab817593253a0a37de723072827d88fe0ca54251";
  assert.equal(await readRelayFee(FINAL), 100_000n);
  assert.equal((await readInvoice(FINAL, 999_999n)).status, "missing");
  const [first] = await paidLogs(FINAL, { paymentId: 1n });
  assert.ok(first?.txHash, "payment 1 is in the log index");
  const record = await readPayment(FINAL, 1n);
  assert.equal(record.gross, first.gross, "the index and the chain agree on the gross");
  const byMerchant = await paidLogs(FINAL, { merchant: record.merchant });
  assert.ok(byMerchant.some((log) => log.paymentId === 1n), "the merchant filter (topic2) finds it too");
});
