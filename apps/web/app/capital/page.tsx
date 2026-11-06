// Capital, the investor offer book (FR-ARK-2, FR-ARK-3, FR-ADV-3, FR-INV-3; CAPITAL-TAB §4 I1-I2). Public: the book is
// read from GET /api/v1/capital/offers in the browser, and funding is one signature, no sign-in and no gas.
import type { Metadata } from "next";
import { EditorialHeader } from "@/components/gateway/Frame";
import { InvestorApp } from "@/components/capital/investor/InvestorApp";

export const metadata: Metadata = { title: "Capital · Merchant Capital+" };

export default function CapitalPage() {
  return (
    <InvestorApp
      view="book"
      header={
        <EditorialHeader
          label="Capital · Offers"
          lede="Each offer is a shop's cash advance or an unpaid invoice. You pay USDT now and are paid back from the shop's sales, or when the invoice is paid. Every offer is checked against the chain before you can buy. You sign once and never pay gas."
        >
          Fund a shop&apos;s <span className="emphasis">next sales.</span>
        </EditorialHeader>
      }
    />
  );
}
