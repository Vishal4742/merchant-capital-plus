// Adapted from Pixa (MIT) src/server.ts and src/config.ts: one McpServer, with the tools the environment allows.
// Changes for Merchant Capital+: merchant tools on the gateway API (MCP_SECRET_KEY, FR-MCP-1, FR-MCP-2) and payer
// tools (MCP_PAYER_KEY, FR-MCP-5) instead of Pixa's Algorand wallet, swap and token tools; the payer tools exist only
// when that key is set; a bad setting stops startup with a reason that never repeats a key (FR-MCP-3).
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Gateway } from "../../sdk/index.ts";
import { parseUsdt, replier } from "./common.ts";
import { CEILING, SpendingTracker, type Limits } from "./spending.ts";
import { registerMerchantTools } from "./tools/merchant.ts";
import { registerPay } from "./tools/pay.ts";
import { registerSpendingReport } from "./tools/spending-report.ts";

export const DEFAULT_BASE_URL = "https://whiteflow-app.vercel.app";
const DEFAULT_PER_PAYMENT = "10"; // USDT (SRS FR-MCP-5)
const DEFAULT_PER_DAY = "25";
const SECRET_KEY = /^sk_test_[A-Za-z0-9_-]{16,128}$/;
const PAYER_KEY = /^0x[0-9a-fA-F]{64}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface ServerOptions {
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  /** Default: $XDG_CONFIG_HOME (or ~/.config)/merchant-capital-mcp/spending.json */
  spendingFile?: string;
  now?: () => number;
}

function baseUrl(text: string): URL {
  const url = URL.canParse(text) ? new URL(text) : null;
  const secure = url && (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)));
  if (!url || !secure || url.username || url.password) {
    throw new Error(`MCP_BASE_URL must be the gateway's https origin, like ${DEFAULT_BASE_URL} (http only for localhost).`);
  }
  return new URL(url.origin);
}

function cap(env: ServerOptions["env"], name: string, fallback: string): bigint {
  let units: bigint;
  try {
    units = parseUsdt(env[name] ?? fallback, name);
  } catch {
    throw new Error(`${name} must be a USDT amount like 10.00.`);
  }
  if (units === 0n || units > CEILING) throw new Error(`${name} must be more than 0 and at most 100 USDT.`);
  return units;
}

function limits(env: ServerOptions["env"]): Limits {
  const perPayment = cap(env, "MCP_MAX_PER_PAYMENT", DEFAULT_PER_PAYMENT), perDay = cap(env, "MCP_MAX_PER_DAY", DEFAULT_PER_DAY);
  if (perDay < perPayment) throw new Error("MCP_MAX_PER_DAY must be at least MCP_MAX_PER_PAYMENT.");
  return { perPayment, perDay };
}

const defaultSpendingFile = (env: ServerOptions["env"]) => join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "merchant-capital-mcp", "spending.json");

export function createServer(opts: ServerOptions): McpServer {
  const { env } = opts;
  const secretKey = env.MCP_SECRET_KEY || undefined, payerKey = env.MCP_PAYER_KEY || undefined;
  if (!secretKey && !payerKey) throw new Error("Set MCP_SECRET_KEY (your sk_test_ key) for the merchant tools, and MCP_PAYER_KEY only to let the assistant pay checkouts.");
  if (secretKey && !SECRET_KEY.test(secretKey)) throw new Error("MCP_SECRET_KEY must be your secret key, starting sk_test_ (Developers screen). A pk_ key won't work.");
  if (payerKey && !PAYER_KEY.test(payerKey)) throw new Error("MCP_PAYER_KEY must be a test wallet's private key: 0x and 64 hex characters.");
  const base = baseUrl(env.MCP_BASE_URL || DEFAULT_BASE_URL);
  const fetch = opts.fetch ?? globalThis.fetch, now = opts.now ?? Date.now;

  const server = new McpServer({ name: "merchant-capital", version: "0.1.0" });
  const reply = replier([secretKey, payerKey]);
  if (secretKey) registerMerchantTools(server, { gateway: new Gateway(secretKey, { baseUrl: base.origin, fetch }), base, reply });
  if (payerKey) {
    const account = privateKeyToAccount(payerKey as Hex);
    const spending = new SpendingTracker(opts.spendingFile ?? defaultSpendingFile(env), limits(env), now);
    registerPay(server, { account, base, fetch, now, spending, reply });
    registerSpendingReport(server, { spending, payer: account.address, reply });
  }
  return server;
}
