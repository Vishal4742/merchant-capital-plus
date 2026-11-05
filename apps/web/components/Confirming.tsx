"use client";

// The "we couldn't confirm it yet" panel of the checkout and invoice sheets. "Check again" is a full reload: the server
// settles the attempt from the chain and shows the receipt if it went through. It reads as a link, not a disabled
// button (UX review 004 R2 L1).
import { UNCONFIRMED } from "@/lib/outcome";

export function Confirming() {
  return (
    <div role="status" className="grid gap-3 rounded-md border border-hairline p-4">
      <span className="justify-self-start rounded-pill border border-current px-3 py-0.5 text-xs font-medium tracking-wide text-warning">Confirming</span>
      <p className="text-sm">{UNCONFIRMED}</p>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center justify-self-start text-base font-medium text-accent underline underline-offset-4 hover:text-accent-hover">
        Check again
      </button>
    </div>
  );
}
