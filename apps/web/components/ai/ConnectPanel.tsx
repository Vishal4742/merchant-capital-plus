"use client";

// The interactive part of "Connect your AI" (batch 058, FR-MCP-4): the ChatGPT / Claude selector, the copy button and the
// endpoint. Every prompt arrives already built by the server (lib/ai-connect.ts) from public facts only; this component
// never composes text, never reads storage or cookies and never marks anything as connected. Clipboard missing or blocked:
// the prompt is shown in a text box, selected, to copy by hand.
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";

export interface PanelPrompt {
  client: "chatgpt" | "claude-app" | "claude-code";
  label: string;
  /** null: setup isn't available, and `reason` says why */
  prompt: string | null;
}

const MAIN = ["chatgpt", "claude-app"] as const;

export function ConnectPanel({ prompts, reason, mcpUrl }: { prompts: PanelPrompt[]; reason: string | null; mcpUrl: string | null }) {
  const [client, setClient] = useState<PanelPrompt["client"]>("chatgpt");
  const [outcome, setOutcome] = useState<"idle" | "copied" | "failed">("idle");
  const box = useRef<HTMLTextAreaElement>(null);
  const current = prompts.find((p) => p.client === client) ?? prompts[0];

  const choose = (next: PanelPrompt["client"]) => {
    setClient(next);
    setOutcome("idle");
  };

  const copy = async () => {
    if (!current.prompt) return;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(current.prompt);
      setOutcome("copied");
    } catch {
      setOutcome("failed");
      // the text box exists on the next render: focus and select it so Ctrl+C works at once
      setTimeout(() => {
        box.current?.focus();
        box.current?.select();
      }, 0);
    }
  };

  const option = (p: PanelPrompt) => (
    <label
      key={p.client}
      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] border border-hairline px-4 py-3 text-[15px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
    >
      <input type="radio" name="assistant" value={p.client} checked={client === p.client} onChange={() => choose(p.client)} className="size-4 accent-[var(--accent)]" />
      {p.label}
    </label>
  );

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2.5">
        <legend className="eyebrow mb-2 text-ink-muted">Your assistant</legend>
        <div className="grid gap-2.5 sm:grid-cols-2">{prompts.filter((p) => (MAIN as readonly string[]).includes(p.client)).map(option)}</div>
        <details className="mt-1 text-sm" open={client === "claude-code" || undefined}>
          <summary className="min-h-11 cursor-pointer py-2.5 text-ink-muted underline underline-offset-4">Advanced: Claude Code (terminal)</summary>
          <div className="grid gap-2.5 pt-2">{prompts.filter((p) => p.client === "claude-code").map(option)}</div>
        </details>
      </fieldset>

      {current.prompt ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={copy}>Copy setup prompt</Button>
            <span role="status" className="text-sm text-ink-muted">
              {outcome === "copied" && "Copied. Paste it into your assistant. Nothing is connected until you finish the steps below."}
              {outcome === "failed" && "Your browser blocked copying. The text is selected below: press Ctrl+C (Cmd+C on Mac)."}
            </span>
          </div>
          {outcome === "failed" ? (
            <textarea ref={box} readOnly aria-label={`Setup prompt for ${current.label}`} value={current.prompt} rows={12} className="w-full min-w-0 rounded-sm border border-hairline bg-surface p-3 font-mono text-xs" />
          ) : (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2.5 text-ink-muted underline underline-offset-4">Preview what you&apos;ll copy</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-sm border border-hairline bg-surface-sunk p-3 text-xs whitespace-pre-wrap">{current.prompt}</pre>
            </details>
          )}
          <p className="text-xs text-ink-muted">The prompt holds no password, key or token. Pasting it doesn&apos;t install or authorize anything: you do that in your assistant.</p>
        </div>
      ) : (
        <p role="status" className="rounded-[14px] border border-hairline bg-surface-sunk p-4 text-sm text-warning">
          Setup isn&apos;t available yet. {reason}
        </p>
      )}

      {mcpUrl && (
        <div className="grid gap-1.5">
          <span className="eyebrow text-ink-muted">MCP endpoint</span>
          <div className="flex flex-wrap items-center gap-x-3">
            <code className="data min-w-0 break-all">{mcpUrl}</code>
            <CopyButton text={mcpUrl} name="the MCP endpoint" />
          </div>
        </div>
      )}
    </div>
  );
}
