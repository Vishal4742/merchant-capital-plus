// Batch 058 phase B (FR-MCP-1..3; SRS-CHANGE FR-MCP-18/19 proposed): the remote server factory. One server per
// authenticated request, bound to that request's principal: exactly the six real tools, scope checked when a tool is CALLED
// (not only when it is listed), a successful call reported so a grant can be marked verified, and no state shared between
// tenants. Offline: the gateway is scripted, the journal is PGlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PGlite } from "@electric-sql/pglite";
import { PgJournal, type SqlRunner } from "../src/journal-pg.ts";
import { REMOTE_TOOLS, createRemoteServer, type RemotePrincipal, type RemoteEvent } from "../src/remote.ts";
import { WhiteflowClient } from "../src/client.ts";
import { NOW, fakeFetch, memoryLog, type Call } from "./helpers.ts";

const BASE = "https://gateway.test";
const MIGRATION = readFileSync(new URL("../../../apps/web/db/051_mcp_remote.sql", import.meta.url), "utf8");
const ACCOUNT = (address: string) => ({
  merchant: { address, name: "Shop" },
  environment: "test",
  network: { name: "Whitechain Testnet", chain_id: 1874, explorer: "https://explorer.testnet.whitechain.io" },
  settlement: { asset: "USDT", token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", decimals: 6 },
  price_currencies: ["USDT"],
  payment_limits: { currency: "USDT", min: "1.00", max: "1000.00" },
  payment_methods: [{ id: "usdt_signature", label: "USDT on Whitechain Testnet" }],
  timezone: null,
  credential: { type: "mcp_grant", key_id: null, scopes: null, expires_at: null },
  capabilities: { links: true, payments: true, reports: true, customers: false, invoices: false, reminders: false, operations: true },
});
const LINK = { id: "lnk_AbCdEfGhIjKlMnOp", slug: "Ab3dE6gH9k", url: "/l/Ab3dE6gH9k", amount: "25.00", currency: "USDT", description: "Beans", reference_id: null, single_use: true, status: "active", expires_at: null, created_at: "2026-11-06T12:00:00.000Z", payments: 0 };
const A = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
const B = "0x00000000000000000000000000000000000b0b01";
const ALL = ["account:read", "links:read", "payments:read", "reports:read", "links:write"];

async function database() {
  const db = new PGlite();
  await db.exec(MIGRATION);
  const sql: SqlRunner = { query: async (text, params) => (await db.query(text, params as unknown[])).rows as Record<string, unknown>[] };
  return sql;
}

/** One request's server for `principal`, a scripted gateway, and a handle to call tools like an MCP client would. */
async function connectAs(principal: RemotePrincipal, sql: SqlRunner, extra: { token?: string; events?: RemoteEvent[]; routes?: (call: Call) => { status: number; body: unknown } | undefined } = {}) {
  const token = extra.token ?? `wfi1.${principal.grantId}.signature-placeholder`;
  const { calls, fetch } = fakeFetch((call) => {
    const { pathname } = new URL(call.url);
    const custom = extra.routes?.(call);
    if (custom) return custom;
    if (call.method === "GET" && pathname === "/api/v1/account") return { status: 200, body: ACCOUNT(principal.merchant) };
    if (call.method === "POST" && pathname === "/api/v1/links") return { status: 201, body: LINK };
    return { status: 404, body: { error: "not found" } };
  });
  const client = new WhiteflowClient({ baseUrl: new URL(BASE), apiKey: token, fetch, sleep: async () => {} });
  const server = createRemoteServer({ principal, client, journal: new PgJournal(sql, () => NOW), now: () => NOW, log: memoryLog(), onEvent: (e) => { extra.events?.push(e); } });
  const mcp = new Client({ name: "test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await mcp.connect(c);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content.map((p) => p.text).join("\n");
    let json: Record<string, any> = {};
    try { json = JSON.parse(text); } catch { /* plain text */ }
    return { text, json, isError: Boolean(r.isError) };
  };
  return { mcp, call, calls };
}

const principal = (merchant: string, scopes: string[], grantId = "grant_1"): RemotePrincipal => ({ merchant, scopes, grantId });

test("exactly the six real tools are listed, and no prompts", async () => {
  const { mcp } = await connectAs(principal(A, ALL), await database());
  const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...REMOTE_TOOLS].sort());
  assert.deepEqual(names, ["create_payment_link", "get_business_profile", "get_collection_summary", "get_operation_status", "get_payment_link", "list_payments"]);
  assert.equal((await mcp.listPrompts().catch(() => ({ prompts: [] }))).prompts.length, 0);
});

test("a tool outside the six can't be called even by name (customers and invoices don't exist remotely)", async () => {
  const { mcp } = await connectAs(principal(A, ALL), await database());
  for (const name of ["create_customer", "create_invoice_draft", "finalize_invoice", "pay_checkout", "search_customers"]) {
    const result = await mcp.callTool({ name, arguments: {} }).then((r) => r, (e) => ({ isError: true, thrown: String(e) }));
    assert.equal((result as { isError?: boolean }).isError, true, name);
  }
});

