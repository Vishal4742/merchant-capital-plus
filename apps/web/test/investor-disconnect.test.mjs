// claude-frontend batch 063: an investor can disconnect their wallet on the Capital pages (FR-ADV-3, FR-UX-4), and a
// disconnected wallet stays disconnected on the next visit until they press Connect. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { investorOff, setInvestorOff } = await import("../lib/investor-off.ts");

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } };

test("disconnect is remembered until Connect clears it", () => {
  const s = memory();
  assert.equal(investorOff(s), false, "a first visit reconnects silently as before");
  setInvestorOff(s, true);
  assert.equal(investorOff(s), true, "after Disconnect, the next load stays disconnected");
  setInvestorOff(s, false);
  assert.equal(investorOff(s), false, "Connect clears it");
});

test("blocked storage (private mode) breaks nothing", () => {
  assert.equal(investorOff(blocked), false);
  assert.doesNotThrow(() => setInvestorOff(blocked, true));
  assert.equal(investorOff(undefined), false);
});

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the hook skips the silent reconnect when off, asks the wallet to revoke, and Connect clears the flag", () => {
  const hook = src("components/capital/investor/useInvestor.ts");
  assert.match(hook, /if \(!prompt && investorOff\(/);
  assert.match(hook, /wallet_revokePermissions/);
  assert.match(hook, /setInvestorOff\([^)]*, false\)/);
  assert.match(hook, /setInvestorOff\([^)]*, true\)/);
});

test("the bar shows Disconnect once a wallet is connected (ready or wrong network)", () => {
  const chip = src("components/capital/investor/InvestorApp.tsx");
  assert.equal(chip.match(/aria-label="Disconnect wallet"/g)?.length, 2);
});
