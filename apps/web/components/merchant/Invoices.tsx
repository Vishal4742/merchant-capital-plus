"use client";

// Merchant invoices (FR-PAY-1, FR-PAY-2): create one from the shop's own wallet, share its pay link, cancel an untouched
// one (MerchantPay refuses to cancel a part-paid or financed invoice). The customer's name and the label are private
// (human, 2026-11-06 02:3x): they stay in this browser's localStorage, never go on chain (the on-chain customer is the
// zero address and refHash is random, claude-contracts S6 d, NFR-8) and have no form `name`, so even a submit before
// hydration can't put them in a URL (security review 005 F6).
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { QrActions } from "@/components/gateway/Share";
import { cancelInvoice, connectMerchant, createInvoice, walletError } from "@/lib/merchant-wallet";
import { parseUsdt } from "@/lib/usdt";

export interface InvoiceRow {
  id: string;
  amountText: string;
  dueText: string;
  status: "open" | "paid" | "cancelled";
  /** Credited so far on an open invoice (customers may pay part of it), or null. */
  paidText: string | null;
  /** The payment that paid it in full, when the log index has it. */
  receiptId: string | null;
}

interface InvoicesProps {
  merchant: Address;
  merchantPay: Address;
  /** Null if the list couldn't be read right now. */
  invoices: InvoiceRow[] | null;
  /** Today in IST (YYYY-MM-DD), the earliest due date. */
  today: string;
  /** MerchantPay.relayFee(), formatted: what customers add on top; null if it couldn't be read. */
  feeText: string | null;
}

const MIN_UNITS = 1_000_000n; // MerchantPay.MIN_PAYMENT: 1 USDT
const MAX_UNITS = 1_000_000_000n; // 1,000 USDT per payment on testnet (§4b), = MAX_PAYMENT in lib/server/http.ts (server-only)
const NOTES_EVENT = "mcplus-invoice-notes";
const STATUS = {
  open: { label: "Open", tone: "text-accent" },
  partPaid: { label: "Part paid", tone: "text-accent" },
  paid: { label: "Paid", tone: "text-positive" },
  cancelled: { label: "Cancelled", tone: "text-ink-muted" },
} as const;
const link = "inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4";

interface Note {
  customer?: string;
  label?: string;
}

// Keyed by MerchantPay too: ids restart at 1 on every redeploy, so notes for an older contract never attach to new
// invoices (code review 005 F9). Read through useSyncExternalStore, so the server render (no notes) hydrates cleanly.
const notesKey = (merchantPay: Address) => `mcplus.invoiceNotes.${merchantPay.toLowerCase()}`;
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(NOTES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NOTES_EVENT, onChange);
  };
};
function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? "{}";
  } catch {
    return "{}"; // storage blocked: no notes
  }
}
function parseNotes(raw: string): Record<string, Note> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? (value as Record<string, Note>) : {};
  } catch {
    return {};
  }
}
function saveNote(key: string, id: string, note: Note) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...parseNotes(readRaw(key)), [id]: note }));
    window.dispatchEvent(new Event(NOTES_EVENT));
  } catch {} // storage blocked: the invoice still exists, just without its notes here
}

const payLink = (id: string) => `${window.location.origin}/pay/${id}`;
const statusOf = (invoice: InvoiceRow) => STATUS[invoice.status === "open" && invoice.paidText ? "partPaid" : invoice.status];

