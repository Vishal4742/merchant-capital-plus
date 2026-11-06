// claude-contracts check for batch 012 review N2: applyVoucher's own SQL refuses a paid checkout, even when the read
// before it (checkoutOf) still saw the checkout unpaid (the payment was recorded in between). checkoutOf is replaced
// with one that returns that stale, unpaid view; the real row in Postgres is paid.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-vouchers-paid-race.test.mjs
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { MERCHANT, setupDb } from "./gw-helpers.mjs";

const USDT = (n) => BigInt(Math.round(n * 1_000_000));
const t = Date.now();
const stale = { sessionId: "ses_race", kind: "link", refId: "lnk_1", merchant: MERCHANT, usdtAmount: USDT(100), fx: null, createdAt: t, paidAt: null };
mock.module("../lib/server/checkouts.ts", { namedExports: { checkoutOf: async (id) => (id === "ses_race" ? stale : null) } });

const { applyVoucher } = await import("../lib/server/vouchers.ts");

let pg;
before(async () => {
  pg = await setupDb();
});

test("N2: a re-apply that raced the payment record is refused by the upsert itself", async () => {
  await pg.query(
    "INSERT INTO app_gw_vouchers (id, merchant, code, kind, value, expires_at, max_redemptions, created_at) VALUES ('v_half', $1, 'HALF', 'percent', 50, $2, 1, $3), ('v_one', $1, 'ONE', 'percent', 1, $2, 1000, $3)",
    [MERCHANT, t + 86_400_000, t],
  );
  // the checkout is PAID in the database (recorded after applyVoucher's read), with HALF's confirmed hold
  await pg.query("INSERT INTO app_gw_checkouts (session_id, kind, ref_id, merchant, usdt_amount, created_at, paid_at) VALUES ('ses_race', 'link', 'lnk_1', $1, $2, $3, $4)", [MERCHANT, USDT(100).toString(), t, t + 1000]);
  await pg.query("INSERT INTO app_gw_redemptions (session_id, voucher_id, discount, usdt_amount, created_at) VALUES ('ses_race', 'v_half', $1, $2, $3)", [USDT(50).toString(), USDT(50).toString(), t]);
  const res = await applyVoucher(MERCHANT, "ONE", "ses_race", USDT(100), t + 2000); // the read says unpaid
  assert.equal(res.ok, false, "the SQL saw paid_at and refused");
  const { rows } = await pg.query("SELECT voucher_id FROM app_gw_redemptions WHERE session_id = 'ses_race'");
  assert.equal(rows[0].voucher_id, "v_half", "the paid session's code was not switched");
});

test("N2: a fresh insert on a paid checkout (no hold yet) is refused too", async () => {
  await pg.query("UPDATE app_gw_checkouts SET session_id = 'ses_race' WHERE session_id = 'ses_race'"); // still paid
  await pg.query("DELETE FROM app_gw_redemptions WHERE session_id = 'ses_race'");
  const res = await applyVoucher(MERCHANT, "ONE", "ses_race", USDT(100), t + 3000);
  assert.equal(res.ok, false);
  const { rows } = await pg.query("SELECT count(*)::int AS n FROM app_gw_redemptions WHERE session_id = 'ses_race'");
  assert.equal(rows[0].n, 0);
});
