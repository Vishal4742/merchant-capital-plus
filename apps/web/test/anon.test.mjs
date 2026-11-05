// claude-frontend checks for lib/anon.ts (batch 001: DEP-6 boot deadline, retry after a failed boot, pinned worker hash).
// Run from apps/web: npm test
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// A fake harness whose next boot can stall (never ready), fail, or succeed.
let mode = "stall";
let boots = 0;
const closed = [];
class FakeWorker {
  constructor() {
    this.id = ++boots;
    this.ready =
      mode === "stall" ? new Promise(() => {}) : mode === "fail" ? Promise.reject(new Error("boot failed")) : Promise.resolve();
    this.fetch = async () => new Response("{}");
  }
  close() {
    closed.push(this.id);
  }
}
mock.module("@anon-rpc/browser-harness", { exports: { AnonRpcWorker: FakeWorker } });
const { getChainClient, pinWorkerHash, NYM_WORKER_HASH, BOOT_DEADLINE_MS } = await import("../lib/anon.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("a boot that never gets ready times out at the deadline and closes its worker", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = getChainClient();
    while (boots === 0) await nextTurn(); // the deadline timer is set right after the worker is built
    mock.timers.tick(BOOT_DEADLINE_MS);
    await assert.rejects(pending, /timed out/);
    assert.deepEqual(closed, [1]);
  } finally {
    mock.timers.reset();
  }
});

test("a failed boot closes its worker, and the next call boots a fresh one", async () => {
  mode = "fail";
  await assert.rejects(getChainClient(), /boot failed/);
  assert.deepEqual(closed, [1, 2]);
  mode = "ok";
  const client = await getChainClient();
  assert.equal(boots, 3);
  assert.equal(client.chain.id, 1874);
  assert.strictEqual(await getChainClient(), client, "a booted client is reused");
});

const hashCall = { method: "eth_call", params: [{ to: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0", data: "0x3898587d" }, "latest"] };

test("the pinned worker hash is accepted in any hex case", async () => {
  const provider = pinWorkerHash({ request: async () => NYM_WORKER_HASH.replace("f13a", "F13A") });
  assert.match(String(await provider.request(hashCall)), /^0x[fF]13[aA]/);
});

test("a different worker hash is refused", async () => {
  const provider = pinWorkerHash({ request: async () => `0x${"ab".repeat(32)}` });
  await assert.rejects(provider.request(hashCall), /refusing to run it/);
});

test("other calls pass through untouched", async () => {
  const resolvers = { method: "eth_call", params: [{ to: hashCall.params[0].to, data: "0x12345678" }, "latest"] };
  const provider = pinWorkerHash({ request: async () => "0xdeadbeef" });
  assert.equal(await provider.request(resolvers), "0xdeadbeef");
});
