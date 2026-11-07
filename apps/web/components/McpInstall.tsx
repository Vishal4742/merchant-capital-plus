// The Whiteflow MCP install block: Claude Desktop (.mcpb), one-click Cursor and VS Code links, and setups for every other
// MCP client. Shown on the public /mcp page and on the dashboard's Connections page.
import { buttonClasses } from "@/components/Button";

// Any MCP client runs the same stdio server from this site (built from packages/mcp; sandbox unless WHITEFLOW_MODE=testnet).
const MCP_PKG = "https://whiteflow.org/downloads/whiteflow-mcp.tgz";
const MCP_ARGS = ["-y", `--package=${MCP_PKG}`, "whiteflow-mcp"];
const MCP_SERVER = { command: "npx", args: MCP_ARGS };
const CURSOR_INSTALL = `cursor://anysphere.cursor-deeplink/mcp/install?name=whiteflow&config=${Buffer.from(JSON.stringify(MCP_SERVER)).toString("base64")}`;
const VSCODE_INSTALL = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "whiteflow", ...MCP_SERVER }))}`;
const AGENT_SETUPS: [string, string][] = [
  ["Claude Code", `claude mcp add whiteflow -- npx ${MCP_ARGS.join(" ")}`],
  ["Codex (~/.codex/config.toml)", `[mcp_servers.whiteflow]\ncommand = "npx"\nargs = [${MCP_ARGS.map((a) => `"${a}"`).join(", ")}]`],
  [
    "Gemini CLI, Windsurf, Cline, Zed and other clients (JSON)",
    JSON.stringify({ mcpServers: { whiteflow: { ...MCP_SERVER, env: { WHITEFLOW_MODE: "testnet", WHITEFLOW_API_KEY: "sk_test_…" } } } }, null, 2),
  ],
];

export function McpInstall({ keyHint }: { keyHint: string }) {
  return (
    <section aria-labelledby="mcp-heading" className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <h2 id="mcp-heading" className="text-[17px] font-semibold text-ink">
            Model Context Protocol (MCP)
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Run collections from your AI assistant: payment links, payments and summaries, plus invoices, customers and
            reminders in the sandbox. It can&apos;t move money, and publishing needs the Owner&apos;s approval.
          </p>
        </div>
        {/* a plain download: Claude Desktop installs a .mcpb when it's opened */}
        <a className={buttonClasses("primary", "h-10! px-4! text-sm")} href="/downloads/whiteflow.mcpb" download>
          Add to Claude Desktop
        </a>
      </div>

      <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-ink-muted">
        <li>Download <span className="font-mono text-ink">whiteflow.mcpb</span> and open it: Claude Desktop installs it.</li>
        <li>
          Keep <span className="font-mono text-ink">Mode: sandbox</span> to try it with no key, or choose{" "}
          <span className="font-mono text-ink">testnet</span> and paste an <span className="font-mono text-ink">sk_test_</span> key{" "}
          {keyHint}.
        </li>
        <li>Ask Claude: &ldquo;Create a 2 USDT payment link for an espresso.&rdquo;</li>
      </ol>
      <p className="break-all text-xs text-ink-muted">
        SHA-256 <span className="font-mono">8fc2f72830d78ce926319cc98fd5370d26c0c132c8a1c68a97b8130865ff0019</span>
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">Any other AI agent</h3>
          <div className="flex flex-wrap gap-2">
            <a className={buttonClasses("quiet", "h-9! px-3.5! text-sm")} href={CURSOR_INSTALL}>
              Add to Cursor
            </a>
            <a className={buttonClasses("quiet", "h-9! px-3.5! text-sm")} href={VSCODE_INSTALL}>
              Add to VS Code
            </a>
          </div>
        </div>
        <p className="text-sm text-ink-muted">
          Every MCP client runs the same server with one command (Node 20 or newer). It starts in the sandbox; add{" "}
          <span className="font-mono text-ink">WHITEFLOW_MODE=testnet</span> and{" "}
          <span className="font-mono text-ink">WHITEFLOW_API_KEY=sk_test_…</span> for the live gateway.
        </p>
        {AGENT_SETUPS.map(([client, setup]) => (
          <div key={client}>
            <p className="mb-1.5 text-xs font-medium text-ink">{client}</p>
            <pre className="overflow-x-auto rounded-[8px] bg-slate-900 p-3.5 font-mono text-xs text-emerald-400">{setup}</pre>
          </div>
        ))}
        <p className="break-all text-xs text-ink-muted">
          Package SHA-256 <span className="font-mono">d45ac86f84bcd0d72ff387bd4a1d5b56ef53d58743f66b51ecd74a618ad4c2cf</span>. A hosted connector URL (MCP 2025-11-25, Streamable HTTP)
          comes in Stage 6.
        </p>
      </div>
    </section>
  );
}
