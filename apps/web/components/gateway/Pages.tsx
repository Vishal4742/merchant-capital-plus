"use client";

// Payment pages on the dashboard (FR-GW-2): build a page (title, description, logo, colour, currency, items or an open
// amount) beside a live preview of the hosted page as customers will see it, then copy it, show its QR, or open it.
// The list is read on our server; creating calls the gateway from this browser, then the list reloads.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { SectionLabel, card, field, nightGrain, textLink } from "@/components/gateway/Frame";
import { PageSheet, rangeText } from "@/components/gateway/Hosted";
import { LinkPill, QrActions, WebhookId } from "@/components/gateway/Share";
import { PRICE_CURRENCIES, errorText, gatewayClient, type Currency, type Page } from "@/lib/gateway-client";
import { amountText, pageBody, type PageForm } from "@/lib/gateway-forms";

const MAX_ITEMS = 20;
const START: PageForm = {
  title: "",
  description: "",
  logoUrl: "",
  color: "#1723E2",
  currency: "USD",
  mode: "items",
  items: [
    { name: "", price: "" },
    { name: "", price: "" },
  ],
  min: "",
  max: "",
};

export function PagesScreen({ pages, origin, merchantName }: { pages: Page[]; origin: string; merchantName: string }) {
  return (
    <div className="grid gap-8 px-4 py-6 md:px-8 md:py-8">
      <NewPage origin={origin} merchantName={merchantName} />
      <section aria-labelledby="your-pages" className="grid gap-4">
        <SectionLabel id="your-pages">Your pages · {pages.length}</SectionLabel>
        {pages.length === 0 ? (
          <p className="text-sm text-ink-muted">No pages yet. Build one above and share its address; customers pay on a page that shows your name and items.</p>
        ) : (
          <ul className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {pages.map((page) => (
              <PageCard key={page.id} page={page} origin={origin} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewPage({ origin, merchantName }: { origin: string; merchantName: string }) {
  const router = useRouter();
  const [form, setForm] = useState<PageForm>(START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Page | null>(null);
  const set = (change: Partial<PageForm>) => {
    setError(null);
    setForm((current) => ({ ...current, ...change }));
  };
  const setItem = (index: number, change: Partial<PageForm["items"][number]>) => set({ items: form.items.map((item, i) => (i === index ? { ...item, ...change } : item)) });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const checked = pageBody(form);
    if (!checked.ok) return setError(checked.error);
    setBusy(true);
    try {
      setCreated(await gatewayClient().createPage(checked.value));
      setForm(START);
      router.refresh(); // the list is read on the server
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const logo = /^https:\/\/\S+$/.test(form.logoUrl.trim()) ? form.logoUrl.trim() : null;
  const preview = {
    slug: "preview",
    merchant_name: merchantName,
    title: form.title.trim(),
    description: form.description.trim() || null,
    logo_url: logo,
    color: /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : null,
    currency: form.currency as Currency,
    open_amount: form.mode === "open" ? { min: form.min.trim() || null, max: form.max.trim() || null } : null,
  };
  const rows = form.mode === "items" ? form.items.map((item) => ({ name: item.name.trim(), price: item.price.trim() || "0", priceText: item.price.trim() ? amountText(item.price.trim()) : "0.00", qty: 1 })) : null;

  return (
    <section aria-labelledby="new-page" className={`${card} gap-6`}>
      <h2 id="new-page" className="text-[15px] font-medium">
        New payment page
      </h2>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="text-ink-muted">Title</span>
            <input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} required autoComplete="off" placeholder="Order ahead at Bandra Beans" className={field} />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="text-ink-muted">Description (optional)</span>
            <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} rows={2} placeholder="Pick up at the counter. Ready in about ten minutes." className={`${field} h-auto py-2`} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-ink-muted">Logo URL (optional, https)</span>
            <input value={form.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} inputMode="url" autoComplete="off" placeholder="https://…/logo.png" className={field} />
          </label>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">Colour</span>
              <input type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} className="h-11 w-14 cursor-pointer rounded-sm border border-hairline bg-surface p-1" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">Currency</span>
              <select value={form.currency} onChange={(e) => set({ currency: e.target.value })} className={field}>
                {PRICE_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="grid gap-1 text-sm sm:col-span-2">
            <legend className="mb-1 text-ink-muted">Customers pay for</legend>
            <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-1">
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" checked={form.mode === "items"} onChange={() => set({ mode: "items" })} className="size-5 accent-accent" />
                Items you list
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" checked={form.mode === "open"} onChange={() => set({ mode: "open" })} className="size-5 accent-accent" />
                An amount they choose
              </label>
            </div>
          </fieldset>
          {form.mode === "items" ? (
            <div className="grid gap-2 sm:col-span-2">
              {form.items.map((item, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">Item {i + 1}</span>
                    <input value={item.name} onChange={(e) => setItem(i, { name: e.target.value })} maxLength={80} autoComplete="off" placeholder={i === 0 ? "Cold brew" : "Banana bread"} className={field} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">Price</span>
                    <input value={item.price} onChange={(e) => setItem(i, { price: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="5.00" className={`${field} text-right tabular-nums`} />
                  </label>
                  <Button variant="quiet" aria-label={`Remove item ${i + 1}`} aria-disabled={form.items.length === 1} onClick={() => set({ items: form.items.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                </div>
              ))}
              {form.items.length < MAX_ITEMS && (
                <Button variant="quiet" className="justify-self-start" onClick={() => set({ items: [...form.items, { name: "", price: "" }] })}>
                  Add an item
                </Button>
              )}
            </div>
          ) : (
            <>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">Lowest amount (optional)</span>
                <input value={form.min} onChange={(e) => set({ min: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="2.00" className={`${field} tabular-nums`} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">Highest amount (optional)</span>
                <input value={form.max} onChange={(e) => set({ max: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="50.00" className={`${field} tabular-nums`} />
              </label>
            </>
          )}
          <div className="grid gap-2 sm:col-span-2">
            <Button type="submit" className="justify-self-start" aria-disabled={busy}>
              {busy ? "Creating…" : "Create page"}
            </Button>
            <p className="text-xs text-ink-muted">Your colour is an accent on the page; text stays in our colours so it is always easy to read.</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {error}
            </p>
          )}
        </form>
        <figure className="grid gap-2">
          <figcaption className="eyebrow text-ink-muted">Live preview</figcaption>
          <div className={`grid place-items-center rounded-[20px] px-3 py-8 sm:px-6 ${nightGrain}`}>
            <PageSheet page={preview} rows={rows} amount={null} error={null} preview />
          </div>
        </figure>
      </div>
      {created && (
        <div role="status" className="grid gap-3 rounded-[16px] border border-hairline bg-accent-soft p-4 text-sm">
          <p>Your page is live. Share it, or show its QR code at the counter.</p>
          <LinkPill url={`${origin}/p/${created.slug}`} name="the new page" />
          <QrActions kind="p" id={created.slug} name={created.title} />
        </div>
      )}
    </section>
  );
}

function PageCard({ page, origin }: { page: Page; origin: string }) {
  const what = page.items ? `${page.items.length} ${page.items.length === 1 ? "item" : "items"} · ${page.currency}` : rangeText(page.open_amount ?? { min: null, max: null }, page.currency);
  return (
    <li className={`${card} lift`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-1 size-3 shrink-0 rounded-full bg-accent" style={page.color ? { backgroundColor: page.color } : undefined} />
        <div className="grid min-w-0 gap-1">
          <span className="eyebrow text-ink-muted">{what}</span>
          <h3 className="text-[17px] leading-snug font-medium break-words">{page.title}</h3>
        </div>
      </div>
      <LinkPill url={`${origin}/p/${page.slug}`} name={`the page ${page.title}`} />
      <WebhookId field="page_id" id={page.id} name={`the page ${page.title}`} />
      <div className="grid gap-1 border-t border-hairline pt-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <span className="text-ink-muted tabular-nums">
            {page.payments} {page.payments === 1 ? "payment" : "payments"}
          </span>
          {/* a full load in a new tab: the hosted page runs under its own CSP */}
          <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" className={textLink}>
            View page ↗
          </a>
        </div>
        <QrActions kind="p" id={page.slug} name={page.title} />
      </div>
    </li>
  );
}
