// claude-frontend checks for the /docs keys box helpers (security review 006 F5): the page shows no character of the
// shop's secret key, and the snippets' gateway address comes from configuration before the request's own headers.
// Run from apps/web: npm test
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { keyFingerprint, publicOrigin } = await import("../lib/config.ts");

afterEach(() => delete process.env.PUBLIC_ORIGIN);

test("the key's fingerprint is 8 hex characters of its SHA-256 and shares no run of characters with the key", () => {
  const key = "sk_test_0123456789abcdef0123456789abcdef";
  const print = keyFingerprint(key);
  assert.match(print, /^[0-9a-f]{8}$/);
  assert.equal(print, keyFingerprint(key), "stable, so the shop can compare it with its own copy");
  assert.notEqual(print, keyFingerprint(`${key}x`));
  for (let i = 0; i + 4 <= print.length; i++) assert.ok(!key.includes(print.slice(i, i + 4)), "no 4 characters of the key");
});

test("the public origin comes from PUBLIC_ORIGIN when it is an http(s) URL, else from the request", () => {
  assert.equal(publicOrigin("http://127.0.0.1:3109"), "http://127.0.0.1:3109");
  process.env.PUBLIC_ORIGIN = "https://pay.example.com/some/path";
  assert.equal(publicOrigin("http://evil.example"), "https://pay.example.com", "a forged Host never reaches the snippet");
  for (const bad of ["javascript:alert(1)", "not a url", "ftp://pay.example.com"]) {
    process.env.PUBLIC_ORIGIN = bad;
    assert.equal(publicOrigin("http://127.0.0.1:3109"), "http://127.0.0.1:3109", bad);
  }
});
