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
        <section aria-labelledby="mcp-heading" className="grid gap-3 rounded-[16px] border border-hairline bg-surface p-5">
          <h2 id="mcp-heading" className="text-lg font-medium">Connect your AI assistant</h2>
          <p>Use ChatGPT, Claude or another compatible MCP client to read your testnet payments and create payment links with your permission.</p>
          <a href="/merchant/ai" className="text-accent underline underline-offset-4">Set up and manage AI connections</a>
          <p className="text-sm text-ink-muted">An Owner authorizes access through WhiteFlow. Never paste an API key into a chat.</p>
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

