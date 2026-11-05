"use client";

// The customer's invoice sheet (FR-PAY-3, FR-PAY-7, FR-PAY-9): the checkout's press-and-hold flow and plain words (no
// "sign", "gas" or chain names). The customer pays what is still owed plus a 0.10 USDT fee on top (Phase 3 MerchantPay),
// and the sheet says so. Paid and cancelled invoices show a closed sheet, not a toast.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { Confirming } from "@/components/Confirming";
import { HoldButton } from "@/components/HoldButton";
import { FAILED, outcome, type PayAnswer } from "@/lib/outcome";
import type { InvoicePayTerms } from "@/lib/sign-sale";
import { EXPLORER } from "@/lib/usdt";

// The signer (viem + the guest key) loads after first paint, so it never slows the sheet (NFR-12).
type Signer = typeof import("@/lib/sign-sale");
const loadSigner = () => import("@/lib/sign-sale");

export interface InvoicePayProps {
  invoiceId: string;
  /** The shop's name (/pay serves only the shop's own invoices). */
  merchantName: string;
  dueText: string;
  /** The whole invoice, what was paid before (null if nothing), what is still owed, the fee, and owed + fee. */
  invoiceText: string;
  paidSoFarText: string | null;
  owedText: string;
  feeText: string;
  totalText: string;
  state: "open" | "paid" | "cancelled" | "pending";
  /** Null until MerchantPay and the relayer are configured on the server. */
  terms: InvoicePayTerms | null;
  /** The payment id of a paid invoice, when our server knows it. */
  receiptId: string | null;
}

type Paid = { receiptId: string | null; txHash: Hex | null };
// confirming: an attempt's outcome is unknown, here or on the server; it never offers the button again (002 security D4)
type Phase = "ready" | "confirming" | "cancelled";

/** The sheet already shows what happened (confirming or cancelled): no extra error line. */
class Shown extends Error {}

const PILL = {
  ready: { label: "Open", tone: "text-accent" },
  partPaid: { label: "Part paid", tone: "text-accent" },
  confirming: { label: "Confirming", tone: "text-warning" },
  cancelled: { label: "Cancelled", tone: "text-ink-muted" },
  paid: { label: "Paid", tone: "text-positive" },
} as const;

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

export function InvoicePay({ invoiceId, merchantName, dueText, invoiceText, paidSoFarText, owedText, feeText, totalText, state, terms, receiptId }: InvoicePayProps) {
  const [paid, setPaid] = useState<Paid | null>(state === "paid" ? { receiptId, txHash: null } : null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(state === "pending" ? "confirming" : state === "cancelled" ? "cancelled" : "ready");
  // the page, not the button, owns the payment in flight: a remounted button can't start a second one (R3 D3)
  const inFlight = useRef<Promise<void> | null>(null);
  const signer = useRef<Promise<Signer> | null>(null);
  useEffect(() => {
    if (!terms || state !== "open") return;
    const warm = () => {
      signer.current ??= loadSigner();
    };
    const hasIdle = typeof window.requestIdleCallback === "function"; // Safari lacks it: fall back to a short timeout
    const id = hasIdle ? window.requestIdleCallback(warm) : window.setTimeout(warm, 300);
    return () => (hasIdle ? window.cancelIdleCallback(id) : window.clearTimeout(id));
  }, [terms, state]);

  const pay = () => (inFlight.current ??= submit().finally(() => (inFlight.current = null)));

  async function submit() {
    setError(null);
    try {
      if (!terms) throw new Error("Payments aren't live yet.");
      const { signInvoice } = await (signer.current ??= loadSigner());
      const approval = await signInvoice(terms);
      let res: Response;
      try {
        res = await fetch(`/api/v1/invoices/${invoiceId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(approval) });
      } catch {
        setPhase("confirming"); // the request may have reached our server before the connection dropped
        throw new Shown();
      }
      const result = outcome(res.status, (await res.json().catch(() => ({}))) as PayAnswer);
      if (result.kind === "paid") return setPaid({ receiptId: result.receiptId, txHash: result.txHash });
      if (result.kind === "error") throw new Error(result.message);
      setPhase(result.kind === "closed" ? "cancelled" : "confirming");
      throw new Shown();
    } catch (e) {
      if (!(e instanceof Shown)) setError(e instanceof Error ? e.message : FAILED);
      throw e; // returns the hold button to idle
    }
  }

  const pill = PILL[paid ? "paid" : phase === "ready" && paidSoFarText ? "partPaid" : phase];
  const payable = !paid && phase === "ready";
  return (
    <section className="relative grid w-full max-w-[420px] gap-6 rounded-[28px] bg-surface p-8 text-ink shadow-float" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <span className="label text-ink-muted">Invoice {invoiceId}</span>
          <h1 className="title first-letter:uppercase">{merchantName}</h1>
        </div>
        <span className={`shrink-0 rounded-pill border border-current px-3 py-0.5 text-xs font-medium tracking-wide ${pill.tone}`}>{pill.label}</span>
      </div>
      <dl className="grid gap-2 border-y border-hairline py-4 text-sm">
        <Row term="Due">{dueText}</Row>
        <Row term="Invoice">{invoiceText} USDT</Row>
        {!paid && paidSoFarText && <Row term="Already paid">{paidSoFarText} USDT</Row>}
        {payable && <Row term="Payment fee">{feeText} USDT</Row>}
        {paid?.receiptId && (
          <Row term="Receipt">
            <Link className="data text-accent underline underline-offset-4" href={`/r/${paid.receiptId}`}>
              View receipt
            </Link>
          </Row>
        )}
        {paid?.txHash && (
          <Row term="Record">
            <a className="text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${paid.txHash}`} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          </Row>
        )}
      </dl>
      {payable || phase === "confirming" ? (
        <p className="flex items-baseline justify-between">
          <span className="label text-ink-muted">You pay</span>
          <span>
            <span className="amount-xl">{totalText}</span>
            <span className="label ml-1.5 text-ink-muted">USDT</span>
          </span>
        </p>
      ) : null}
      {paid ? (
        <p className="text-sm text-ink-muted">This invoice is paid. {paid.receiptId ? "Keep the receipt link; it shows any refund too." : "There's nothing left to pay."}</p>
      ) : phase === "confirming" ? (
        <Confirming />
      ) : phase === "cancelled" ? (
        <p role="status" className="text-sm text-ink-muted">
          This invoice was cancelled, so it can&apos;t be paid. Ask whoever sent it for a new one.
        </p>
      ) : terms ? (
        <div className="grid gap-3">
          <HoldButton label={`Hold to pay ${totalText}`} busyLabel="Paying" doneLabel="Paid" onConfirm={pay} aria-describedby="pay-hint" className="w-full" />
          <p id="pay-hint" className="text-center text-sm text-ink-muted">
            You pay {totalText} USDT: the {owedText} due plus a {feeText} USDT payment fee.
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
    </section>
  );
}
