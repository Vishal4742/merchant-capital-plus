"use client";

// The customer's invoice sheet (FR-PAY-3, FR-PAY-7, FR-PAY-9): the checkout's press-and-hold flow and plain words (no
// "sign", "gas" or chain names). The customer pays what is still owed plus a 0.10 USDT fee on top (Phase 3 MerchantPay),
// and the sheet says so. Paid and cancelled invoices show a closed sheet, not a toast.
// Batch 032 (FR-PAY-16): the checkout's short-balance notice before the hold and its "Pay with your wallet" option.
import Link from "next/link";
import { useRef, useState } from "react";
import type { Hex } from "viem";
import { Confirming } from "@/components/Confirming";
import { HoldButton } from "@/components/HoldButton";
import { GuestShort, WALLET_SHORT, WalletOption, loadSigner, useGuestFunds, walletPayer } from "@/components/WalletPay";
import { FAILED, NOT_FUNDED, outcome, type PayAnswer } from "@/lib/outcome";
import type { InvoicePayTerms } from "@/lib/sign-sale";
import { EXPLORER } from "@/lib/usdt";

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
/** Who approves: the guest (hold to pay) or the customer's own wallet. */
type Via = "hold" | "wallet";

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
  const [paying, setPaying] = useState<Via | null>(null);
  const fundsUrl = `/api/v1/invoices/${invoiceId}/funds`;
  // loads the signer after first paint, then asks our server whether this browser can pay owed + fee (FR-PAY-16)
  const guest = useGuestFunds(terms && state === "open" && !paid && phase === "ready" ? fundsUrl : null, "");

  function pay(via: Via) {
    if (!inFlight.current) {
      setPaying(via);
      inFlight.current = submit(via).finally(() => {
        inFlight.current = null;
        setPaying(null);
      });
    }
    return inFlight.current;
  }

  async function submit(via: Via) {
    setError(null);
    try {
      if (!terms) throw new Error("Payments aren't live yet.");
      const { signInvoice } = await loadSigner();
      // the customer's own wallet: connected, on chain 1874, enough USDT per our server, before it asks to approve
      const approval = await signInvoice(terms, via === "wallet" ? await walletPayer(fundsUrl) : undefined);
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
          {/* short: said before the hold, never after it; a hold already under way stays */}
          {guest.funds === "short" && guest.address && paying !== "hold" ? (
            <GuestShort amountText={totalText} address={guest.address} onRecheck={guest.recheck} />
          ) : (
            <>
              <HoldButton label={`Hold to pay ${totalText} USDT`} busyLabel="Paying" doneLabel="Paid" onConfirm={() => pay("hold")} aria-describedby="pay-hint" className="w-full" />
              <p id="pay-hint" className="text-center text-sm text-ink-muted">
                You pay {totalText} USDT: the {owedText} due plus a {feeText} USDT payment fee.
                <span className="block">Press and hold the button, or press Enter, to pay.</span>
              </p>
            </>
          )}
          {/* submit() already shows its error; the rejection only matters to the hold button */}
          <WalletOption busy={paying === "wallet"} disabled={paying !== null} onPay={() => void pay("wallet").catch(() => undefined)} />
        </div>
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Payments aren&apos;t live yet. Nothing can be charged from this page.
        </p>
      )}
      {error && (
        // the demo message explains a limit, it isn't a failure: the warning tone, not red (UX review 005 N3)
        <p role="alert" className={`text-sm ${error === NOT_FUNDED || error === WALLET_SHORT ? "text-warning" : "text-critical"}`}>
          {error}
        </p>
      )}
    </section>
  );
}
