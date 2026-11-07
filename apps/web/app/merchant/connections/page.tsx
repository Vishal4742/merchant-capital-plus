// Whiteflow Connections Workspace (/merchant/connections):
// Manage API credentials, webhook endpoints, and Model Context Protocol (MCP) connectivity.
import { connection } from "next/server";
import { Suspense } from "react";
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
              <div className="flex items-center gap-2">
                <h2 id="mcp-heading" className="text-[17px] font-semibold text-ink">
                  Model Context Protocol (MCP)
                </h2>
                <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
                  Stage 6 Planned
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Standard interface for AI assistants (Claude Desktop, cursor, agent tools) to draft invoices and query payments.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 text-sm text-ink-muted">
            <p>
              Whiteflow targets protocol version <span className="font-mono text-ink">2025-11-25</span> using{" "}
              <span className="font-mono text-ink">@modelcontextprotocol/sdk 1.32.2</span> over Streamable HTTP.
            </p>
            <div className="rounded-[10px] bg-surface-sunk/70 p-4 border border-hairline">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink mb-1.5">
                Current Architecture State
              </h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                Backend MCP endpoint deploys during <strong>Stage 6</strong> after Stage 2 payment reliability, Stage 3 business identity, and Stage 4 settlement hardening. Assistant tools will support scoped tenant access for drafting invoices and querying on-chain payment records. No private keys are ever stored in connector configuration or exposed in model context.
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink mb-2">
                Claude Desktop Configuration Preview
              </h3>
              <pre className="overflow-x-auto rounded-[8px] bg-slate-900 p-3.5 text-xs font-mono text-emerald-400">
{`{
  "mcpServers": {
    "whiteflow": {
      "url": "https://api.whiteflow.io/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_SHOP_API_KEY>"
      }
    }
  }
}`}
              </pre>
            </div>
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

