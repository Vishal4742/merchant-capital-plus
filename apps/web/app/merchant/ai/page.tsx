// /merchant/ai (batch 058): the signed-in side of "Connect your AI": the honest state of each connection, Disconnect, then the
// same guide as /connect. State comes from lib/ai-connect.ts, so a copied prompt or a finished consent can never read as
// Verified: that needs a successful authenticated tool call recorded on the grant. The time shown is when it last happened;
// nothing here implies the assistant is connected right now.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ConnectGuide } from "@/components/ai/ConnectGuide";
import { DisconnectButton } from "@/components/ai/DisconnectButton";
import { panelPrompts } from "@/components/ai/prompts";
import { Shell } from "@/components/dashboard/Shell";
import { Account, card, SignedOut } from "@/components/gateway/Frame";
import { authSecret } from "@/lib/auth";
import { currentAiConnect } from "@/lib/ai-config";
import { connectionState, STATE_TEXT, type ConnectionState } from "@/lib/ai-connect";
import { currentMerchant } from "@/lib/merchant-session";
import { logFailure } from "@/lib/gateway-server";
import { csrfToken, grantState, listGrants, type GrantRow } from "@/lib/server/mcp-grants";
import { internalSecret } from "@/lib/server/mcp-principal";

export const metadata: Metadata = { title: "AI connections · WhiteFlow" };

export default function AiPage() {
  return (
    <Suspense
      fallback={
        <Shell active="ai">
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading AI connections…</p>
        </Shell>
      }
    >
      <Connections />
    </Suspense>
  );
}

const when = (ms: number) => `${new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST`;

/** Everything on this page that depends on the clock, in one plain function (the render body never reads it). */
function view(provisioned: boolean, grants: GrantRow[] | null) {
  const now = Date.now();
  const rows = (grants ?? []).map((grant) => ({ grant, state: grantState(grant, now) }));
  // the headline state: the newest connection that isn't revoked, else the newest, else none
  const lead = rows.find((r) => r.state !== "revoked") ?? rows[0];
  const state: ConnectionState = provisioned ? (lead ? lead.state : connectionState({ provisioned, grant: null, now })) : "unavailable";
  return { rows, state };
}

async function Connections() {
  await connection();
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const config = currentAiConnect("");
  const { prompts, reason } = panelPrompts(config);
  const secret = internalSecret();
  let grants: GrantRow[] | null = null;
  if (config.available) {
    grants = await listGrants(merchant).catch((error: unknown) => (logFailure("ai connections", error), null)); // the name only
  }
  const { rows, state } = view(config.available, grants);
  const text = STATE_TEXT[state];
  return (
    <Shell active="ai" account={<Account merchant={merchant} />}>
      <ConnectGuide
        prompts={prompts}
        reason={reason}
        mcpUrl={config.available ? config.mcpUrl : null}
        lead={
          <section aria-labelledby="state" className={`${card} max-w-3xl`}>
            <h2 id="state" className="eyebrow text-ink-muted">
              Connection status
            </h2>
            <p className="text-[18px] font-medium">{text.label}</p>
            <p className="text-sm text-ink-muted">{text.meaning}</p>
            {config.available && grants === null && <p className="text-sm text-warning">We couldn&apos;t read your connections just now, so the status above may be out of date. Reload in a minute.</p>}
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Network</dt>
                <dd className="data">Whitechain Testnet · test USDT</dd>
              </div>
            </dl>
            {rows.length > 0 && (
              <ul aria-label="Your connections" className="grid gap-3 border-t border-hairline pt-3">
                {rows.map(({ grant, state: grantStatus }) => (
                  <li key={grant.id} className="grid gap-2 rounded-[14px] border border-hairline p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <b className="font-medium">{grant.clientName}</b>
                      <span className="eyebrow text-ink-muted">{STATE_TEXT[grantStatus].label}</span>
                    </div>
                    <dl className="grid gap-1 text-sm text-ink-muted">
                      <div className="flex flex-wrap justify-between gap-x-4">
                        <dt>Permissions</dt>
                        <dd className="data text-ink">{grant.scopes.join(" ")}</dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4">
                        <dt>Last verified request</dt>
                        <dd className="data text-ink">{grant.lastToolOkAt === null ? "Never" : when(grant.lastToolOkAt)}</dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4">
                        <dt>{grant.revokedAt !== null ? "Disconnected" : "Expires"}</dt>
                        <dd className="data text-ink">{when(grant.revokedAt ?? grant.expiresAt)}</dd>
                      </div>
                    </dl>
                    {grantStatus !== "revoked" && secret && <DisconnectButton grantId={grant.id} csrf={csrfToken(merchant, grant.id, secret)} name={grant.clientName} />}
                  </li>
                ))}
              </ul>
            )}
            {config.available && grants !== null && rows.length === 0 && <p className="text-sm text-ink-muted">No assistant is connected yet. When one is, it appears here with a Disconnect button.</p>}
          </section>
        }
      />
    </Shell>
  );
}
