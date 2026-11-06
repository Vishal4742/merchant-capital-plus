// Shared by every tool: USDT amounts, checkout ids, explorer links, and the one reply path, which redacts the keys
// from every result and every error (FR-MCP-3).
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatUnits, parseUnits } from "viem";

export const CURRENCIES = ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"] as const; // POST /api/v1/sessions (FR-GW-11)
const EXPLORER_TX = "https://explorer.testnet.whitechain.io/tx/";
const AMOUNT = /^\d+(\.\d{1,6})?$/;
const CHECKOUT_ID = /^[\w-]{1,64}$/;
const CHECKOUT_PATH = /^\/checkout\/([\w-]{1,64})\/?$/;

export const explorer = (txHash: string | null | undefined): string | null => (txHash ? `${EXPLORER_TX}${txHash}` : null);

/** "25" or "25.50" → USDT units (6 decimals). Throws a plain reason for anything else. */
export function parseUsdt(text: string, name = "amount"): bigint {
  if (!AMOUNT.test(text)) throw new Error(`${name} must be a number like 25.00, with at most 6 decimals.`);
  return parseUnits(text, 6);
}

/** USDT units → "25.50": at least 2 decimals, no thousands commas. */
export function usdt(units: bigint): string {
  const [whole, fraction = ""] = formatUnits(units, 6).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/** A checkout id, or a /checkout/<id> URL on the gateway's own origin. */
export function checkoutId(input: string, base: URL): string {
  if (CHECKOUT_ID.test(input)) return input;
  const url = URL.canParse(input) ? new URL(input) : null;
  const match = url && url.origin === base.origin ? CHECKOUT_PATH.exec(url.pathname) : null;
  if (!match) throw new Error(`Give a checkout id or a checkout URL on ${base.origin} (like ${base.origin}/checkout/<id>).`);
  return match[1];
}

export type Reply = (work: () => Promise<unknown>) => Promise<CallToolResult>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Runs a tool and turns its result or error into MCP text, with every key replaced by [redacted]. A hex key is
 *  matched without its 0x and in any case. */
export function replier(secrets: (string | undefined)[]): Reply {
  const patterns = secrets.filter((s): s is string => Boolean(s)).map((s) => new RegExp(escapeRegExp(s.replace(/^0x/i, "")), "gi"));
  const redact = (text: string) => patterns.reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);
  return async (work) => {
    try {
      return { content: [{ type: "text", text: redact(JSON.stringify(await work(), null, 2)) }] };
    } catch (error) {
      // the SDK's 401 hint names its own env var; ours is MCP_SECRET_KEY
      const message = (error instanceof Error ? error.message : String(error)).replaceAll("GATEWAY_SECRET_KEY", "MCP_SECRET_KEY");
      return { content: [{ type: "text", text: redact(message) }], isError: true };
    }
  };
}
