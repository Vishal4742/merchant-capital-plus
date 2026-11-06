// Batch 015 Builder Y: a single-use link is paid at most once (SRS FR-GW-1, G4 review M3). claimAmountDue claims the
// checkout under a per-link lock and refuses (410) while another checkout of the same single-use link is paid or was
// claimed within FREEZE_MS; releaseHold gives the claim back. Real SQL on PGlite; the races run in order.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-single-use.test.mjs
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, MERCHANT } from "./gw-helpers.mjs";

const { claimAmountDue, releaseHold, applyVoucher, FREEZE_MS } = await import("../lib/server/vouchers.ts");
const { recordCheckout, markCheckoutPaid } = await import("../lib/server/checkouts.ts");
const { query } = await import("../lib/server/db.ts");

const DAY = 24 * 60 * 60 * 1000;
const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const PAID_ONCE = { status: 410, message: "This payment link has already been paid." };
const t = Date.now();

async function link(id, singleUse) {
  await query(
    "INSERT INTO app_gw_links (id, slug, merchant, amount, currency, description, single_use, created_at) VALUES ($1, $2, $3, $4, 'USDT', 'Invoice 7', $5, $6)",
    [id, `slug_${id}`, MERCHANT, USDT(25).toString(), singleUse, t],
  );
}
let n = 0;
async function checkout(refId, kind = "link") {
  const id = `ses_su_${++n}`;
  await recordCheckout(id, kind, refId, MERCHANT, USDT(25), { now: t });
  return id;
}
const claimedAt = async (s) => (await query("SELECT claimed_at::text FROM app_gw_checkouts WHERE session_id = $1", [s]))[0].claimed_at;
const frozenAt = async (s) => (await query("SELECT frozen_at::text FROM app_gw_redemptions WHERE session_id = $1", [s]))[0].frozen_at;

before(setupDb);
beforeEach(() => resetDb());

test("FREEZE_MS is the relayer's 15-min signature window + 5 min", () => {
  assert.equal(FREEZE_MS, 20 * 60_000);
});

test("A claims, then B's claim of the same single-use link is refused (410) and freezes nothing", async () => {
  await link("lnk_once", true);
  await link("lnk_other", true);
  await query("INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, created_at) VALUES ('v_half', $1, 'HALF', 'percent', 50, $2, 1, $3)", [MERCHANT, t + DAY, t]);
  const [a, b, c] = [await checkout("lnk_once"), await checkout("lnk_once"), await checkout("lnk_other")];
  assert.equal((await applyVoucher(MERCHANT, "HALF", b, USDT(25), t)).ok, true, "B holds a code");
  assert.equal(await claimAmountDue(a, t + 1000), USDT(25));
  assert.equal(Number(await claimedAt(a)), t + 1000);
  await assert.rejects(claimAmountDue(b, t + 2000), PAID_ONCE);
  assert.equal(await claimedAt(b), null, "a refused claim isn't recorded");
  assert.equal(await frozenAt(b), null, "a refused claim doesn't freeze B's voucher hold (holds count exactly)");
  assert.equal(await claimAmountDue(a, t + 3000), USDT(25), "A's own retry still claims");
  assert.equal(await claimAmountDue(c, t + 3000), USDT(25), "another single-use link isn't blocked");
  await assert.rejects(claimAmountDue(b, t + 3000 + FREEZE_MS - 1), PAID_ONCE, "A is mid-payment for FREEZE_MS");
});

test("A paid: B is refused for good, and a paid checkout can't be claimed again", async () => {
  await link("lnk_once", true);
  const [a, b] = [await checkout("lnk_once"), await checkout("lnk_once")];
  assert.equal(await claimAmountDue(a, t), USDT(25));
  assert.equal(await markCheckoutPaid(a, t + 1000), true);
  await assert.rejects(claimAmountDue(b, t + 2000), PAID_ONCE);
  await assert.rejects(claimAmountDue(b, t + 7 * DAY), PAID_ONCE, "paid never lapses");
  await assert.rejects(claimAmountDue(a, t + 3000), PAID_ONCE, "A itself is paid");
});

