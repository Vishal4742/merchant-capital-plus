// Capital tab server (batch 023, claude-relayer): CapitalMarket + ClaimToken reads behind /api/v1/capital/*.
// claude-contracts' 08:53 API shape; ClaimToken's own check order for the transfer check (FR-TOK-8, AT-8 UI half).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSignature } from "viem";

const capital = await import("../lib/server/capital.ts");
const shared = await import("../../../packages/shared/contracts.ts");

const NOW = 1_800_000_000; // unix s
const M = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1"; // the demo merchant
const OTHER = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";

// offers(id) as viem returns it: [kind, merchant, offerDeadline, bps, cancelled, settled, invoiceId, face, price, maturity, sold]
const advance = (o = {}) => ({ kind: 2, merchant: M, offerDeadline: NOW + 3600, bps: 2000, cancelled: false, settled: false, invoiceId: 0n, face: 110_000_000n, price: 100_000_000n, maturity: NOW + 30 * 86400, sold: 0n, ...o });
const invoice = (o = {}) => ({ ...advance(), kind: 1, bps: 0, invoiceId: 4n, face: 50_000_000n, price: 48_000_000n, ...o });
const tuple = (o) => [o.kind, o.merchant, BigInt(o.offerDeadline), o.bps, o.cancelled, o.settled, o.invoiceId, o.face, o.price, BigInt(o.maturity), o.sold];

function chain({ offers = {}, advanceOf = {}, outstanding = {}, state = {}, eligible = [ALICE, BOB], frozen = {}, balances = {}, holders = {} } = {}) {
  const calls = [];
  const read = async (req) => {
    calls.push(req.functionName);
    const [a, b] = req.args ?? [];
    switch (req.functionName) {
      case "offerCount": return BigInt(Object.keys(offers).length);
      case "offers": { const o = offers[String(a)]; return o ? tuple(o) : [0, "0x0000000000000000000000000000000000000000", 0n, 0, false, false, 0n, 0n, 0n, 0n, 0n]; }
      case "quote": { const o = offers[String(a)]; if (!o) throw new Error("division by zero"); return (b * o.price + o.face - 1n) / o.face; }
      case "advanceOf": return advanceOf[a] ?? 0n;
      case "outstanding": return outstanding[String(a)] ?? 0n;
      case "claimState": return state[String(a)] ?? [0n, false];
      case "canSend": case "canReceive": return eligible.includes(a);
      case "getFrozenTokens": return frozen[`${a}:${b}`] ?? 0n;
      case "balanceOf": return balances[`${a}:${b}`] ?? 0n;
      case "holdersOf": return holders[String(a)] ?? [];
      case "MAX_HOLDERS": return 8n;
      default: throw new Error(`unexpected ${req.functionName}`);
    }
  };
  return { read, calls };
}

