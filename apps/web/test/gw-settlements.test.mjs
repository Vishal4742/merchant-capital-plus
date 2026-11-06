// claude-contracts checks for settlements (SRS FR-GW-10, AT-11, AT-15): one row per payment from MerchantPay's Paid
// logs (Blockscout index, fetch mocked), newest first, T+0 in the payment tx; the balance card is the wallet's USDT.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-settlements.test.mjs
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi, toHex } from "viem";
import { MERCHANT, OTHER_MERCHANT, req, signedIn } from "./gw-helpers.mjs";

const MERCHANT_PAY = "0xab817593253a0a37de723072827d88fe0ca54251";
process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
process.env.RELAYER_URL = "https://relayer.test";

// the wallet's USDT balance is a chain read (lib/onchain.ts has its own tests)
const balanceReads = [];
let balanceFails = false;
mock.module("../lib/onchain.ts", {
  namedExports: {
    readUsdtBalance: async (owner) => {
      balanceReads.push(owner);
      if (balanceFails) throw new Error("rpc down");
      return 123_450_000n;
    },
  },
});
const { GET } = await import("../app/api/v1/settlements/route.ts");

const PAYER = "0x3333333333333333333333333333333333333333";
const events = parseAbi([
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
]);
const tx = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const paid = (id, iso, [gross, fee, toInvestors, toMerchant], merchant = MERCHANT) => ({
  address: MERCHANT_PAY,
  blockNumber: toHex(id),
  logIndex: "0x0",
  topics: encodeEventTopics({ abi: events, eventName: "Paid", args: { paymentId: BigInt(id), merchant, payer: PAYER } }),
  data: encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [0n, `0x${"ab".repeat(32)}`, gross, fee, toInvestors, toMerchant],
  ),
  transactionHash: tx(100 + id),
  timeStamp: toHex(Date.parse(iso) / 1000),
});
const LOGS = [
  paid(1, "2026-11-03T09:00:00Z", [10_000_000n, 100_000n, 0n, 9_900_000n]), // before the range
  paid(2, "2026-11-04T08:00:00Z", [25_000_000n, 100_000n, 5_000_000n, 19_900_000n]), // an advance's investors took 5
  paid(3, "2026-11-05T23:59:59Z", [4_000_000n, 100_000n, 0n, 3_900_000n]),
  paid(4, "2026-11-05T12:00:00Z", [99_000_000n, 100_000n, 0n, 98_900_000n], OTHER_MERCHANT),
];

let indexDown;
beforeEach(() => {
  indexDown = false;
  balanceFails = false;
  balanceReads.length = 0;
  mock.method(globalThis, "fetch", async () => {
    if (indexDown) return new Response("bad gateway", { status: 502 });
    // Paid logs for the merchant; the Refunded query gets the same list, which decodes to nothing for that event
    return Response.json({ message: "OK", status: "1", result: LOGS });
  });
});
afterEach(() => mock.restoreAll());

const get = (query, headers = signedIn()) => GET(req("GET", `/api/v1/settlements${query}`, { headers }));

test("settlements need the dashboard cookie", async () => {
  assert.equal((await get("", {})).status, 401);
  assert.equal(balanceReads.length, 0);
});

test("one row per payment in range, newest first, with the split and the explorer link; balance from the wallet", async () => {
  const res = await get("?from=2026-11-04&to=2026-11-05");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.balance, "123.45");
  assert.deepEqual(balanceReads.map((a) => a.toLowerCase()), [MERCHANT]);
  assert.deepEqual(body.settlements, [
    { payment_id: "3", gross: "4", fee: "0.1", to_investors: "0", net: "3.9", tx_hash: tx(103), settled_at: "2026-11-05T23:59:59.000Z", explorer_url: `https://explorer.testnet.whitechain.io/tx/${tx(103)}` },
    { payment_id: "2", gross: "25", fee: "0.1", to_investors: "5", net: "19.9", tx_hash: tx(102), settled_at: "2026-11-04T08:00:00.000Z", explorer_url: `https://explorer.testnet.whitechain.io/tx/${tx(102)}` },
  ]);
});

test("another merchant only sees its own settlements", async () => {
  const body = await (await get("?from=2026-11-05&to=2026-11-05", signedIn(OTHER_MERCHANT))).json();
  assert.deepEqual(body.settlements.map((s) => s.payment_id), ["4"]);
});

test("bad ranges are 400; the index or the balance read failing is a 502; no MerchantPay config is a 503", async () => {
  assert.equal((await get("?from=2026-11-06&to=2026-11-01")).status, 400);
  indexDown = true;
  assert.equal((await get("")).status, 502);
  indexDown = false;
  balanceFails = true;
  assert.equal((await get("")).status, 502);
  balanceFails = false;
  const saved = process.env.MERCHANT_PAY_ADDRESS;
  delete process.env.MERCHANT_PAY_ADDRESS;
  try {
    assert.equal((await get("")).status, 503);
  } finally {
    process.env.MERCHANT_PAY_ADDRESS = saved;
  }
});
