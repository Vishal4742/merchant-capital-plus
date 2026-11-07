// Batch 058 phase A1 (FR-MCP-1..4, FR-GW-14): the setup-prompt generator. The prompts are copied into ChatGPT or Claude,
// so they must carry only public facts, and must never promise an install the host hasn't made. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { buildSetupPrompt, parsePublicUrl, CLIENTS, MCP_TOOLS_FOR_EXAMPLES } = await import("../lib/ai-connect.ts");

const setupUrl = "https://whiteflow.example/connect";
const mcpUrl = "https://whiteflow.example/mcp";
const good = (client) => buildSetupPrompt({ client, setupUrl, mcpUrl });

// anything shaped like a credential: API keys, bearer tokens, 32-byte hex keys, authorization-code / token query params
const SECRET_SHAPES = [/sk_test_/i, /pk_test_/i, /bearer\s+[a-z0-9._-]{8,}/i, /0x[0-9a-f]{64}/i, /[?&](code|token|access_token|state)=/i, /\b(seed phrase|mnemonic|private key)\b.*:/i];

test("each client gets a prompt with the identity, both URLs and the read-only verification request", () => {
  for (const client of CLIENTS) {
    const result = good(client);
    assert.equal(result.ok, true, client);
    assert.ok(result.prompt.includes("WhiteFlow"), client);
    assert.ok(result.prompt.includes(setupUrl), client);
    assert.ok(result.prompt.includes(mcpUrl), client);
    assert.match(result.prompt, /get_business_profile/, client);
    assert.match(result.prompt, /Never claim connection success without a successful tool call/, client);
    assert.match(result.prompt, /Never ask me to paste credentials into chat/, client);
    assert.match(result.prompt, /Do not create a payment or payment link merely to test setup/, client);
  }
});

test("no prompt contains a secret-shaped string", () => {
  for (const client of CLIENTS) for (const shape of SECRET_SHAPES) assert.doesNotMatch(good(client).prompt, shape, `${client} ${shape}`);
});

test("the Claude Code prompt uses the documented command and no invented installer", () => {
  const { prompt } = good("claude-code");
  assert.match(prompt, /claude mcp add --transport http whiteflow https:\/\/whiteflow\.example\/mcp/);
  assert.match(prompt, /\/mcp/);
  assert.doesNotMatch(prompt, /curl|npx|npm i|\| ?(ba)?sh|\.mcpb/i);
});

test("ChatGPT and Claude app prompts use each host's documented custom-connector steps", () => {
  assert.match(good("chatgpt").prompt, /Add custom MCP server/);
  assert.match(good("chatgpt").prompt, /Create as a plugin/);
  assert.match(good("claude-app").prompt, /Add custom connector/);
  assert.match(good("claude-app").prompt, /Customize/);
});

test("no prompt invents an install deep link, a chat-prefill URL or a marketplace listing", () => {
  for (const client of CLIENTS) {
    const { prompt } = good(client);
    const urls = prompt.match(/https?:\/\/[^\s)]+/g) ?? [];
    for (const url of urls) assert.ok([setupUrl, mcpUrl].includes(url.replace(/[.,]$/, "")), `${client}: unexpected URL ${url}`);
    assert.doesNotMatch(prompt, /marketplace|directory listing|Add to ChatGPT|one-click/i);
  }
});

test("a prompt never states that pasting it installs or authorizes anything", () => {
  for (const client of CLIENTS) assert.doesNotMatch(good(client).prompt, /(has been|is now|was) (installed|authorized|connected)/i);
});

test("the unavailable service gives no prompt: no localhost, sandbox, plain http, credentials or query strings", () => {
  const bad = [
    "http://whiteflow.example/mcp",
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://10.0.0.5/mcp",
    "https://[::1]/mcp",
    "https://sandbox.whiteflow.invalid/mcp",
    "https://user:pw@whiteflow.example/mcp",
    "https://whiteflow.example/mcp?token=abc",
    "https://whiteflow.example/mcp#frag",
    "javascript:alert(1)",
    "",
    undefined,
    "not a url",
  ];
  for (const url of bad) {
    const result = buildSetupPrompt({ client: "chatgpt", setupUrl, mcpUrl: url });
    assert.equal(result.ok, false, String(url));
    assert.ok(result.reason.length > 10);
    assert.equal("prompt" in result, false);
    assert.equal(buildSetupPrompt({ client: "chatgpt", setupUrl: url, mcpUrl }).ok, false, `setup ${String(url)}`);
  }
});

test("parsePublicUrl keeps a path and drops nothing else", () => {
  assert.equal(parsePublicUrl("https://whiteflow.example/mcp"), "https://whiteflow.example/mcp");
  assert.equal(parsePublicUrl("https://whiteflow.example"), "https://whiteflow.example/");
  assert.equal(parsePublicUrl("https://whiteflow.example:8443/mcp"), "https://whiteflow.example:8443/mcp");
});

test("an unknown client is refused", () => {
  assert.equal(buildSetupPrompt({ client: "gemini", setupUrl, mcpUrl }).ok, false);
});

test("examples cover only what the real backend does", () => {
  assert.deepEqual([...MCP_TOOLS_FOR_EXAMPLES].sort(), ["create_payment_link", "get_business_profile", "get_collection_summary", "get_operation_status", "get_payment_link", "list_payments"]);
});