test("a checkout paid without a claim (settled from the chain) also blocks the other checkouts", async () => {
  await link("lnk_once", true);
  const [a, b] = [await checkout("lnk_once"), await checkout("lnk_once")];
  await markCheckoutPaid(a, t);
  await assert.rejects(claimAmountDue(b, t + 1000), PAID_ONCE);
});

test("A released (nothing was sent): B claims, then A is refused while B's claim stands", async () => {
  await link("lnk_once", true);
  const [a, b] = [await checkout("lnk_once"), await checkout("lnk_once")];
  assert.equal(await claimAmountDue(a, t), USDT(25));
  assert.equal(await releaseHold(a), false, "no voucher hold to unfreeze, but the claim is given back");
  assert.equal(await claimedAt(a), null);
  assert.equal(await claimAmountDue(b, t + 1000), USDT(25));
  await assert.rejects(claimAmountDue(a, t + 2000), PAID_ONCE);
});

test("releaseHold leaves a paid checkout's claim alone", async () => {
  await link("lnk_once", true);
  const a = await checkout("lnk_once");
  await claimAmountDue(a, t);
  await markCheckoutPaid(a, t + 1000);
  await releaseHold(a);
  assert.equal(Number(await claimedAt(a)), t);
});

test("an abandoned claim stops blocking FREEZE_MS after it", async () => {
  await link("lnk_once", true);
  const [a, b] = [await checkout("lnk_once"), await checkout("lnk_once")];
  assert.equal(await claimAmountDue(a, t), USDT(25)); // relay timed out, never landed, nobody released it
  await assert.rejects(claimAmountDue(b, t + FREEZE_MS - 1), PAID_ONCE);
  assert.equal(await claimAmountDue(b, t + FREEZE_MS), USDT(25));
  await assert.rejects(claimAmountDue(a, t + FREEZE_MS + 1), PAID_ONCE, "now B is mid-payment");
});

test("a later attempt's claim restarts the window: its own signature may land up to 15 min after it", async () => {
  await link("lnk_once", true);
  const [a, b] = [await checkout("lnk_once"), await checkout("lnk_once")];
  await claimAmountDue(a, t); // attempt 1: unknown outcome, pending until its approval is dead
  const retry = t + 16 * 60_000; // attempt 2 after the pending cleared, inside attempt 1's FREEZE_MS
  assert.equal(await claimAmountDue(a, retry), USDT(25));
  await assert.rejects(claimAmountDue(b, t + FREEZE_MS + 1), PAID_ONCE, "attempt 2 may still land");
  await assert.rejects(claimAmountDue(b, retry + FREEZE_MS - 1), PAID_ONCE);
  assert.equal(await claimAmountDue(b, retry + FREEZE_MS), USDT(25));
});

test("a reusable link and a page: every checkout claims, paid or not", async () => {
  await link("lnk_many", false);
  const [a, b] = [await checkout("lnk_many"), await checkout("lnk_many")];
  assert.equal(await claimAmountDue(a, t), USDT(25));
  assert.equal(await claimAmountDue(b, t), USDT(25));
  await markCheckoutPaid(a, t + 1000);
  const c = await checkout("lnk_many");
  assert.equal(await claimAmountDue(c, t + 2000), USDT(25));
  const [p, q] = [await checkout("pg_1", "page"), await checkout("pg_1", "page")];
  assert.equal(await claimAmountDue(p, t), USDT(25));
  assert.equal(await claimAmountDue(q, t), USDT(25));
  await markCheckoutPaid(p, t + 1000);
  assert.equal(await claimAmountDue(await checkout("pg_1", "page"), t + 2000), USDT(25));
});

test("four checkouts of one single-use link claiming at once: exactly one wins", async () => {
  await link("lnk_once", true);
  const ids = [await checkout("lnk_once"), await checkout("lnk_once"), await checkout("lnk_once"), await checkout("lnk_once")];
  const results = await Promise.allSettled(ids.map((s) => claimAmountDue(s, t)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results.filter((r) => r.status === "rejected")) assert.equal(r.reason.status, 410);
  const [{ k }] = await query("SELECT count(*)::int AS k FROM app_gw_checkouts WHERE claimed_at IS NOT NULL");
  assert.equal(k, 1);
});
