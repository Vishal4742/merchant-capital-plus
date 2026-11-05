// claude-frontend checks for the Arkiv writer (DEP-5, NFR-3): key handling and keeping the access key out of errors.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError } from "viem";

import { arkivClients, redactArkivError } from "../lib/arkiv.ts";

const ACCESS = "ak_test/with+chars=0123456789"; // has characters that encodeURIComponent changes
const KEY = `0x${"11".repeat(32)}`;

test("a missing or malformed writer key is refused without echoing it", () => {
  assert.throws(() => arkivClients({ ARKIV_ACCESS_KEY: ACCESS }), /ARKIV_PRIVATE_KEY/);
  const top = `0x${"ff".repeat(32)}`; // right shape, outside the curve order: noble would print it as a number
  for (const bad of ["0xnot-a-key-but-secretish", "0x1234", "11".repeat(32), `${KEY}00`, top]) {
    assert.throws(
      () => arkivClients({ ARKIV_PRIVATE_KEY: bad, ARKIV_ACCESS_KEY: ACCESS }),
      (e) => /ARKIV_PRIVATE_KEY/.test(e.message) && !e.message.includes(bad) && !e.message.includes(BigInt(top).toString()) && e.cause === undefined,
      bad.slice(0, 12),
    );
  }
});

test("a missing access key is refused instead of silently using the rate-limited public endpoint", () => {
  assert.throws(() => arkivClients({ ARKIV_PRIVATE_KEY: KEY }), /ARKIV_ACCESS_KEY/);
  assert.throws(() => arkivClients({ ARKIV_PRIVATE_KEY: KEY, ARKIV_ACCESS_KEY: "" }), /ARKIV_ACCESS_KEY/);
  assert.throws(() => arkivClients({ ARKIV_PRIVATE_KEY: KEY, ARKIV_ACCESS_KEY: "  " }), /ARKIV_ACCESS_KEY/, "whitespace only");
});

test("valid env gives Rabdi clients and the public writer address", () => {
  const { reader, writer, address } = arkivClients({ ARKIV_PRIVATE_KEY: KEY, ARKIV_ACCESS_KEY: ACCESS });
  assert.equal(reader.chain.id, 7794095);
  assert.equal(writer.chain.id, 7794095);
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
});

test("RPC errors are redacted: the access key never appears, raw or URL-encoded", () => {
  const url = `https://rpc.rabdi.db-chain.testnet.arkiv.network/${encodeURIComponent(ACCESS)}`;
  const err = new HttpRequestError({ url, status: 500, body: { method: "eth_chainId" } });
  assert.ok(err.message.includes(encodeURIComponent(ACCESS)), "viem puts the URL in the message (why this exists)");
  const text = redactArkivError(err, ACCESS);
  assert.ok(!text.includes(ACCESS) && !text.includes(encodeURIComponent(ACCESS)));
  assert.match(text, /HTTP request failed/);
  const raw = redactArkivError(new Error(`bad key ${ACCESS} in config`), ACCESS);
  assert.equal(raw, "bad key <access-key> in config", "the raw form is redacted too");
  assert.equal(redactArkivError("plain", ACCESS), "plain");
});
