// The merchant dashboard frame (approved gateway v2 design): a sidebar with the wordmark, the sections and the account,
// and the page beside it. At phone width the sidebar becomes a top bar with a folded menu. The test-mode strip comes
// from the root layout, so it isn't repeated here.
import type { ReactNode } from "react";
import { Nav, type NavKey } from "@/components/dashboard/Nav";
import { PrivateReads } from "@/components/dashboard/PrivateReads";

export function Shell({ active, account, children, privateReads = true }: { active: NavKey; account?: ReactNode; children: ReactNode; privateReads?: boolean }) {
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[240px_minmax(0,1fr)]">
      {/* the column carries the surface and the rule to the page's foot; its contents stick to the top while the page scrolls */}
      <aside className="border-b border-hairline bg-surface md:border-r md:border-b-0">
        {/* at phone width one row holds the wordmark, the address and Sign out, the menu below (UX review 006 F1) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 md:sticky md:top-0 md:h-dvh md:flex-col md:flex-nowrap md:items-stretch md:gap-1 md:overflow-y-auto md:px-3.5 md:py-5">
          {/* a full load: home must not run inside this page's CSP (security review 005 F-N4) */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="order-1 inline-flex min-h-11 items-center text-[17px] font-medium tracking-[-0.02em] whitespace-nowrap md:mb-3 md:px-2.5 md:text-[19px]">
            Merchant Capital+
          </a>
          {account && <div className="order-2 ml-auto flex items-center gap-x-1 text-sm whitespace-nowrap text-ink-muted md:order-4 md:mt-auto md:ml-0 md:flex-wrap md:gap-x-2 md:px-2.5 md:pt-4">{account}</div>}
          {/* the private-read meter (FR-PRIV-3) leads the menu's row at phone width and sits under the wordmark from md up,
              so the tab order matches what you see at both widths */}
          <div className="order-3 flex basis-full items-center gap-2 md:contents">
            {account && privateReads && <PrivateReads className="shrink-0 md:order-2 md:mb-3 md:self-start" />}
            <div className="min-w-0 grow md:order-3 md:grow-0">
              <Nav active={active} />
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 pb-16">{children}</main>
    </div>
  );
}
