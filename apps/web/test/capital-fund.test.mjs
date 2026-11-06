// POST /api/v1/capital/fund (batch 023): gasless investor funding through the relayer's fund action (FR-ADV-3).
// Checked before relaying (eligible investor, open offer, units left); the relayer's answers become plain messages.
import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeAbiParameters, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { fundOffer } = await import("../lib/server/capital-fund.ts");
const { BUSY, UNKNOWN, NOT_FUNDED } = await import("../lib/relay.ts");
const { usdtDomain, receiveTypes } = await import("../lib/usdt.ts");

const NOW = Math.floor(Date.now() / 1000);
const M = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const investorKey = privateKeyToAccount(generatePrivateKey());
const INVESTOR = investorKey.address;
const MARKET = "0xecd63a369d23dfddc6bfac921e41a86760c20abe";
const TX = `0x${"ab".repeat(32)}`;
// CapitalMarket.fundingNonce = keccak256(abi.encode(chainid, market, claimId, investor, units, salt)), written out
// here independently of lib/server/capital.ts; value = quote(claimId, units) = ceil(units × price / face)
const nonceOf = (claimId, units, salt) => keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }], [1874n, MARKET, claimId, INVESTOR, units, salt]));
async function signed({ units = 11_000_000n, validBefore = BigInt(NOW + 600), salt = `0x${"cd".repeat(32)}`, signer = investorKey, value } = {}) {
  const cost = value ?? (units * 10_000_000n + 11_000_000n - 1n) / 11_000_000n;
  const sig = await signer.signTypedData({ domain: usdtDomain, types: receiveTypes, primaryType: "ReceiveWithAuthorization", message: { from: INVESTOR, to: MARKET, value: cost, validAfter: 0n, validBefore, nonce: nonceOf(1n, units, salt) } });
  return { claim_id: "1", investor: INVESTOR, units: units.toString(), valid_after: "0", valid_before: validBefore.toString(), salt, sig };
}
const body = await signed();
const offer = (o = {}) => ({ kind: 2, merchant: M, offerDeadline: NOW + 3600, bps: 2000, cancelled: false, settled: false, invoiceId: 0n, face: 11_000_000n, price: 10_000_000n, maturity: NOW + 86400 * 30, sold: 0n, ...o }); // the G5 advance
const tuple = (o) => [o.kind, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];

function world({ o = offer(), eligible = true, holders = [], reply = { status: 200, json: { txHash: TX, blockNumber: "123" } }, throws } = {}) {
  const posts = [];
  const scheduled = [];
  const read = async (req) => {
    if (req.functionName === "offers") return tuple(o);
    if (req.functionName === "canReceive") return eligible;
    if (req.functionName === "holdersOf") return holders;
    if (req.functionName === "quote") return (req.args[1] * o.price + o.face - 1n) / o.face;
    throw new Error(`unexpected ${req.functionName}`);
  };
  const fetch = async (url, init) => {
    posts.push({ url: String(url), init, body: JSON.parse(init.body) });
    if (throws) throw throws;
    return Response.json(reply.json, { status: reply.status, headers: reply.headers });
  };
  return { deps: { read, fetch, relayerUrl: "https://relayer.test", secret: "s3cret", schedule: (task) => scheduled.push(task) }, posts, scheduled };
}

test("a valid funding is relayed once as the fund action and answers {tx_hash, block_number}; Arkiv syncs after", async () => {
  const w = world();
  assert.deepEqual(await fundOffer(body, w.deps), { tx_hash: TX, block_number: "123" });
  assert.equal(w.posts.length, 1);
  assert.equal(w.posts[0].url, "https://relayer.test/relay");
  assert.deepEqual(w.posts[0].body, { action: "fund", args: { claimId: "1", investor: INVESTOR, units: "11000000", validAfter: "0", validBefore: body.valid_before, salt: body.salt }, sig: body.sig });
  assert.equal(new Headers(w.posts[0].init.headers).get("x-relay-secret"), "s3cret");
  assert.equal(w.posts[0].init.redirect, "manual");
  assert.equal(w.scheduled.length, 1, "FR-ARK-5: the offer's Arkiv status is refreshed after the response");
});

test("the relay secret never goes over plain http to another host", async () => {
  const w = world();
  await fundOffer(body, { ...w.deps, relayerUrl: "http://relayer.test" });
  assert.equal(new Headers(w.posts[0].init.headers).get("x-relay-secret"), null);
});

test("a funding below the relayer's 1 USDT minimum is refused with the reason, before any relay", async () => {
  const w = world();
  await assert.rejects(fundOffer({ ...body, units: "1000" }, w.deps), (e) => e.status === 400 && /1\.00 USDT/.test(e.message));
  assert.equal(w.posts.length, 0);
});

test("refused before any relay: not a verified investor (403), offer not open (409), more units than left (400)", async () => {
  for (const [opts, status] of [[{ eligible: false }, 403], [{ o: offer({ cancelled: true }) }, 409], [{ o: offer({ offerDeadline: NOW - 1 }) }, 409], [{ o: offer({ sold: 5_000_000n }) }, 400]]) {
    const w = world(opts);
    await assert.rejects(fundOffer(body, w.deps), (e) => e.status === status && e.message.length > 0, JSON.stringify(Object.keys(opts)));
    assert.equal(w.posts.length, 0);
  }
});

