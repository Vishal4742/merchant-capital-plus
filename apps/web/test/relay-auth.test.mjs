// claude-frontend checks for the relayer's shared secret (claude-relayer batch 006, 06:06): every POST /relay carries
// x-relay-secret when RELAY_API_SECRET is set, none when it isn't, and the secret never comes back in a result.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const SECRET = "relay-secret-for-tests-0123456789";
let seen;
let seenInit;
let answer = () => Response.json({ error: "unauthorized", code: "unauthorized" }, { status: 401 });
globalThis.fetch = async (_url, init) => {
  seen = init.headers;
  seenInit = init;
  return answer();
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

test("relay: Vercel's burst mitigation (403 + x-vercel-mitigated) reads as busy, a plain 403 doesn't (claude-relayer 06:46)", async () => {
  answer = () => new Response("<html>checkpoint</html>", { status: 403, headers: { "x-vercel-mitigated": "challenge" } });
  const busy = await relaySale(sale);
  assert.equal(busy.status, 503, "nothing was sent: unlock and say try again");
  answer = () => new Response("forbidden", { status: 403 });
  assert.equal((await relaySale(sale)).status, 400);
  answer = () => Response.json({ error: "unauthorized", code: "unauthorized" }, { status: 401 });
});

// claude-relayer 09:42: when a checkout opens, our server warms the relayer with a fire-and-forget GET /health, at most
// once per 30 s per server instance (security review 020 F1: page loads must never become relayer traffic).
test("warmRelayer: one GET /health per 30 s, after the response, never awaited, never throws, https or loopback only", async () => {
  const { warmRelayer } = await import("../lib/relay.ts");
  const scheduled = [];
  const urls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => (urls.push(String(url)), Promise.reject(new TypeError("offline")));
  const schedule = (task) => void scheduled.push(task);
  try {
    const t0 = 1_000_000_000;
    for (let i = 0; i < 100; i++) warmRelayer("https://relayer.example", schedule, t0 + i * 100);
    assert.equal(scheduled.length, 1, "100 page loads in 10 s: one ping");
    assert.equal(urls.length, 0, "nothing runs in the page's own path");
    await scheduled[0](); // a failing ping is swallowed
    assert.deepEqual(urls, ["https://relayer.example/health"]);
    warmRelayer("https://relayer.example", schedule, t0 + 30_001);
    assert.equal(scheduled.length, 2, "after 30 s, one more");
    for (const bad of ["http://relayer.example:8787", undefined, "not a url", "mailto:x"]) warmRelayer(bad, schedule, t0 + 120_000);
    assert.equal(scheduled.length, 2, "plain http to another host, unset, junk or a URL that takes no path: no ping");
  } finally {
    globalThis.fetch = saved;
  }
});
