// /merchant/ai/authorize (batch 058; FR-MCP-1..3, FR-GW-14; SRS-CHANGE FR-MCP-19 proposed): the consent screen. An assistant
// asked WhiteFlow for access; the MCP service signed that request and sent the browser here. The merchant shown is the
// wallet signed in on THIS site (never anything from the request or a copied prompt), the network is Whitechain Testnet, and
// the permissions are exactly what was asked, each tickable. Nothing is granted by loading this page.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ConsentForm } from "@/components/ai/ConsentForm";
import { SCOPES } from "@/components/ai/ConnectGuide";
import { Account, card, PlainPage, SignedOut } from "@/components/gateway/Frame";
import { authSecret } from "@/lib/auth";
import { currentMerchant } from "@/lib/merchant-session";
import { query } from "@/lib/server/db";
import { csrfToken, describeClient, issuerOf, verifyConsentRequest } from "@/lib/server/mcp-grants";
import { internalSecret } from "@/lib/server/mcp-principal";

export const metadata: Metadata = { title: "Authorize an assistant · WhiteFlow", robots: { index: false } };

export default function AuthorizePage({ searchParams }: PageProps<"/merchant/ai/authorize">) {
  return (
    <Suspense fallback={<PlainPage><p className="py-8 text-ink-muted">Loading the request…</p></PlainPage>}>
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}

const Notice = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <PlainPage>
    <section className={`${card} mt-10 max-w-xl`}>
      <h1 className="title">{title}</h1>
      <p className="text-ink-muted">{children}</p>
      <a href="/connect" className="text-accent underline underline-offset-4">
        Back to the setup guide
      </a>
    </section>
  </PlainPage>
);

async function clientName(clientId: string): Promise<string> {
  try {
    const [row] = await query<{ name: string | null }>("SELECT metadata->>'client_name' AS name FROM app_mcp_clients WHERE client_id = $1", [clientId]);
    return row?.name ?? "An AI assistant";
  } catch {
    return "An AI assistant";
  }
}

async function Consent({ searchParams }: Pick<PageProps<"/merchant/ai/authorize">, "searchParams">) {
  await connection();
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const secret = internalSecret();
  if (!secret || !issuerOf()) return <Notice title="AI connections aren't switched on">This server isn&apos;t set up to connect assistants yet, so nothing can be approved here.</Notice>;
  const raw = (await searchParams).request;
  const token = typeof raw === "string" ? raw : "";
  const request = token ? verifyConsentRequest(token, secret) : null;
  if (!request) return <Notice title="This request has expired">Start the connection again from your assistant. Nothing was approved.</Notice>;
  // who is asking is decided by where the code will be SENT, never by the name the app chose (review 058 R1 H1)
  const who = describeClient(await clientName(request.clientId), request.redirectUri);
  const asked = SCOPES.filter((s) => request.scopes.includes(s.id)).map((s) => ({ id: s.id, text: s.text, write: s.write }));

  return (
    <PlainPage>
      <div className="mt-8 grid max-w-xl gap-6 md:mt-12">
        <header className="grid gap-3">
          <span className="eyebrow border-t border-ink pt-3 text-ink-muted">Authorize</span>
          <h1 className="text-[32px] leading-[1.05] font-medium tracking-[-0.03em] md:text-[40px]">
            Let <span className="emphasis">{who.title}</span> use WhiteFlow?
          </h1>
        </header>
        {who.warning && (
          <p role="alert" className="rounded-[14px] border border-warning px-4 py-3 text-sm text-warning">
            {who.warning}
          </p>
        )}
        <section aria-labelledby="who" className={card}>
          <h2 id="who" className="sr-only">
            What you are approving
          </h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt>App</dt>
              <dd className="font-medium">{who.title}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-hairline pt-2">
              <dt>Access is sent to</dt>
              <dd className="data">{who.host}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-hairline pt-2">
              <dt>Your WhiteFlow account</dt>
              <dd className="data flex items-center gap-2">
                <Account merchant={merchant} />
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-hairline pt-2">
              <dt>Network</dt>
              <dd className="data">Whitechain Testnet · test USDT</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-muted">
            The assistant gets only the permissions you tick. It can never move or send money, sign anything, change your receiving wallet, issue refunds or manage owners. You can disconnect at
            any time under AI connections.
          </p>
        </section>
        <section aria-labelledby="perms" className={card}>
          <h2 id="perms" className="text-[18px] font-medium">
            Permissions
          </h2>
          <ConsentForm request={token} csrf={csrfToken(merchant, token, secret)} scopes={asked} />
        </section>
      </div>
    </PlainPage>
  );
}