test("a signature that isn't the investor's authorization for exactly this funding never reaches the relayer (400)", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  for (const bad of [
    { ...body, sig: `0x${"11".repeat(65)}` }, // junk
    await signed({ signer: other }), // someone else's key
    { ...(await signed({ units: 5_000_000n })), units: "11000000" }, // signed for other units
    await signed({ value: 1_000_000n }), // signed for another amount
  ]) {
    const w = world();
    await assert.rejects(fundOffer(bad, w.deps), (e) => e.status === 400, bad.sig.slice(0, 12));
    assert.equal(w.posts.length, 0);
  }
});

test("an invoice claim takes at most 2 investors, so its repayment fits the relayer's gas (claude-research 10:59, contracts Q19)", async () => {
  const inv = offer({ kind: 1, invoiceId: 4n, bps: 0 });
  const two = ["0x5555555555555555555555555555555555555555", "0x6666666666666666666666666666666666666666"];
  const third = world({ o: inv, holders: two });
  await assert.rejects(fundOffer(body, third.deps), (e) => e.status === 409 && /2 investors/.test(e.message));
  assert.equal(third.posts.length, 0);
  assert.deepEqual(await fundOffer(body, world({ o: inv, holders: [two[0], INVESTOR] }).deps), { tx_hash: TX, block_number: "123" }, "an existing holder can add units");
  assert.deepEqual(await fundOffer(body, world({ o: inv, holders: [two[0]] }).deps), { tx_hash: TX, block_number: "123" }, "a second holder is fine");
});

test("an advance takes 1 investor: a second one is refused before any relay; the holder can add units (contracts 11:26)", async () => {
  const other = world({ holders: ["0x5555555555555555555555555555555555555555"] });
  await assert.rejects(fundOffer(body, other.deps), (e) => e.status === 409 && /1 investor/.test(e.message));
  assert.equal(other.posts.length, 0);
  assert.deepEqual(await fundOffer(body, world({ holders: [INVESTOR] }).deps), { tx_hash: TX, block_number: "123" });
  assert.deepEqual(await fundOffer(body, world({ holders: [] }).deps), { tx_hash: TX, block_number: "123" });
});

test("whoever takes a claim's last free investor slot buys everything left, so a small slice can't lock it (human 12:2x)", async () => {
  const part = await signed({ units: 4_000_000n });
  const advance = world(); // cap 1: the first investor is the last slot
  await assert.rejects(fundOffer(part, advance.deps), (e) => e.status === 400 && /11000000/.test(e.message));
  assert.equal(advance.posts.length, 0);
  const inv = (holders) => world({ o: offer({ kind: 1, invoiceId: 4n, bps: 0 }), holders });
  assert.deepEqual(await fundOffer(part, inv([]).deps), { tx_hash: TX, block_number: "123" }, "an invoice's first of 2 slots may buy part");
  await assert.rejects(fundOffer(part, inv(["0x5555555555555555555555555555555555555555"]).deps), (e) => e.status === 400, "its second (last) slot buys the rest");
  assert.deepEqual(await fundOffer(part, inv([INVESTOR]).deps), { tx_hash: TX, block_number: "123" }, "an existing holder tops up freely");
});

test("a validBefore outside the relayer's 30 s – 15 min window is refused before any read or relay", async () => {
  for (const validBefore of [BigInt(NOW + 10), BigInt(NOW + 1000)]) {
    const w = world();
    await assert.rejects(fundOffer(await signed({ validBefore }), w.deps), (e) => e.status === 400 && /window/i.test(e.message));
    assert.equal(w.posts.length, 0);
  }
});

test("the relayer's refusals become the web's plain messages", async () => {
  const cases = [
    [{ reply: { status: 422, json: { code: "insufficient_funds" } } }, 400, NOT_FUNDED],
    [{ reply: { status: 422, json: { code: "bad_signature" } } }, 400, /approval didn't work/],
    [{ reply: { status: 422, json: { code: "replay" } } }, 409, /already sent/],
    [{ reply: { status: 503, json: { code: "gas_price_cap" } } }, 503, BUSY],
    [{ reply: { status: 429, json: { code: "rate_limited" } } }, 503, BUSY],
    // batch 031 round 3 (A10): the relayer's temporary payer cooldown gets its own message, not "busy"
    [{ reply: { status: 429, json: { code: "payer_cooldown", retry_after_s: 120 } } }, 429, /paused for about 2 minutes.*Nothing was charged/],
    [{ reply: { status: 403, json: {}, headers: { "x-vercel-mitigated": "challenge" } } }, 503, BUSY],
    [{ reply: { status: 502, json: { code: "rpc_error", txHash: TX } } }, 504, UNKNOWN],
    [{ throws: new Error("socket hang up") }, 504, UNKNOWN],
  ];
  for (const [opts, status, message] of cases) {
    const w = world(opts);
    await assert.rejects(fundOffer(body, w.deps), (e) => e.status === status && (typeof message === "string" ? e.message === message : message.test(e.message)), JSON.stringify(opts));
    assert.equal(w.scheduled.length, 0);
  }
});
