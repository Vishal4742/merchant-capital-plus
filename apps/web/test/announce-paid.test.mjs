// claude-frontend: a recorded payment tells the gateway backend (onSessionPaid: link/page paid, voucher counted,
// payment.succeeded webhook), after the response and without ever failing the payment. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { announcePaid } = await import("../lib/announce-paid.ts");
const session = { id: "s-1", merchant: "0x1111111111111111111111111111111111111111", amount: 25_000_000n };

test("announcePaid: outside a request it runs at once with the recorded session and the price it was paid at", async () => {
  const seen = [];
  announcePaid(session, 22_500_000n, async (s, paid) => void seen.push([s.id, paid]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [["s-1", 22_500_000n]], "the charged price (after a code), not the session's 25.00 (security 009 F3)");
});

test("announcePaid: a backend that keeps failing is tried 3 times, logged by error name only, and nothing throws", async () => {
  const lines = [];
  const waits = [];
  const original = console.error;
  console.error = (line) => lines.push(String(line));
  try {
    const secretish = new TypeError("connect to postgres://user:pass@host failed");
    assert.doesNotThrow(() => announcePaid(session, session.amount, async () => Promise.reject(secretish), async (ms) => void waits.push(ms)));
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 3, "3 tries (G4 code review M2)");
  assert.deepEqual(waits, [500, 1500], "backs off between tries");
  for (const line of lines) {
    assert.match(line, /s-1 not queued \(try \d\): TypeError$/);
    assert.ok(!line.includes("postgres"), "the message (which may carry a URL) isn't logged");
  }
});

test("announcePaid: a database blip on the first try is recovered on the second", async () => {
  let calls = 0;
  const original = console.error;
  console.error = () => {};
  try {
    announcePaid(session, session.amount, async () => (++calls === 1 ? Promise.reject(new Error("blip")) : undefined), async () => {});
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = original;
  }
  assert.equal(calls, 2);
});
