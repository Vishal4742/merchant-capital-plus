"use client";

// The investor's Capital pages (CAPITAL-TAB §4): a top bar with the wordmark, Offers / Your claims, and the wallet (with
// the private-read meter once connected, FR-PRIV-3), over the page's header and its screen. No sign-in: the fund
// signature is the authority and holdings are public reads by address (G8).
import type { ReactNode } from "react";
import { Button } from "@/components/Button";
import { PrivateReads } from "@/components/dashboard/PrivateReads";
import { short } from "./format";
import { Holdings } from "./Holdings";
import { OfferBook } from "./OfferBook";
import { useInvestor, type WalletState } from "./useInvestor";

const PAGES = [
  { key: "book", label: "Offers", href: "/capital" },
  { key: "holdings", label: "Your claims", href: "/capital/holdings" },
] as const;

export type InvestorView = (typeof PAGES)[number]["key"];

export interface InvestorAppProps {
  view: InvestorView;
  header: ReactNode;
}

export function InvestorApp({ view, header }: InvestorAppProps) {
  const { state, connect } = useInvestor();
  return (
    <div className="min-h-dvh pb-16">
      <div className="border-b border-hairline bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-8">
          {/* a full load: home runs under its own headers (security review 005 F-N4) */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="inline-flex min-h-11 items-center text-[17px] font-medium tracking-[-0.02em] whitespace-nowrap md:text-[19px]">
            WhiteFlow
          </a>
          {/* no CSS order: what you see is the tab order at every width; the wallet wraps below on a phone (UX review #33 M4) */}
          <nav aria-label="Capital" className="flex gap-1">
            {PAGES.map((p) => (
              <a
                key={p.key}
                href={p.href}
                aria-current={p.key === view ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-[10px] px-2.5 text-sm whitespace-nowrap sm:px-3 ${p.key === view ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-sunk"}`}
              >
                {p.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <WalletChip state={state} connect={connect} />
          </div>
        </div>
      </div>
      {header}
      {/* left-aligned with the header's text, as on the dashboard pages */}
      <div className="grid max-w-6xl gap-6 px-4 py-6 md:px-8 md:py-8">
        {(state.phase === "disconnected" || state.phase === "wrong-network") && state.error && (
          <p role="alert" className="text-sm text-critical">
            {state.error}
          </p>
        )}
        {state.phase === "wrong-network" && !state.error && (
          <p role="status" className="text-sm text-warning">
            Your wallet is on another network. Switch it to Whitechain Testnet to buy or to see your claims.
          </p>
        )}
        {view === "book" ? <OfferBook state={state} connect={connect} /> : <Holdings state={state} connect={connect} />}
      </div>
    </div>
  );
}

function WalletChip({ state, connect }: { state: WalletState; connect: () => void }) {
  switch (state.phase) {
    case "checking":
      return null;
    case "connecting":
      return <span className="text-sm text-ink-muted">Waiting for your wallet…</span>;
    case "disconnected":
      return (
        <Button className="h-11 px-5 text-sm" onClick={connect}>
          Connect wallet
        </Button>
      );
    case "wrong-network":
      return (
        <>
          <span className="data text-ink-muted max-sm:hidden">{short(state.account)}</span>
          <Button className="h-11 px-5 text-sm" onClick={connect}>
            Switch network
          </Button>
        </>
      );
    case "ready":
      return (
        <>
          <PrivateReads className="shrink-0" />
          <span className="data text-ink-muted max-sm:hidden">{short(state.wallet.account)}</span>
        </>
      );
  }
}
