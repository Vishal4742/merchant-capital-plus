// Batch 058 A5 (FR-MCP-1..3): connector reliability fixes shared by stdio and the later remote endpoint.
// Explicit idempotency keys get the same reconciliation and retry-age guards as generated ones; an operation-lookup 404
// is never proof a write didn't happen; a recovered success isn't settled without the normal checks; the payment-link
// prompts no longer demand customer search; invoice prompts respect unsupported capabilities and pending approval. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Journal, JournalRefusal, SERVER_RETENTION_MS } from "../src/journal.ts";
import { PROMPTS } from "../src/prompts.ts";
import { ApiError } from "../src/client.ts";
import { Mismatch, makeContext } from "../src/tools/context.ts";
import { replier, redactor } from "../src/safety.ts";
import { BASE, NOW, TESTNET_KEY, connect, fakeFetch, memoryLog, tempDir } from "./helpers.ts";

const HOUR = 60 * 60_000;

// ── review 058 R1 code H1: a journal hiccup after WhiteFlow answered must never turn a created record into "refused" ──
const PROFILE = { merchant: { address: "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1", name: "Shop" }, environment: "test", capabilities: { links: true }, timezone: null };

/** A context over a real file journal whose settle() throws the first time it is asked for `failOn`. */
function flakyContext(failOn: string) {
  const journal = new Journal(join(tempDir(), "journal.json"), () => NOW);
  let failed = false;
  const flaky = {
    claim: journal.claim.bind(journal),
    find: journal.find.bind(journal),
    unresolved: journal.unresolved.bind(journal),
    settle: (scope: string, key: string, outcome: Parameters<Journal["settle"]>[2], note?: string | null) => {
      if (outcome === failOn && !failed) {
        failed = true;
        throw new Error("neon: fetch failed");
      }
      return journal.settle(scope, key, outcome, note);
    },
  };
  const client = { origin: new URL(BASE), account: async () => ({ data: PROFILE, replayed: false }) };
  const log = memoryLog();
  const ctx = makeContext({ mode: "testnet", client: client as never, journal: flaky, reply: replier(redactor([]), log, {}), log, now: () => NOW, configuredZone: null, trustedOrigins: [] });
  return { ctx, journal, log };
}

test("a failed 'done' settle after a successful create keeps the write's identity: the retry sends the SAME key", async () => {
  const { ctx, journal, log } = flakyContext("done");
  const keys: string[] = [];
  const send = async (key: string) => {
    keys.push(key);
    return { data: { id: "lnk_1" }, replayed: keys.length > 1 };
  };
  const first = await ctx.write("create_payment_link", { amount: "25.00" }, {}, send);
  assert.equal(first.data.id, "lnk_1", "the created record is reported, not hidden behind a journal error");
  const scope = (await ctx.profile()).scope;
  assert.notEqual(journal.find(scope, keys[0])?.outcome, "refused", "never 'refused': WhiteFlow said yes");
  assert.ok(log.lines.some((l) => /settle/i.test(l)), "the journal failure is logged");
  await ctx.write("create_payment_link", { amount: "25.00" }, {}, send);
  assert.equal(new Set(keys).size, 1, "one key across both calls, so the gateway replays instead of creating a second link");
});

test("a failed 'needs_reconciliation' settle after a mismatching reply never becomes 'refused' either", async () => {
  const { ctx, journal } = flakyContext("needs_reconciliation");
  const keys: string[] = [];
  const send = async (key: string) => (keys.push(key), { data: { id: "lnk_wrong" }, replayed: false });
  const verify = () => {
    throw new Mismatch("amount 99 instead of 25.00");
  };
  await assert.rejects(ctx.write("create_payment_link", { amount: "25.00" }, {}, send, verify));
  const scope = (await ctx.profile()).scope;
  assert.notEqual(journal.find(scope, keys[0])?.outcome, "refused");
  await assert.rejects(ctx.write("create_payment_link", { amount: "25.00" }, {}, send, verify));
  assert.equal(new Set(keys).size, 1, "the retry resumes the same key; it never mints a fresh one");
});

