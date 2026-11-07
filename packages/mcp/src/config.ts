// The connector's settings, from the environment (an .mcpb install fills them from its user_config). A bad setting
// stops startup with a reason that never repeats a key value (FR-MCP-3). Sandbox is the default (the human's brief:
// "Default local setup to sandbox").
import { gatewayOrigin } from "./client.ts";
import { validZone } from "./dates.ts";

export type Mode = "sandbox" | "testnet";
export const DEFAULT_BASE_URL = "https://whiteflow.org"; // the deployed Whiteflow gateway (testnet)
const TESTNET_KEY = /^sk_test_[A-Za-z0-9_-]{16,128}$/;
const SANDBOX_KEY = /^wf_sbx_[A-Za-z0-9_-]{32}$/;

export interface Config {
  mode: Mode;
  apiKey: string | null; // sandbox: optional (the local default key is used)
  baseUrl: URL | null; // testnet only
  timezone: string | null; // used when the backend has none; null → UTC
  /** Extra https origins whose checkout/invoice URLs may be shown (an approved custom checkout domain). The gateway's
   *  own origin is always trusted; nothing else is (production review F3). */
  trustedOrigins: string[];
  warnings: string[];
}

/** An .mcpb host fills env from user_config; an optional field left empty may arrive as "" or, depending on the
 *  host, as the literal "${user_config.x}" placeholder. Both mean "not set". */
const setting = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text && !/^\$\{user_config\.[A-Za-z0-9_]+\}$/.test(text) ? text : undefined;
};

export function parseConfig(rawEnv: Record<string, string | undefined>): Config {
  const env = Object.fromEntries(Object.entries(rawEnv).map(([name, value]) => [name, setting(value)]));
  const warnings: string[] = [];
  const modeText = (env.WHITEFLOW_MODE || "sandbox").trim().toLowerCase();
  if (modeText !== "sandbox" && modeText !== "testnet") throw new Error('WHITEFLOW_MODE must be "sandbox" (simulated, the default) or "testnet" (the real Whiteflow gateway on Whitechain Testnet).');
  const mode = modeText as Mode;
  const key = env.WHITEFLOW_API_KEY?.trim() || null;
  const zone = env.WHITEFLOW_TIMEZONE?.trim() || null;
  if (zone && !validZone(zone)) throw new Error("WHITEFLOW_TIMEZONE must be an IANA time zone like Asia/Kolkata or Europe/London.");
  if (env.MCP_PAYER_KEY) warnings.push("MCP_PAYER_KEY is ignored: the Whiteflow connector never signs or pays (pay_checkout was removed). Delete it from your config.");
  // A refusal, not a warning: the old README's setup would otherwise start the sandbox silently.
  if (env.MCP_SECRET_KEY && !key) throw new Error("MCP_SECRET_KEY is no longer read: set WHITEFLOW_API_KEY (your sk_test_ key) and WHITEFLOW_MODE=testnet instead, or remove MCP_SECRET_KEY to use the sandbox.");
  const trustedOrigins = (env.WHITEFLOW_TRUSTED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => gatewayOrigin(o, "WHITEFLOW_TRUSTED_ORIGINS").origin);

  if (mode === "testnet") {
    if (!key) throw new Error("Testnet mode needs WHITEFLOW_API_KEY: your secret key from the Whiteflow dashboard's Developers screen (it starts sk_test_).");
    if (key.startsWith("pk_")) throw new Error("WHITEFLOW_API_KEY is a publishable key (pk_…). Use your secret key (sk_test_…); a publishable key can't read or create records.");
    if (!TESTNET_KEY.test(key)) throw new Error("WHITEFLOW_API_KEY must be your secret key, starting sk_test_ (Developers screen).");
    return { mode, apiKey: key, baseUrl: gatewayOrigin(env.WHITEFLOW_BASE_URL?.trim() || DEFAULT_BASE_URL), timezone: zone, trustedOrigins, warnings };
  }
  if (key && !SANDBOX_KEY.test(key)) {
    throw new Error(key.startsWith("sk_") ? "That's a testnet key (sk_…): set WHITEFLOW_MODE=testnet to use it. Sandbox mode needs no key." : "In sandbox mode leave WHITEFLOW_API_KEY empty (a local sandbox key is made for you), or give a wf_sbx_ key.");
  }
  if (env.WHITEFLOW_BASE_URL && env.WHITEFLOW_BASE_URL !== DEFAULT_BASE_URL) warnings.push("WHITEFLOW_BASE_URL is ignored in sandbox mode.");
  return { mode, apiKey: key, baseUrl: null, timezone: zone, trustedOrigins: [], warnings };
}
