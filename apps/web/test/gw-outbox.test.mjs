// Batch 031-PW4 (FR-GW-7, FR-PAY-10): a payment event's dedupe key and its deliveries are written together, so a crash
// can never leave a "sent" marker without deliveries; attempts, dispatch and replay share one lease; a failed replay of
// a delivered event never downgrades it. Real SQL on PGlite; DNS and fetch are mocked (no network).
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-outbox.test.mjs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
// batch 051: this file wraps setTestDb itself (crash injection), so it seeds the signed-in workspace explicitly
import { setupDb, resetDb, seedWorkspace, req, params, MERCHANT } from "./gw-helpers.mjs";

const { setTestDb, query } = await import("../lib/server/db.ts");
const { onSessionPaid, eventIdFor } = await import("../lib/server/events.ts");
const { createWebhook, dispatchDue } = await import("../lib/server/webhooks.ts");
const { POST: replay } = await import("../app/api/v1/webhooks/deliveries/[id]/replay/route.ts");

const MIN = 60_000;
mock.method(dns, "lookup", async (host) => {
  if (host !== "shop.example") throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  return [{ address: "93.184.215.14", family: 4 }];
});
let calls = [];
let reply = async () => new Response("ok", { status: 200 });
mock.method(globalThis, "fetch", async (url, init) => {
  calls.push({ url: String(url), body: init.body });
  return reply(url, init);
});

// The PGlite client from gw-helpers, wrapped so a test can "kill the process" right after a chosen statement: that
// statement commits, then it and every later query throw until restart() (no catch block gets to clean up).
let pg;
let crashAfter = null;
let dead = false;
// holdAfter: the matching statement commits, then its caller is frozen until release() (a stalled instance)
let holdAfter = null;
let held = null;
const restart = () => {
  dead = false;
  crashAfter = null;
  holdAfter = null;
};
function installCrashableDb() {
  const run = async (exec, text) => {
    if (dead) throw new Error("process is dead");
    const rows = await exec();
    if (crashAfter && crashAfter.test(text)) {
      dead = true;
      crashAfter = null;
      throw new Error("process killed");
    }
    if (holdAfter && holdAfter.test(text)) {
      holdAfter = null;
      await new Promise((release) => {
        held.reached(release);
      });
    }
    return rows;
  };
  setTestDb({
    query: (text, p) => run(async () => (await pg.query(text, p)).rows, text),
    transaction: (statements) =>
      run(
        () =>
          pg.transaction(async (tx) => {
            const out = [];
            for (const s of statements) out.push((await tx.query(s.text, s.params ?? [])).rows);
            return out;
          }),
        statements.map((s) => s.text).join("\n"),
      ),
  });
}

before(async () => {
  pg = await setupDb();
  installCrashableDb();
});
beforeEach(async () => {
  restart();
  await resetDb();
  calls = [];
  reply = async () => new Response("ok", { status: 200 });
});

const session = (id = "sess_out") => ({
  id,
  merchant: MERCHANT,
  merchantName: "Bandra Beans",
  amount: 25_000_000n,
  reference: "A-1",
  payment: { paymentId: "9", txHash: "0xabc", from: "0x3333333333333333333333333333333333333333", paidAt: 1, blockNumber: "5" },
});
const hook = (url = "https://shop.example/hooks") => createWebhook(MERCHANT, url);
const deliveries = () => query("SELECT id, webhook_id, event_id, status, attempts, next_attempt_at::text AS next_attempt_at FROM app_gw_deliveries ORDER BY id");
const eventKeys = () => query("SELECT key FROM app_gw_events ORDER BY key");

