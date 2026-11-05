// tester round-1 probes (FR-GW-5, FR-GW-7): header edge cases, Buffer body, timeout. (baseUrl path: sdk.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Gateway, GatewayError, WebhookSignatureError, constructEvent, signWebhook } from "../index.ts";

const SECRET = "whsec-test-0123456789abcdef";
const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", created: 1, data: {} });
const now = () => Math.floor(Date.now() / 1000);

test("constructEvent accepts a Buffer body and spaces after the comma", () => {
  const h = signWebhook(body, SECRET, now());
  assert.equal(constructEvent(Buffer.from(body), h.replace(",", ", "), SECRET).id, "evt_1");
});

test("constructEvent rejects uppercase hex, t with letters, an all-zero v1, empty/undefined/garbage headers", () => {
  const h = signWebhook(body, SECRET, now());
  const [t, v1] = h.split(",");
  assert.throws(() => constructEvent(body, `${t},v1=${v1.slice(3).toUpperCase()}`, SECRET), WebhookSignatureError);
  assert.throws(() => constructEvent(body, `t=12ab,${v1}`, SECRET), WebhookSignatureError);
  // a well-formed but wrong v1 (all zeros) is rejected by the HMAC compare, not by the header parse
  assert.throws(() => constructEvent(body, `${t},v1=${"0".repeat(64)}`, SECRET), WebhookSignatureError);
  assert.throws(() => constructEvent(body, "", SECRET), WebhookSignatureError);
  assert.throws(() => constructEvent(body, undefined, SECRET), WebhookSignatureError);
  assert.throws(() => constructEvent(body, "garbage,,=,t", SECRET), WebhookSignatureError);
});

test("constructEvent honours a custom toleranceSec", () => {
  const h = signWebhook(body, SECRET, now() - 100);
  assert.throws(() => constructEvent(body, h, SECRET, { toleranceSec: 10 }), WebhookSignatureError);
  assert.equal(constructEvent(body, h, SECRET, { toleranceSec: 200 }).id, "evt_1");
});

test("a timeout is retried, then reported as GatewayError status 0", async () => {
  let calls = 0;
  const fetch = ((_u: unknown, init: RequestInit) => { calls++; return new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))); }) as typeof globalThis.fetch;
  const gw = new Gateway("sk_x", { baseUrl: "https://g.test", fetch, timeoutMs: 20, maxRetries: 1 });
  await assert.rejects(gw.sessions.retrieve("a"), (e: unknown) => e instanceof GatewayError && e.status === 0);
  assert.equal(calls, 2);
});
