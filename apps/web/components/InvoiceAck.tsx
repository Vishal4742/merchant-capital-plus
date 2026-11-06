"use client";

// FR-INV-8 (batch 047): "Acknowledge this invoice" on the invoice sheet. The customer confirms it owes this invoice with
// one approval, the same ways in as paying: this browser's key by default, or its own wallet (the browser's, or Privy's
// modal when its app ID is set). A message, never a transaction: nothing is paid and no money moves. Our server rebuilds
// the message from the invoice on chain, checks it and keeps the first one (POST …/acknowledge); investors see it in the
// offer book. FR-PAY-7: only the wallet block (data-pay-option="wallet") says "wallet".
import { useState } from "react";
import { Button } from "@/components/Button";
import { istDateTime } from "@/components/capital/investor/format";
import { connectVia, endWalletSession, loadSigner, useHasWallet, type WalletVia } from "@/components/WalletPay";
import { errorTone } from "@/lib/outcome";
import { privyAppId } from "@/lib/privy-config";
import type { AckTermsText } from "@/lib/sign-sale";

const NOT_SAVED = "We couldn't save that. Nothing was charged. Try again.";
/** Who approves: this browser's key, or the customer's own wallet. */
type Via = "guest" | WalletVia;

interface InvoiceAckProps {
  terms: AckTermsText;
  /** When our server accepted this invoice's acknowledgement (ISO), or null if it has none yet. */
  ack: string | null;
}

export function InvoiceAck({ terms, ack }: InvoiceAckProps) {
  const [acked, setAcked] = useState(ack);
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
      setAcked(data.signed_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : NOT_SAVED);
    } finally {
      endWalletSession();
      setBusy(null);
    }
  }

  if (acked) {
    return (
      <p role="status" className="border-t border-hairline pt-4 text-center text-sm text-positive">
        Acknowledged ✓ {istDateTime(Date.parse(acked))}. This doesn&apos;t pay it.
      </p>
    );
  }
  const disabled = busy !== null;
  return (
    <div className="grid gap-1 border-t border-hairline pt-4 text-center">
      <Button variant="quiet" className="justify-self-center text-sm" aria-disabled={disabled} aria-describedby="ack-hint" onClick={() => void acknowledge("guest")}>
        {busy === "guest" ? "Acknowledging…" : "Acknowledge this invoice"}
      </Button>
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
