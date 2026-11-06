// The hosted link and page sheets (FR-GW-1, FR-GW-2) over the night scene, in the checkout's own sheet style. Plain
// HTML forms that post to our server (no JS needed), which answers 303 to the checkout. No hooks: /l and /p render
// them on the server, and the dashboard renders the page sheet as its live preview. Plain words only (FR-PAY-7).
import { LiveTotal } from "@/components/gateway/LiveTotal";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/Button";
import type { Currency, OpenAmount, PublicLink } from "@/lib/gateway-client";
import { amountText } from "@/lib/gateway-forms";

const sheet = "relative grid w-full max-w-[440px] gap-5 overflow-hidden rounded-[28px] bg-surface p-7 text-ink shadow-float";
const input = "h-12 rounded-sm border border-hairline bg-surface px-3 text-ink tabular-nums";

function Note({ currency }: { currency: Currency }) {
  const other = currency !== "USD" && currency !== "USDT";
  return <p className="text-xs text-ink-muted">You&apos;ll see the exact total on the next screen before you pay.{other && ` Prices are in ${currency}, at today's rate.`}</p>;
}

function Alert({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-critical">
      {error}
    </p>
  ) : null;
}

/** `detail`: what the link was for (a closed link); `action`: a plain link, a full load (G4 UX review F2, F3). */
export function HostedNotice({ eyebrow, title, children, detail, action }: { eyebrow: string; title: string; children: ReactNode; detail?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <section role="status" className={`${sheet} gap-3`}>
      <span className="eyebrow text-ink-muted">{eyebrow}</span>
      <h1 className="title">{title}</h1>
      {detail}
      <p className="text-sm text-ink-muted">{children}</p>
      {action && (
        <a href={action.href} className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4">
          {action.label}
        </a>
      )}
    </section>
  );
}

/** A closed link's description and price, so a customer can tell which link this was. */
export function LinkSummary({ link }: { link: PublicLink }) {
  return (
    <p className="grid gap-0.5 border-y border-hairline py-3">
      <span className="break-words">{link.description}</span>
      {link.amount !== null && (
        <span className="data text-ink-muted">
          {amountText(link.amount)} {link.currency}
        </span>
      )}
    </p>
  );
}

export function LinkSheet({ link, amount, error }: { link: PublicLink; amount: string | null; error: string | null }) {
  return (
    <section className={sheet} aria-labelledby="pay-title">
      <div className="grid gap-1">
        <span className="eyebrow text-ink-muted">{link.merchant_name}</span>
        <h1 id="pay-title" className="title">
          {link.description}
        </h1>
      </div>
      <form method="post" action={`/l/${link.slug}/checkout`} className="grid gap-4">
        {link.amount === null ? (
          <label className="grid gap-1.5 text-sm">
            <span className="text-ink-muted">Amount in {link.currency}</span>
            <input name="amount" inputMode="decimal" autoComplete="off" required placeholder="25.00" defaultValue={amount ?? undefined} pattern="\s*\d+(\.\d{1,6})?\s*" className={`${input} w-full text-[20px]`} />
          </label>
        ) : (
          <p className="flex items-baseline gap-2">
            <span className="amount-xl">{amountText(link.amount)}</span>
            <span className="eyebrow text-ink-muted">{link.currency}</span>
          </p>
        )}
        <Alert error={error} />
        <button type="submit" className={buttonClasses("primary", "w-full")}>
          Continue to pay
        </button>
      </form>
      <Note currency={link.currency} />
    </section>
  );
}

export interface SheetPage {
  slug: string;
  merchant_name: string;
  title: string;
  description: string | null;
  logo_url: string | null;
  color: string | null; // checked #RRGGBB: an accent only, never behind or as text
  currency: Currency;
  open_amount: OpenAmount | null;
}

