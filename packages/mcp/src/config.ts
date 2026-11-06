// The connector's settings, from the environment (an .mcpb install fills them from its user_config). A bad setting
// stops startup with a reason that never repeats a key value (FR-MCP-3). Sandbox is the default (the human's brief:
// "Default local setup to sandbox").
import { gatewayOrigin } from "./client.ts";
import { validZone } from "./dates.ts";

export type Mode = "sandbox" | "testnet";
export const DEFAULT_BASE_URL = "https://merchant-capital.vercel.app"; // the deployed WhiteFlow gateway (testnet)
const TESTNET_KEY = /^sk_test_[A-Za-z0-9_-]{16,128}$/;
const SANDBOX_KEY = /^wf_sbx_[A-Za-z0-9_-]{32}$/;

export interface Config {
  mode: Mode;
  apiKey: string | null; // sandbox: optional (the local default key is used)
  baseUrl: URL | null; // testnet only
  timezone: string | null; // used when the backend has none; null → UTC
  warnings: string[];
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const warnings: string[] = [];
  const modeText = (env.WHITEFLOW_MODE || "sandbox").trim().toLowerCase();
  if (modeText !== "sandbox" && modeText !== "testnet") throw new Error('WHITEFLOW_MODE must be "sandbox" (simulated, the default) or "testnet" (the real WhiteFlow gateway on Whitechain Testnet).');
  const mode = modeText as Mode;
  const key = env.WHITEFLOW_API_KEY?.trim() || null;
  const zone = env.WHITEFLOW_TIMEZONE?.trim() || null;
  if (zone && !validZone(zone)) throw new Error("WHITEFLOW_TIMEZONE must be an IANA time zone like Asia/Kolkata or Europe/London.");
  if (env.MCP_PAYER_KEY) warnings.push("MCP_PAYER_KEY is ignored: the WhiteFlow connector never signs or pays (pay_checkout was removed). Delete it from your config.");
  if (env.MCP_SECRET_KEY && !key) warnings.push("MCP_SECRET_KEY is no longer read: set WHITEFLOW_API_KEY and WHITEFLOW_MODE=testnet instead.");

  if (mode === "testnet") {
    if (!key) throw new Error("Testnet mode needs WHITEFLOW_API_KEY: your secret key from the WhiteFlow dashboard's Developers screen (it starts sk_test_).");
    if (key.startsWith("pk_")) throw new Error("WHITEFLOW_API_KEY is a publishable key (pk_…). Use your secret key (sk_test_…); a publishable key can't read or create records.");
    if (!TESTNET_KEY.test(key)) throw new Error("WHITEFLOW_API_KEY must be your secret key, starting sk_test_ (Developers screen).");
    return { mode, apiKey: key, baseUrl: gatewayOrigin(env.WHITEFLOW_BASE_URL?.trim() || DEFAULT_BASE_URL), timezone: zone, warnings };
  }
  if (key && !SANDBOX_KEY.test(key)) {
    throw new Error(key.startsWith("sk_") ? "That's a testnet key (sk_…): set WHITEFLOW_MODE=testnet to use it. Sandbox mode needs no key." : "In sandbox mode leave WHITEFLOW_API_KEY empty (a local sandbox key is made for you), or give a wf_sbx_ key.");
  }
  if (env.WHITEFLOW_BASE_URL) warnings.push("WHITEFLOW_BASE_URL is ignored in sandbox mode.");
  return { mode, apiKey: key, baseUrl: null, timezone: zone, warnings };
}
