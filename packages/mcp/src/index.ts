#!/usr/bin/env node
// The stdio entry (started from Pixa's MIT src/index.ts). stdout carries MCP JSON-RPC only: every console method is
// pointed at stderr before anything else loads, so no library can print onto the protocol stream.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

const toStderr = (...parts: unknown[]) => process.stderr.write(`${parts.map(String).join(" ")}\n`);
console.log = console.info = console.debug = console.warn = console.error = toStderr;

try {
  await createServer({ env: process.env }).connect(new StdioServerTransport());
} catch (error) {
  // config errors never contain a key value (src/config.ts)
  process.stderr.write(`whiteflow-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
