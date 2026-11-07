// The service's settings, from the environment, failing closed (batch 058; FR-MCP-1..3, FR-GW-14). Anything missing or
// malformed means the service does not start answering MCP or OAuth requests: there is no default host, no sandbox mode and
// no fallback to a local endpoint. The error names the SETTINGS that are wrong, never their values.
export interface ServiceConfig {
  /** The public MCP endpoint, https, path /mcp: also the audience tokens are bound to. */
  mcpUrl: URL;
  /** The authorization server's issuer: the MCP endpoint's origin. */
  issuerUrl: URL;
  /** The WhiteFlow web app (dashboard consent page, and the gateway API the tools call), https. */
  webOrigin: URL;
  internalSecret: string;
  /** Browser origins allowed to call /mcp (a request with no Origin, i.e. a server-to-server client, is allowed). */
  allowedOrigins: string[];
}

export type ConfigResult = { ok: true; config: ServiceConfig; databaseUrl: string } | { ok: false; problems: string[] };

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/** https, no credentials, query or fragment; plain http only for a loopback host (local development). */
function httpsUrl(text: string | undefined, allowLoopbackHttp = false): URL | null {
  if (!text || !URL.canParse(text)) return null;
  const url = new URL(text);
  const secure = url.protocol === "https:" || (allowLoopbackHttp && url.protocol === "http:" && LOOPBACK.has(url.hostname));
  return secure && !url.username && !url.password && !url.search && !url.hash ? url : null;
}

export function parseConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];
  const local = env.WHITEFLOW_MCP_ALLOW_LOOPBACK === "yes"; // development only: never set on a deployment
  const mcpUrl = httpsUrl(env.WHITEFLOW_MCP_PUBLIC_URL, local);
  if (!mcpUrl || mcpUrl.pathname !== "/mcp") problems.push("WHITEFLOW_MCP_PUBLIC_URL must be the public https URL of this service ending in /mcp");
  const webOrigin = httpsUrl(env.WHITEFLOW_WEB_ORIGIN, local);
  if (!webOrigin || (webOrigin.pathname !== "/" && webOrigin.pathname !== "")) problems.push("WHITEFLOW_WEB_ORIGIN must be the https origin of the WhiteFlow web app");
  const internalSecret = env.MCP_INTERNAL_SECRET;
  if (!internalSecret || internalSecret.length < 32) problems.push("MCP_INTERNAL_SECRET must be set (at least 32 characters) and equal the web app's");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL must be set");
  const allowedOrigins = (env.WHITEFLOW_MCP_ALLOWED_ORIGINS ?? "https://claude.ai,https://claude.com,https://chatgpt.com").split(",").map((o) => o.trim()).filter(Boolean);
  if (allowedOrigins.some((o) => !httpsUrl(o, local) || new URL(o).origin !== o)) problems.push("WHITEFLOW_MCP_ALLOWED_ORIGINS must be a comma-separated list of https origins");
  if (problems.length || !mcpUrl || !webOrigin || !internalSecret) return { ok: false, problems };
  return { ok: true, databaseUrl: env.DATABASE_URL!, config: { mcpUrl, issuerUrl: new URL(mcpUrl.origin), webOrigin: new URL(webOrigin.origin), internalSecret, allowedOrigins } };
}
