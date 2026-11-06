// POST /api/v1/capital/fund (batch 023): gasless investor funding through the relayer's fund action (FR-ADV-3).
// Checked before relaying (eligible investor, open offer, units left); the relayer's answers become plain messages.
import { test } from "node:test";
import assert from "node:assert/strict";

const { fundOffer } = await import("../lib/server/capital-fund.ts");
const { BUSY, UNKNOWN, NOT_FUNDED } = await import("../lib/relay.ts");

const NOW = Math.floor(Date.now() / 1000);
const M = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const INVESTOR = "0x2222222222222222222222222222222222222222";
const TX = `0x${"ab".repeat(32)}`;
const body = { claim_id: "1", investor: INVESTOR, units: "10000000", valid_after: "0", valid_before: String(NOW + 600), salt: `0x${"cd".repeat(32)}`, sig: `0x${"11".repeat(65)}` };
const offer = (o = {}) => ({ kind: 2, merchant: M, offerDeadline: NOW + 3600, bps: 2000, cancelled: false, settled: false, invoiceId: 0n, face: 110_000_000n, price: 100_000_000n, maturity: NOW + 86400 * 30, sold: 0n, ...o });
const tuple = (o) => [o.kind, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];

function world({ o = offer(), eligible = true, reply = { status: 200, json: { txHash: TX, blockNumber: "123" } }, throws } = {}) {
  const posts = [];
  const scheduled = [];
  const read = async (req) => {
    if (req.functionName === "offers") return tuple(o);
    if (req.functionName === "canReceive") return eligible;
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
  assert.deepEqual(w.posts[0].body, { action: "fund", args: { claimId: "1", investor: INVESTOR, units: "10000000", validAfter: "0", validBefore: body.valid_before, salt: body.salt }, sig: body.sig });
  assert.equal(new Headers(w.posts[0].init.headers).get("x-relay-secret"), "s3cret");
  assert.equal(w.posts[0].init.redirect, "manual");
  assert.equal(w.scheduled.length, 1, "FR-ARK-5: the offer's Arkiv status is refreshed after the response");
});

test("the relay secret never goes over plain http to another host", async () => {
  const w = world();
  await fundOffer(body, { ...w.deps, relayerUrl: "http://relayer.test" });
  assert.equal(new Headers(w.posts[0].init.headers).get("x-relay-secret"), null);
});

test("refused before any relay: not a verified investor (403), offer not open (409), more units than left (400)", async () => {
  for (const [opts, status] of [[{ eligible: false }, 403], [{ o: offer({ cancelled: true }) }, 409], [{ o: offer({ offerDeadline: NOW - 1 }) }, 409], [{ o: offer({ sold: 105_000_000n }) }, 400]]) {
    const w = world(opts);
    await assert.rejects(fundOffer(body, w.deps), (e) => e.status === status && e.message.length > 0, JSON.stringify(Object.keys(opts)));
    assert.equal(w.posts.length, 0);
  }
});

test("the relayer's refusals become the web's plain messages", async () => {
  const cases = [
    [{ reply: { status: 422, json: { code: "insufficient_funds" } } }, 400, NOT_FUNDED],
    [{ reply: { status: 422, json: { code: "bad_signature" } } }, 400, /approval didn't work/],
    [{ reply: { status: 503, json: { code: "gas_price_cap" } } }, 503, BUSY],
    [{ reply: { status: 429, json: { code: "rate_limited" } } }, 503, BUSY],
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
