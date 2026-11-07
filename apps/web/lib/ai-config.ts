// What this deployment says about the AI connection (batch 058). Pure over `env` so tests can pin it. The service counts
// as provisioned only when the owner has set WHITEFLOW_MCP_REMOTE=on (the endpoint and its sign-in are deployed) AND both
// public URLs are valid https. Anything else is "unavailable": there is no fallback to localhost, a sandbox or a made-up host.
import { parsePublicUrl } from "./ai-connect.ts";
import { publicOrigin } from "./config.ts";

export interface AiConnectConfig {
  available: boolean;
  setupUrl: string | null;
  mcpUrl: string | null;
}

export function aiConnectConfig(env: Record<string, string | undefined>, requestOrigin: string): AiConnectConfig {
  const mcpUrl = parsePublicUrl(env.WHITEFLOW_MCP_PUBLIC_URL);
  const origin = env.PUBLIC_ORIGIN ?? requestOrigin;
  const setupUrl = parsePublicUrl(`${origin.replace(/\/+$/, "")}/connect`);
  const on = env.WHITEFLOW_MCP_REMOTE === "on";
  return { available: on && Boolean(mcpUrl) && Boolean(setupUrl), setupUrl: setupUrl && mcpUrl ? setupUrl : null, mcpUrl: setupUrl && mcpUrl ? mcpUrl : null };
}

/** The config for this server process; `fallback` is the request's own origin, used only when PUBLIC_ORIGIN is unset. */
export const currentAiConnect = (fallback: string): AiConnectConfig => aiConnectConfig({ ...process.env, PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ? publicOrigin(fallback) : undefined }, fallback);
