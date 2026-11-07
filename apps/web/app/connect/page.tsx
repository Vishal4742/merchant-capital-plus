// /connect (batch 058, FR-MCP-4): the public setup guide for connecting ChatGPT or Claude. Secret-free and merchant-free:
// it reads no cookie, creates no grant and authorizes nobody. It shows a setup prompt only when the owner has switched the
// remote service on (lib/ai-config.ts); otherwise it says setup isn't available, with no localhost or sandbox substitute.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ConnectGuide } from "@/components/ai/ConnectGuide";
import { panelPrompts } from "@/components/ai/prompts";
import { PlainPage } from "@/components/gateway/Frame";
import { currentAiConnect } from "@/lib/ai-config";

export const metadata: Metadata = { title: "Connect your AI · WhiteFlow", description: "Use WhiteFlow from ChatGPT or Claude: copy a setup prompt, authorize, verify." };

export default function ConnectPage() {
  return (
    <Suspense fallback={<PlainPage><p className="py-8 text-ink-muted">Loading the setup guide…</p></PlainPage>}>
      <Guide />
    </Suspense>
  );
}

async function Guide() {
  await connection(); // the owner's switch is read at request time, never frozen into the build
  const { prompts, reason } = panelPrompts(currentAiConnect(""));
  const config = currentAiConnect("");
  return (
    <PlainPage>
      <ConnectGuide prompts={prompts} reason={reason} mcpUrl={config.available ? config.mcpUrl : null} />
    </PlainPage>
  );
}