test("the copied ABI fragments and addresses match packages/shared/contracts.ts", () => {
  assert.equal(capital.CAPITAL_MARKET.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
  assert.equal(capital.CLAIM_TOKEN.toLowerCase(), shared.addresses.claimToken.toLowerCase());
  const pin = (mine, theirs) => {
    for (const f of mine) {
      const real = theirs.find((x) => x.type === "function" && x.name === f.name && x.inputs.length === f.inputs.length);
      assert.ok(real, `${f.name} is in the shared ABI`);
      assert.equal(toFunctionSignature(f), toFunctionSignature(real), `${f.name} inputs`);
      assert.deepEqual(f.outputs.map((o) => o.type), real.outputs.map((o) => o.type), `${f.name} outputs`);
    }
  };
  pin(capital.capitalAbi, shared.capitalMarketAbi);
  pin(capital.claimAbi, shared.claimTokenAbi);
});

test("the offer book leaves out cancelled and expired-unfunded offers (AT-9) and labels open / funded / closed", async () => {
  const { read } = chain({ offers: {
    1: advance(),
    2: invoice({ sold: 50_000_000n }), // fully funded
    3: advance({ cancelled: true }),
    4: invoice({ offerDeadline: NOW - 1 }), // expired, nothing sold
    5: invoice({ settled: true, sold: 50_000_000n, offerDeadline: NOW - 99 }), // repaid
    6: advance({ offerDeadline: NOW - 1, sold: 10_000_000n }), // expired, partly sold: can't be bought any more
  } });
  const book = (await capital.chainOffers({ read })).map((o) => [o.claimId, capital.offerStatus(o, NOW)]);
  assert.deepEqual(book.filter(([, s]) => s !== null), [[1n, "open"], [2n, "funded"], [5n, "closed"]]);
});

test("an advance's JSON carries principal, cap and holdback_pct; an invoice's carries face; amounts are plain USDT", async () => {
  const { read } = chain({ offers: { 1: advance({ sold: 25_000_000n }), 2: invoice() } });
  const [a, i] = await capital.chainOffers({ read });
  assert.deepEqual(capital.offerJson(a, NOW, { entityKey: "0xabc", matches: true, terms: { claimId: "1" } }), {
    id: "1", kind: "advance", merchant: M, merchant_name: capital.offerJson(a, NOW).merchant_name,
    principal: "100.00", face: "110.00", price: "100.00", cap: "110.00", holdback_pct: 20, // Q12: face always (an advance's face = its cap)
    maturity: new Date((NOW + 30 * 86400) * 1000).toISOString(), offer_deadline: new Date((NOW + 3600) * 1000).toISOString(),
    units_left: "85000000", status: "open", arkiv: { entity_key: "0xabc", matches: true, terms: { claimId: "1" } },
  });
  const inv = capital.offerJson(i, NOW);
  assert.equal(inv.kind, "invoice");
  assert.equal(inv.face, "50.00");
  assert.equal(inv.price, "48.00");
  assert.equal(inv.principal, null);
  assert.equal(inv.cap, null);
  assert.equal(inv.holdback_pct, 0, "Q12: 0 for invoices");
  assert.deepEqual(inv.arkiv, { entity_key: null, matches: false, terms: null }, "not on Arkiv yet: Buy stays disabled");
});

test("quote is CapitalMarket.quote as plain USDT; an unknown offer is a 404", async () => {
  const { read } = chain({ offers: { 1: invoice() } });
  assert.equal(await capital.quoteCost(1n, 10_000_000n, { read }), "9.60");
  await assert.rejects(capital.quoteCost(9n, 1n, { read }), (e) => e.status === 404);
});

test("the transfer check follows ClaimToken's own order and names the first rule that fails", async () => {
  const base = { balances: { [`${ALICE}:1`]: 10n }, holders: { 1: [ALICE] } };
  const check = (opts, amount = 5n, from = ALICE, to = BOB) => capital.transferCheck({ from, to, claimId: 1n, amount }, chain({ ...base, ...opts }));
  assert.deepEqual(await check({}), { allowed: true, reason: null });
  const reasons = [
    [{ state: { 1: [0n, true] }, eligible: [] }, /frozen/i], // frozen beats everything after it
    [{ state: { 1: [1n, false] }, eligible: [] }, /locked/i], // lockFrom long past (the check uses the real clock)
    [{ eligible: [BOB] }, /sender/i],
    [{ eligible: [ALICE] }, /receiver/i],
    [{ frozen: { [`${ALICE}:1`]: 8n } }, /frozen units|unfrozen/i],
    [{ balances: { [`${ALICE}:1`]: 3n } }, /balance/i],
    [{ holders: { 1: [ALICE, ...Array.from({ length: 7 }, (_, n) => `0x${String(n + 4).repeat(40)}`)] } }, /holder/i],
  ];
  for (const [opts, reason] of reasons) {
    const out = await check(opts);
    assert.equal(out.allowed, false, JSON.stringify(opts, (_, v) => (typeof v === "bigint" ? String(v) : v)));
    assert.match(out.reason, reason);
  }
  // the holder cap doesn't apply when the receiver already holds, or the sender moves everything
  assert.equal((await check({ holders: { 1: Array.from({ length: 8 }, (_, n) => `0x${String(n + 1).repeat(40)}`) }, balances: { [`${ALICE}:1`]: 10n, [`${BOB}:1`]: 1n } })).allowed, true);
});

test("an invoice claim takes no 3rd investor by transfer either: the 2-investor cap (security 022 M1)", async () => {
  const two = [ALICE, "0x5555555555555555555555555555555555555555"];
  const opts = { offers: { 1: invoice() }, balances: { [`${ALICE}:1`]: 10n }, holders: { 1: two } };
  const out = await capital.transferCheck({ from: ALICE, to: BOB, claimId: 1n, amount: 5n }, chain(opts));
  assert.equal(out.allowed, false);
  assert.match(out.reason, /2 investors/);
  assert.equal((await capital.transferCheck({ from: ALICE, to: BOB, claimId: 1n, amount: 10n }, chain(opts))).allowed, true, "moving everything keeps it at 2");
  assert.equal((await capital.transferCheck({ from: ALICE, to: BOB, claimId: 1n, amount: 5n }, chain({ ...opts, offers: { 1: advance() } }))).allowed, true, "advances keep the contract's own cap");
});

test("the transfer check reads the lock against the server clock", async () => {
  const later = await capital.transferCheck({ from: ALICE, to: BOB, claimId: 1n, amount: 1n }, { ...chain({ state: { 1: [BigInt(Math.floor(Date.now() / 1000) + 3600), false] }, balances: { [`${ALICE}:1`]: 1n } }) });
  assert.equal(later.allowed, true, "the lock starts in an hour: still movable");
});

test("the merchant view: the running advance with outstanding, cap and holdback; null without one", async () => {
  const { read } = chain({ offers: { 1: advance({ sold: 110_000_000n }), 2: invoice() }, advanceOf: { [M]: 1n }, outstanding: { 1: 66_000_000n } });
  assert.deepEqual(await capital.merchantAdvance(M, { read }), { claim_id: "1", outstanding: "66.00", cap: "110.00", holdback_pct: 20 });
  assert.equal(await capital.merchantAdvance(OTHER, { read }), null);
});

test("fund bodies are checked before any relay: ids and units are uint strings, valid_after is 0, sig is 65 bytes", () => {
  const good = { claim_id: "1", investor: ALICE, units: "10000000", valid_after: "0", valid_before: String(NOW + 600), salt: `0x${"ab".repeat(32)}`, sig: `0x${"11".repeat(65)}` };
  const parsed = capital.parseFundBody(good);
  assert.deepEqual([parsed.claimId, parsed.units, parsed.validBefore], [1n, 10_000_000n, BigInt(NOW + 600)]);
  for (const [field, value] of [["claim_id", "-1"], ["claim_id", "1.5"], ["investor", "0x12"], ["units", "0"], ["valid_after", "5"], ["valid_before", "x"], ["salt", "0x12"], ["sig", "0x12"]]) {
    assert.throws(() => capital.parseFundBody({ ...good, [field]: value }), (e) => e.status === 400 && e.message.length > 0, `${field}=${value}`);
  }
});
