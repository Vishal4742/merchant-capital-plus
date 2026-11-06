// Tester round 2 (batch 007): extra probes of the voucher hold fix (security H1).
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDb, resetDb, signedIn, req, MERCHANT } from "./gw-helpers.mjs";

const { POST: create } = await import("../app/api/v1/vouchers/route.ts");
const { applyVoucher, confirmRedemption } = await import("../lib/server/vouchers.ts");
const { recordCheckout } = await import("../lib/server/checkouts.ts");
const { query } = await import("../lib/server/db.ts");

const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const mk = (code, max) => create(req("POST", "/api/v1/vouchers", { body: { code, kind: "percent", value: "10", expires_at: new Date(Date.now() + 864e5).toISOString(), max_redemptions: max }, headers: signedIn() }));
let n = 0;
const checkout = async () => { const id = `ses_t2_${++n}`; await recordCheckout(id, "link", "lnk_1", MERCHANT, USDT(25)); return id; };

before(setupDb);
beforeEach(async () => { await resetDb(); delete process.env.VOUCHER_HASH_SECRET; mock.method(console, "error", () => {}); });

test("simultaneous applies of a 1-use code: exactly one hold", async () => {
  await mk("ONE", 1);
  const ids = await Promise.all([1, 2, 3, 4, 5].map(checkout));
  const rs = await Promise.all(ids.map((s) => applyVoucher(MERCHANT, "ONE", s, USDT(25))));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  const [{ c }] = await query("SELECT count(*)::int AS c FROM app_gw_redemptions");
  assert.equal(c, 1);
});

test("confirmed uses and live holds both count: max 2 = 1 paid + 1 held, third refused", async () => {
  await mk("TWO", 2);
  const [a, b, c] = [await checkout(), await checkout(), await checkout()];
  assert.equal((await applyVoucher(MERCHANT, "TWO", a, USDT(25))).ok, true);
  assert.ok(await confirmRedemption(a, USDT(22.5)));
  assert.equal((await applyVoucher(MERCHANT, "TWO", b, USDT(25))).ok, true);
  assert.equal((await applyVoucher(MERCHANT, "TWO", c, USDT(25))).ok, false);
});

test("a holder who switches to another code frees the first code's hold", async () => {
  await mk("AAA", 1);
  await mk("BBB", 1);
  const [a, b] = [await checkout(), await checkout()];
  assert.equal((await applyVoucher(MERCHANT, "AAA", a, USDT(25))).ok, true);
  assert.equal((await applyVoucher(MERCHANT, "AAA", b, USDT(25))).ok, false);
  assert.equal((await applyVoucher(MERCHANT, "BBB", a, USDT(25))).ok, true);
  assert.equal((await applyVoucher(MERCHANT, "AAA", b, USDT(25))).ok, true);
});
