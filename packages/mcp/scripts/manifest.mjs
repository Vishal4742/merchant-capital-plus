// Writes manifest.json (MCPB manifest_version 0.3) from the server itself: its tools come from a real tools/list and
// its prompts from src/prompts.ts, so the manifest can't drift from runtime discovery (test/package.test.ts re-runs this
// and compares). Usage: node scripts/manifest.mjs [--check]   (--check: fail if manifest.json is out of date)
// Schema facts (checked 2026-11-07, github.com/modelcontextprotocol/mcpb v2.1.2 schemas and MANIFEST.md): required
// name/version/description/author/server; tools entries {name, description}; prompts entries {name, text, description?,
// arguments?: string[]} with ${arguments.x}; user_config entries {type, title, description, required?, default?, sensitive?}.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_BASE_URL } from "../src/config.ts";
import { PROMPTS } from "../src/prompts.ts";
import { VERSION, createServer } from "../src/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function buildManifest() {
  const stateDir = mkdtempSync(join(tmpdir(), "wf-manifest-"));
  const server = createServer({ env: {}, stateDir, log: { info() {}, error() {} } });
  const client = new Client({ name: "manifest", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const { tools } = await client.listTools();
  await client.close();
  rmSync(stateDir, { recursive: true, force: true }); // its throwaway sandbox and key (review 052 F11)
  return {
    manifest_version: "0.3",
    name: "whiteflow-merchant",
    display_name: "WhiteFlow Merchant",
    version: VERSION,
    description: "Create payment links and invoices, track collections and see what's outstanding, by asking. Sandbox by default; testnet with your WhiteFlow sk_test_ key.",
    long_description:
      "WhiteFlow Merchant lets a business manage payment collection from a conversation: find or create customers, create payment links, draft and finalize invoices, check whether they've been paid, list verified payments, summarize collections and draft reminders.\n\n" +
      "**Two modes.** *Sandbox* (the default) is a local simulator: no account, no network, no real money; payments are simulated by you with the bundled `sandbox-cli`. *Testnet* uses the WhiteFlow gateway on Whitechain Testnet with your own `sk_test_` secret key (test USDT, not real money). On testnet, payment links, payments and collection summaries are live; customers and invoices are not on the testnet backend yet, and those tools say so.\n\n" +
      "**What it never does.** It doesn't send email, move money, sign transactions, refund, or change keys, wallets or webhooks. Creating a link or finalizing an invoice sends nothing. Payment status comes only from WhiteFlow's verified records.",
    author: { name: "WhiteFlow contributors", url: "https://github.com/Vishal4742/merchant-capital-plus" },
    repository: { type: "git", url: "https://github.com/Vishal4742/merchant-capital-plus" },
    homepage: "https://github.com/Vishal4742/merchant-capital-plus/tree/main/packages/mcp",
    documentation: "https://github.com/Vishal4742/merchant-capital-plus/blob/main/packages/mcp/README.md",
    support: "https://github.com/Vishal4742/merchant-capital-plus/issues",
    icon: "icon.png",
    license: "MIT",
    keywords: ["payments", "invoices", "payment-links", "collections", "stablecoin", "usdt", "whitechain", "merchant"],
    server: {
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.mjs"],
        env: {
          WHITEFLOW_MODE: "${user_config.mode}",
          WHITEFLOW_API_KEY: "${user_config.api_key}",
          WHITEFLOW_BASE_URL: "${user_config.base_url}",
          WHITEFLOW_TIMEZONE: "${user_config.timezone}",
        },
      },
    },
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
    tools_generated: false,
    prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description, ...(p.arguments.length ? { arguments: p.arguments.map((a) => a.name) } : {}), text: p.text })),
    prompts_generated: false,
    user_config: {
      mode: {
        type: "string",
        title: "Mode",
        description: "\"sandbox\" (default): a local simulator with no real money and no network. \"testnet\": the WhiteFlow gateway on Whitechain Testnet; needs your secret key below.",
        default: "sandbox",
        required: false,
      },
      api_key: {
        type: "string",
        title: "WhiteFlow secret key (testnet only)",
        description: "Your sk_test_ key from the WhiteFlow dashboard (Developers screen). Leave empty for sandbox. Never a wallet private key or seed phrase: the connector never asks for one.",
        sensitive: true,
        required: false,
      },
      base_url: {
        type: "string",
        title: "Gateway URL (testnet only)",
        description: "The WhiteFlow gateway's https origin.",
        default: DEFAULT_BASE_URL,
        required: false,
      },
      timezone: {
        type: "string",
        title: "Business time zone",
        description: "IANA zone such as Asia/Kolkata. Used for due dates and periods like \"this week\" when the backend has no business time zone (testnet today), and for a new sandbox.",
        default: "UTC",
        required: false,
      },
    },
    compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: ">=20.0.0" } },
  };
}

export const manifestText = async () => `${JSON.stringify(await buildManifest(), null, 2)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = join(root, "manifest.json");
  const text = await manifestText();
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== text) {
      process.stderr.write("manifest.json is out of date: run npm run manifest\n");
      process.exit(1);
    }
  } else {
    writeFileSync(file, text);
    process.stdout.write(`wrote ${file}\n`);
  }
}
