// The packaged archive (batch 052 acceptance): `npm run pack` builds and validates whiteflow.mcpb; the archive is
// unpacked with the official CLI into a temp folder outside the repo and launched with plain `node` over stdio. Every
// stdout line must be JSON-RPC; tools/list and prompts/list must equal the manifest; the sandbox demo runs through
// the bundled server and the bundled sandbox CLI. Takes a few seconds (esbuild + mcpb). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestText } from "../scripts/manifest.mjs";
import { archive, pack } from "../scripts/pack.mjs";
import { tempDir } from "./helpers.ts";

const ROOT = new URL("..", import.meta.url);
const mcpbCli = join(fileURLToPath(ROOT), "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");

/** A minimal stdio JSON-RPC client that records every stdout line. */
function launch(entry: string, env: Record<string, string>, cwd: string) {
  const child = spawn(process.execPath, [entry], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const lines: string[] = [];
  let stderr = "", buffer = "", nextId = 1;
  const waiting = new Map<number, (message: any) => void>();
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (d) => {
    buffer += d;
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      lines.push(line);
      const message = JSON.parse(line); // a non-JSON line fails the test right here
      if (message.id !== undefined && waiting.has(message.id)) waiting.get(message.id)!(message);
    }
  });
  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`no reply to ${method}; stderr: ${stderr}`)), 20_000);
      waiting.set(id, (m) => (clearTimeout(timer), resolve(m)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await send("tools/call", { name, arguments: args });
    return JSON.parse(reply.result.content[0].text);
  };
  return { child, lines, send, notify, call, stderr: () => stderr };
}

test("whiteflow.mcpb: validated, self-contained, launches from the unpacked archive, discovery equals the manifest", { timeout: 180_000 }, async () => {
  const built = await pack();
  assert.ok(existsSync(archive));
  assert.match(readFileSync(`${archive}.sha256`, "utf8"), /^[0-9a-f]{64}  whiteflow\.mcpb\n$/);
  assert.deepEqual(built.files, ["LICENSE", "README.md", "THIRD_PARTY_LICENSES", "icon.png", "manifest.json", "sbom.cdx.json", "server/index.mjs", "server/sandbox-cli.mjs"]);
  assert.equal(readFileSync(new URL("manifest.json", ROOT), "utf8").replace(/\r\n/g, "\n"), await manifestText(), "manifest.json is current");

  const installed = tempDir(); // outside the repo: no node_modules anywhere above it
  const unpacked = spawnSync(process.execPath, [mcpbCli, "unpack", archive, installed], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.ok(!existsSync(join(installed, "node_modules")));
  const manifest = JSON.parse(readFileSync(join(installed, "manifest.json"), "utf8"));
  const licences = readFileSync(join(installed, "THIRD_PARTY_LICENSES"), "utf8");
  assert.match(licences, /@modelcontextprotocol\/sdk 1\.32\.2/);
  assert.match(licences, /zod 4\.6\.7/);
  const sbom = JSON.parse(readFileSync(join(installed, "sbom.cdx.json"), "utf8"));
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.ok(sbom.components.some((c: { purl: string }) => c.purl === "pkg:npm/%40modelcontextprotocol/sdk@1.32.2"));
  for (const file of readdirSync(join(installed, "server"))) {
    const text = readFileSync(join(installed, "server", file), "utf8");
    assert.ok(!/sk_test_[A-Za-z0-9_-]{16}|wf_sbx_[A-Za-z0-9_-]{32}|PRIVATE KEY/.test(text), `${file} has a key-shaped string`);
  }

  const state = tempDir();
  const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", WHITEFLOW_STATE_DIR: state, WHITEFLOW_TIMEZONE: "Asia/Kolkata", WHITEFLOW_MODE: "${user_config.mode}", WHITEFLOW_API_KEY: "" };
  const entry = join(installed, ...manifest.server.entry_point.split("/"));
  const server = launch(entry, env, installed);
  try {
    const init = await server.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "package-test", version: "0" } });
    assert.equal(init.result.serverInfo.name, "whiteflow");
    server.notify("notifications/initialized");
    const tools = (await server.send("tools/list")).result.tools;
    assert.deepEqual(tools.map((t: { name: string }) => t.name), manifest.tools.map((t: { name: string }) => t.name));
    assert.deepEqual(tools.map((t: { description: string }) => t.description), manifest.tools.map((t: { description: string }) => t.description));
    const prompts = (await server.send("prompts/list")).result.prompts;
    assert.deepEqual(prompts.map((p: { name: string }) => p.name), manifest.prompts.map((p: { name: string }) => p.name));
    const prompt = await server.send("prompts/get", { name: "collect-payment", arguments: { amount: "₹15,000", customer: "Acme" } });
    assert.match(prompt.result.messages[0].content.text, /Amount: "₹15,000"/);

    // the demo through the installed bundle; the bundled CLI plays the customer paying
    const profile = await server.call("get_business_profile");
    assert.equal(profile.environment, "sandbox");
    const customer = (await server.call("create_customer", { name: "Priya Sharma", email: "priya@example.com" })).customer;
    const draft = await server.call("create_invoice_draft", { customer_id: customer.id, currency: "USDT", line_items: [{ description: "Consulting session", quantity: 3, unit_price: "20.00" }], due_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }); // a week out: the bundle runs on the real clock
    assert.ok(draft.invoice, JSON.stringify(draft));
    // publication needs the Owner: finalize asks; the bundled CLI (the review page's stand-in) approves this version
    const requested = await server.call("finalize_invoice", { invoice: draft.invoice.id });
    assert.equal(requested.approval.status, "pending");
    const approved = spawnSync(process.execPath, [join(installed, "server", "sandbox-cli.mjs"), "approve", requested.approval.id], { cwd: installed, env, encoding: "utf8" });
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(approved.stdout, /approved: the invoice is published/);
    const final = await server.call("get_invoice", { invoice: draft.invoice.id });
    assert.equal(final.invoice.number, "WF-1001");
    const paid = spawnSync(process.execPath, [join(installed, "server", "sandbox-cli.mjs"), "pay", "WF-1001"], { cwd: installed, env, encoding: "utf8" });
    assert.equal(paid.status, 0, paid.stderr);
    assert.match(paid.stdout, /SANDBOX: simulated payment .* of 60\.00 USDT/);
    assert.match(paid.stdout, /payment\.succeeded\s+applied\s+invoice paid in full/);
    assert.equal((await server.call("get_invoice", { invoice: "WF-1001" })).invoice.status, "paid");

    // stdout carried only JSON-RPC 2.0 messages; diagnostics went to stderr
    assert.ok(server.lines.length >= 9);
    for (const line of server.lines) assert.equal(JSON.parse(line).jsonrpc, "2.0");
    assert.match(server.stderr(), /whiteflow-mcp info started in sandbox mode/);
    const key = JSON.parse(readFileSync(join(state, "sandbox-credentials.json"), "utf8")).api_key;
    assert.ok(!server.stderr().includes(key) && !server.lines.join("\n").includes(key));
  } finally {
    server.child.kill();
  }
});
