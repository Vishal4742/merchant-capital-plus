// Shared pieces of the Whiteflow gateway screens:
// Editorial header, card styles, input field tokens, account badges, and signed-out states.
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WhiteflowWordmark } from "@/components/WhiteflowLogo";
import { LegacyAccess, WorkspaceSignOut } from "@/components/workspace/LegacyAccess";

/** The day/night switch on a plain surface (batch 060); the landing dresses it as glass instead. */
export const plainToggle = "border-hairline text-ink-muted hover:border-accent hover:text-ink";
export const card = "grid min-w-0 content-start gap-4 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card";
export const field = "h-11 w-full min-w-0 rounded-[8px] border border-hairline bg-surface px-3 text-ink text-sm focus:border-accent focus:ring-1 focus:ring-accent transition-colors";
export const textLink = "inline-flex min-h-10 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover transition-colors";
/** Halftone grain printed into a surface: one CSS gradient, no image bytes. */
export const grain = "bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--ink)_7%,transparent)_1px,transparent_1.4px)] bg-size-[4px_4px]";
/** The same grain in light dots, for the night surface. */
export const nightGrain = "bg-scene-night bg-[radial-gradient(circle_at_1px_1px,rgba(237,237,243,0.07)_1px,transparent_1.4px)] bg-size-[4px_4px]";

export function EditorialHeader({
  label,
  lede,
  children,
  action,
}: {
  label: string;
  lede?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="grid gap-4 border-b border-hairline bg-surface/50 px-4 pt-7 pb-6 backdrop-blur-xs md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-start md:gap-6 md:px-8 md:pt-10 md:pb-8">
      <span className="eyebrow self-start border-t border-accent pt-2.5 font-medium text-accent">
        {label}
      </span>
      <div className="grid gap-2 max-w-2xl">
        <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.035em] text-ink md:text-[44px]">
          {children}
        </h1>
        {lede && <p className="text-sm text-ink-muted leading-relaxed">{lede}</p>}
      </div>
      {action && <div className="self-start md:ml-auto">{action}</div>}
    </header>
  );
}

/** A section label over a rule, as in the design's spec grid. */
export const SectionLabel = ({ id, children }: { id?: string; children: ReactNode }) => (
  <h2 id={id} className="eyebrow border-t border-hairline pt-3 font-medium text-ink-muted">
    {children}
  </h2>
);

export function Problem({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
      <span className="text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden="true">⚠️</span>
      <div className="grow">{children}</div>
    </div>
  );
}

export function Account({ merchant }: { merchant: string }) {
  return (
    <div className="flex items-center justify-between gap-2 w-full">
      <span className="data text-xs font-mono text-ink bg-surface-sunk px-2 py-1 rounded-[6px] border border-hairline">
        {merchant.slice(0, 6)}…{merchant.slice(-4)}
      </span>
      <WorkspaceSignOut />
    </div>
  );
}

/** A dashboard page without the Shell: the wordmark home and a label, over the page. */
export function PlainPage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 md:px-8">
      <header className="flex items-center justify-between gap-4 border-b border-hairline pb-4">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="inline-flex min-h-10 items-center">
          <WhiteflowWordmark />
        </a>
        <span className="flex items-center gap-3">
          <span className="text-xs font-medium text-ink-muted uppercase tracking-wider max-sm:hidden">Business Payments Workspace</span>
          <ThemeToggle className={plainToggle} />
        </span>
      </header>
      {children}
    </main>
  );
}

const GETS = [
  ["Invoices & Links", "Create invoices and shareable payment links settled directly in USDT."],
  ["Atomic Settlement", "Funds settle directly to your Whitechain wallet in the payment transaction."],
  ["Zero Customer Gas", "Customer transactions on Whitechain testnet are sponsored by Whiteflow relayer."],
  ["AI & Developer Ready", "Access through your dashboard, API keys, webhooks, or Model Context Protocol (MCP)."],
] as const;

/** Every dashboard page without a linked workspace (batch 051): what a business gets, and the way in: Whiteflow
 *  sign-in, a workspace, then an Owner links the merchant wallet (LegacyAccess). `available` (the retired wallet
 *  cookie's secret) is ignored; the SIWE cleanup batch removes it from the pages. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SignedOut(props: { available?: boolean }) {
  return (
    <PlainPage>
      <div className="mt-8 grid gap-8 md:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-8">
        <div className="grid content-start gap-5 lg:pt-4">
          <span className="eyebrow self-start border-t border-accent pt-2.5 font-medium text-accent">
            Whiteflow Business Workspace
          </span>
          <h1 className="max-w-[15ch] text-[38px] leading-tight font-semibold tracking-[-0.035em] text-ink md:text-[52px]">
            One invoice. <span className="text-accent">Clear settlement.</span>
          </h1>
          <p className="max-w-[48ch] text-sm text-ink-muted leading-relaxed">
            Request business payments, accept supported crypto, and receive exact USDT settlement in your Whitechain wallet. Sign in to Whiteflow to start.
          </p>
        </div>
        <section aria-labelledby="setup" className={`${card} gap-3 shadow-card lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start`}>
          <h2 id="setup" className="text-base font-semibold text-ink">
            Open your workspace
          </h2>
          <p className="text-xs text-ink-muted">
            Already used the dashboard with your wallet? Sign in to Whiteflow, then link that wallet once: your links, keys and payments come with it.
          </p>
          <LegacyAccess />
          <div className="grid gap-2 border-t border-hairline pt-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <form method="post" action="/api/demo-checkout">
                <button type="submit" className={`${textLink} cursor-pointer`}>
                  Try sample customer checkout
                </button>
              </form>
              <a href="/docs" className={textLink}>
                Developer documentation
              </a>
            </div>
            <p className="text-xs text-ink-muted">
              Test mode: Whitechain testnet (Chain ID 1874). No real funds move.
            </p>
          </div>
        </section>
        <dl aria-label="What you get" className="grid content-start border-t border-hairline">
          {GETS.map(([label, text]) => (
            <div key={label} className="grid gap-1 border-b border-hairline py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
              <dt className="eyebrow pt-0.5 text-accent">{label}</dt>
              <dd className="text-sm text-ink-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </PlainPage>
  );
}
