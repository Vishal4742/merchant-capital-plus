"use client";

// I4, the transfer check (FR-TOK-2, FR-TOK-3, FR-TOK-4, FR-TOK-8, AT-8): GET /api/v1/capital/transfer-check gives the
// first rule a transfer would break, in ClaimToken's own order, before anything is signed. There is no Send button:
// moving a claim costs gas, and investors here never pay gas (CON-4; AT-8 records the on-chain revert once).
import { useState, type FormEvent } from "react";
import { isAddress, type Address } from "viem";
import { Button } from "@/components/Button";
import { field } from "@/components/gateway/Frame";
import { parseUsdt } from "@/lib/usdt";

type Check = { phase: "idle" } | { phase: "checking" } | { phase: "allowed" } | { phase: "blocked"; reason: string } | { phase: "error"; message: string };

export interface TransferCheckProps {
  from: Address;
  claimId: bigint;
}

export function TransferCheck({ from, claimId }: TransferCheckProps) {
  const [check, setCheck] = useState<Check>({ phase: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const to = String(form.get("to") ?? "").trim();
    const amount = String(form.get("amount") ?? "").trim();
    if (!isAddress(to)) return setCheck({ phase: "error", message: "Enter the receiver's 0x wallet address." });
    let units: bigint;
    try {
      units = parseUsdt(amount);
    } catch {
      return setCheck({ phase: "error", message: "Enter an amount like 10.00, with at most 6 decimals." });
    }
    if (units === 0n) return setCheck({ phase: "error", message: "Enter an amount above 0." });
    setCheck({ phase: "checking" });
    const query = new URLSearchParams({ from, to, claim: claimId.toString(), amount: units.toString() });
    try {
      const res = await fetch(`/api/v1/capital/transfer-check?${query}`);
      const data = (await res.json()) as { allowed?: unknown; reason?: unknown; error?: unknown };
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "check failed");
      setCheck(data.allowed === true ? { phase: "allowed" } : { phase: "blocked", reason: typeof data.reason === "string" ? data.reason : "This transfer would be refused." });
    } catch (error) {
      setCheck({ phase: "error", message: error instanceof Error && error.message !== "check failed" ? error.message : "We couldn't check this transfer right now. Try again." });
    }
  }

  return (
    <form onSubmit={submit} onChange={() => check.phase !== "checking" && setCheck({ phase: "idle" })} className="grid gap-3 border-t border-hairline pt-4">
      <h3 className="text-sm font-medium">Check a transfer</h3>
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Receiver&apos;s wallet</span>
          <input name="to" autoComplete="off" spellCheck={false} placeholder="0x…" required className={`${field} data`} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Amount (USDT)</span>
          <input name="amount" inputMode="decimal" autoComplete="off" placeholder="10.00" required className={`${field} tabular-nums`} />
        </label>
        <Button type="submit" className="h-11 px-5 text-sm" aria-disabled={check.phase === "checking"}>
          {check.phase === "checking" ? "Checking…" : "Check"}
        </Button>
      </div>
      {check.phase === "blocked" && (
        <p role="status" className="text-sm text-warning">
          Blocked: {check.reason}
        </p>
      )}
      {check.phase === "allowed" && (
        <p role="status" className="text-sm text-positive">
          This transfer would go through.
        </p>
      )}
      {check.phase === "error" && (
        <p role="alert" className="text-sm text-critical">
          {check.message}
        </p>
      )}
      <p className="text-xs text-ink-muted">This only checks the rules. There&apos;s no Send button: moving a claim costs gas, and investors on this demo never pay gas.</p>
    </form>
  );
}