export function rangeText({ min, max }: OpenAmount, currency: Currency): string {
  if (min && max) return `From ${amountText(min)} to ${amountText(max)} ${currency}`;
  if (min) return `At least ${amountText(min)} ${currency}`;
  if (max) return `Up to ${amountText(max)} ${currency}`;
  return `Any amount in ${currency}`;
}

/** The logo's URL as the URL parser writes it (https only), or null. */
function logoHref(url: string | null): string | null {
  try {
    const parsed = url ? new URL(url) : null;
    return parsed?.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** `rows`: an items page's items with the quantities shown and their price text; null for an open-amount page. */
export function PageSheet({ page, rows, amount, error, preview = false }: { page: SheetPage; rows: { name: string; price: string; priceText: string; qty: number }[] | null; amount: string | null; error: string | null; preview?: boolean }) {
  const accent = page.color ? { backgroundColor: page.color } : undefined;
  const logo = logoHref(page.logo_url);
  return (
    <section className={`${sheet} pt-9`} aria-label={preview ? "Preview of your page" : undefined} aria-labelledby={preview ? undefined : "page-title"}>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-2 bg-accent" style={accent} />
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-accent p-0.5" style={accent}>
          <span className="relative grid size-11 place-items-center rounded-full bg-surface text-lg font-medium">
            {page.merchant_name.slice(0, 1).toUpperCase()}
            {/* the logo as a background layer over the initial: one that fails to load leaves a plain circle, never a
                broken-image icon, with no JS. href is the parsed URL, so a quote in it is already %22 */}
            {logo && <span className="absolute inset-0 rounded-full bg-surface bg-cover bg-center" style={{ backgroundImage: `url("${logo}")` }} />}
          </span>
        </span>
        <span className="eyebrow min-w-0 text-ink-muted">{page.merchant_name}</span>
      </div>
      <div className="grid gap-1.5">
        <h1 id={preview ? undefined : "page-title"} className="title break-words">
          {page.title || "Your page title"}
        </h1>
        {page.description && <p className="text-sm break-words text-ink-muted">{page.description}</p>}
      </div>
      <form method="post" action={`/p/${page.slug}/checkout`} className="grid gap-4" inert={preview}>
        {rows ? (
          <>
            <LiveTotal
              prices={rows.map((row) => row.price)}
              quantities={rows.map((row) => String(row.qty))}
              currency={page.currency}
              updateAction={`/p/${page.slug}`}
              alert={<Alert error={error} />}
            >
            <ul className="grid divide-y divide-hairline border-y border-hairline">
              {rows.map((row, i) => (
                <li key={`${i}:${row.name}`} className="flex items-center justify-between gap-3 py-3">
                  <label htmlFor={`qty-${i}`} className="grid min-w-0 gap-0.5">
                    <span className="break-words">{row.name || `Item ${i + 1}`}</span>
                    <span className="data text-ink-muted">
                      {row.priceText} {page.currency}
                    </span>
                  </label>
                  <input id={`qty-${i}`} name={`qty:${row.name}`} type="number" inputMode="numeric" min={0} max={100} step={1} defaultValue={row.qty} aria-label={`How many ${row.name}`} className={`${input} w-20 shrink-0 text-right`} />
                </li>
              ))}
            </ul>
            </LiveTotal>
          </>
        ) : (
          <>
            <label className="grid gap-1.5 text-sm">
              <span className="text-ink-muted">Amount in {page.currency}</span>
              <input name="amount" inputMode="decimal" autoComplete="off" required placeholder="25.00" defaultValue={amount ?? undefined} pattern="\s*\d+(\.\d{1,6})?\s*" className={`${input} w-full text-[20px]`} />
              <span className="text-ink-muted">{rangeText(page.open_amount ?? { min: null, max: null }, page.currency)}</span>
            </label>
            <Alert error={error} />
            <button type="submit" className={buttonClasses("primary", "w-full")}>
              Continue to pay
            </button>
          </>
        )}
      </form>
      <Note currency={page.currency} />
    </section>
  );
}
