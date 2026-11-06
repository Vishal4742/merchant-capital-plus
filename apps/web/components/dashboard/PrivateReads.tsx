"use client";

// The private-read meter (FR-PRIV-3): how many of this page's chain reads went through Anon-RPC (Nym). It also starts
// the Anon-RPC boot, after first paint and when the browser is idle, so it never blocks input (NFR-13); until the boot
// is done, reads go through the wallet at once and count as plain. Click or focus shows one line on what it means.
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { meterValue, readMeter, serverMeter, setPrivateStatus, subscribeMeter, type ReadMeter } from "@/lib/read-meter";

const IDLE_TIMEOUT_MS = 3_000; // start within 3 s even on a busy page
const NO_IDLE_CALLBACK_MS = 500; // Safari has no requestIdleCallback

const DOT: Record<ReadMeter["status"], string> = { idle: "bg-ink-muted", connecting: "bg-ink-muted", ready: "bg-positive", failed: "bg-warning" };

function explain(m: ReadMeter): string {
  const now =
    m.status === "ready"
      ? "Reads go through Anon-RPC (Nym), so no node sees who is asking. Sending still goes through your wallet."
      : m.status === "failed"
        ? "Anon-RPC (Nym) couldn't connect, so reads go through your wallet and count as plain."
        : "Connecting to Anon-RPC (Nym). Until then, reads go through your wallet and count as plain.";
  const setup = m.setup > 0 ? ` Not counted: ${m.setup} setup ${m.setup === 1 ? "lookup" : "lookups"} on Ethereum to find Nym.` : "";
  return now + setup;
}

function startWhenIdle(): () => void {
  const start = () => {
    // the wallet code (viem, the Nym client) loads only now, never on the first paint's path
    import("@/lib/merchant-wallet").then(({ startPrivateReads }) => startPrivateReads(), () => setPrivateStatus("failed"));
  };
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(start, NO_IDLE_CALLBACK_MS);
  return () => clearTimeout(handle);
}

export function PrivateReads({ className = "" }: { className?: string }) {
  const meter = useSyncExternalStore(subscribeMeter, readMeter, serverMeter);
  const [open, setOpen] = useState(false);
  const panel = useId();
  useEffect(startWhenIdle, []);
  const counted = meter.private + meter.plain > 0;
  const connecting = !counted && (meter.status === "idle" || meter.status === "connecting");

  return (
    <div
      className={`relative ${className}`}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
        // keyboard focus opens it; a mouse click focuses too, and the click itself toggles
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline bg-surface px-3 text-sm whitespace-nowrap text-ink hover:bg-surface-sunk"
      >
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[meter.status]} ${connecting ? "motion-safe:animate-pulse" : ""}`} />
        {/* a phone keeps "Private" and the figure; the rest stays for screen readers */}
        <span>
          Private<span className="max-sm:sr-only"> reads</span>
          {counted ? " " : ": "}
          <span className="tabular-nums">
            <span className={connecting ? "max-sm:sr-only" : ""}>{meterValue(meter)}</span>
            {connecting && (
              <span aria-hidden="true" className="sm:hidden">
                …
              </span>
            )}
          </span>
        </span>
      </button>
      <p
        id={panel}
        hidden={!open}
        className="absolute top-full left-0 z-20 mt-2 w-[calc(100vw-2rem)] max-w-80 rounded-[14px] border border-hairline bg-surface p-3 text-sm text-ink shadow-card md:static md:w-auto"
      >
        {explain(meter)}{" "}
        {/* a full load: /proofs runs outside the dashboard's headers (security review 005 F-N4) */}
        <a href="/proofs" className="text-accent underline underline-offset-4">
          See a private read
        </a>
      </p>
    </div>
  );
}
