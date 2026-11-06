// Batch 036 (Capital tab, merchant view /merchant/capital): the form rules that mirror CapitalMarket's BadTerms, the
// cost and price math in bigint, the M1 advance state from GET /merchant's data, and the publish call.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { toEventSignature, toFunctionSignature } from "viem";

const m = await import("../components/capital/merchant/terms.ts");
const server = await import("../lib/server/capital.ts");
const shared = await import("../../../packages/shared/contracts.ts");

// 2026-11-07 00:30 IST
const NOW = Date.UTC(2026, 10, 6, 19, 0) / 1000;
const DAY = 86_400;
const AT3 = { principal: "10", cap: "11", holdback: "20", termDays: "30" };

test("the copied CapitalMarket fragments and address match packages/shared and the server", () => {
  assert.equal(m.CAPITAL_MARKET.toLowerCase(), shared.addresses.capitalMarket.toLowerCase());
  assert.equal(m.CAPITAL_MARKET.toLowerCase(), server.CAPITAL_MARKET.toLowerCase());
  for (const f of m.listingAbi) {
    const real = shared.capitalMarketAbi.find((x) => x.type === f.type && x.name === f.name);
    assert.ok(real, `${f.type} ${f.name} is in the shared ABI`);
    if (f.type === "function") {
      assert.equal(toFunctionSignature(f), toFunctionSignature(real), `${f.name} inputs`);
      assert.deepEqual(f.outputs.map((o) => o.type), real.outputs.map((o) => o.type), `${f.name} outputs`);
    } else if (f.type === "event") {
      assert.equal(toEventSignature(f), toEventSignature(real), `${f.name} signature`);
      assert.deepEqual(f.inputs.map((i) => i.indexed ?? false), real.inputs.map((i) => i.indexed), `${f.name} indexed`);
    } else {
      assert.deepEqual(f.inputs.map((i) => i.type), real.inputs.map((i) => i.type), `error ${f.name}`);
    }
  }
  for (const name of ["BadTerms", "AdvanceActive", "InvoiceNotListable", "NotMerchant", "AlreadyFunded", "OfferClosed"]) {
    assert.ok(m.listingAbi.some((x) => x.type === "error" && x.name === name), `${name} decodes`);
    assert.ok(m.CAPITAL_COPY[name], `${name} has copy`);
  }
});

test("percentToBps: up to two decimals, nothing else", () => {
  assert.equal(m.percentToBps("20"), 2000);
  assert.equal(m.percentToBps("12.5"), 1250);
  assert.equal(m.percentToBps(" 12.25 "), 1225);
  assert.equal(m.percentToBps("0"), 0);
  for (const bad of ["", "abc", "12.345", "-1", "1e2", "12,5", "1000"]) assert.equal(m.percentToBps(bad), null, bad);
});

test("advanceTerms: the AT-3 terms pass with the exact listAdvance arguments", () => {
  const r = m.advanceTerms({ ...AT3, deadline: NOW + DAY }, NOW);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, { principal: 10_000_000n, cap: 11_000_000n, holdbackBps: 2000, term: 2_592_000n, offerDeadline: BigInt(NOW + DAY) });
  assert.equal(m.advanceTerms({ ...AT3, cap: "10", deadline: NOW + DAY }, NOW).ok, true, "cap == principal is allowed");
  assert.equal(m.advanceTerms({ ...AT3, holdback: "30", deadline: NOW + DAY }, NOW).ok, true, "30% is the limit, allowed");
});