test("A1/A6: a process killed right after the event marker is written still delivers the event after restart", async () => {
  await hook();
  const now = Date.now();
  // Die the moment the statement that WRITES the dedupe key returns (review 031 R1: not the read-only pre-check). On the
  // pre-031 code this was the bare key INSERT, which left a marker with no delivery; now it is the one CTE statement.
  crashAfter = /INSERT INTO app_gw_events/;
  await assert.rejects(onSessionPaid(session(), 25_000_000n, now), /process killed/);
  assert.equal(crashAfter, null, "the crash really happened on the marker write");
  restart();
  const keys = (await eventKeys()).map((r) => r.key);
  const rows = await query("SELECT status, leased_until::text AS leased_until, next_attempt_at::text AS next_attempt_at FROM app_gw_deliveries");
  assert.deepEqual(keys, ["paid:sess_out"], "the marker was committed");
  assert.equal(rows.length, 1, `the marker was committed WITH its delivery (a marker alone loses the event forever): deliveries=${rows.length}`);
  assert.deepEqual([rows[0].status, rows[0].leased_until, Number(rows[0].next_attempt_at)], ["pending", null, now + MIN]);
  assert.equal(calls.length, 0, "the process died before its inline attempt");
  // A6: no re-announce needed — the dispatcher sends it once the lease window has passed, exactly once
  assert.equal(await dispatchDue(now + MIN - 1), 0, "not before the lease window");
  assert.equal(await dispatchDue(now + MIN), 1);
  assert.deepEqual(calls.map((c) => JSON.parse(c.body).id), [eventIdFor("paid:sess_out")], "delivered once, with the stable event id");
  // a later re-announce (the paid page) does nothing more
  await onSessionPaid(session(), 25_000_000n, now + 2 * MIN);
  assert.equal(calls.length, 1);
  assert.equal((await deliveries()).length, 1);
});

test("A8: re-applying migration 051 is a no-op (one leased_until column)", async () => {
  const { readFileSync } = await import("node:fs");
  const { sqlStatements } = await import("../db/statements.mjs");
  for (const s of sqlStatements(readFileSync(new URL("../db/051_webhook_outbox.sql", import.meta.url), "utf8"))) await pg.query(s);
  const cols = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'app_gw_deliveries' AND column_name = 'leased_until'");
  assert.equal(cols.length, 1);
});

test("A1: if the delivery write fails, no event marker remains, so a retry still queues it", async () => {
  await hook();
  await pg.exec(`CREATE OR REPLACE FUNCTION wf_test_fail_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delivery write failed'; END $$`);
  await pg.exec(`CREATE TRIGGER wf_test_fail BEFORE INSERT ON app_gw_deliveries FOR EACH ROW EXECUTE FUNCTION wf_test_fail_delivery()`);
  try {
    await assert.rejects(onSessionPaid(session("sess_fail"), 25_000_000n), /delivery write failed/);
    assert.deepEqual(await eventKeys(), [], "no orphan marker");
  } finally {
    await pg.exec("DROP TRIGGER IF EXISTS wf_test_fail ON app_gw_deliveries");
  }
  await onSessionPaid(session("sess_fail"), 25_000_000n);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).id, eventIdFor("paid:sess_fail"));
});

test("A2: two concurrent announcements of one payment create one delivery per endpoint", async () => {
  await hook("https://shop.example/a");
  await hook("https://shop.example/b");
  await Promise.all([onSessionPaid(session("sess_race"), 25_000_000n), onSessionPaid(session("sess_race"), 25_000_000n)]);
  const rows = await deliveries();
  assert.equal(rows.length, 2, "one per endpoint");
  assert.equal(new Set(rows.map((r) => r.webhook_id)).size, 2);
  assert.equal(calls.length, 2, "each endpoint POSTed once");
});

test("A2 (round 2, T1): two enqueues that both passed the pre-check race on the marker; the loser queues nothing", async () => {
  const { enqueueEventOnce } = await import("../lib/server/webhooks.ts");
  await hook("https://shop.example/a");
  await hook("https://shop.example/b");
  const now = Date.now();
  const id = eventIdFor("paid:sess_cte");
  // straight to the CTE twice (the pre-check is what normally hides this race): the ON CONFLICT path decides
  await Promise.all([
    enqueueEventOnce("paid:sess_cte", MERCHANT, "payment.succeeded", { n: 1 }, now, id),
    enqueueEventOnce("paid:sess_cte", MERCHANT, "payment.succeeded", { n: 2 }, now, id),
  ]);
  const rows = await deliveries();
  assert.equal(rows.length, 2, "one per endpoint, not two");
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map((c) => JSON.parse(c.body).data.n)).size, 1, "both deliveries carry the winner's body");
});

