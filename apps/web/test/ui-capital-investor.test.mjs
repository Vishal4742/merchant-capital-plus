// Capital tab, investor view (batch 035): what the investor signs to fund an offer (docs/CAPITAL-TAB.md §2.1), checked
// against the server that verifies it (lib/server/capital-fund.ts), plus the holder-cap last-slot rule (batch 026) and
// the Buy gate (FR-ARK-3). Pure functions only; the wallet calls are browser-only. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const inv = await import("../lib/capital-wallet.ts");
const server = await import("../lib/server/capital.ts");
const { fundOffer } = await import("../lib/server/capital-fund.ts");
const shared = await import("../../../packages/shared/contracts.ts");
const { usdtDomain, receiveTypes } = await import("../lib/usdt.ts");

const NOW = Math.floor(Date.now() / 1000);
const M = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1"; // the demo merchant
const A = "0xC2362c3693E185388E5745BadaffAC38184C6752"; // demo investor A
const B = "0xaf747912b20D4fE6df1B88D4993FccBc7002771B"; // demo investor B
const TX = `0x${"ab".repeat(32)}`;

test("the copied addresses, ABI fragments and holder caps match packages/shared and the server", () => {
  assert.equal(inv.CAPITAL_MARKET.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
  assert.equal(inv.CLAIM_TOKEN.toLowerCase(), shared.addresses.claimToken.toLowerCase());
  assert.equal(inv.CAPITAL_MARKET, server.CAPITAL_MARKET);
  const pin = (mine, theirs) => {
    for (const f of mine) {
      const real = theirs.find((x) => x.type === "function" && x.name === f.name && x.inputs.length === f.inputs.length);
      assert.ok(real, `${f.name} is in the shared ABI`);
      assert.equal(toFunctionSignature(f), toFunctionSignature(real), `${f.name} inputs`);
      assert.deepEqual(f.outputs.map((o) => o.type), real.outputs.map((o) => o.type), `${f.name} outputs`);
    }
  };
  pin(inv.marketAbi, shared.capitalMarketAbi);
  pin(inv.tokenAbi, shared.claimTokenAbi);
  assert.deepEqual(inv.HOLDER_CAP, server.HOLDER_CAP);
  for (const kind of ["advance", "invoice"]) assert.equal(inv.holderCapMessage(kind), server.holderCapMessage(kind));
});

test("fundingNonce matches the chain vector and the server's", () => {
  // chain: CapitalMarket.fundingNonce(2, A, 60000000, 0x00…01) (CAPITAL-TAB §2.1)
  const salt = `0x${"0".repeat(63)}1`;
  assert.equal(inv.fundingNonce(2n, A, 60_000_000n, salt), "0x91151ff3e6e3cc466bac44d1d58ab1e22b3b4de6a7255cea6d25e95d9f571878");
  const other = `0x${"cd".repeat(32)}`;
  assert.equal(inv.fundingNonce(7n, B, 123n, other), server.fundingNonce(7n, B, 123n, other));
});

test("the fund authorization is EIP-3009 ReceiveWithAuthorization on USDT, to CapitalMarket, valid from 0, value = the quote (§2.1)", () => {
  const salt = `0x${"11".repeat(32)}`;
  const t = inv.fundingTypedData({ claimId: 2n, investor: A, units: 60_000_000n, cost: 58_839_334n, salt, validBefore: 1_900_000_000n });
  assert.deepEqual(t.domain, { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" });
  assert.deepEqual(t.domain, usdtDomain);
  assert.deepEqual(t.types, receiveTypes);
  assert.equal(t.primaryType, "ReceiveWithAuthorization");
  assert.deepEqual(t.message, { from: A, to: server.CAPITAL_MARKET, value: 58_839_334n, validAfter: 0n, validBefore: 1_900_000_000n, nonce: inv.fundingNonce(2n, A, 60_000_000n, salt) });
  assert.deepEqual(inv.fundBody({ claimId: 2n, investor: A, units: 60_000_000n, salt, validBefore: 1_900_000_000n }, "0xsig"), {
    claim_id: "2", investor: A, units: "60000000", valid_after: "0", valid_before: "1900000000", salt, sig: "0xsig",
  });
});

// The AT-6 invoice: face 100 USDT at 98.065556, units bought by A then B.
const at6 = (o = {}) => ({ kind: 1, merchant: M, offerDeadline: NOW + 3600, bps: 0, cancelled: false, settled: false, invoiceId: 1n, face: 100_000_000n, price: 98_065_556n, maturity: NOW + 60 * 86400, sold: 0n, ...o });
const tuple = (o) => [o.kind, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];
function world(o, holders = []) {
  const posts = [];
  const read = async (req) => {
    if (req.functionName === "offers") return tuple(o);
    if (req.functionName === "canReceive") return true;
    if (req.functionName === "holdersOf") return holders;
    if (req.functionName === "quote") return (req.args[1] * o.price + o.face - 1n) / o.face;
    throw new Error(`unexpected ${req.functionName}`);
  };
  const fetch = async (url, init) => {
    posts.push(JSON.parse(init.body));
    return Response.json({ txHash: TX, blockNumber: "9" });
  };
  return { deps: { read, fetch, relayerUrl: "https://relayer.test", secret: "s", schedule: () => {} }, posts };
}

test("a funding signed from the browser's typed data passes the server's checks and is relayed (AT-6 A then B)", async () => {
  for (const [units, cost, o, holders] of [
    [60_000_000n, 58_839_334n, at6(), []],
    [40_000_000n, 39_226_223n, at6({ sold: 60_000_000n }), [A]],
  ]) {
    const key = privateKeyToAccount(generatePrivateKey());
    const terms = { claimId: 2n, investor: key.address, units, cost, salt: `0x${"5a".repeat(32)}`, validBefore: BigInt(NOW + 465) };
    const sig = await key.signTypedData(inv.fundingTypedData(terms));
    const w = world(o, holders);
    assert.deepEqual(await fundOffer(inv.fundBody(terms, sig), w.deps), { tx_hash: TX, block_number: "9" });
    assert.equal(w.posts.length, 1);
    assert.equal(w.posts[0].action, "fund");
    assert.equal(w.posts[0].args.units, units.toString());
  }
});

test("a signature over a different value is refused before the relayer", async () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const terms = { claimId: 2n, investor: key.address, units: 60_000_000n, cost: 58_839_333n, salt: `0x${"5a".repeat(32)}`, validBefore: BigInt(NOW + 465) };
  const w = world(at6());
  await assert.rejects(fundOffer(inv.fundBody(terms, await key.signTypedData(inv.fundingTypedData(terms))), w.deps), { status: 400 });
  assert.equal(w.posts.length, 0);
});

test("slotRule: a new investor taking the last free slot buys everything left; a full claim blocks; holders may add", () => {
  const left = 40_000_000n;
  assert.deepEqual(inv.slotRule("advance", [], A, 11_000_000n), { kind: "last", units: 11_000_000n }, "an advance takes one investor");
  assert.deepEqual(inv.slotRule("invoice", [], A, 100_000_000n), { kind: "free" });
  assert.deepEqual(inv.slotRule("invoice", [A], B, left), { kind: "last", units: left }, "B is the invoice's second and last investor");
  assert.deepEqual(inv.slotRule("invoice", [A], A.toLowerCase(), left), { kind: "free" }, "an existing holder may add any amount");
  assert.deepEqual(inv.slotRule("advance", [A], A, 1n), { kind: "free" });
  assert.deepEqual(inv.slotRule("invoice", [A, M], B, left), { kind: "full", message: server.holderCapMessage("invoice") });
  assert.deepEqual(inv.slotRule("advance", [A], B, left), { kind: "full", message: server.holderCapMessage("advance") });
});

test("minUnits is the smallest buy that costs at least 1 USDT (CAPITAL-TAB §4 I2 vectors)", () => {
  assert.equal(inv.minUnits(98_065_556n, 100_000_000n), 1_019_726n);
  assert.equal(inv.minUnits(10_000_000n, 11_000_000n), 1_099_999n);
  const quote = (u, p, f) => (u * p + f - 1n) / f;
  for (const [p, f] of [[98_065_556n, 100_000_000n], [10_000_000n, 11_000_000n], [1_000_000n, 1_000_000n]]) {
    const u = inv.minUnits(p, f);
    assert.ok(quote(u, p, f) >= 1_000_000n && quote(u - 1n, p, f) < 1_000_000n, `${p}/${f}`);
  }
});

const book = (o = {}) => ({ id: "2", kind: "invoice", merchant: M, merchant_name: "Demo shop", principal: null, face: "100.00", price: "98.065556", cap: null, holdback_pct: 0, maturity: new Date((NOW + 60 * 86400) * 1000).toISOString(), offer_deadline: new Date((NOW + 3600) * 1000).toISOString(), units_left: "100000000", status: "open", arkiv: { entity_key: `0x${"e1".repeat(32)}`, matches: true, terms: {} }, ...o });

test("buyBlocker: Buy only for an open offer whose Arkiv terms match the chain, for an eligible wallet that isn't the shop (FR-ARK-3)", () => {
  assert.equal(inv.buyBlocker(book()), null, "anyone may open an open, matching offer before connecting");
  assert.match(inv.buyBlocker(book({ status: "funded" })), /fully funded/i);
  assert.match(inv.buyBlocker(book({ status: "closed" })), /closed/i);
  assert.match(inv.buyBlocker(book({ arkiv: { entity_key: null, matches: false, terms: null } })), /Arkiv/);
  assert.match(inv.buyBlocker(book({ arkiv: { entity_key: "0x1", matches: false, terms: {} } })), /don't match the chain/);
  assert.match(inv.buyBlocker(book(), { account: A, eligible: false }), /waiting for approval/i);
  assert.match(inv.buyBlocker(book(), { account: M.toLowerCase(), eligible: true }), /own offer/);
  assert.equal(inv.buyBlocker(book(), { account: A, eligible: true, holders: [B] }), null);
  assert.equal(inv.buyBlocker(book(), { account: A, eligible: true, holders: [B, M] }), server.holderCapMessage("invoice"));
});

test("amountBlocker: units within what's left, a cost of at least 1 USDT, and enough USDT in the wallet", () => {
  assert.match(inv.amountBlocker(0n, 100n, null, null), /how much/);
  assert.match(inv.amountBlocker(101n, 100n, null, null), /Only 0\.0001 USDT is left/);
  assert.equal(inv.amountBlocker(60_000_000n, 100_000_000n, null, 0n), null, "no verdict on cost before the quote arrives");
  assert.match(inv.amountBlocker(1_000_000n, 100_000_000n, 980_656n, 10n ** 9n), /1\.00 USDT/);
  assert.match(inv.amountBlocker(60_000_000n, 100_000_000n, 58_839_334n, 58_000_000n), /holds 58\.00 USDT, less than the 58\.839334 USDT/);
  assert.equal(inv.amountBlocker(60_000_000n, 100_000_000n, 58_839_334n, 58_839_334n), null);
});

test("fundOutcome: a tx hash is done; 5xx (not 503) or a 200 without a hash is unknown, never 'try again'", () => {
  assert.deepEqual(inv.fundOutcome(200, { tx_hash: TX, block_number: "9" }), { kind: "done", txHash: TX });
  assert.deepEqual(inv.fundOutcome(200, {}), { kind: "unknown" });
  assert.deepEqual(inv.fundOutcome(504, { error: "x" }), { kind: "unknown" });
  assert.deepEqual(inv.fundOutcome(502, {}), { kind: "unknown" });
  assert.deepEqual(inv.fundOutcome(503, { error: "busy" }), { kind: "error", message: "busy" });
  assert.deepEqual(inv.fundOutcome(403, { error: "This wallet isn't a verified investor yet, so it can't buy claims." }), { kind: "error", message: "This wallet isn't a verified investor yet, so it can't buy claims." });
  assert.equal(inv.fundOutcome(400, {}).kind, "error");
  assert.match(inv.UNKNOWN_FUNDING, /Don't fund again/);
});

test("claimsToShow keeps held claims and the ones this browser funded (a repaid claim burns to 0)", () => {
  assert.deepEqual(inv.claimsToShow([1n, 2n, 3n], [0n, 5n, 0n], { 3: "11000000" }), [2n, 3n]);
  assert.deepEqual(inv.claimsToShow([1n], [0n], {}), []);
});

test("aprPercent shows the AT-6 invoice at 12.0% a year over 60 days", () => {
  assert.deepEqual(inv.aprPercent(98_065_556n, 100_000_000n, NOW + 60 * 86400, NOW), { pct: "12.0", days: 60 });
});
