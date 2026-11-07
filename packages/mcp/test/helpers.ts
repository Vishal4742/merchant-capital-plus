// Test helpers (batch 052): a temp state dir, a scripted fetch for the testnet backend, and an in-memory MCP client
// connected to a fresh server. Key-shaped strings are built at runtime, so no key-like literal sits in the repo.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ServerOptions } from "../src/server.ts";
import type { Logger } from "../src/safety.ts";
import { run as sandboxCli } from "../src/sandbox/cli.ts";

export const BASE = "https://gateway.test";
export const TESTNET_KEY = ["sk", "test", "AbCdEfGhIjKlMnOpQrStUvWxYz012345"].join("_");
// 2026-11-06 12:00 UTC = 17:30 in Asia/Kolkata, a Friday
export const NOW = Date.parse("2026-11-06T12:00:00Z");

export const tempDir = () => mkdtempSync(join(tmpdir(), "wf-mcp-test-"));

export type Call = { url: string; method: string; headers: Headers; body: string | undefined };
type Reply = { status: number; body: unknown; headers?: Record<string, string> } | Error;

/** A fetch that answers each call from `route`; every call is recorded. */
export function fakeFetch(route: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : undefined };
    calls.push(call);
    const reply = route(call);
    if (reply instanceof Error) throw reply;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: { "content-type": "application/json", ...reply.headers } });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

/** A logger that keeps every line (to check nothing secret reaches stderr). */
export function memoryLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (m) => void lines.push(`info ${m}`), error: (m, e) => void lines.push(`error ${m} ${e instanceof Error ? e.message : String(e ?? "")}`) };
}

export type ToolResult = { text: string; json: Record<string, any>; isError: boolean };

export async function connect(env: Record<string, string | undefined>, opts: Partial<ServerOptions> = {}) {
  const log = opts.log ?? memoryLog();
  const server = createServer({ env, stateDir: opts.stateDir ?? tempDir(), now: opts.now ?? (() => NOW), log, sleep: async () => {}, ...opts });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    const text = result.content.map((part) => part.text).join("\n");
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {
      // a schema error from the SDK is plain text
    }
    return { text, json, isError: Boolean(result.isError) };
  };
  return { client, call, log: log as ReturnType<typeof memoryLog> };
}

/** The business Owner approves a publication request through the sandbox CLI (the stand-in for the review page). */
export function approveAs(stateDir: string, approvalId: string, decision: "approve" | "reject" = "approve", now: () => number = () => NOW): { code: number; said: string } {
  const lines: string[] = [];
  const code = sandboxCli([decision, approvalId], { WHITEFLOW_STATE_DIR: stateDir }, (line) => lines.push(line), now);
  return { code, said: lines.join("\n") };
}

/** finalize_invoice (the request) + the Owner's approval: the invoice as it is afterwards (published). */
export async function publish(call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>, stateDir: string, invoice: string, now: () => number = () => NOW): Promise<ToolResult> {
  const requested = await call("finalize_invoice", { invoice });
  if (requested.isError || !requested.json.approval?.id) return requested;
  const decided = approveAs(stateDir, requested.json.approval.id, "approve", now);
  if (decided.code !== 0) throw new Error(decided.said);
  return call("get_invoice", { invoice });
}

/** A sandbox server (the default mode) in its own state dir, in Asia/Kolkata. */
export async function sandbox(opts: Partial<ServerOptions> & { env?: Record<string, string> } = {}) {
  const stateDir = opts.stateDir ?? tempDir();
  const connected = await connect({ WHITEFLOW_TIMEZONE: "Asia/Kolkata", ...opts.env }, { ...opts, stateDir });
  return { ...connected, stateDir };
}
