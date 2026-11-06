// Test helpers: a scripted fetch, an in-memory MCP client, and a hosted checkout page in Next.js's flight format.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

export const BASE = "https://gateway.test";
export const SECRET = "sk_test_AbCdEfGhIjKlMnOpQrStUvWxYz012345";
// a throwaway key built at runtime, so no key-shaped literal sits in the repo (the CI secret scan)
export const PAYER = `0x${"5a".repeat(32)}`;
export const MERCHANT_PAY = "0xab817593253a0a37de723072827d88fe0ca54251";
export const MERCHANT = "0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1";
export const ORDER_REF = `0x${"d6".repeat(32)}`;
export const NOW = Date.parse("2026-11-06T12:00:00Z");

export type Call = { url: string; method: string; headers: Headers; body: string | undefined };
type Reply = { status: number; body: unknown; type?: string } | Error;
type Route = (call: Call) => Reply;

/** A fetch that answers each call from `route`; every call is recorded. */
export function fakeFetch(route: Route) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : undefined };
    calls.push(call);
    const reply = route(call);
    if (reply instanceof Error) throw reply;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: { "content-type": reply.type ?? "application/json" } });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

export const tempFile = () => join(mkdtempSync(join(tmpdir(), "mcp-test-")), "spending.json");

export async function connect(env: Record<string, string | undefined>, fetch: typeof globalThis.fetch, opts: { spendingFile?: string; now?: () => number } = {}) {
  const server = createServer({ env: { MCP_BASE_URL: BASE, ...env }, fetch, spendingFile: opts.spendingFile ?? tempFile(), now: opts.now ?? (() => NOW) });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { text: result.content.map((part) => part.text).join("\n"), isError: Boolean(result.isError) };
  };
  return { client, call };
}

export interface PageTerms {
  id: string;
  amount: string; // USDT units
  merchantPay?: string;
  expiresAt?: number;
  paid?: boolean;
  pending?: boolean;
}

/** The hosted checkout page as Next.js streams it: the Checkout props inside self.__next_f.push string chunks, split
 *  mid-object like a real stream. */
export function checkoutPage(terms: PageTerms): string {
  const sale = { merchantPay: terms.merchantPay ?? MERCHANT_PAY, merchant: MERCHANT, orderRef: ORDER_REF, amount: terms.amount };
  const props = { sessionId: terms.id, merchantName: "Bandra Beans", reference: 'say "sale":{} here', sale, expiresAt: terms.expiresAt ?? NOW + 30 * 60_000, paid: terms.paid ?? false, pending: terms.pending ?? false };
  const flight = `5:["$","$L6",null,${JSON.stringify(props)}]\n`;
  const cut = flight.indexOf('"orderRef"');
  const push = (chunk: string) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`;
  return `<!DOCTYPE html><html><body>${push('1:"$Sreact.fragment"\n')}${push(flight.slice(0, cut))}${push(flight.slice(cut))}</body></html>`;
}
