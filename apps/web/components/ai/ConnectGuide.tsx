// The guide shared by the public /connect page and the signed-in /merchant/ai page (batch 058): headline, the selector
// and copy button, three steps, examples drawn from what the backend really does, the permissions and the limits.
// Contains nothing merchant-specific. Server component; only ConnectPanel is interactive.
import type { ReactNode } from "react";
import { ConnectPanel, type PanelPrompt } from "@/components/ai/ConnectPanel";
import { card, EditorialHeader, SectionLabel } from "@/components/gateway/Frame";
import { EXAMPLES } from "@/lib/ai-connect";

export const SCOPES = [
  { id: "account:read", text: "See your business name, network and what WhiteFlow supports", write: false },
  { id: "links:read", text: "Read your payment links and whether they've been paid", write: false },
  { id: "payments:read", text: "Read your payments", write: false },
  { id: "reports:read", text: "Read collection summaries: gross, fees and net", write: false },
  { id: "links:write", text: "Create payment links. Asked for separately, off by default", write: true },
] as const;

const STEPS = [
  { title: "Add the connector", text: "Choose your assistant and add the server URL below as a custom MCP connector using OAuth. The optional setup prompt can guide you through these steps." },
  { title: "Authorize WhiteFlow", text: "Sign in to your WhiteFlow workspace as an Owner and review the permissions. Your workspace needs a linked receiving wallet. Read access comes first; creating links is a separate choice." },
  { title: "Verify", text: "Ask: “Show my WhiteFlow business profile.” The connection counts as verified only after that request succeeds." },
] as const;

export function ConnectGuide({ prompts, reason, mcpUrl, lead }: { prompts: PanelPrompt[]; reason: string | null; mcpUrl: string | null; lead?: ReactNode }) {
  return (
    <>
      <EditorialHeader label="AI connections" lede="Create payment links and check verified Whitechain testnet payments by asking your assistant. You approve what it can do, and you can disconnect at any time.">
        Use WhiteFlow in your <span className="emphasis">AI assistant.</span>
      </EditorialHeader>
      <div className="grid gap-8 px-4 py-6 md:px-8 md:py-8">
        {lead}
        <section aria-labelledby="start" className={`${card} max-w-3xl`}>
          <h2 id="start" className="text-[18px] font-medium">
            Connect your AI
          </h2>
          <ConnectPanel prompts={prompts} reason={reason} mcpUrl={mcpUrl} />
        </section>

        <section aria-labelledby="steps" className="grid max-w-3xl gap-4">
          <SectionLabel id="steps">Three steps</SectionLabel>
          <ol className="grid gap-3 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className={`${card} gap-2 p-4 md:p-5`}>
                <span className="eyebrow text-ink-muted">Step {index + 1}</span>
                <b className="font-medium">{step.title}</b>
                <span className="text-sm text-ink-muted">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="examples" className="grid max-w-3xl gap-4">
          <SectionLabel id="examples">What you can ask</SectionLabel>
          <ul className="grid gap-2 text-[15px]">
            {EXAMPLES.map((example) => (
              <li key={example.text} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-[14px] border border-hairline px-4 py-3">
                <span>“{example.text}”</span>
                <span className="eyebrow text-ink-muted">{example.writes ? "Needs create-links permission" : "Read only"}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-muted">
            The assistant creates links and reads your records. The customer authorizes the payment themselves, at your link&apos;s checkout. Amounts are test USDT on Whitechain testnet.
          </p>
        </section>

        <section aria-labelledby="scopes" className="grid max-w-3xl gap-4">
          <SectionLabel id="scopes">Permissions you can grant</SectionLabel>
          <ul className="grid gap-2 text-sm">
            {SCOPES.map((scope) => (
              <li key={scope.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline pb-2">
                <code className="data">{scope.id}</code>
                <span className={scope.write ? "text-warning" : "text-ink-muted"}>{scope.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="limits" className="grid max-w-3xl gap-3">
          <SectionLabel id="limits">What it can never do</SectionLabel>
          <p className="text-sm text-ink-muted">
            Move or send money, sign anything, change your receiving wallet, issue refunds or manage owners. Customer records, invoice drafts and invoice approvals aren&apos;t connected to
            assistants yet. Only the six actions above are.
          </p>
        </section>
      </div>
    </>
  );
}
