#!/usr/bin/env node
// Adapted from Pixa (MIT) src/index.ts: the stdio entry. stdout carries the MCP JSON-RPC only, so any library's
// console.log goes to stderr. Run: node src/index.ts (Node >= 22.18 runs the TypeScript directly).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

console.log = console.info = console.debug = console.error;

try {
  await createServer({ env: process.env }).connect(new StdioServerTransport());
} catch (error) {
  // createServer's reasons never contain a key (FR-MCP-3)
  console.error(`merchant-capital-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
