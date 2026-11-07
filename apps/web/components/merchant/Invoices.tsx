"use client";

// WhiteFlow Merchant Invoices: create one from the shop's own wallet, share its pay link, cancel an untouched
// one (MerchantPay refuses to cancel a part-paid or financed invoice). The customer's name and the label are private:
// they stay in this browser's localStorage, never go on chain.
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { Button } from "@/components/Button";
import { DebtorAck } from "@/components/DebtorAck";
import { QrActions } from "@/components/gateway/Share";
import { StatusBadge, type StatusTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cancelInvoice, connectMerchant, createInvoice, walletError } from "@/lib/merchant-wallet";
import type { DebtorAckView } from "@/lib/server/invoice-acks";
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
  /** The debtor's acknowledgement of an open invoice (batch 047, FR-INV-8), or null. */
  ack: DebtorAckView | null;
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
const MAX_UNITS = 1_000_000_000n; // 1,000 USDT per payment on testnet
const NOTES_EVENT = "whiteflow-invoice-notes";

const link = "inline-flex min-h-10 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover";

interface Note {
  customer?: string;
  label?: string;
}

const notesKey = (merchantPay: Address) => `whiteflow.invoiceNotes.${merchantPay.toLowerCase()}`;
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
    return "{}";
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
  } catch {}
}

const payLink = (id: string) => `${window.location.origin}/pay/${id}`;

