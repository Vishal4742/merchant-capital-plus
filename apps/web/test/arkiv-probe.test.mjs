// Tester (batch 003 round 1): the DEP-5 probe's exit code and output, offline (no RPC, no tGLM spent).
// The probe runs at import time, so each case imports it under a fresh URL with a mocked lib/arkiv.ts.
// Run from apps/web: npm test
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError } from "viem";

const real = await import("../lib/arkiv.ts?real");
const ACCESS = "ak_probe/with+chars=42";
const WRITER = `0x${"ab".repeat(20)}`;
const KEY = `0x${"cd".repeat(32)}`;
let scenario; // set per test: what the fake reader returns, or what the fake clients throw

mock.module(new URL("../lib/arkiv.ts", import.meta.url).href, {
  exports: {
    redactArkivError: real.redactArkivError,
    arkivClients: () => {
      if (scenario.throws) throw scenario.throws;
      const query = { from: () => query, where: () => query, ownedBy: () => query, limit: () => query, fetch: async () => ({ entities: scenario.entities }) };
      return {
        address: WRITER,
        writer: { createEntity: async () => ({ entityKey: KEY, txHash: `0x${"ef".repeat(32)}` }) },
        reader: { select: () => query },
      };
    },
  },
});

async function runProbe(name) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  process.exitCode = undefined;
  try {
    await import(`../scripts/arkiv-probe.ts?case=${name}`);
    return { code: process.exitCode ?? 0, out: out.mock.calls.map((c) => c.arguments.join(" ")), err: err.mock.calls.map((c) => c.arguments.join(" ")) };
  } finally {
    process.exitCode = undefined;
    out.mock.restore();
    err.mock.restore();
  }
}

test("probe exits 0 and prints the public fields when the entity is found", async () => {
  scenario = { entities: [{ $key: KEY }] };
  const r = await runProbe("found");
  assert.equal(r.code, 0);
  const printed = JSON.parse(r.out[0]);
  // exactly these public fields: a probe that also printed an env value would fail here (review-code R2 L1)
  assert.deepEqual(Object.keys(printed), ["writer", "entityKey", "txHash", "createMs", "queryMs", "found", "expiresInMin"]);
  assert.equal(printed.found, true);
  assert.equal(printed.writer, WRITER);
});

test("probe exits 1 when the query doesn't return the new entity", async () => {
  scenario = { entities: [{ $key: `0x${"00".repeat(32)}` }] };
  const r = await runProbe("notfound");
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.out[0]).found, false);
});

test("probe exits 1 on an RPC error and never prints the access key, raw or URL-encoded", async () => {
  process.env.ARKIV_ACCESS_KEY = ACCESS;
  scenario = { throws: new HttpRequestError({ url: `https://rpc.example/${encodeURIComponent(ACCESS)}`, status: 401 }) };
  try {
    const r = await runProbe("rpcerror");
    assert.equal(r.code, 1);
    assert.equal(r.out.length, 0);
    const text = r.err.join("\n");
    assert.match(text, /Arkiv probe failed: HTTP request failed/);
    assert.ok(!text.includes(ACCESS) && !text.includes(encodeURIComponent(ACCESS)));
  } finally {
    delete process.env.ARKIV_ACCESS_KEY;
  }
});