test("only a definite refusal from WhiteFlow settles 'refused'; an unexpected error leaves the write pending", async () => {
  const { ctx, journal } = flakyContext("never");
  const scope = (await ctx.profile()).scope;
  await assert.rejects(ctx.write("create_payment_link", { amount: "1.00" }, {}, async () => {
    throw new ApiError(422, "amount too small");
  }));
  assert.equal(journal.unresolved(scope).length, 0, "a 422 is a definite no");
  const keys: string[] = [];
  await assert.rejects(ctx.write("create_payment_link", { amount: "2.00" }, {}, async (key) => {
    keys.push(key);
    throw new TypeError("something unexpected");
  }));
  assert.equal(journal.unresolved(scope)[0]?.key, keys[0], "an unknown failure is not proof nothing was created");
});
const SCOPE = "scope-a";
const PAYLOAD = { amount: "25.00", currency: "USDT", description: "Beans" };
const journalAt = (clock: { now: number }) => new Journal(join(tempDir(), "journal.json"), () => clock.now);
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof JournalRefusal, String(error));
    return error;
  }
  assert.fail("expected a JournalRefusal");
};

test("an explicit key on a request that needs reconciliation is refused, like a generated one", () => {
  const clock = { now: NOW };
  const j = journalAt(clock);
  const first = j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0001-first" });
  j.settle(SCOPE, first.key, "needs_reconciliation", "reply didn't match");
  const again = refusal(() => j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0001-first" }));
  assert.match(again.message, /reconcil/i);
  // a different explicit key for the same request must not slip past the guard either
  refusal(() => j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0001-second" }));
  // only a deliberate create_another passes, with a key the caller chose
  assert.equal(j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0001-second", createAnother: true }).key, "order-0001-second");
});

test("an explicit key past the server's retention window is flagged for reconciliation, not re-sent", () => {
  const clock = { now: NOW };
  const j = journalAt(clock);
  j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0002-aaaa" }); // outcome unknown: stays pending
  clock.now += SERVER_RETENTION_MS - HOUR + 1; // beyond the resume limit (24 h minus a one-hour margin)
  const late = refusal(() => j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0002-aaaa" }));
  assert.match(late.message, /no longer keeps its key|can't be safely retried/);
  assert.equal(j.find(SCOPE, "order-0002-aaaa")?.outcome, "needs_reconciliation");
  refusal(() => j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0002-aaaa" })); // and it stays blocked
});

test("an explicit key still resumes its own unresolved write inside the window, with the same key", () => {
  const clock = { now: NOW };
  const j = journalAt(clock);
  j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0003-aaaa" });
  clock.now += 2 * HOUR;
  const resumed = j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0003-aaaa" });
  assert.deepEqual([resumed.key, resumed.source], ["order-0003-aaaa", "caller"]);
});

test("a different explicit key while an identical write is still unresolved is refused (it could duplicate)", () => {
  const clock = { now: NOW };
  const j = journalAt(clock);
  const open = j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0004-aaaa" });
  const blocked = refusal(() => j.claim(SCOPE, "create_payment_link", PAYLOAD, { callerKey: "order-0004-bbbb" }));
  assert.match(blocked.message, new RegExp(open.key));
  // and the generated-key path agrees: it resumes that same key rather than minting another
  assert.equal(j.claim(SCOPE, "create_payment_link", PAYLOAD).key, "order-0004-aaaa");
});

test("another merchant's unresolved write never blocks this one", () => {
  const clock = { now: NOW };
  const j = journalAt(clock);
  j.claim("scope-a", "create_payment_link", PAYLOAD, { callerKey: "order-0005-aaaa" });
  assert.equal(j.claim("scope-b", "create_payment_link", PAYLOAD, { callerKey: "order-0005-bbbb" }).key, "order-0005-bbbb");
});

// ── operation lookup ──
const ACCOUNT = {
  merchant: { address: "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1", name: "Bandra Beans" },
  environment: "test",
  network: { name: "Whitechain Testnet", chain_id: 1874, explorer: "https://explorer.testnet.whitechain.io" },
  settlement: { asset: "USDT", token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", decimals: 6 },
  price_currencies: ["USDT"],
  payment_limits: { currency: "USDT", min: "1.00", max: "1000.00" },
  payment_methods: [{ id: "usdt_signature", label: "USDT on Whitechain Testnet" }],
  timezone: null,
  credential: { type: "secret_key", key_id: "key_abc", scopes: null, expires_at: null },
  capabilities: { links: true, payments: true, reports: true, customers: false, invoices: false, reminders: false, operations: true },
};
const LINK = { id: "lnk_AbCdEfGhIjKlMnOp", slug: "Ab3dE6gH9k", url: "/l/Ab3dE6gH9k", amount: "25.00", currency: "USDT", description: "Beans", reference_id: null, single_use: true, status: "active", expires_at: null, created_at: "2026-11-06T12:00:00.000Z", payments: 0 };
const ENV = { WHITEFLOW_MODE: "testnet", WHITEFLOW_API_KEY: TESTNET_KEY, WHITEFLOW_BASE_URL: BASE };

/** A gateway whose first link POST loses its reply, and whose operation lookup answers `operation`. */
function lostWrite(operation: { status: number; body: unknown }) {
  return fakeFetch(({ method, url }) => {
    const { pathname } = new URL(url);
    if (method === "GET" && pathname === "/api/v1/account") return { status: 200, body: ACCOUNT };
    if (method === "POST" && pathname === "/api/v1/links") return new TypeError("fetch failed");
    if (method === "GET" && pathname.startsWith("/api/v1/operations/")) return operation;
    return { status: 404, body: "<html>404</html>" };
  });
}

test("an operation-lookup 404 is never reported as proof the write did not happen", async () => {
  const { fetch } = lostWrite({ status: 404, body: { error: "not found" } });
  const { call } = await connect(ENV, { fetch });
  const lost = await call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans" });
  const key = lost.json.idempotency_key;
  assert.ok(key, lost.text);
  const status = await call("get_operation_status", { idempotency_key: key });
  assert.doesNotMatch(status.text, /never happened|did not happen/i);
  assert.match(status.text, /not (a )?proof|does not prove|doesn't prove/i);
  assert.equal(status.json.operation.state, "pending", "the entry stays unresolved");
});

test("a lookup that says succeeded is shown, but the write isn't settled until its record passes the normal checks", async () => {
  const { fetch } = lostWrite({ status: 200, body: { idempotency_key: "k", route: "POST /api/v1/links", state: "succeeded", http_status: 201, result_id: LINK.id, created_at: LINK.created_at } });
  const { call } = await connect(ENV, { fetch });
  const lost = await call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans" });
  const key = lost.json.idempotency_key;
  const status = await call("get_operation_status", { idempotency_key: key });
  assert.equal(status.json.operation.whiteflow_record.state, "succeeded");
  assert.equal(status.json.operation.state, "pending", "not marked done from a bare record id");
  assert.match(status.text, /get_payment_link/);
});

// ── prompts ──
const text = (name: string) => PROMPTS.find((p) => p.name === name)!.text;

test("payment-link prompts don't require a customer search", () => {
  assert.doesNotMatch(text("collect-payment"), /search_customers/);
  assert.doesNotMatch(text("summarize-collections"), /search_customers/);
});

test("invoice prompts check capabilities first and treat approval as pending", () => {
  for (const name of ["create-invoice", "review-overdue"]) {
    assert.match(text(name), /capabilit/i, name);
    assert.match(text(name), /isn't available|not available|unsupported/i, name);
  }
  const create = text("create-invoice");
  assert.match(create, /approval/i);
  assert.match(create, /never say[^.]*(published|sent)/i);
});