export function Invoices({ merchant, merchantPay, invoices, today, feeText }: InvoicesProps) {
  const key = notesKey(merchantPay);
  const notes = parseNotes(useSyncExternalStore(subscribe, () => readRaw(key), () => "{}"));
  const [filter, setFilter] = useState<"all" | "open" | "paid" | "cancelled">("all");
  const [search, setSearch] = useState("");

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => {
      if (filter !== "all" && inv.status !== filter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const note = notes[inv.id] ?? {};
      return (
        inv.id.includes(q) ||
        note.customer?.toLowerCase().includes(q) ||
        note.label?.toLowerCase().includes(q)
      );
    });
  }, [invoices, filter, search, notes]);

  const counts = useMemo(() => {
    if (!invoices) return { all: 0, open: 0, paid: 0, cancelled: 0 };
    return {
      all: invoices.length,
      open: invoices.filter((i) => i.status === "open").length,
      paid: invoices.filter((i) => i.status === "paid").length,
      cancelled: invoices.filter((i) => i.status === "cancelled").length,
    };
  }, [invoices]);

  return (
    <section className="grid scroll-mt-6 gap-6 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card" aria-labelledby="invoices-heading">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h2 id="invoices-heading" className="text-[18px] font-semibold text-ink">
            Invoices &amp; Requests
          </h2>
          <p className="text-xs text-ink-muted">
            Issue invoices for exact USDT settlement to your Whitechain wallet.
          </p>
        </div>
      </div>

      <NewInvoice merchant={merchant} merchantPay={merchantPay} today={today} feeText={feeText} notesKey={key} />

      {invoices === null ? (
        <p className="text-sm text-warning">We couldn&apos;t load your invoices right now. Reload in a minute.</p>
      ) : invoices.length === 0 ? (
        <EmptyState
          title="No invoices issued yet"
          description="Create your first invoice above to generate a customer payment link settled in USDT."
        />
      ) : (
        <div className="grid gap-3">
          {/* Filter pills and Search control */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter invoices">
              {(
                [
                  ["all", `All (${counts.all})`],
                  ["open", `Open (${counts.open})`],
                  ["paid", `Paid (${counts.paid})`],
                  ["cancelled", `Cancelled (${counts.cancelled})`],
                ] as const
              ).map(([tab, labelText]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab}
                  onClick={() => setFilter(tab)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === tab
                      ? "bg-accent text-on-accent"
                      : "bg-surface-sunk text-ink-muted hover:text-ink"
                  }`}
                >
                  {labelText}
                </button>
              ))}
            </div>

            <div className="w-full sm:w-64">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search reference or customer…"
                className="h-9 w-full rounded-[8px] border border-hairline bg-surface px-3 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent"
                aria-label="Search invoices"
              />
            </div>
          </div>

          {filteredInvoices.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              No invoices match the selected filter.
            </p>
          ) : (
            <ul className="grid divide-y divide-hairline border-y border-hairline sm:table sm:w-full sm:divide-y-0 sm:border-collapse sm:text-sm">
              <li className="hidden bg-surface-sunk text-ink-muted sm:table-row font-medium" aria-hidden="true">
                {["Invoice", "Amount", "Due Date", "Status", "Actions"].map((h, i) => (
                  <span
                    key={h}
                    className={`eyebrow sm:table-cell sm:px-4 sm:py-3 ${i === 0 ? "text-left" : i === 4 ? "text-right" : "text-left"}`}
                  >
                    {h}
                  </span>
                ))}
              </li>
              {filteredInvoices.map((invoice) => {
                const note = notes[invoice.id] ?? {};
                const statusTone: StatusTone =
                  invoice.status === "paid"
                    ? "paid"
                    : invoice.status === "cancelled"
                    ? "cancelled"
                    : invoice.paidText
                    ? "open"
                    : "open";
                const statusLabel =
                  invoice.status === "paid"
                    ? "Paid"
                    : invoice.status === "cancelled"
                    ? "Cancelled"
                    : invoice.paidText
                    ? "Part paid"
                    : "Open";

                return (
                  <li
                    key={invoice.id}
                    className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-4 sm:table-row sm:border-t sm:border-hairline hover:bg-surface-sunk/30 transition-colors"
                  >
                    <span className="col-span-2 sm:table-cell sm:px-4 sm:py-3.5 sm:align-middle">
                      {note.customer && <span className="block font-medium text-ink">{note.customer}</span>}
                      {note.label && <span className="block text-xs text-ink-muted">{note.label}</span>}
                      <span className="data text-xs text-ink-muted font-mono">Invoice #{invoice.id}</span>
                    </span>
                    <span className="tabular-nums font-medium text-ink sm:table-cell sm:px-4 sm:py-3.5 sm:align-middle">
                      {invoice.amountText} <span className="text-xs text-ink-muted font-normal">USDT</span>
                    </span>
                    <span className="text-xs text-ink-muted sm:table-cell sm:px-4 sm:py-3.5 sm:align-middle sm:text-ink">
                      <span className="sm:hidden font-medium text-ink">Due: </span>
                      {invoice.dueText}
                    </span>
                    <span className="sm:table-cell sm:px-4 sm:py-3.5 sm:align-middle">
                      <StatusBadge status={statusTone} label={statusLabel} />
                      {invoice.paidText && (
                        <span className="block text-xs text-ink-muted mt-0.5 font-mono">{invoice.paidText} credited</span>
                      )}
                      {invoice.status === "open" && <DebtorAck ack={invoice.ack} />}
                    </span>
                    <span className="col-span-2 sm:table-cell sm:px-4 sm:py-3.5 sm:text-right sm:align-middle">
                      <InvoiceActions invoice={invoice} merchant={merchant} merchantPay={merchantPay} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function NewInvoice({
  merchant,
  merchantPay,
  today,
  feeText,
  notesKey: key,
}: Omit<InvoicesProps, "invoices"> & { notesKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const walletRef = useRef<HTMLInputElement>(null); // no form name either: read from the ref, never put in a URL

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
    const dueMs = /^\d{4}-\d{2}-\d{2}$/.test(due) ? Date.parse(`${due}T23:59:59+05:30`) : NaN;
    if (!(dueMs > Date.now() + 60_000)) return setError("Pick a due date from today on.");
    // batch 047 (security H1): a named customer wallet goes on chain, and only it can then acknowledge the invoice
    const wallet = walletRef.current?.value.trim() ?? "";
    if (wallet && !isAddress(wallet)) return setError("Enter your customer's wallet address (0x and 40 characters), or leave it empty.");
    // all lowercase carries no checksum, so a mistyped character would bind the wrong wallet (re-review); isAddress
    // already refused a mixed-case address whose checksum is wrong
    if (wallet && wallet !== getAddress(wallet)) return setError("Paste the checksummed address (with its capital letters) from your customer's wallet.");
    if (wallet && wallet.toLowerCase() === merchant.toLowerCase()) return setError("That's your own wallet. Enter your customer's, or leave it empty.");
    const customer: Address = wallet ? getAddress(wallet) : zeroAddress;
    const note = { customer: customerRef.current?.value.trim().slice(0, 60) || undefined, label: labelRef.current?.value.trim().slice(0, 60) || undefined };
    setBusy(true);
    try {
      const w = await connectMerchant(window.ethereum, merchant, merchantPay);
      const id = (await createInvoice(w, amount, BigInt(Math.floor(dueMs / 1000)), customer)).toString();
      if (note.customer || note.label) saveNote(key, id, note);
      setCreated(id);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = "h-10 w-full rounded-[8px] border border-hairline bg-surface px-3 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent transition-colors";

  return (
    <div className="grid gap-3 rounded-[12px] border border-hairline bg-surface-sunk/40 p-4">
      <h3 className="text-sm font-semibold text-ink">Create new invoice</h3>
      {/* a stale error goes as soon as anything changes (UX review 005 F6) */}
      <form onSubmit={submit} onChange={() => setError(null)} className="grid items-end gap-3 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1.3fr_1.3fr_1.3fr_auto]">
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-ink-muted">Amount (1.00 to 1,000.00 USDT)</span>
          <input name="amount" inputMode="decimal" autoComplete="off" placeholder="25.00" required className={field} />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-ink-muted">Due date</span>
          <input name="due" type="date" min={today} required className={field} />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-ink-muted">Customer (private note)</span>
          <input ref={customerRef} maxLength={60} autoComplete="off" placeholder="Acme Services" className={field} />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-ink-muted">Description / Memo</span>
          <input ref={labelRef} maxLength={60} autoComplete="off" placeholder="Design Sprint Q4" className={field} />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-ink-muted">Customer wallet (optional)</span>
          <input ref={walletRef} maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x…" className={`${field} data`} />
        </label>
        <Button type="submit" aria-disabled={busy} className="h-10 px-5 text-sm font-medium">
          {busy ? "Signing in wallet…" : "Issue invoice"}
        </Button>
      </form>
      <p className="text-xs text-ink-muted">
        Your connected wallet issues the invoice on Whitechain. Customer adds {feeText ? `${feeText} USDT relayer fee` : "a small fee"} on top, settling the invoice amount to your wallet in full. Customer notes remain private in this browser.
        <span className="block">
          A customer wallet, if you add one, goes on chain with the invoice: only that wallet can then acknowledge it, and investors see &quot;Acknowledged by the wallet the merchant named&quot;. Investors don&apos;t see other wallets&apos; acknowledgements.
        </span>
      </p>
      {error && (
        <p role="alert" className="text-xs text-critical font-medium">
          {error}
        </p>
      )}
      {created && (
        <div role="status" className="grid gap-2 rounded-[10px] border border-hairline bg-accent-soft p-3.5 text-sm text-ink">
          <p className="font-medium">Invoice #{created} is ready. Share this payment link with your customer:</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={`/pay/${created}`} className={`${link} data font-mono text-xs break-all`}>
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
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            },
            () => window.prompt("Copy this link:", payLink(id)),
          )
        }
      >
        Copy link
      </Button>
      {copied && (
        <span aria-live="polite" className="text-xs text-positive font-medium">
          Copied!
        </span>
      )}
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
        View receipt ↗
      </a>
    ) : null;
  }
  if (invoice.status !== "open") return null;
  const cancellable = invoice.paidText === null;

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

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-x-4">
        <CopyLink id={invoice.id} />
        {cancellable && (
          // CapitalMarket lists only an open invoice nothing is paid on; the Capital tab preselects it (FR-INV-1)
          <a href={`/merchant/capital?invoice=${invoice.id}`} className={link}>
            Sell this invoice
          </a>
        )}
        {cancellable &&
          (confirming ? (
            <span role="group" aria-label={`Cancel invoice ${invoice.id}?`} className="flex flex-wrap items-center justify-end gap-x-2 text-xs">
              <span className="whitespace-nowrap text-ink">Cancel invoice?</span>
              <button
                type="button"
                className="font-medium text-critical underline underline-offset-4 cursor-pointer"
                onClick={cancel}
                disabled={busy}
              >
                {busy ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button
                type="button"
                className="text-ink-muted underline underline-offset-4 cursor-pointer"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-xs text-ink-muted hover:text-critical underline underline-offset-4 cursor-pointer"
              onClick={() => setConfirming(true)}
            >
              Cancel
            </button>
          ))}
      </div>
      <QrActions kind="pay" id={invoice.id} name={`invoice ${invoice.id}`} />
      {error && (
        <p role="alert" className="max-w-64 text-right text-xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
