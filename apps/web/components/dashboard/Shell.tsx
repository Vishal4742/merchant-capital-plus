// Whiteflow Workspace Shell — Polished financial-workspace layout.
// Sidebar with Whiteflow wordmark, navigation sections, account session & network indicator, and main content area.
import type { ReactNode } from "react";
import { Nav, type NavKey } from "@/components/dashboard/Nav";
import { PrivateReads } from "@/components/dashboard/PrivateReads";
import { WhiteflowWordmark } from "@/components/WhiteflowLogo";

export function Shell({
  active,
  account,
  children,
  privateReads = true,
}: {
  active: NavKey;
  account?: ReactNode;
  children: ReactNode;
  privateReads?: boolean;
}) {
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[250px_minmax(0,1fr)] bg-ground">
      {/* Sidebar column with restrained border and clean surface */}
      <aside className="border-b border-hairline bg-surface md:border-r md:border-b-0 shadow-[1px_0_0_0_var(--hairline)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 md:sticky md:top-0 md:h-dvh md:flex-col md:flex-nowrap md:items-stretch md:gap-2 md:overflow-y-auto md:px-4 md:py-5">
          {/* Brand Wordmark linking to Home */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="order-1 inline-flex min-h-10 items-center whitespace-nowrap rounded-lg px-2 py-1 transition-colors hover:bg-surface-sunk md:mb-2"
            aria-label="Whiteflow home"
          >
            <WhiteflowWordmark />
          </a>

          {/* Account profile & network badge (at top on mobile, at bottom on desktop) */}
          {account && (
            <div className="order-2 ml-auto flex items-center gap-x-2 text-xs text-ink-muted md:order-4 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:gap-2 md:border-t md:border-hairline md:pt-4">
              <div className="hidden md:flex items-center justify-between text-xs text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>Whitechain Testnet</span>
                </span>
                <span className="eyebrow text-[10px]">1874</span>
              </div>
              <div className="flex items-center justify-between gap-2">{account}</div>
            </div>
          )}

          {/* Navigation and private reads meter */}
          <div className="order-3 flex basis-full items-center gap-2 md:contents">
            {account && privateReads && (
              <PrivateReads className="shrink-0 md:order-2 md:mb-2 md:self-start" />
            )}
            <div className="min-w-0 grow md:order-3 md:grow-0">
              <Nav active={active} />
            </div>
          </div>
        </div>
      </aside>

      {/* Main workspace canvas */}
      <main className="min-w-0 pb-16">{children}</main>
    </div>
  );
}
