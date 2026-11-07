// Capital, the investor's claims and the transfer check (FR-TOK-2, FR-TOK-3, FR-TOK-4, FR-TOK-7, FR-TOK-8; CAPITAL-TAB
// §4 I3-I4). Public: read in the browser by the connected wallet's address.
import type { Metadata } from "next";
import { EditorialHeader } from "@/components/gateway/Frame";
import { InvestorApp } from "@/components/capital/investor/InvestorApp";

export const metadata: Metadata = { title: "Your claims · Whiteflow" };

export default function HoldingsPage() {
  return (
    <InvestorApp
      view="holdings"
      header={
        <EditorialHeader
          label="Capital · Your claims"
          lede="A claim is USDT a shop owes you. It shrinks as you're paid back, from the shop's sales or when its invoice is paid, and the money lands in your wallet in the same transaction."
        >
          What you&apos;re <span className="emphasis">owed.</span>
        </EditorialHeader>
      }
    />
  );
}
