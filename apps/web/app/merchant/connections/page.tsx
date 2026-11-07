// Whiteflow Connections Workspace (/merchant/connections):
// Manage API credentials, webhook endpoints, and Model Context Protocol (MCP) connectivity.
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonClasses } from "@/components/Button";
import { Shell } from "@/components/dashboard/Shell";
import { ApiKeys, type KeyRow } from "@/components/gateway/ApiKeys";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { Setup } from "@/components/gateway/Setup";
import { Webhooks, type WebhookRow } from "@/components/gateway/Webhooks";
import { keyOf, setupSteps, webhookOf } from "@/lib/gateway-dev";
import { readFailure } from "@/lib/gateway-server";
import { currentWorkspace } from "@/lib/merchant-session";
import { keyJson, listKeys } from "@/lib/server/keys";
import { deliveredEvents, listWebhooks } from "@/lib/server/webhooks";

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

const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

const header = (
  <EditorialHeader
    label="Connections"
    lede="Connect your systems via developer API keys, event webhooks, and Model Context Protocol (MCP) tooling."
  >
    Integrations &amp; <span className="emphasis">APIs.</span>
  </EditorialHeader>
);

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <Shell active="connections" privateReads={false}>
          {header}
          <p className="px-4 py-8 text-ink-muted md:px-8">Loading connections…</p>
        </Shell>
      }
    >
      <ConnectionsLoader />
    </Suspense>
  );
}

type Read<T> = { rows: T[] } | { error: string };
const readError = (what: string) => (error: unknown) => ({ error: readFailure(what, error) });
type HooksRead = { rows: WebhookRow[]; delivered: Awaited<ReturnType<typeof deliveredEvents>> } | { error: string };

async function read(merchant: `0x${string}`): Promise<{ keys: Read<KeyRow>; webhooks: HooksRead }> {
  const keys = listKeys(merchant).then((list) => list.map(keyJson));
  const hooks = Promise.all([listWebhooks(merchant), deliveredEvents(merchant)]);

  const keyRows = keys
    .then((list): Read<KeyRow> => ({ rows: list.map(keyOf).map((k) => ({ ...k, createdText: ist(k.created_at), lastUsedText: k.last_used_at && ist(k.last_used_at) })) }))
    .catch(readError("API keys"));

  const hookRows = hooks
    .then(
      ([list, delivered]): HooksRead => ({
        delivered,
        rows: list.map(webhookOf).map((h) => ({
          ...h,
          createdText: ist(h.created_at),
          deliveries: h.deliveries.map((d) => ({ ...d, atText: ist(d.at), nextText: d.next_attempt_at && istTime(d.next_attempt_at) })),
        })),
      }),
    )
    .catch(readError("Webhooks"));

  return { keys: await keyRows, webhooks: await hookRows };
}

async function ConnectionsLoader() {
  await connection();
  const workspace = await currentWorkspace();
  if (!workspace) return <SignedOut />;
  const { merchant } = workspace;
  // batch 051 (032 R2-1): keys and webhooks are Owner-only, on this page as in the API
  const owner = workspace.scopes.has("keys:manage");
  const { keys, webhooks } = owner ? await read(merchant) : { keys: null, webhooks: null };

  return (
    <Shell active="connections" privateReads={false} account={<Account merchant={merchant} />}>
      {header}
      {/* minmax(0,1fr) on every grid down to the MCP <pre>: an `auto` column sizes to the pre's longest line, so each
          level must allow shrinking for the pre to scroll inside its box (the page was 468 px wide at 360 before 051) */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 px-4 py-6 md:px-8 md:py-8">
        {/* Model Context Protocol (MCP) Section */}
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
              <span className="font-mono text-ink">testnet</span> and paste an <span className="font-mono text-ink">sk_test_</span> key
              from API keys above.
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

        {keys === null || webhooks === null ? (
          <p className="text-sm text-ink-muted">Only Owners can see API keys and webhooks.</p>
        ) : (
          <>
            {/* Integration Setup Checklist */}
            {"rows" in keys && "rows" in webhooks && (
              <Setup steps={setupSteps({ keys: keys.rows, hooks: webhooks.rows, delivered: webhooks.delivered })} />
            )}

            {/* API Keys */}
            {"error" in keys ? <Problem>{keys.error}</Problem> : <ApiKeys keys={keys.rows} />}

            {/* Webhooks */}
            {"error" in webhooks ? <Problem>{webhooks.error}</Problem> : <Webhooks hooks={webhooks.rows} />}
          </>
        )}
      </div>
    </Shell>
  );
}