test("advanceTerms mirrors BadTerms and the offer-book limits, one sentence each", () => {
  const error = (over, deadline = NOW + DAY) => {
    const r = m.advanceTerms({ ...AT3, deadline, ...over }, NOW);
    assert.equal(r.ok, false, JSON.stringify(over));
    return r.error;
  };
  assert.match(error({ principal: "" }), /principal as an amount/i);
  assert.match(error({ principal: "0" }), /principal as an amount/i);
  assert.match(error({ principal: "0.5" }), /1\.00 to 1,000\.00/);
  assert.match(error({ principal: "1000.01" }), /1\.00 to 1,000\.00/);
  assert.match(error({ cap: "abc" }), /cap as an amount/i);
  assert.match(error({ cap: "9.99" }), /at least the principal/i);
  assert.match(error({ cap: "1000.01" }), /at least the principal/i);
  assert.match(error({ holdback: "0" }), /above 0% and at most 30%/);
  assert.match(error({ holdback: "30.01" }), /above 0% and at most 30%/);
  assert.match(error({ holdback: "x" }), /percent like 20/);
  assert.match(error({ termDays: "0" }), /1 to 180 days/);
  assert.match(error({ termDays: "181" }), /1 to 180 days/);
  assert.match(error({ termDays: "2.5" }), /1 to 180 days/);
  assert.match(error({}, NOW), /deadline in the future/);
  assert.match(error({}, NOW - 1), /deadline in the future/);
  assert.match(error({ termDays: "1" }, NOW + 2 * DAY), /before the term ends/);
});

test("advanceCostLine: the total cost before signing (FR-ADV-6)", () => {
  assert.equal(m.advanceCostLine(10_000_000n, 11_000_000n, 2000), "When investors fund it, you get 10.00 USDT. You repay 11.00 USDT (cost 1.00 USDT) from 20% of each sale until it's repaid.");
  assert.equal(m.advanceCostLine(10_000_000n, 10_000_000n, 1250), "When investors fund it, you get 10.00 USDT. You repay 10.00 USDT (cost 0.00 USDT) from 12.5% of each sale until it's repaid.");
});

test("priceFromApr: the G3 formula, floor, bigint", () => {
  assert.equal(m.priceFromApr(100_000_000n, 1200, 60), 98_065_556n, "chain offers(2).price");
  assert.equal(m.priceFromApr(100_000_000n, 1200, 61), 98_033_949n);
  assert.equal(m.priceFromApr(100_000_000n, 1200, 1), 99_967_134n);
  assert.equal(m.priceFromApr(100_000_000n, 0, 60), 100_000_000n, "APR 0 is face: the form refuses it");
});

test("daysToDue: IST calendar days, so an end-of-day due date isn't a day long", () => {
  const due = Date.UTC(2027, 0, 6, 18, 29, 59) / 1000; // 2027-01-06 23:59:59 IST, 60 days after 2026-11-07
  assert.equal(m.daysToDue(due, NOW), 60, "00:30 IST");
  assert.equal(m.daysToDue(due, Date.UTC(2026, 10, 7, 18, 0) / 1000), 60, "23:30 IST, same day");
  assert.equal(m.daysToDue(NOW + 60 * DAY, NOW + 60), 60, "due exactly now + 60 days, listed a minute later");
  assert.equal(m.daysToDue(NOW + 3600, NOW), 0, "due later today");
});

test("invoiceTerms: AT-6 prices 98.065556 for 60 days at 12% and lists with recourse 0", () => {
  const due = Date.UTC(2027, 0, 6, 18, 29, 59) / 1000;
  const r = m.invoiceTerms({ face: 100_000_000n, dueDate: due, apr: "12", deadline: NOW + DAY }, NOW);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, { price: 98_065_556n, offerDeadline: BigInt(NOW + DAY), days: 60, aprBps: 1200 });
  assert.equal(m.invoicePriceLine(98_065_556n, 100_000_000n, 60, 1200), "Investors pay 98.065556 USDT now for 100.00 USDT due in 60 days (12.00% APR).");
  assert.equal(m.invoicePriceLine(99_967_134n, 100_000_000n, 1, 1200), "Investors pay 99.967134 USDT now for 100.00 USDT due in 1 day (12.00% APR).");
});

