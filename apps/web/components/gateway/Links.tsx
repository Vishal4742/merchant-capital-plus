"use client";

// Payment links on the dashboard (FR-GW-1): create one (a fixed amount or the customer's, a currency, what it is for, an
// optional expiry, once or any number of times), then copy it, show its QR at the counter, or cancel it. The list is read
// on our server; creating and cancelling call the gateway from this browser (same origin, the sign-in cookie goes
// along), then the list reloads.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { SectionLabel, card, field } from "@/components/gateway/Frame";
import { LinkPill, QrActions } from "@/components/gateway/Share";
import { PRICE_CURRENCIES, errorText, gatewayClient, type Link, type LinkStatus } from "@/lib/gateway-client";
import { amountText, linkBody } from "@/lib/gateway-forms";

/** A link with its expiry already written out on our server (so the server and browser renders match). */
export interface LinkRow extends Link {
  expiresText: string | null;
}

const STATUS: Record<LinkStatus, { label: string; tone: string }> = {
  active: { label: "Active", tone: "text-accent" },
  paid: { label: "Paid", tone: "text-positive" },
  expired: { label: "Expired", tone: "text-warning" },
  cancelled: { label: "Cancelled", tone: "text-ink-muted" },
};

export function LinksScreen({ links, origin }: { links: LinkRow[]; origin: string }) {
  return (
    <div className="grid gap-8 px-4 py-6 md:px-8 md:py-8">
      <NewLink origin={origin} />
      <section aria-labelledby="your-links" className="grid gap-4">
        <SectionLabel id="your-links">Your links · {links.length}</SectionLabel>
        {links.length === 0 ? (
          <p className="text-sm text-ink-muted">No links yet. Create one above and send it in any chat.</p>
        ) : (
          <ul className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {links.map((link) => (
              <LinkCard key={link.id} link={link} origin={origin} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewLink({ origin }: { origin: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Link | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "");
    const checked = linkBody({ amount: value("amount"), open, currency: value("currency"), description: value("description"), expires: value("expires"), reusable: value("uses") === "any" });
    if (!checked.ok) return setError(checked.error);
    setBusy(true);
    try {
      setCreated(await gatewayClient().createLink(checked.value));
      form.reset();
      setOpen(false);
      router.refresh(); // the list is read on the server
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-link" className={card}>
      <h2 id="new-link" className="text-[15px] font-medium">
        New payment link
      </h2>
      {/* a stale error goes as soon as anything changes (UX review 005 F6) */}
      <form onSubmit={submit} onChange={() => setError(null)} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
        <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">
          <span className="text-ink-muted">What it&apos;s for (customers see this)</span>
          <input name="description" maxLength={200} required autoComplete="off" placeholder="Two cold brews, table 4" className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Amount</span>
          <input name="amount" inputMode="decimal" autoComplete="off" placeholder={open ? "The customer enters it" : "25.00"} disabled={open} required={!open} className={`${field} tabular-nums disabled:bg-surface-sunk`} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Currency</span>
          <select name="currency" defaultValue="USD" className={field}>
            {PRICE_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="size-5 accent-accent" />
          The customer chooses the amount
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Ends (optional)</span>
          <input name="expires" type="datetime-local" className={field} />
        </label>
        <fieldset className="grid gap-1 text-sm md:col-span-1 xl:col-span-2">
          <legend className="mb-1 text-ink-muted">Can be paid</legend>
          <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-1">
            <label className="flex items-center gap-2">
              <input type="radio" name="uses" value="once" defaultChecked className="size-5 accent-accent" />
              Once
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="uses" value="any" className="size-5 accent-accent" />
              Any number of times
            </label>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:col-span-2 xl:col-span-3">
          <Button type="submit" aria-disabled={busy}>
            {busy ? "Creating…" : "Create link"}
          </Button>
          <p className="text-xs text-ink-muted">Customers pay the equivalent of 1 to 1,000 US dollars per payment, at the rate when they pay.</p>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {created && (
        <div role="status" className="grid gap-3 rounded-[16px] border border-hairline bg-accent-soft p-4 text-sm">
          <p>Your link is ready. Send it in any chat, or show its QR code at the counter.</p>
          <LinkPill url={`${origin}/l/${created.slug}`} name="the new link" />
          <QrActions kind="l" id={created.slug} name={created.description} />
        </div>
      )}
    </section>
  );
}

function LinkCard({ link, origin }: { link: LinkRow; origin: string }) {
  const status = STATUS[link.status];
  const active = link.status === "active";
  return (
    <li className={`${card} lift`}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="eyebrow text-ink-muted">
            {link.single_use ? "Pays once" : "Reusable"}
            {link.expiresText && ` · ${active ? "ends" : "ended"} ${link.expiresText}`}
          </span>
          <h3 className="text-[17px] leading-snug font-medium break-words">{link.description}</h3>
        </div>
        <span className={`inline-flex shrink-0 rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
      </div>
      <p className="flex items-baseline gap-2">
        <b className="text-[30px] leading-none font-medium tracking-[-0.03em] tabular-nums">{link.amount === null ? "Any amount" : amountText(link.amount)}</b>
        <span className="eyebrow text-ink-muted">{link.currency}</span>
      </p>
      <LinkPill url={`${origin}/l/${link.slug}`} name={`the link for ${link.description}`} />
      <div className="grid gap-1 border-t border-hairline pt-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <span className="text-ink-muted tabular-nums">
            {link.payments} {link.payments === 1 ? "payment" : "payments"}
          </span>
          {active && <CancelLink link={link} />}
        </div>
        {active && <QrActions kind="l" id={link.slug} name={link.description} />}
      </div>
    </li>
  );
}

function CancelLink({ link }: { link: Link }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      await gatewayClient().cancelLink(link.id);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  // cancelling is final, so it takes a second step (UX review 005 F4)
  return (
    <div className="grid justify-items-end">
      {confirming ? (
        <span role="group" aria-label={`Cancel the link for ${link.description}?`} className="flex flex-wrap items-center justify-end gap-x-2">
          <span className="whitespace-nowrap">Cancel link?</span>
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
      )}
      {error && (
        <p role="alert" className="max-w-64 text-right text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
