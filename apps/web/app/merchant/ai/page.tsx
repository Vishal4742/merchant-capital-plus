// /merchant/ai (batch 058): the signed-in side of "Connect your AI": the connection's honest state, then the same guide as
// /connect. State comes from lib/ai-connect.ts, so a copied prompt or a finished consent can never read as Verified.
// There is no grant store in this phase, so the state is Setup required or Service unavailable and there is nothing to
// disconnect; the grant list and Disconnect arrive with the OAuth server (spec phase C).
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ConnectGuide } from "@/components/ai/ConnectGuide";
import { panelPrompts } from "@/components/ai/prompts";
import { Shell } from "@/components/dashboard/Shell";
import { Account, card, SignedOut } from "@/components/gateway/Frame";
import { authSecret } from "@/lib/auth";
import { currentAiConnect } from "@/lib/ai-config";
import { connectionState, STATE_TEXT } from "@/lib/ai-connect";
import { currentMerchant } from "@/lib/merchant-session";

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

/** The clock is read here, in a plain function, not in the render body. No grant store exists yet, so grant is null. */
const stateNow = (provisioned: boolean) => connectionState({ provisioned, grant: null, now: Date.now() });

async function Connections() {
  await connection();
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const config = currentAiConnect("");
  const { prompts, reason } = panelPrompts(config);
  const text = STATE_TEXT[stateNow(config.available)];
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
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Network</dt>
                <dd className="data">Whitechain Testnet · test USDT</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Last verified request</dt>
                <dd className="data">Never</dd>
              </div>
            </dl>
          </section>
        }
      />
    </Shell>
  );
}
