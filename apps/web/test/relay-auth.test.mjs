// claude-frontend checks for the relayer's shared secret (claude-relayer batch 006, 06:06): every POST /relay carries
// x-relay-secret when RELAY_API_SECRET is set, none when it isn't, and the secret never comes back in a result.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const SECRET = "relay-secret-for-tests-0123456789";
let seen;
let seenInit;
globalThis.fetch = async (_url, init) => {
  seen = init.headers;
  seenInit = init;
  return Response.json({ error: "unauthorized", code: "unauthorized" }, { status: 401 });
};

const { relaySale } = await import("../lib/relay.ts");
const sale = {
  relayerUrl: "https://relayer.test",
  merchant: `0x${"1".repeat(40)}`,
  orderRef: `0x${"2".repeat(64)}`,
  from: `0x${"3".repeat(40)}`,
  amount: 25_000_000n,
  validBefore: 999n,
  salt: `0x${"4".repeat(64)}`,
  signature: `0x${"5".repeat(130)}`,
};

test("relay: sends x-relay-secret when RELAY_API_SECRET is set, and never echoes it", async () => {
  process.env.RELAY_API_SECRET = SECRET;
  const result = await relaySale(sale);
  assert.equal(seen["x-relay-secret"], SECRET);
  assert.equal(result.ok, false);
  assert.match(result.message, /Nothing was charged/, "a 401 was never sent: say so plainly");
  assert.ok(!JSON.stringify(result).includes(SECRET), "the secret isn't in the result");
});

test("relay: no x-relay-secret header when RELAY_API_SECRET is unset or blank", async () => {
  delete process.env.RELAY_API_SECRET;
  await relaySale(sale);
  assert.equal("x-relay-secret" in seen, false);
  process.env.RELAY_API_SECRET = "   ";
  await relaySale(sale);
  assert.equal("x-relay-secret" in seen, false);
  delete process.env.RELAY_API_SECRET;
});

test("relay: the secret goes only to an https or loopback relayer, and redirects aren't followed (security 008 F2)", async () => {
  process.env.RELAY_API_SECRET = SECRET;
  await relaySale({ ...sale, relayerUrl: "http://relayer.example:8787" });
  assert.equal("x-relay-secret" in seen, false, "plain http to another host");
  await relaySale({ ...sale, relayerUrl: "https://relayer.example" });
  assert.equal(seen["x-relay-secret"], SECRET);
  await relaySale({ ...sale, relayerUrl: "http://127.0.0.1:8787" });
  assert.equal(seen["x-relay-secret"], SECRET, "this machine");
  assert.equal(seenInit.redirect, "manual");
  delete process.env.RELAY_API_SECRET;
});
