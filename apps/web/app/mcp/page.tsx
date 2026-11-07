// /mcp: one public link for connecting any AI assistant to Whiteflow (no sign-in to read it). The install block is shared
// with the dashboard's Connections page.
import type { Metadata } from "next";
import { EditorialHeader, PlainPage } from "@/components/gateway/Frame";
import { McpInstall } from "@/components/McpInstall";

export const metadata: Metadata = {
  title: "Connect your AI · Whiteflow",
  description: "Add Whiteflow to Claude, Cursor, VS Code, Codex, Gemini CLI or any MCP client: payment links, payments and summaries from your AI assistant.",
};

export default function McpPage() {
  return (
    <PlainPage>
      <EditorialHeader label="AI assistants" lede="Run collections from Claude, Cursor, VS Code, Codex, Gemini CLI or any MCP client. It can't move money.">
        Connect your <span className="emphasis">AI.</span>
      </EditorialHeader>
      <div className="mt-8">
        <McpInstall keyHint="from your dashboard (Connections → API keys)" />
      </div>
    </PlainPage>
  );
}