export function Invoices({ merchant, merchantPay, invoices, today, feeText }: InvoicesProps) {
  const key = notesKey(merchantPay);
  const notes = parseNotes(useSyncExternalStore(subscribe, () => readRaw(key), () => "{}"));
  return (
    <section className="grid scroll-mt-4 gap-6 rounded-[20px] border border-hairline bg-surface p-6" aria-labelledby="invoices">
      <h2 id="invoices" className="label text-ink-muted">
        Invoices
      </h2>
      <NewInvoice merchant={merchant} merchantPay={merchantPay} today={today} feeText={feeText} notesKey={key} />
      {invoices === null ? (
        <p className="text-sm text-warning">We couldn&apos;t load your invoices right now. Reload in a minute.</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-ink-muted">No invoices yet. Create one above and send its link to your customer.</p>
      ) : (
        // a card per invoice on a phone, a table row from sm up: the actions are never off screen (tester R1 #1)
        <ul className="grid divide-y divide-hairline border-y border-hairline sm:table sm:w-full sm:divide-y-0 sm:border-collapse sm:text-sm">
          <li className="hidden bg-surface-sunk text-ink-muted sm:table-row" aria-hidden="true">
            {["Invoice", "Amount", "Due", "Status", ""].map((h, i) => (
              <span key={h || "actions"} className={`label sm:table-cell sm:px-4 sm:py-3 ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </span>
            ))}
          </li>
          {invoices.map((invoice) => {
            const note = notes[invoice.id] ?? {};
            const status = statusOf(invoice);
            return (
              <li key={invoice.id} className="grid grid-cols-2 gap-x-4 gap-y-1 py-4 sm:table-row sm:border-t sm:border-hairline">
                <span className="col-span-2 sm:table-cell sm:px-4 sm:py-3 sm:align-middle">
                  {note.customer && <span className="block font-medium">{note.customer}</span>}
                  {note.label && <span className="block text-ink-muted">{note.label}</span>}
                  <span className="data text-ink-muted">Invoice {invoice.id}</span>
                </span>
                <span className="tabular-nums sm:table-cell sm:px-4 sm:py-3 sm:text-right sm:align-middle">
                  {invoice.amountText} <span className="text-ink-muted sm:hidden">USDT</span>
                </span>
                <span className="text-right text-ink-muted sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-ink">
                  <span className="sm:hidden">Due </span>
                  {invoice.dueText}
                </span>
                <span className="sm:table-cell sm:px-4 sm:py-3 sm:text-right sm:align-middle">
                  <span className={`inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
                  {invoice.paidText && <span className="ml-2 text-xs text-ink-muted sm:ml-0 sm:block">{invoice.paidText} paid</span>}
                </span>
                <span className="text-right sm:table-cell sm:px-4 sm:py-3 sm:align-middle">
                  <InvoiceActions invoice={invoice} merchant={merchant} merchantPay={merchantPay} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NewInvoice({ merchant, merchantPay, today, feeText, notesKey: key }: Omit<InvoicesProps, "invoices"> & { notesKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    let amount: bigint;
    try {
      amount = parseUsdt(String(data.get("amount") ?? ""));
    } catch {
      return setError("Enter an amount like 25.00.");
    }
    if (amount < MIN_UNITS || amount > MAX_UNITS) return setError("Enter an amount from 1.00 to 1,000.00 USDT.");
    const due = String(data.get("due") ?? "");
    const dueMs = /^\d{4}-\d{2}-\d{2}$/.test(due) ? Date.parse(`${due}T23:59:59+05:30`) : NaN; // the end of that day in IST
    if (!(dueMs > Date.now() + 60_000)) return setError("Pick a due date from today on.");
    const note = { customer: customerRef.current?.value.trim().slice(0, 60) || undefined, label: labelRef.current?.value.trim().slice(0, 60) || undefined };
    setBusy(true);
    try {
      const w = await connectMerchant(window.ethereum, merchant, merchantPay);
      const id = (await createInvoice(w, amount, BigInt(Math.floor(dueMs / 1000)))).toString();
      if (note.customer || note.label) saveNote(key, id, note);
      setCreated(id);
      form.reset();
      router.refresh(); // the list is read on the server
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = "h-11 w-full rounded-sm border border-hairline bg-surface px-3 text-ink";
  return (
    <div className="grid gap-4">
      {/* a stale error goes as soon as anything changes (UX review 005 F6) */}
      <form onSubmit={submit} onChange={() => setError(null)} className="grid items-end gap-4 md:grid-cols-[1fr_1fr_1.5fr_1.5fr_auto]">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Amount, 1.00 to 1,000.00 USDT</span>
          <input name="amount" inputMode="decimal" autoComplete="off" placeholder="25.00" required className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Due date</span>
          <input name="due" type="date" min={today} required className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Customer (only you see it)</span>
          <input ref={customerRef} maxLength={60} autoComplete="off" placeholder="Asha Rao" className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Label (only you see it)</span>
          <input ref={labelRef} maxLength={60} autoComplete="off" placeholder="Office catering, March" className={field} />
        </label>
        <Button type="submit" aria-disabled={busy}>
          {busy ? "Waiting for your wallet…" : "Create invoice"}
        </Button>
      </form>
      <p className="text-xs text-ink-muted">
        Your wallet sends the invoice and pays a small WBT fee. Your customer adds {feeText ? `a ${feeText} USDT` : "a small"} payment fee on top, so you get the invoice amount in full. The customer and label stay in
        this browser and are never sent anywhere.
      </p>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {created && (
        <div role="status" className="grid gap-2 rounded-sm border border-hairline bg-accent-soft p-4 text-sm">
          <p>Invoice {created} is ready. Send this link to your customer:</p>
          <div className="flex flex-wrap items-center gap-x-3">
            {/* a plain link: a full page load, so the pay sheet runs under its own strict CSP (security F8, code F8) */}
            <a href={`/pay/${created}`} className={`${link} data break-all`}>
              {payLink(created)}
            </a>
            <CopyLink id={created} />
          </div>
          <QrActions kind="pay" id={created} name={`invoice ${created}`} />
        </div>
      )}
    </div>
  );
}

function CopyLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="quiet"
        onClick={() =>
          navigator.clipboard.writeText(payLink(id)).then(
            () => setCopied(true),
            () => window.prompt("Copy this link:", payLink(id)), // clipboard blocked: let them copy it by hand
          )
        }
      >
        Copy link
      </Button>
      <span aria-live="polite" className="text-xs text-positive">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}

function InvoiceActions({ invoice, merchant, merchantPay }: { invoice: InvoiceRow; merchant: Address; merchantPay: Address }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (invoice.status === "paid") {
    return invoice.receiptId ? (
      <a href={`/r/${invoice.receiptId}`} className={link}>
        Receipt
      </a>
    ) : null;
  }
  if (invoice.status !== "open") return null;
  const cancellable = invoice.paidText === null; // MerchantPay refuses to cancel once anything is paid

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      await cancelInvoice(await connectMerchant(window.ethereum, merchant, merchantPay), BigInt(invoice.id));
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(false);
    }
  }
  // Cancel is final, so it takes a second step and sits apart from Copy link (UX review 005 F4)
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-x-6">
        <CopyLink id={invoice.id} />
        {cancellable && (
          // CapitalMarket lists only an open invoice nothing is paid on; the Capital tab preselects it (FR-INV-1)
          <a href={`/merchant/capital?invoice=${invoice.id}`} className={link}>
            Sell this invoice
          </a>
        )}
        {cancellable &&
          (confirming ? (
            // wraps as whole phrases with room at the card edge; "Keep it" says what the other choice does (UX review 005 N2)
            <span role="group" aria-label={`Cancel invoice ${invoice.id}?`} className="flex flex-wrap items-center justify-end gap-x-2 pr-2 text-sm">
              <span className="whitespace-nowrap text-ink">Cancel invoice?</span>
              <Button variant="quiet" className="whitespace-nowrap" onClick={cancel} aria-disabled={busy}>
                {busy ? "Cancelling…" : "Yes, cancel"}
              </Button>
              <Button variant="quiet" className="whitespace-nowrap" onClick={() => setConfirming(false)} aria-disabled={busy}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button variant="quiet" onClick={() => setConfirming(true)}>
              Cancel
            </Button>
          ))}
      </div>
      <QrActions kind="pay" id={invoice.id} name={`invoice ${invoice.id}`} />
      {error && (
        <p role="alert" className="max-w-64 text-right text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
