"use client";

// FR-INV-8 (batch 047): "Acknowledge this invoice" on the invoice sheet. The customer confirms it owes this invoice with
// one approval, the same ways in as paying: this browser's key by default, or its own wallet (the browser's, or Privy's
// modal when its app ID is set). A message, never a transaction: nothing is paid and no money moves. Our server rebuilds
// the message from the invoice on chain, checks it and keeps each key's first ack (POST …/acknowledge). Security 047 M1:
// another key's earlier ack is named as such ("Acknowledged by another key"), never shown as this browser's, and this
// key can still add its own. An invoice that names its customer wallet takes that wallet's ack only (H1).
// FR-PAY-7: only the wallet block (data-pay-option="wallet") says "wallet".
import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { istDateTime, short } from "@/components/capital/investor/format";
import { ackCount } from "@/components/DebtorAck";
import { connectVia, endWalletSession, loadSigner, useHasWallet, type WalletVia } from "@/components/WalletPay";
import { errorTone } from "@/lib/outcome";
import { privyAppId } from "@/lib/privy-config";
import type { AckEntry } from "@/lib/server/invoice-acks";
import type { AckTermsText } from "@/lib/sign-sale";

const NOT_SAVED = "We couldn't save that. Nothing was charged. Try again.";
/** Who approves: this browser's key, or the customer's own wallet. */
type Via = "guest" | WalletVia;

interface InvoiceAckProps {
  terms: AckTermsText;
  /** Every key's ack of this invoice, oldest first: the short address and when (our server's record). */
  acks: AckEntry[];
  /** The customer wallet the invoice names on chain (short), or null: then any pay-link holder may acknowledge. */
  customer: string | null;
  /** This browser's guest address, once loaded (null until then). */
  guest: Address | null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function InvoiceAck({ terms, acks, customer, guest }: InvoiceAckProps) {
  const [added, setAdded] = useState<AckEntry | null>(null); // the ack made on this page, by whichever key
  const [busy, setBusy] = useState<Via | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasWallet = useHasWallet();
  const privy = privyAppId();

  async function acknowledge(via: Via) {
    if (busy) return;
    setBusy(via);
    setError(null);
    try {
      const { signAck } = await loadSigner();
      const body = await signAck(terms, via === "guest" ? undefined : await connectVia(via));
      const res = await fetch(`/api/v1/invoices/${terms.invoiceId}/acknowledge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {
        throw new Error(NOT_SAVED);
      });
      const data = (await res.json().catch(() => ({}))) as { signed_at?: unknown; error?: unknown };
      if (!res.ok || typeof data.signed_at !== "string") throw new Error(typeof data.error === "string" ? data.error : NOT_SAVED);
      setAdded({ debtor: short(body.debtor), signed_at: data.signed_at });
    } catch (e) {
      setError(e instanceof Error ? e.message : NOT_SAVED);
    } finally {
      endWalletSession();
      setBusy(null);
    }
  }

  // this browser's own ack: made here, or the stored one whose short debtor is this browser's guest key
  const own = added ?? (guest && acks.find((a) => same(a.debtor, short(guest)))) ?? null;
  const others = acks.filter((a) => !own || !same(a.debtor, own.debtor));
  const count = others.length + (own ? 1 : 0);
  const tally = count > 1 ? ` · ${ackCount(count)} acknowledgements` : "";
  if (own) {
    return (
      <p role="status" className="border-t border-hairline pt-4 text-center text-sm text-positive">
        You acknowledged this invoice {istDateTime(Date.parse(own.signed_at))}. This doesn&apos;t pay it.{tally}
      </p>
    );
  }
  const disabled = busy !== null;
  // with a named customer, this browser's key can acknowledge only if it is that wallet
  const guestFits = !customer || (guest !== null && same(short(guest), customer));
  return (
    <div className="grid gap-1 border-t border-hairline pt-4 text-center">
      {others.length > 0 && (
        <p className="text-sm text-ink-muted">
          Acknowledged by another key ({others[0].debtor}){tally}.
        </p>
      )}
      {customer && <p className="text-xs text-ink-muted">Only the customer wallet this invoice names ({customer}) can acknowledge it.</p>}
      {guestFits && (
        <Button variant="quiet" className="justify-self-center text-sm" aria-disabled={disabled} aria-describedby="ack-hint" onClick={() => void acknowledge("guest")}>
          {busy === "guest" ? "Acknowledging…" : "Acknowledge this invoice"}
        </Button>
      )}
      <p id="ack-hint" className="text-xs text-ink-muted">
        You confirm you owe this invoice. This doesn&apos;t pay it and moves no money.
      </p>
      {(hasWallet || privy) && (
        <div data-pay-option="wallet" className="flex flex-wrap justify-center gap-x-4">
          {hasWallet && (
            <Button variant="quiet" className="text-xs" aria-disabled={disabled} onClick={() => void acknowledge("wallet")}>
              {busy === "wallet" ? "Check your wallet…" : "Acknowledge with your browser wallet"}
            </Button>
          )}
          {privy && (
            // the pay block above shows #privy-notice: who sees what before Privy opens (security 046 M2)
            <Button variant="quiet" className="text-xs" aria-disabled={disabled} aria-describedby="privy-notice" onClick={() => void acknowledge("privy")}>
              {busy === "privy" ? "Finish in the wallet window…" : "Acknowledge with another wallet or email"}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className={`text-sm ${errorTone(error)}`}>
          {error}
        </p>
      )}
    </div>
  );
}
