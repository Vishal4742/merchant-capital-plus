// claude-frontend checks for the private-read meter (FR-PRIV-3). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { countRead, meterValue, readMeter, serverMeter, setPrivateStatus, subscribeMeter } = await import("../lib/read-meter.ts");

test("the meter counts each kind, tells its subscribers, and shows private of private + plain, setup apart", () => {
  let told = 0;
  const stop = subscribeMeter(() => told++);
  const first = readMeter();
  countRead("private");
  countRead("private");
  countRead("plain");
  countRead("setup");
  assert.deepEqual(readMeter(), { private: 2, plain: 1, setup: 1, status: "idle" });
  assert.notEqual(readMeter(), first, "a new snapshot on every change, for useSyncExternalStore");
  assert.equal(meterValue(readMeter()), "2 of 3");
  assert.equal(told, 4);
  stop();
  setPrivateStatus("ready");
  assert.equal(told, 4, "an unsubscribed listener hears nothing");
  assert.deepEqual(serverMeter(), { private: 0, plain: 0, setup: 0, status: "idle" }, "the server render shows no reads");
});

test("before the first read the chip shows the connection instead of 0 of 0", () => {
  const none = { private: 0, plain: 0, setup: 2 };
  assert.equal(meterValue({ ...none, status: "idle" }), "connecting…");
  assert.equal(meterValue({ ...none, status: "connecting" }), "connecting…");
  assert.equal(meterValue({ ...none, status: "ready" }), "on");
  assert.equal(meterValue({ ...none, status: "failed" }), "off");
  assert.equal(meterValue({ private: 0, plain: 3, setup: 0, status: "failed" }), "0 of 3");
});
