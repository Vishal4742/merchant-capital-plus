"use client";

// The live pay button on /docs (FR-GW-4, FR-GW-8). "Make a test checkout" does what a shop's server does: it opens a
// real test checkout for the demo shop through POST /api/demo-checkout (the same route as "Simulate a payment", 303 to
// /checkout/{id}), reads the id from where that redirect lands, then loads the real /v1/button.js with it. The button
// that appears is exactly what a shop's page gets; pressing it opens the hosted checkout (test money). Same origin only,
// so /docs keeps its strict CSP (script-src and connect-src 'self').
import { useRef, useState } from "react";
import { Button } from "@/components/Button";

const CHECKOUT_PATH = /^\/checkout\/([\w-]{1,64})$/; // button.js accepts the same ids
const LABEL = "Pay 25.00 USDT";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "ready"; id: string } | { kind: "error"; message: string };

function failure(res: Response): string {
  if (res.status === 429) return "Too many test checkouts. Wait a minute and try again.";
  if (res.redirected) return "The demo shop isn't set up on this server, so there is no checkout to open.";
  return "That didn't work. Try again in a moment.";
}

export function ButtonPreview() {
  const slot = useRef<HTMLDivElement>(null); // React renders no children here: the script and its button live in it
  const [state, setState] = useState<State>({ kind: "idle" });

  async function make() {
    setState({ kind: "busy" });
    let res: Response;
    try {
      res = await fetch("/api/demo-checkout", { method: "POST" });
    } catch {
      setState({ kind: "error", message: "We couldn't reach the gateway. Check your connection and try again." });
      return;
    }
    res.body?.cancel().catch(() => {}); // only where the redirect landed matters, not the checkout page itself
    const id = res.ok ? CHECKOUT_PATH.exec(new URL(res.url).pathname)?.[1] : undefined;
    if (!id) {
      setState({ kind: "error", message: failure(res) });
      return;
    }
    const script = document.createElement("script");
    script.src = "/v1/button.js";
    script.dataset.session = id;
    script.dataset.label = LABEL;
    script.onload = () => slot.current?.querySelector<HTMLButtonElement>(".mc-pay-button")?.focus(); // the next step
    slot.current?.replaceChildren(script);
    setState({ kind: "ready", id });
  }

  const busy = state.kind === "busy";
  return (
    <div className="grid gap-4">
      <div className="relative grid min-h-32 place-items-center rounded-[14px] border border-dashed border-hairline bg-ground p-6">
        <div ref={slot} />
        {state.kind !== "ready" && <p className="text-sm text-ink-muted">The real button appears here.</p>}
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {state.kind === "idle" && "This makes a real test checkout for the demo shop (25.00 USDT, test money), the way your server would, then loads /v1/button.js with its id."}
        {state.kind === "busy" && "Making a test checkout…"}
        {state.kind === "ready" && `Checkout ${state.id.slice(0, 8)}… is ready. Press the button to open it.`}
        {state.kind === "error" && <span className="text-warning">{state.message}</span>}
      </p>
      {state.kind === "ready" && (
        <pre className="data rounded-[14px] bg-scene-night p-4 text-[12px] leading-[1.6] break-words whitespace-pre-wrap text-glass-ink">
          <code>{`<script src="/v1/button.js" data-session="${state.id}" data-label="${LABEL}"></script>`}</code>
        </pre>
      )}
      <div>
        <Button variant={state.kind === "ready" ? "quiet" : "primary"} onClick={make} aria-disabled={busy}>
          {busy ? "Making a checkout…" : state.kind === "ready" ? "Make another" : "Make a test checkout"}
        </Button>
      </div>
    </div>
  );
}