test("L2 (round 2): a stalled first attempt never re-sends what dispatch already delivered", async () => {
  await hook();
  const now = Date.now();
  let releaseHold;
  const reached = new Promise((r) => {
    held = { reached: (release) => { releaseHold = release; r(); } };
  });
  holdAfter = /INSERT INTO app_gw_events/; // the instance freezes right after committing marker + delivery
  const announcing = onSessionPaid(session("sess_stall"), 25_000_000n, now);
  await reached;
  assert.equal(await dispatchDue(now + MIN), 1, "after the lease window another instance delivers it");
  assert.equal(calls.length, 1);
  releaseHold(); // the frozen instance wakes up and runs its inline "first" attempt
  await announcing;
  assert.equal(calls.length, 1, "no second POST of a delivered event");
  const [d] = await deliveries();
  assert.deepEqual([d.status, Number(d.attempts)], ["succeeded", 1]);
});

test("M1 (round 2): an endpoint whose DNS hangs can't hold an attempt past its deadline", { timeout: 20_000 }, async () => {
  await hook();
  const lookup = dns.lookup;
  mock.method(dns, "lookup", () => new Promise(() => {})); // never answers
  try {
    const t = Date.now();
    await onSessionPaid(session("sess_dns"), 25_000_000n, t);
    const took = Date.now() - t;
    assert.ok(took < 10_000, `bounded attempt (took ${took} ms)`);
    const [d] = await query("SELECT status, attempts, leased_until::text AS leased_until, next_attempt_at::text AS next FROM app_gw_deliveries");
    // round 3 (A9): a DNS deadline is deferred, not counted, so a merchant whose DNS hangs (or whose lookups wait behind
    // someone else's hanging DNS) never burns retries; it is tried again a minute later
    assert.deepEqual([d.status, Number(d.attempts), d.leased_until], ["pending", 0, null], "deferred: no attempt used, lease released");
    assert.ok(Number(d.next) >= t + MIN, "retried later, not hot-looped");
    assert.equal(calls.length, 0);
  } finally {
    dns.lookup = lookup;
  }
});

test("A9 (round 3): a host that doesn't exist still uses up an attempt (only DNS timeouts are deferred)", async () => {
  await hook();
  const lookup = dns.lookup;
  mock.method(dns, "lookup", async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND shop.example"), { code: "ENOTFOUND" });
  });
  try {
    await onSessionPaid(session("sess_nx"), 25_000_000n);
    const [d] = await query("SELECT status, attempts FROM app_gw_deliveries");
    assert.deepEqual([d.status, Number(d.attempts)], ["pending", 1]);
  } finally {
    dns.lookup = lookup;
  }
});

test("A9 (round 3): the deferral is bounded — an old delivery whose DNS still times out uses up attempts", { timeout: 20_000 }, async () => {
  await hook();
  const t0 = Date.now() - 3 * 60 * MIN; // queued 3 h ago, past the 2 h deferral window
  reply = async () => new Response("", { status: 500 });
  await onSessionPaid(session("sess_old"), 25_000_000n, t0);
  const lookup = dns.lookup;
  mock.method(dns, "lookup", () => new Promise(() => {}));
  try {
    await query("UPDATE app_gw_deliveries SET next_attempt_at = $1", [Date.now() - 1]);
    assert.equal(await dispatchDue(Date.now()), 1);
    const [d] = await query("SELECT status, attempts FROM app_gw_deliveries");
    assert.deepEqual([d.status, Number(d.attempts)], ["pending", 2], "counted once the window has passed");
  } finally {
    dns.lookup = lookup;
  }
});

test("A9 (round 3): creating a webhook says when DNS timed out, separately from an unknown host", { timeout: 20_000 }, async () => {
  const lookup = dns.lookup;
  mock.method(dns, "lookup", () => new Promise(() => {}));
  try {
    await assert.rejects(createWebhook(MERCHANT, "https://shop.example/hooks"), (err) => err.status === 400 && /didn.t answer in time/i.test(err.message));
  } finally {
    dns.lookup = lookup;
  }
  await assert.rejects(createWebhook(MERCHANT, "https://nowhere.example/hooks"), (err) => err.status === 400 && /couldn.t find that host/i.test(err.message));
});

