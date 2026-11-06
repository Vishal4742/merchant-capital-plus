// Adapted from Pixa (MIT) src/tools/spending-report.ts: exposes the spending tracker to the agent as an MCP tool, so
// it can audit its own payments and remaining budget. Changes: USDT on Whitechain testnet, each payment's tx hash and
// explorer link, the payer address to fund, and the history read from the spending file (FR-MCP-5).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Address } from "viem";
import type { Reply } from "../common.ts";
import type { SpendingTracker } from "../spending.ts";

export function registerSpendingReport(server: McpServer, { spending, payer, reply }: { spending: SpendingTracker; payer: Address; reply: Reply }): void {
  server.registerTool(
    "spending_report",
    {
      title: "Spending report",
      description:
        "Show every payment pay_checkout made: today's spend against the daily limit, the per-payment limit, and each payment with its status, " +
        "tx hash and explorer link. A payment with status unknown had no clear answer and still counts against the limit.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => reply(async () => ({ payer, ...spending.report() })),
  );
}
