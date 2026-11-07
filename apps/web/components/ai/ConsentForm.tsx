"use client";

// The consent choices (batch 058): which permissions to grant, Approve or Deny. It posts JSON to /api/mcp/consent with the
// CSRF token the server rendered, then navigates the browser to the assistant's callback the server returned (a form post
// can't: this site's form-action policy is 'self'). Read permissions start ticked; creating links never does.
import { useState } from "react";
import { Button } from "@/components/Button";

export interface ConsentScope {
  id: string;
  text: string;
  write: boolean;
}

export function ConsentForm({ request, csrf, scopes }: { request: string; csrf: string; scopes: ConsentScope[] }) {
  const [ticked, setTicked] = useState<string[]>(scopes.filter((s) => !s.write).map((s) => s.id));
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (decision: "approve" | "deny") => {
    setBusy(decision);
    setProblem(null);
    try {
      const res = await fetch("/api/mcp/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, csrf, decision, scopes: ticked }) });
      const body = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !body.redirect) {
        setProblem(body.error ?? "Something went wrong. Nothing was approved.");
        setBusy(null);
        return;
      }
      window.location.assign(body.redirect);
    } catch {
      setProblem("We couldn't reach WhiteFlow. Check your connection; nothing was approved.");
      setBusy(null);
    }
  };

  const toggle = (id: string) => setTicked((now) => (now.includes(id) ? now.filter((s) => s !== id) : [...now, id]));
  const reads = scopes.filter((s) => !s.write), writes = scopes.filter((s) => s.write);
  const row = (s: ConsentScope) => (
    <li key={s.id}>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[12px] border border-hairline px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={ticked.includes(s.id)} onChange={() => toggle(s.id)} />
        <span className="grid gap-0.5 text-sm">
          <code className="data">{s.id}</code>
          <span className={s.write ? "text-warning" : "text-ink-muted"}>{s.text}</span>
        </span>
      </label>
    </li>
  );

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="eyebrow mb-1 text-ink-muted">Read access</legend>
        <ul className="grid gap-2">{reads.map(row)}</ul>
      </fieldset>
      {writes.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="eyebrow mb-1 text-warning">Extra permission, off unless you tick it</legend>
          <ul className="grid gap-2">{writes.map(row)}</ul>
        </fieldset>
      )}
      {problem && (
        <p role="alert" className="text-sm text-warning">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => send("approve")} aria-disabled={busy !== null || ticked.length === 0}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button variant="glass" className="border-ink/30 text-ink" onClick={() => send("deny")} aria-disabled={busy !== null}>
          Deny
        </Button>
      </div>
      {ticked.length === 0 && <p className="text-xs text-ink-muted">Tick at least one permission to approve, or deny.</p>}
    </div>
  );
}
