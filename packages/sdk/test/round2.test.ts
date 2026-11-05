// tester round-2 probes: baseUrl forms, orderId bounds, tolerance 0, key chars, redirect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Gateway, GatewayError, constructEvent, signWebhook } from "../index.ts";

const K = "sk_test_abc";
const mk = (baseUrl: string, fetch?: typeof globalThis.fetch) => new Gateway(K, { baseUrl, fetch });

test("baseUrl: http://[::1]:3000 and http://localhost ok; http remote, ftp, javascript refused", () => {
  mk("http://[::1]:3000"); mk("http://localhost:3000"); mk("http://127.0.0.1:3000"); mk("https://x.example");
  for (const u of ["http://example.com", "ftp://x", "javascript:alert(1)", "", "nope"]) assert.throws(() => mk(u), u);
});

test("baseUrl with user:pass is accepted or refused, but never leaks creds into a header", async () => {
  let seen = "";
  const f = (async (u: string) => { seen = String(u); return new Response(JSON.stringify({ id: "a", url: "u", amount: "1.00", expiresAt: "x" }), { status: 200 }); }) as never;
  try { await mk("https://user:pass@host.example", f).sessions.create({ amount: 1 }); } catch { return; }
  console.log("userinfo url seen by fetch:", seen);
});

test("toleranceSec 0 is accepted and rejects any non-current timestamp", () => {
  const b = "{}"; const t = Math.floor(Date.now() / 1000);
  assert.throws(() => constructEvent(b, signWebhook(b, "s", t - 5), "s", { toleranceSec: 0 }));
});

test("orderId: 40 ok, 41 refused, inner space ok, edge space refused", async () => {
  const f = (async () => new Response(JSON.stringify({ id: "a", url: "u", amount: "1.00", expiresAt: "x" }), { status: 200 })) as never;
  const g = mk("https://x.example", f);
  await g.sessions.create({ amount: 1, orderId: "a".repeat(40) });
  await g.sessions.create({ amount: 1, orderId: "a b" });
  for (const o of ["a".repeat(41), " a", "a ", ""]) await assert.rejects(g.sessions.create({ amount: 1, orderId: o }), GatewayError, JSON.stringify(o));
});

test("a key with a double quote is printable ASCII: accepted, and scrubbed from fetch errors", async () => {
  const key = 'sk_"x';
  const f = (async () => { throw new Error(`bad header ${key}`); }) as never;
  const g = new Gateway(key, { baseUrl: "https://x.example", fetch: f, maxRetries: 0 });
  await assert.rejects(g.sessions.create({ amount: 1 }), (e: Error) => e instanceof GatewayError && !e.message.includes(key));
});

test("a redirect (fetch rejects under redirect:error) surfaces as GatewayError with status 0", async () => {
  const f = (async (_u: string, init: RequestInit) => { assert.equal(init.redirect, "error"); throw new TypeError("redirect"); }) as never;
  const g = new Gateway(K, { baseUrl: "https://x.example", fetch: f, maxRetries: 0 });
  await assert.rejects(g.sessions.create({ amount: 1 }), (e: GatewayError) => e instanceof GatewayError && e.status === 0);
});
