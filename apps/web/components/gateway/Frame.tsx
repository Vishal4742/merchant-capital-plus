// Shared pieces of the gateway screens in the approved v2 design (design-refs/gateway-v2-demo.html): the editorial
// header (a mono section label over a rule beside a large headline), cards as objects, the halftone grain, plain
// notices. No server-only imports, so the client screens use the same classes.
import type { ReactNode } from "react";
import { SignIn, SignOut } from "@/components/merchant/SignIn";

export const card = "grid min-w-0 content-start gap-4 rounded-[20px] border border-hairline bg-surface p-5 md:p-6";
export const field = "h-11 w-full min-w-0 rounded-sm border border-hairline bg-surface px-3 text-ink";
export const textLink = "inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4";
/** Halftone grain printed into a surface: one CSS gradient, no image bytes. */
export const grain = "bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--ink)_7%,transparent)_1px,transparent_1.4px)] bg-size-[4px_4px]";
/** The same grain in light dots, for the night surface. */
export const nightGrain = "bg-scene-night bg-[radial-gradient(circle_at_1px_1px,rgba(237,237,243,0.07)_1px,transparent_1.4px)] bg-size-[4px_4px]";

export function EditorialHeader({ label, lede, children }: { label: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <header className={`grid gap-4 border-b border-hairline px-4 pt-8 pb-7 md:grid-cols-[180px_minmax(0,1fr)] md:gap-6 md:px-8 md:pt-12 md:pb-10 ${grain}`}>
      <span className="eyebrow self-start border-t border-ink pt-3 text-ink-muted">{label}</span>
      <div className="grid gap-3">
        <h1 className="max-w-[16ch] text-[36px] leading-none font-medium tracking-[-0.04em] md:text-[56px]">{children}</h1>
        {lede && <p className="max-w-[560px] text-ink-muted">{lede}</p>}
      </div>
    </header>
  );
}

/** A section label over a rule, as in the design's spec grid. */
export const SectionLabel = ({ id, children }: { id?: string; children: ReactNode }) => (
  <h2 id={id} className="eyebrow border-t border-hairline pt-3 text-ink-muted">
    {children}
  </h2>
);

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="status" className={`${card} text-sm text-warning`}>
      {children}
    </p>
  );
}

export function Account({ merchant }: { merchant: string }) {
  return (
    <>
      <span className="data">
        {merchant.slice(0, 6)}…{merchant.slice(-4)}
      </span>
      <SignOut />
    </>
  );
}

export function SignedOut({ available }: { available: boolean }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16">
      <header className="flex items-center justify-between gap-4">
        {/* a full load: home must not run inside this page's CSP (security review 005 F-N4) */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="title inline-flex min-h-11 items-center whitespace-nowrap">
          Merchant Capital+
        </a>
        <span className="label text-ink-muted">Merchant dashboard</span>
      </header>
      <SignIn available={available} />
    </main>
  );
}
