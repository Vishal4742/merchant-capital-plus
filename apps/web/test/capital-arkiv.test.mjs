// Capital offers on Arkiv (batch 023, claude-relayer): mcplus.offer.v1 terms from the chain, the Buy gate (FR-ARK-3),
// publish rules (FR-ARK-1/5) and an Arkiv outage that never hides the book.
import { test } from "node:test";
import assert from "node:assert/strict";

const arkiv = await import("../lib/server/capital-arkiv.ts");

const NOW = Math.floor(Date.now() / 1000);
const M = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const OTHER = "0x1111111111111111111111111111111111111111";
const offer = (o = {}) => ({ claimId: 1n, kind: "advance", merchant: M, offerDeadline: NOW + 3600, bps: 2000, cancelled: false, settled: false, invoiceId: 0n, face: 110_000_000n, price: 100_000_000n, maturity: NOW + 30 * 86400, sold: 0n, ...o });
const tuple = (o) => [o.kind === "advance" ? 2 : 1, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];

function fakes({ offers = { 1: offer() }, rows = [], failRows = false } = {}) {
  const writes = [];
  const read = async (req) => {
    if (req.functionName === "offerCount") return BigInt(Object.keys(offers).length);
    if (req.functionName === "offers") { const o = offers[String(req.args[0])]; return o ? tuple(o) : [0, OTHER, 0n, 0, false, false, 0n, 0n, 0n, 0n, 0n]; }
    throw new Error(`unexpected ${req.functionName}`);
  };
  const store = {
    rows: async () => { if (failRows) throw new Error("Arkiv down at https://rabdi/SECRET-KEY"); return rows; },
    create: async (values, expiresAt) => { writes.push({ create: values, expiresAt }); return "0xnew"; },
    patch: async (key, values) => { writes.push({ patch: key, values }); },
  };
  return { deps: { read, arkiv: store }, writes };
}
const rowOf = (o, key = "0xk1") => ({ entityKey: key, terms: arkiv.offerTerms(o) });

test("the Arkiv terms come from the chain, in ARCHITECTURE §5's names, with no personal data (FR-ARK-4)", () => {
  const t = arkiv.offerTerms(offer({ sold: 10_000_000n }));
  assert.deepEqual(Object.keys(t).sort(), ["aprBps", "chainId", "claimId", "deadline", "faceUsdt", "holdbackBps", "kind", "market", "maturity", "merchant", "priceUsdt", "remainingUsdt", "sector", "status"]);
  assert.equal(t.faceUsdt, "110000000");
  assert.equal(t.remainingUsdt, "100000000");
  assert.equal(t.merchant, M.toLowerCase());
  assert.equal(t.status, "open");
});

test("Buy is enabled only when every Arkiv term equals the chain (FR-ARK-3); state fields may lag", () => {
  const o = offer();
  assert.equal(arkiv.matches(o, arkiv.offerTerms(o)), true);
  for (const [field, value] of [["priceUsdt", "90000000"], ["faceUsdt", "1"], ["merchant", OTHER.toLowerCase()], ["deadline", "1"], ["maturity", "1"], ["holdbackBps", "1"], ["kind", "invoice"], ["claimId", "2"], ["market", OTHER.toLowerCase()], ["chainId", "1"]]) {
    assert.equal(arkiv.matches(o, { ...arkiv.offerTerms(o), [field]: value }), false, field);
  }
  assert.equal(arkiv.matches(offer({ sold: 5n }), arkiv.offerTerms(o)), true, "a funding the mirror hasn't caught up with yet doesn't disable Buy");
});

test("the book joins chain offers with our Arkiv entities; an offer missing from Arkiv shows matches false", async () => {
  const { deps } = fakes({ offers: { 1: offer(), 2: offer({ claimId: 2n, price: 90_000_000n }) }, rows: [rowOf(offer()), rowOf(offer({ claimId: 2n }), "0xk2")] });
  const book = await arkiv.offerBook(deps);
  assert.deepEqual(book.map((o) => [o.id, o.arkiv]), [["1", { entity_key: "0xk1", matches: true }], ["2", { entity_key: "0xk2", matches: false }]]);
});

test("an Arkiv outage keeps the book on screen with Buy disabled, and the error never leaks", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...a) => logged.push(a.join(" ")));
  process.env.ARKIV_ACCESS_KEY = "SECRET-KEY";
  const { deps } = fakes({ failRows: true });
  const book = await arkiv.offerBook(deps);
  assert.equal(book.length, 1);
  assert.deepEqual(book[0].arkiv, { entity_key: null, matches: false });
  assert.ok(logged.length === 1);
  assert.doesNotMatch(logged[0], /SECRET-KEY/, "the access key is redacted from the log");
  delete process.env.ARKIV_ACCESS_KEY;
});

test("publish: only the offer's merchant; creates once with expiry = deadline, then patches (FR-ARK-1, FR-ARK-5)", async () => {
  const fresh = fakes();
  await assert.rejects(arkiv.publishOffer(OTHER, 1n, fresh.deps), (e) => e.status === 403);
  await assert.rejects(arkiv.publishOffer(M, 9n, fresh.deps), (e) => e.status === 404);
  assert.deepEqual(await arkiv.publishOffer(M, 1n, fresh.deps), { entity_key: "0xnew" });
  assert.equal(fresh.writes[0].expiresAt, NOW + 3600);
  const again = fakes({ rows: [rowOf(offer())] });
  assert.deepEqual(await arkiv.publishOffer(M, 1n, again.deps), { entity_key: "0xk1" });
  assert.equal(again.writes[0].patch, "0xk1");
});

test("publish refuses a cancelled or expired offer that isn't on Arkiv yet", async () => {
  const cancelled = fakes({ offers: { 1: offer({ cancelled: true }) } });
  await assert.rejects(arkiv.publishOffer(M, 1n, cancelled.deps), (e) => e.status === 409);
  const expired = fakes({ offers: { 1: offer({ offerDeadline: NOW - 5 }) } });
  await assert.rejects(arkiv.publishOffer(M, 1n, expired.deps), (e) => e.status === 409);
});

test("publish and the book pick the same row for a claim, and an unchanged offer isn't rewritten (security F2, F5)", async () => {
  const o = offer();
  const ours = rowOf(o, "0xours");
  const stale = { entityKey: "0xstale", terms: { ...arkiv.offerTerms(o), priceUsdt: "1" } };
  const w = fakes({ rows: [ours, stale] });
  const book = await arkiv.offerBook(w.deps);
  const published = await arkiv.publishOffer(M, 1n, w.deps);
  assert.equal(book[0].arkiv.entity_key, published.entity_key, "one rule picks the row in both places");
  assert.equal(w.writes.length, 0, "the terms already match: no Arkiv write");
});

test("Arkiv write failures reach the client as a fixed message, never the SDK's text", async () => {
  const w = fakes();
  w.deps.arkiv.create = async () => { throw new Error("rpc https://rabdi/abc-internal failed"); };
  await assert.rejects(arkiv.publishOffer(M, 1n, w.deps), (e) => e.status === 502 && !/rabdi|internal/.test(e.message));
});
