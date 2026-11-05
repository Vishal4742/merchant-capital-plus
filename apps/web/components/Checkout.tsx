"use client";

// The customer's checkout sheet (FR-PAY-5, FR-PAY-7, FR-PAY-9). Plain words only: no "sign", "gas",
// "wallet" or chain names. Press and hold to pay (human pick); the guest key signs in the browser and our
// server checks and relays it.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { Confirming } from "@/components/Confirming";
import { HoldButton } from "@/components/HoldButton";
import { FAILED, outcome, type PayAnswer } from "@/lib/outcome";
import { EXPLORER } from "@/lib/usdt";

// The signer (viem + the guest key) loads after first paint, so it never slows the sheet (NFR-12).
type Signer = typeof import("@/lib/sign-sale");
const loadSigner = () => import("@/lib/sign-sale");

interface CheckoutProps {
  sessionId: string;
  merchantName: string;
  reference: string;
  items: { name: string; qty: number; price: string }[];
  amountText: string;
  /** Null until MerchantPay and the relayer are configured on the server. */
  sale: { merchantPay: Address; merchant: Address; orderRef: Hex; amount: string } | null;
  expiresAt: number;
  paid: boolean;
  /** An earlier attempt's outcome is still unknown (the server settles it from the chain). */
  pending: boolean;
}

type Receipt = { receiptId: string; txHash: Hex | null };
// confirming: an attempt's outcome is unknown, here or on the server. It wins over "expired": that customer may
// already have paid, so they must never be sent to a new checkout (security R1 S1), and it never offers the
// button again (002 security D4).
type Phase = "ready" | "confirming" | "expired";

/** The sheet already shows what happened (confirming or expired): no extra error line. */
class Shown extends Error {}

export function Checkout({ sessionId, merchantName, reference, items, amountText, sale, expiresAt, paid, pending }: CheckoutProps) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (pending ? "confirming" : Date.now() > expiresAt ? "expired" : "ready"));
  // the page, not the button, owns the payment in flight: a remounted button can't start a second one (R3 D3)
  const inFlight = useRef<Promise<void> | null>(null);
  const signer = useRef<Promise<Signer> | null>(null);
  useEffect(() => {
    if (!sale) return;
    const warm = () => {
      signer.current ??= loadSigner();
    };
    const hasIdle = typeof window.requestIdleCallback === "function"; // Safari lacks it: fall back to a short timeout
    const id = hasIdle ? window.requestIdleCallback(warm) : window.setTimeout(warm, 300);
    return () => (hasIdle ? window.cancelIdleCallback(id) : window.clearTimeout(id));
  }, [sale]);

  const pay = () => (inFlight.current ??= submit().finally(() => (inFlight.current = null)));

  async function submit() {
    setError(null);
    try {
      if (!sale) throw new Error("Payments aren't live yet.");
      const { signSale } = await (signer.current ??= loadSigner());
      const approval = await signSale(sale);
      let res: Response;
      try {
        res = await fetch(`/api/v1/sessions/${sessionId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(approval) });
      } catch {
        // the request may have reached our server before the connection dropped (plan review, batch 004)
        setPhase("confirming");
        throw new Shown();
      }
      const result = outcome(res.status, (await res.json().catch(() => ({}))) as PayAnswer);
      if (result.kind === "paid") return setReceipt({ receiptId: result.receiptId ?? sessionId, txHash: result.txHash });
      if (result.kind === "error") throw new Error(result.message);
      setPhase(result.kind === "closed" ? "expired" : "confirming");
      throw new Shown();
    } catch (e) {
      if (!(e instanceof Shown)) setError(e instanceof Error ? e.message : FAILED);
      throw e; // returns the hold button to idle
    }
  }

  const paidId = receipt?.receiptId ?? (paid ? sessionId : null);
  return (
    <section className="relative w-full max-w-[420px] rounded-[28px] bg-surface p-8 text-ink shadow-float" aria-live="polite">
      {paidId ? (
        <div className="grid gap-4">
          <h1 className="sr-only">Paid to {merchantName}</h1>
          <span className="justify-self-start rounded-pill border border-current px-3 py-0.5 text-xs font-medium tracking-wide text-positive">Paid</span>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="amount-xl">{amountText}</span>
            <span className="label text-ink-muted">USDT</span>
            <span className="text-ink-muted">to {merchantName}</span>
          </p>
          <dl className="grid gap-2 border-y border-hairline py-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Receipt</dt>
              <dd>
                <Link className="data text-accent underline underline-offset-4" href={`/r/${paidId}`}>
                  View receipt
                </Link>
              </dd>
            </div>
            {reference && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Order</dt>
                <dd>{reference}</dd>
              </div>
            )}
            {receipt?.txHash && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Record</dt>
                <dd>
                  <a className="text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                    View on explorer ↗
                  </a>
                </dd>
              </div>
            )}
          </dl>
          <p className="text-sm text-ink-muted">Keep the receipt link; it shows any refund too.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-1">
            <span className="label text-ink-muted">{reference ? `Order ${reference}` : "Checkout"}</span>
            <h1 className="title">{merchantName}</h1>
          </div>
          {items.length > 0 && (
            <ul className="grid gap-2 border-y border-hairline py-4">
              {items.map((item, i) => (
                <li key={`${i}-${item.name}`} className="flex justify-between gap-4">
                  <span>
                    {item.qty} × {item.name}
                  </span>
                  <span className="tabular-nums">{item.price}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-baseline justify-between">
            <span className="label text-ink-muted">Total</span>
            <span>
              <span className="amount-xl">{amountText}</span>
              <span className="label ml-1.5 text-ink-muted">USDT</span>
            </span>
          </p>
          {phase === "confirming" ? (
            <Confirming />
          ) : phase === "expired" ? (
            // expiry isn't an error: the warning token, not red (UX review 004 R2 L2)
            <p role="status" className="text-sm text-warning">
              This checkout has expired. Ask {merchantName} for a new one.
            </p>
          ) : sale ? (
            <div className="grid gap-3">
              <HoldButton label={`Hold to pay ${amountText}`} busyLabel="Paying" doneLabel="Paid" onConfirm={pay} aria-describedby="pay-hint" className="w-full" />
              <p id="pay-hint" className="text-center text-sm text-ink-muted">
                You pay exactly {amountText} USDT. No fees for you.
                <span className="block">Press and hold the button, or press Enter, to pay.</span>
              </p>
            </div>
          ) : (
            <p role="status" className="text-sm text-ink-muted">
              Payments aren&apos;t live yet. Nothing can be charged from this page.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
