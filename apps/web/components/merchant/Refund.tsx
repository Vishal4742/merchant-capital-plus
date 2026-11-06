"use client";

// Refund all or part of a payment from the shop's own wallet (FR-PAY-8). The money moves merchant → customer only;
// investors are never touched (MerchantPay.refund pulls from the merchant with transferFrom). MerchantPay re-reads what is
// left at send time and refuses more (RefundTooLarge), and lib/merchant-wallet.ts dry-runs it before anything is sent.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { connectMerchant, refund, walletError } from "@/lib/merchant-wallet";
import { formatUsdt, parseUsdt, plainUsdt } from "@/lib/usdt";

interface RefundProps {
  merchant: Address;
  merchantPay: Address;
  paymentId: string;
  /** gross − refunded in USDT units (decimal string), read from payments(id) on chain for this render. */
  refundable: string;
}

export function Refund({ merchant, merchantPay, paymentId, refundable }: RefundProps) {
  const router = useRouter();
  const left = BigInt(refundable);
  const all = plainUsdt(left); // "17.50", not "17.5" (UX review 005 N1); no separators, so parseUsdt reads it back
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(all);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        variant="quiet"
        onClick={() => {
          // always start from what is left now, never a figure typed for an earlier refund (tester R1 #2)
          setAmount(all);
          setError(null);
          setOpen(true);
        }}
      >
        Refund
      </Button>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    let units: bigint;
    try {
      units = parseUsdt(amount);
    } catch {
      units = 0n;
    }
    if (units === 0n || units > left) return setError(`Enter an amount above 0, up to ${formatUsdt(left)} USDT.`);
    setBusy(true);
    try {
      await refund(await connectMerchant(window.ethereum, merchant, merchantPay), BigInt(paymentId), units);
      setOpen(false);
      router.refresh(); // the table re-reads payments(id); the next open starts from the new figure
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(false);
    }
  }

  const inputId = `refund-${paymentId}`;
  return (
    <form onSubmit={submit} className="grid w-full gap-2 text-left sm:w-auto sm:justify-items-end">
      <label htmlFor={inputId} className="text-sm text-ink-muted">
        Refund amount (USDT)
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <input
          id={inputId}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          inputMode="decimal"
          autoComplete="off"
          aria-describedby={`${inputId}-hint`}
          className="h-12 w-full rounded-sm border border-hairline bg-surface px-3 tabular-nums text-ink sm:w-28 sm:text-right"
        />
        <Button type="submit" aria-disabled={busy}>
          {busy ? "Refunding…" : "Refund"}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)} aria-disabled={busy}>
          Close
        </Button>
      </div>
      <p id={`${inputId}-hint`} className="text-sm text-ink-muted">
        Up to {formatUsdt(left)} USDT. Your wallet may ask to approve this amount first.
      </p>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </form>
  );
}