test("invoiceTerms mirrors listInvoice's rules: price below face, deadline a minute before the due date", () => {
  const due = NOW + 60 * DAY;
  const error = (over) => {
    const r = m.invoiceTerms({ face: 100_000_000n, dueDate: due, apr: "12", deadline: NOW + DAY, ...over }, NOW);
    assert.equal(r.ok, false, JSON.stringify(over));
    return r.error;
  };
  assert.match(error({ apr: "0" }), /APR above 0%/);
  assert.match(error({ apr: "" }), /APR above 0%/);
  assert.match(error({ apr: "100.01" }), /at most 100%/);
  assert.match(error({ dueDate: NOW + 3600, deadline: NOW + 60 }), /due today/);
  assert.match(error({ dueDate: NOW + 181 * DAY }), /180 days/);
  assert.match(error({ deadline: NOW }), /deadline in the future/);
  assert.match(error({ deadline: due - 59 }), /a minute before the invoice is due/);
  assert.equal(m.invoiceTerms({ face: 100_000_000n, dueDate: due, apr: "12", deadline: due - 60 }, NOW).ok, true, "due − 60 is the limit");
  assert.match(error({ face: 1n, apr: "1" }), /price isn't above 0/, "a price that rounds to 0 is refused");
});

const offer = (o = {}) => ({ id: "3", kind: "advance", face: "11.00", price: "10.00", units_left: "11000000", status: "open", holdback_pct: 20, offer_deadline: "2026-11-08T00:00:00.000Z", maturity: "2026-12-07T00:00:00.000Z", arkiv: { entity_key: "0xabc", matches: true, terms: null }, ...o });
const running = (o = {}) => ({ claim_id: "3", outstanding: "0.00", cap: "11.00", holdback_pct: 20, ...o });

test("advanceState: open, expired, repaying, repaid, none (FR-ADV-2, FR-ADV-5)", () => {
  assert.deepEqual(m.advanceState(null, []), { kind: "none" });
  assert.equal(m.advanceState(running(), [offer()]).kind, "open", "listed, nobody funded, still in the book");
  assert.equal(m.advanceState(running(), []).kind, "expired", "unfunded and gone from the book: past its deadline");
  const repaying = m.advanceState(running({ outstanding: "10.00" }), [offer({ units_left: "0", status: "funded" })]);
  assert.deepEqual(repaying, { kind: "repaying", claimId: "3", cap: 11_000_000n, outstanding: 10_000_000n, repaid: 1_000_000n, holdbackPct: 20 });
  assert.equal(m.advanceState(running({ outstanding: "10.00" }), []).repaid, null, "sold unknown off the book: shown as —");
  const repaid = m.advanceState(null, [offer({ id: "1", status: "closed", units_left: "0" }), offer({ id: "2", status: "closed", units_left: "0" }), offer({ id: "5", kind: "invoice", status: "closed" })]);
  assert.deepEqual(repaid, { kind: "repaid", claimId: "2" }, "the newest settled advance, never an invoice");
});

test("offerLabel: what each of my offers says", () => {
  assert.equal(m.offerLabel(offer()), "Open");
  assert.equal(m.offerLabel(offer({ units_left: "4400000" })), "Open · 60% funded");
  assert.equal(m.offerLabel(offer({ status: "funded", units_left: "0" })), "Repaying");
  assert.equal(m.offerLabel(offer({ kind: "invoice", status: "funded", units_left: "0" })), "Funded");
  assert.equal(m.offerLabel(offer({ status: "closed" })), "Repaid");
  assert.equal(m.soldUnits(offer({ units_left: "4400000" })), 6_600_000n);
});

test("publishOffer: POSTs the claim id, returns the entity key, and passes the server's sentence on", async () => {
  const calls = [];
  const ok = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ entity_key: "0xfeed" }), { status: 200 });
  };
  assert.equal(await m.publishOffer("7", ok), "0xfeed");
  assert.equal(calls[0].url, "/api/v1/capital/offers/7/publish");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json", "a JSON POST: a cross-site form can't send it");
  const refused = async () => new Response(JSON.stringify({ error: "Arkiv refused or timed out. Try again in a minute." }), { status: 502 });
  await assert.rejects(m.publishOffer("7", refused), /Arkiv refused or timed out/);
  const garbled = async () => new Response("<html>", { status: 500 });
  await assert.rejects(m.publishOffer("7", garbled), /isn't in the offer book yet/);
  const offline = async () => {
    throw new TypeError("fetch failed: https://internal.example");
  };
  await assert.rejects(m.publishOffer("7", offline), (e) => !/internal\.example/.test(e.message) && /offer book/.test(e.message));
  await assert.rejects(m.publishOffer("7/../x", ok), /claim/i, "only a decimal claim id goes in the path");
});
