// Whiteflow Frontend & Presentation Verification Tests
// Tests the Whiteflow navigation shell, branding tokens, status badges, and invoice presentation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("Whiteflow branding is present in layout metadata and header", () => {
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
  assert.match(layout, /title:\s*"Whiteflow — Business Payments Workspace"/);
  assert.match(layout, /One invoice\. Clear settlement\./);
  assert.match(layout, /<TestModeBadge \/>/);
});

test("Whiteflow design tokens preserve the blue palette", () => {
  const tokens = readFileSync(join(ROOT, "app/tokens.css"), "utf8");
  assert.match(tokens, /--accent:\s*#3b4fd9;/); // Blue accent
  assert.match(tokens, /--accent-soft:\s*#e7eafc;/); // Soft blue
  assert.match(tokens, /--ground:\s*#f5f5f9;/);
  assert.match(tokens, /--surface:\s*#ffffff;/);
});

test("Navigation shell includes all 5 target destinations and preserves existing tools", async () => {
  const navSource = readFileSync(join(ROOT, "components/dashboard/Nav.tsx"), "utf8");
  
  // 5 Target Destinations
  assert.match(navSource, /label:\s*"Overview",\s*href:\s*"\/merchant"/);
  assert.match(navSource, /label:\s*"Invoices",\s*href:\s*"\/merchant\/invoices"/);
  assert.match(navSource, /label:\s*"Payments",\s*href:\s*"\/merchant\/payments"/);
  assert.match(navSource, /label:\s*"Connections",\s*href:\s*"\/merchant\/connections"/);
  assert.match(navSource, /label:\s*"Settings",\s*href:\s*"\/merchant\/settings"/);

  // Preserved Tools
  assert.match(navSource, /"\/merchant\/links"/);
  assert.match(navSource, /"\/merchant\/pages"/);
  assert.match(navSource, /"\/merchant\/vouchers"/);
  assert.match(navSource, /"\/merchant\/reports"/);
  assert.match(navSource, /"\/merchant\/settlements"/);
  assert.match(navSource, /"\/merchant\/developers"/);
  assert.match(navSource, /"\/docs"/);
});

test("Invoices route exists and is backed by on-chain reads", () => {
  const invoicesPage = readFileSync(join(ROOT, "app/merchant/invoices/page.tsx"), "utf8");
  assert.match(invoicesPage, /merchantInvoices/);
  assert.match(invoicesPage, /paidLogs/);
  assert.match(invoicesPage, /readRelayFee/);
  assert.match(invoicesPage, /One invoice\./);
});

test("Connections route exists and discloses honest MCP status", () => {
  // the MCP block lives in a component shared with the public /mcp page
  const connPage =
    readFileSync(join(ROOT, "app/merchant/connections/page.tsx"), "utf8") + readFileSync(join(ROOT, "components/McpInstall.tsx"), "utf8");
  assert.match(connPage, /Model Context Protocol \(MCP\)/);
  assert.match(connPage, /Stage 6/);
  assert.match(connPage, /2025-11-25/);
  // the working connector is offered as a download, and no made-up hosted URL is shown
  assert.match(connPage, /href="\/downloads\/whiteflow\.mcpb" download/);
  assert.doesNotMatch(connPage, /api\.whiteflow\.io/);
  assert.match(readFileSync(join(ROOT, "app/mcp/page.tsx"), "utf8"), /<McpInstall /);
  assert.match(connPage, /listKeys/);
  assert.match(connPage, /listWebhooks/);
});

test("Settings route exists and organizes receiving wallet policy honestly", () => {
  const settingsPage = readFileSync(join(ROOT, "app/merchant/settings/page.tsx"), "utf8");
  assert.match(settingsPage, /Designated Receiving Address/);
  assert.match(settingsPage, /Policy v1\.0/);
  assert.match(settingsPage, /Whitechain Sepolia Testnet/);
  assert.match(settingsPage, /relayerHealth/);
});

test("Customer receipt card renders Whiteflow trust mark and settlement rail", () => {
  const receiptPage = readFileSync(join(ROOT, "app/r/[id]/page.tsx"), "utf8");
  assert.match(receiptPage, /WhiteflowWordmark/);
  assert.match(receiptPage, /Whitechain Sepolia/);
  assert.match(receiptPage, /EXPLORER/);
});