test("scope is enforced when a tool is called: links:write is needed to create, and nothing reaches the gateway without it", async () => {
  const read = principal(A, ["account:read", "links:read", "payments:read", "reports:read"]);
  const { call, calls } = await connectAs(read, await database());
  const denied = await call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans" });
  assert.equal(denied.isError, true);
  assert.match(denied.text, /links:write/);
  assert.equal(calls.length, 0, "no request of any kind went to the gateway");
});

test("each read tool needs its own scope", async () => {
  const only = (scope: string) => principal(A, [scope]);
  const cases: [string, string, Record<string, unknown>][] = [
    ["get_business_profile", "account:read", {}],
    ["get_payment_link", "links:read", { link_id: "lnk_AbCdEfGhIjKlMnOp" }],
    ["list_payments", "payments:read", {}],
    ["get_collection_summary", "reports:read", { period: "this_week" }],
    ["get_operation_status", "links:read", {}],
  ];
  const sql = await database();
  for (const [tool, scope, args] of cases) {
    const wrongScope = scope === "links:read" ? "payments:read" : "links:read";
    const refused = await (await connectAs(only(wrongScope), sql)).call(tool, args);
    assert.equal(refused.isError, true, `${tool} with only ${wrongScope}`);
    assert.match(refused.text, new RegExp(scope.replace(":", ":")), tool);
  }
});

test("acknowledging an operation is a write: it needs links:write, plain status needs only links:read", async () => {
  const sql = await database();
  const readOnly = await connectAs(principal(A, ["links:read"]), sql);
  assert.equal((await readOnly.call("get_operation_status", {})).isError, false);
  const ack = await readOnly.call("get_operation_status", { idempotency_key: "order-0001-aaaa", acknowledge: true });
  assert.equal(ack.isError, true);
  assert.match(ack.text, /links:write/);
});

test("only a successful, authorized tool call is reported as verification, tied to its grant", async () => {
  const events: RemoteEvent[] = [];
  const sql = await database();
  const { call } = await connectAs(principal(A, ["account:read"], "grant_77"), sql, { events });
  await call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans" }); // denied: no links:write
  assert.deepEqual(events.filter((e) => e.type === "tool_ok"), []);
  assert.equal(events.filter((e) => e.type === "tool_denied").length, 1);
  const ok = await call("get_business_profile");
  assert.equal(ok.isError, false, ok.text);
  assert.deepEqual(events.filter((e) => e.type === "tool_ok").map((e) => [e.grantId, e.tool]), [["grant_77", "get_business_profile"]]);
});

test("a tool that fails (gateway error) is not verification", async () => {
  const events: RemoteEvent[] = [];
  const { call } = await connectAs(principal(A, ALL, "grant_5"), await database(), { events, routes: (c) => (new URL(c.url).pathname === "/api/v1/account" ? { status: 500, body: { error: "boom" } } : undefined) });
  assert.equal((await call("get_business_profile")).isError, true);
  assert.deepEqual(events.filter((e) => e.type === "tool_ok"), []);
});

test("the request's own credential goes to the gateway, never anything global; two tenants share nothing", async () => {
  const sql = await database();
  const a = await connectAs(principal(A, ALL, "grant_a"), sql, { token: "wfi1.token-for-merchant-a-only" });
  const b = await connectAs(principal(B, ALL, "grant_b"), sql, { token: "wfi1.token-for-merchant-b-only" });
  assert.equal((await a.call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "order-0001-aaaa" })).isError, false);
  for (const call of a.calls) assert.equal(call.headers.get("authorization"), "Bearer wfi1.token-for-merchant-a-only");
  // B's journal view has none of A's writes, and the same explicit key in B's scope is a different entry
  const bStatus = await b.call("get_operation_status", {});
  assert.deepEqual(bStatus.json.unresolved, []);
  assert.equal((await b.call("create_payment_link", { amount: "25", currency: "USDT", description: "Beans", idempotency_key: "order-0001-aaaa" })).isError, false);
  for (const call of b.calls) assert.equal(call.headers.get("authorization"), "Bearer wfi1.token-for-merchant-b-only");
  assert.ok(b.calls.every((c) => !(c.headers.get("authorization") ?? "").includes("merchant-a")));
});

test("the credential never appears in any tool output", async () => {
  const token = "wfi1.SECRET-ASSERTION-VALUE-123456";
  const { call } = await connectAs(principal(A, ALL), await database(), { token });
  for (const [tool, args] of [["get_business_profile", {}], ["get_operation_status", {}]] as const) assert.ok(!(await call(tool, args)).text.includes("SECRET-ASSERTION"));
});
