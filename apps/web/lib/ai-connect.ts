// The setup-prompt generator for "Connect your AI" (batch 058, FR-MCP-1..4, FR-GW-14). Pure: no server or browser imports.
//
// A copied prompt is onboarding text. It is not a transport, a credential or an install: pasting it into ChatGPT or Claude
// installs nothing and authorizes nothing, and nothing here may say otherwise. So a prompt carries only public facts
// (WhiteFlow's name, the public setup URL, the public MCP endpoint) and each host's own documented setup steps, taken from
// the vendors' pages on 2026-11-07:
//   ChatGPT      https://developers.openai.com/api/docs/guides/custom-mcp-server (Add custom MCP server → Create as a plugin → install)
//   Claude app   https://support.claude.com/en/articles/11175166 (Customize → Connectors → Add custom connector)
//   Claude Code  https://code.claude.com/docs/en/mcp (claude mcp add --transport http, then /mcp to sign in)
// No install deep link, chat-prefill URL or marketplace listing is used, because none is published for WhiteFlow.

export const CLIENTS = ["chatgpt", "claude-app", "claude-code"] as const;
export type Client = (typeof CLIENTS)[number];

export const CLIENT_LABEL: Record<Client, string> = { chatgpt: "ChatGPT", "claude-app": "Claude app", "claude-code": "Claude Code" };

/** The tools the examples and the capability list may mention: exactly what the real backend serves (GET /api/v1/account). */
export const MCP_TOOLS_FOR_EXAMPLES = ["get_business_profile", "create_payment_link", "get_payment_link", "list_payments", "get_collection_summary", "get_operation_status"] as const;

/** What an assistant may be asked, each tied to the tool that answers it. Customers and invoices have no backend yet. */
export const EXAMPLES: { text: string; tool: (typeof MCP_TOOLS_FOR_EXAMPLES)[number]; writes: boolean }[] = [
  { text: "Create a payment link for 10 USDT for order WF-104", tool: "create_payment_link", writes: true },
  { text: "Has this link been paid?", tool: "get_payment_link", writes: false },
  { text: "Show my latest payments", tool: "list_payments", writes: false },
  { text: "Summarize collections this week", tool: "get_collection_summary", writes: false },
];

export type PromptResult = { ok: true; client: Client; prompt: string } | { ok: false; reason: string };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function privateIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** The URL as a normalized string, or null unless it is a public https URL with no credentials, query or fragment.
 *  Refused: IP literals, localhost, .local/.internal names and .invalid (the sandbox's name, RFC 2606). */
export function parsePublicUrl(text: unknown): string | null {
  if (typeof text !== "string" || !URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":") || privateIpv4(host) || IPV4.test(host)) return null; // no IP literals at all
  if (host === "localhost" || [".localhost", ".local", ".internal", ".invalid"].some((tld) => host.endsWith(tld)) || !host.includes(".")) return null;
  return url.href;
}

const UNAVAILABLE = "WhiteFlow's AI connection isn't switched on for this server yet, so there is no setup prompt to copy. Nothing was changed.";

const CORE = (setupUrl: string, mcpUrl: string) =>
  `Help me connect WhiteFlow using ${setupUrl}.\n` +
  `The MCP endpoint is ${mcpUrl}.\n` +
  "If WhiteFlow tools are already available, call get_business_profile and show the authorized merchant, network and supported capabilities.\n" +
  "Otherwise guide me through this assistant's supported custom connector setup and WhiteFlow authorization.\n" +
  "If you cannot install connectors, explain the manual steps.\n" +
  "Never claim connection success without a successful tool call.\n" +
  "Never ask me to paste credentials into chat.\n" +
  "Do not create a payment or payment link merely to test setup.";

const HOST_STEPS: Record<Client, (mcpUrl: string) => string> = {
  chatgpt: (mcpUrl) =>
    "\nSetup steps for ChatGPT on the web (names as in OpenAI's custom MCP guide; your workspace may restrict this, so ask an admin if an option is missing):\n" +
    `1. In ChatGPT, open Plugins, select the plus button, then choose Add custom MCP server.\n` +
    `2. Enter the name WhiteFlow and, under Connection, the Server URL ${mcpUrl}.\n` +
    "3. Set authentication to OAuth, select I understand and want to continue, then Create as a plugin.\n" +
    "4. Install the plugin, enable it for the conversation, and sign in to WhiteFlow when asked. Check the permissions shown on WhiteFlow's consent screen.",
  "claude-app": (mcpUrl) =>
    "\nSetup steps for the Claude app (names as in Anthropic's custom connector guide; on Team and Enterprise only an owner can add a connector):\n" +
    "1. Open Customize, then Connectors, click + Add, then Add custom connector.\n" +
    `2. Enter the name WhiteFlow and the remote MCP URL ${mcpUrl}, then continue.\n` +
    "3. Choose to sign in now, and finish WhiteFlow's consent screen in the browser. Check the permissions it shows.",
  "claude-code": (mcpUrl) =>
    "\nAdvanced setup for Claude Code (a terminal client; the Claude app steps are the usual way):\n" +
    `1. Run: claude mcp add --transport http whiteflow ${mcpUrl}\n` +
    "2. In Claude Code run /mcp, choose WhiteFlow and follow the browser sign-in and WhiteFlow consent.\n" +
    "3. To disconnect, run: claude mcp logout whiteflow",
};

/** The prompt for one assistant, or why there is none. Both URLs must be public https; anything else (localhost, a
 *  sandbox host, credentials, a query string) means setup isn't available, and no substitute is offered. */
export function buildSetupPrompt(input: { client: unknown; setupUrl: unknown; mcpUrl: unknown }): PromptResult {
  const client = CLIENTS.find((c) => c === input.client);
  if (!client) return { ok: false, reason: "Choose ChatGPT or Claude." };
  const setupUrl = parsePublicUrl(input.setupUrl);
  const mcpUrl = parsePublicUrl(input.mcpUrl);
  if (!setupUrl || !mcpUrl) return { ok: false, reason: UNAVAILABLE };
  return { ok: true, client, prompt: CORE(setupUrl, mcpUrl) + "\n" + HOST_STEPS[client](mcpUrl) };
}
