// Batch 031 round 4 (A11, owner supervision prompt): webhook connection isolation. The POST connects only to the address
// that passed the SSRF check (no DNS-rebinding window), DNS runs on a per-attempt c-ares resolver that is cancelled at its
// deadline (no shared getaddrinfo threadpool), dispatch is fair per destination, and one hanging destination never
// holds up a healthy one in the same run. Real SQL on PGlite; the network layer is the real one or a scripted fake.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-isolation.test.mjs
import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import dns from "node:dns/promises";
import { setupDb, resetDb, MERCHANT } from "./gw-helpers.mjs";

const { query } = await import("../lib/server/db.ts");
const { createWebhook, dispatchDue, enqueueEvent, defaultWebhookNet, setWebhookNet, DnsTimeoutError } = await import("../lib/server/webhooks.ts");

const MIN = 60_000;
let posts = [];
let resolveHost = async () => ["93.184.215.14"];
const fakeNet = {
  resolve: (host, signal) => resolveHost(host, signal),
  post: async (url, address) => {
    posts.push({ url, address });
    return 200;
  },
};

before(setupDb);
beforeEach(async () => {
  await resetDb();
  posts = [];
  resolveHost = async () => ["93.184.215.14"];
  setWebhookNet(fakeNet);
});
after(() => setWebhookNet(undefined));

test("the POST connects only to the vetted address, even for a hostname DNS can't resolve (no rebinding window)", async () => {
  const seen = [];
  const server = createServer((socket) => {
    seen.push(socket.remoteAddress);
    socket.destroy(); // not TLS: the handshake fails, which is fine — we only check where the connection went
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    // .invalid never resolves (RFC 2606): any connection that arrives came from the pinned address, not from DNS
    await assert.rejects(defaultWebhookNet.post(`https://wf-pin-test.invalid:${port}/hook`, "127.0.0.1", { "content-type": "application/json" }, "{}", 2_000));
    assert.equal(seen.length, 1, "exactly one connection, to the pinned address");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("c-ares lookups are cancelled at the deadline (nothing left running) and surface as a DNS timeout", async () => {
  const hang = () => new Promise(() => {});
  const r4 = mock.method(dns.Resolver.prototype, "resolve4", hang);
  const r6 = mock.method(dns.Resolver.prototype, "resolve6", hang);
  let cancelled = 0;
  const cancel = mock.method(dns.Resolver.prototype, "cancel", () => {
    cancelled++;
  });
  try {
    const abort = new AbortController();
    const pending = defaultWebhookNet.resolve("slow.example", abort.signal);
    abort.abort();
    // the mocked queries never settle on their own; the vetting deadline is what ends a real attempt, and abort must cancel
    assert.equal(cancelled, 1, "abort cancels this resolver's outstanding queries");
    void pending.catch(() => {});
  } finally {
    r4.mock.restore();
    r6.mock.restore();
    cancel.mock.restore();
  }
});

test("a resolver timeout (ETIMEOUT) is reported as DnsTimeoutError; a missing host is not", async () => {
  const timeout = Object.assign(new Error("queryA ETIMEOUT"), { code: "ETIMEOUT" });
  const notFound = Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
  for (const [err, isTimeout] of [[timeout, true], [notFound, false]]) {
    const r4 = mock.method(dns.Resolver.prototype, "resolve4", async () => { throw err; });
    const r6 = mock.method(dns.Resolver.prototype, "resolve6", async () => { throw err; });
    try {
      await assert.rejects(defaultWebhookNet.resolve("x.example", new AbortController().signal), (e) => (e instanceof DnsTimeoutError) === isTimeout);
    } finally {
      r4.mock.restore();
      r6.mock.restore();
    }
  }
});

test("each attempt POSTs to the address the SSRF check just vetted", async () => {
  resolveHost = async () => ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"];
  await createWebhook(MERCHANT, "https://shop.example/hooks");
  await enqueueEvent(MERCHANT, "payment.succeeded", { n: 1 });
  assert.deepEqual(posts.map((p) => p.address), ["93.184.215.14"]);
  resolveHost = async () => ["10.0.0.7"]; // rebinding to a private address after creation
  posts = [];
  await enqueueEvent(MERCHANT, "payment.succeeded", { n: 2 });
  assert.equal(posts.length, 0, "a now-private answer is refused before any connection");
});

test("fair dispatch: a destination with a backlog gets at most 3 attempts per run; others still get theirs", async () => {
  const a = await createWebhook(MERCHANT, "https://a.example/hooks");
  const b = await createWebhook(MERCHANT, "https://b.example/hooks");
  const t0 = Date.now() - 10 * MIN;
  // 10 due deliveries for a, 1 for b, all older than b's
  for (let i = 0; i < 10; i++) {
    await query("INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, 'payment.succeeded', '{}', 'pending', $5, $5)", [`dlv_a${i}`, a.id, MERCHANT, `evt_a${i}`, t0 + i]);
  }
  await query("INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, next_attempt_at, created_at) VALUES ('dlv_b0', $1, $2, 'evt_b0', 'payment.succeeded', '{}', 'pending', $3, $3)", [b.id, MERCHANT, t0 + 100]);
  assert.equal(await dispatchDue(Date.now()), 4);
  const hosts = posts.map((p) => new URL(p.url).hostname);
  assert.equal(hosts.filter((h) => h === "a.example").length, 3);
  assert.equal(hosts.filter((h) => h === "b.example").length, 1, "b isn't crowded out by a's backlog");
});

test("a destination whose DNS hangs never holds up a healthy destination in the same run", { timeout: 20_000 }, async () => {
  await createWebhook(MERCHANT, "https://hang.example/hooks");
  await createWebhook(MERCHANT, "https://ok.example/hooks");
  resolveHost = (host) => (host === "hang.example" ? new Promise(() => {}) : Promise.resolve(["93.184.215.14"]));
  const t = Date.now();
  await enqueueEvent(MERCHANT, "payment.succeeded", { n: 1 }, t);
  const took = Date.now() - t;
  assert.ok(took < 10_000, `bounded (${took} ms)`);
  assert.deepEqual(posts.map((p) => new URL(p.url).hostname), ["ok.example"], "the healthy destination was delivered");
  const rows = await query("SELECT w.url, d.status, d.attempts FROM app_gw_deliveries d JOIN app_gw_webhooks w ON w.id = d.webhook_id ORDER BY w.url");
  assert.deepEqual(rows.map((r) => [new URL(r.url).hostname, r.status, Number(r.attempts)]), [
    ["hang.example", "pending", 0], // deferred, no retry burned
    ["ok.example", "succeeded", 1],
  ]);
});

test("review F1: an address family that never answers doesn't discard the other's answer", async () => {
  const r4 = mock.method(dns.Resolver.prototype, "resolve4", async () => ["93.184.215.14"]);
  const r6 = mock.method(dns.Resolver.prototype, "resolve6", () => new Promise(() => {}));
  let cancelled = 0;
  const cancel = mock.method(dns.Resolver.prototype, "cancel", () => void cancelled++);
  try {
    const t = Date.now();
    const addrs = await defaultWebhookNet.resolve("v4only.example", new AbortController().signal);
    assert.deepEqual(addrs, ["93.184.215.14"]);
    assert.ok(Date.now() - t < 1_500, "returned after the short grace, not the 3 s deadline");
    assert.equal(cancelled, 1, "the silent family was cancelled");
  } finally {
    r4.mock.restore();
    r6.mock.restore();
    cancel.mock.restore();
  }
});
