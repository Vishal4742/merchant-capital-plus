"use client";
// A payment page's total, kept current as the customer changes quantities, with "Continue to pay" disabled while
// nothing is chosen (G4 UX review M1). It renders first with the server's quantities, so with no JS the page still
// works: "Update total" reloads it with the server's total, and the checkout route checks the order again either way.
import { useState, type FormEvent, type ReactNode } from "react";
import { buttonClasses } from "@/components/Button";
import { liveTotal } from "@/lib/gateway-forms";
import { formatUsdt } from "@/lib/usdt";

interface LiveTotalProps {
  prices: readonly string[];
  quantities: readonly string[];
  currency: string;
  updateAction: string;
  alert: ReactNode;
  children: ReactNode;
}

export function LiveTotal({ prices, quantities, currency, updateAction, alert, children }: LiveTotalProps) {
  const [total, setTotal] = useState(() => liveTotal(prices, quantities));
  const recount = (event: FormEvent<HTMLDivElement>) => {
    const inputs = event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="number"]');
    setTotal(liveTotal(prices, [...inputs].map((input) => input.value)));
  };
  const empty = total === 0n;
  return (
    <>
      <div className="contents" onInput={recount}>
        {children}
      </div>
      <p className="flex items-baseline justify-between gap-3" aria-live="polite">
        <span className="eyebrow text-ink-muted">Total</span>
        <span>
          <b className="text-[32px] leading-none font-medium tracking-[-0.03em] tabular-nums">{formatUsdt(total)}</b> <span className="eyebrow text-ink-muted">{currency}</span>
        </span>
      </p>
      {alert}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* first in the form, so Enter in a quantity updates the total instead of paying */}
        <button type="submit" formMethod="get" formAction={updateAction} formNoValidate className={buttonClasses("quiet")}>
          Update total
        </button>
        <button type="submit" disabled={empty} aria-describedby={empty ? "choose-hint" : undefined} className={buttonClasses("primary", "flex-1 disabled:opacity-45")}>
          Continue to pay
        </button>
      </div>
      {empty && (
        <p id="choose-hint" className="text-sm text-ink-muted">
          Choose at least one item.
        </p>
      )}
    </>
  );
}