test("L1 (round 2): one attempt failing inside dispatch doesn't abort the others", async () => {
  await hook("https://shop.example/a");
  await hook("https://shop.example/b");
  reply = async () => new Response("", { status: 500 });
  const t0 = Date.now() - 10 * MIN;
  await onSessionPaid(session("sess_l1"), 25_000_000n, t0);
  reply = async () => new Response(null, { status: 204 });
  calls = [];
  const [a] = await query("SELECT d.id FROM app_gw_deliveries d JOIN app_gw_webhooks w ON w.id = d.webhook_id WHERE w.url LIKE '%/a'");
  await pg.exec(`CREATE OR REPLACE FUNCTION wf_test_fail_outcome() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${a.id}' AND NEW.attempts > OLD.attempts THEN RAISE EXCEPTION 'outcome write failed'; END IF; RETURN NEW; END $$`);
  await pg.exec(`CREATE TRIGGER wf_test_fail_outcome BEFORE UPDATE ON app_gw_deliveries FOR EACH ROW EXECUTE FUNCTION wf_test_fail_outcome()`);
  try {
    assert.equal(await dispatchDue(Date.now()), 2, "both claimed; the failure is logged, not thrown");
  } finally {
    await pg.exec("DROP TRIGGER IF EXISTS wf_test_fail_outcome ON app_gw_deliveries");
  }
  const statuses = await query("SELECT w.url, d.status FROM app_gw_deliveries d JOIN app_gw_webhooks w ON w.id = d.webhook_id ORDER BY w.url");
  assert.deepEqual(statuses.map((r) => r.status), ["pending", "succeeded"], "b still recorded; a left pending for retry");
});

test("A3: re-queuing the same event (marker lost) never adds a second delivery for an endpoint", async () => {
  await hook();
  await onSessionPaid(session("sess_dup"), 25_000_000n);
  await query("DELETE FROM app_gw_events"); // e.g. a manual cleanup: the same event id is queued again
  await onSessionPaid(session("sess_dup"), 25_000_000n);
  assert.equal((await deliveries()).length, 1);
});

test("A4: a delivery whose lease is live is skipped by dispatch and refused by replay (409, nothing sent)", async () => {
  await hook();
  reply = async () => new Response("", { status: 500 });
  const t0 = Date.now() - 10 * MIN;
  await onSessionPaid(session("sess_lease"), 25_000_000n, t0);
  const [d] = await deliveries();
  assert.equal(d.status, "pending");
  calls = [];
  // another instance is attempting it right now
  await query("UPDATE app_gw_deliveries SET leased_until = $2 WHERE id = $1", [d.id, Date.now() + MIN]);
  assert.equal(await dispatchDue(Date.now()), 0, "dispatch skips a leased delivery");
  const res = await replay(req("POST", `/api/v1/webhooks/deliveries/${d.id}/replay`, { headers: (await seedWorkspace()).headers }), params({ id: d.id }));
  assert.equal(res.status, 409);
  assert.equal(calls.length, 0, "nothing sent twice");
});

test("A5: a failed replay of a delivered event keeps it succeeded and schedules no retry", async () => {
  await hook();
  await onSessionPaid(session("sess_ok"), 25_000_000n);
  const [d] = await deliveries();
  assert.equal(d.status, "succeeded");
  reply = async () => new Response("", { status: 500 });
  const res = await replay(req("POST", `/api/v1/webhooks/deliveries/${d.id}/replay`, { headers: (await seedWorkspace()).headers }), params({ id: d.id }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.status, body.attempts, body.response_status, body.next_attempt_at], ["succeeded", 2, 500, null]);
});

test("A4: the lease is released after an attempt, so the scheduled retry is dispatched", async () => {
  await hook();
  reply = async () => new Response("", { status: 503 });
  const t0 = Date.now();
  await onSessionPaid(session("sess_retry"), 25_000_000n, t0);
  const [afterFirst] = await query("SELECT leased_until::text AS leased_until FROM app_gw_deliveries");
  assert.equal(afterFirst.leased_until, null, "the inline attempt released its lease (not merely let it expire)");
  reply = async () => new Response(null, { status: 204 });
  assert.equal(await dispatchDue(t0 + MIN), 1);
  const [d] = await deliveries();
  assert.deepEqual([d.status, Number(d.attempts)], ["succeeded", 2]);
});
