"use client";

// Disconnect one assistant (batch 058). Posts to the revoke route with this grant's CSRF token; on success the page reloads
// its list, where the connection now reads "Revoked". Its next tool call and refresh are refused by the server.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";

export function DisconnectButton({ grantId, csrf, name }: { grantId: string; csrf: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const disconnect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/mcp/grants/${encodeURIComponent(grantId)}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setProblem(body.error ?? "Couldn't disconnect. Try again.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setProblem("We couldn't reach WhiteFlow. It is still connected; try again.");
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1">
      <Button variant="glass" className="h-11 border-ink/30 px-4 text-sm text-ink" onClick={disconnect} aria-disabled={busy} aria-label={`Disconnect ${name}`}>
        {busy ? "Disconnecting…" : "Disconnect"}
      </Button>
      {problem && (
        <p role="alert" className="text-xs text-warning">
          {problem}
        </p>
      )}
    </div>
  );
}
