"use client";

// M2 Get paid today (FR-INV-1, FR-INV-2; AT-6): list an open invoice below its amount, priced from a target APR, both
// shown before the wallet opens. recourseBps is 0 (FR-INV-6 cut).
import { useState, type FormEvent } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { card, field, textLink } from "@/components/gateway/Frame";
import { WBT_HINT } from "@/lib/dashboard";
import { formatUsdt } from "@/lib/usdt";
import { DEADLINES, DEFAULT_DEADLINE, ListingStatus, busy, useListing } from "./Listing";
import { invoicePriceLine, invoiceTerms } from "./terms";
import { listInvoice } from "./wallet";

/** An open, unpaid invoice of this merchant: amount in USDT base units, due date in unix seconds. */
export interface ListableInvoice {
  id: string;
  amount: string;
  dueDate: number;
}

interface InvoicePanelProps {
  merchant: Address;
  /** null: couldn't be read, or invoices aren't switched on here (`unavailable` says which). */
  invoices: ListableInvoice[] | null;
  unavailable?: string;
  /** ?invoice=<id> from the invoice's create view */
  preselect: string | null;
  /** The server's clock (unix s) the page was read at: the price shown is for its day count. */
  now: number;
}

const istDay = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export function InvoicePanel({ merchant, invoices, unavailable, preselect, now }: InvoicePanelProps) {
  return (
    <section aria-labelledby="get-paid" className={card}>
      <div className="grid gap-1">
        <h2 id="get-paid" className="text-[17px] font-medium">
          Get paid today
        </h2>
        <p className="text-sm text-ink-muted">Sell an open invoice to investors for a little less than it&apos;s worth. When your customer pays it, the money goes to them.</p>
      </div>
      {invoices === null ? (
        <p role="status" className="text-sm text-warning">
          {unavailable ?? "We couldn't read your invoices right now. Reload in a minute."}
        </p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Create an invoice first: only an open, unpaid invoice can be listed.{" "}
          <a href="/merchant#invoices" className={textLink}>
            Go to invoices
          </a>
        </p>
      ) : (
        <InvoiceForm merchant={merchant} invoices={invoices} preselect={preselect} now={now} />
      )}
    </section>
  );
}

function InvoiceForm({ merchant, invoices, preselect, now }: Omit<InvoicePanelProps, "invoices" | "unavailable"> & { invoices: ListableInvoice[] }) {
  const listing = useListing(merchant);
  const [form, setForm] = useState({ invoice: invoices.some((i) => i.id === preselect) ? (preselect as string) : invoices[0].id, apr: "", deadline: String(DEFAULT_DEADLINE) });
  const chosen = invoices.find((i) => i.id === form.invoice) ?? invoices[0];
  const terms = (at: number, deadline: number) => invoiceTerms({ face: BigInt(chosen.amount), dueDate: chosen.dueDate, apr: form.apr, deadline }, at);
  const preview = terms(now, now + 1);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    listing.clear();
    setForm({ ...form, [key]: e.target.value });
  };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const at = Math.floor(Date.now() / 1000);
    const r = terms(at, at + Number(form.deadline));
    if (!r.ok) return listing.fail(r.error);
    // the price shown came from the page's day count; never list a different one than the merchant read
    if (preview.ok && r.value.days !== preview.value.days) return listing.fail("A day has passed since this page loaded, so the price changed. Reload to see the new price.");
    void listing.run((w) => listInvoice(w, BigInt(chosen.id), r.value.price, r.value.offerDeadline));
  }

  const label = "grid gap-1 text-sm";
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          <span className="text-ink-muted">Invoice</span>
          <select value={form.invoice} onChange={set("invoice")} className={field}>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {`Invoice ${i.id} · ${formatUsdt(BigInt(i.amount))} USDT · due ${istDay(i.dueDate)}`}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className="text-ink-muted">Target APR, %</span>
          <input value={form.apr} onChange={set("apr")} inputMode="decimal" autoComplete="off" placeholder="12" required className={field} />
        </label>
        <label className={label}>
          <span className="text-ink-muted">Investors can fund it for</span>
          <select value={form.deadline} onChange={set("deadline")} className={field}>
            {DEADLINES.map((d) => (
              <option key={d.seconds} value={d.seconds}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p aria-live="polite" className="text-[15px]">
        {preview.ok ? (
          invoicePriceLine(preview.value.price, BigInt(chosen.amount), preview.value.days, preview.value.aprBps)
        ) : form.apr ? (
          <span className="text-warning">{preview.error}</span>
        ) : (
          <span className="text-ink-muted">Enter a target APR to see what investors pay.</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" aria-disabled={busy(listing.state)}>
          {busy(listing.state) ? "Listing…" : "List the invoice"}
        </Button>
        <p className="max-w-[60ch] text-xs text-ink-muted">Your wallet sends the listing and pays about 0.0008 WBT. Investors pay you when they fund it. {WBT_HINT}</p>
      </div>
      <ListingStatus state={listing.state} />
    </form>
  );
}
