// Capital, the merchant's side (batch 036, docs/CAPITAL-TAB.md §4 M1-M3): a cash advance (FR-ADV-1, 2, 5, 6), an
// invoice sold early (FR-INV-1, 2) and the merchant's live offers (FR-ARK-1, 2). Behind sign-in, in the dashboard Shell.
// Our server reads what GET /api/v1/capital/merchant reads (merchantAdvance + the offer book), directly, never over
// HTTP to ourselves (lib/gateway-server.ts); the listing txs go from the merchant's own wallet in the browser.
import { connection } from "next/server";
import { Suspense } from "react";
import type { Address } from "viem";
import { AdvancePanel } from "@/components/capital/merchant/AdvancePanel";
import { InvoicePanel, type ListableInvoice } from "@/components/capital/merchant/InvoicePanel";
import { MyOffers } from "@/components/capital/merchant/MyOffers";
import { Shell } from "@/components/dashboard/Shell";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { authSecret } from "@/lib/auth";
import { payConfig } from "@/lib/config";
import { logFailure } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";
import { merchantInvoices } from "@/lib/onchain";
import { merchantAdvance } from "@/lib/server/capital";
import { offerBook } from "@/lib/server/capital-arkiv";

const header = (
  <EditorialHeader label="Capital" lede="Get cash now from investors: an advance you repay from a share of each sale, or an open invoice sold for a little less than it's worth.">
    Get paid <span className="emphasis">before you&apos;re paid.</span>
  </EditorialHeader>
);

const one = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{1,20}$/.test(v) ? v : null);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const istTime = (ms: number) => new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", hour12: false, timeZone: "Asia/Kolkata" });
const istDay = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export default function CapitalPage({ searchParams }: PageProps<"/merchant/capital">) {
  return (
    <Suspense
      fallback={
        <Shell active="capital">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your advance and offers…</p>
        </Shell>
      }
    >
      <CapitalLoader searchParams={searchParams} />
    </Suspense>
  );
}

/** GET /api/v1/capital/merchant's body: the running advance and this merchant's offers in the book. */
async function merchantCapital(merchant: Address) {
  const [advance, book] = await Promise.all([merchantAdvance(merchant), offerBook()]);
  const mine = book.filter((o) => o.merchant.toLowerCase() === merchant.toLowerCase());
  return { advance, offers: mine.map((o) => ({ ...o, deadlineText: istTime(Date.parse(o.offer_deadline)) })) };
}

/** Open invoices nothing is paid on yet: the ones CapitalMarket may list (an already-listed one is refused by the dry run). */
async function listable(merchant: Address): Promise<{ invoices: ListableInvoice[] | null; unavailable?: string }> {
  const pay = payConfig();
  if (!pay) return { invoices: null, unavailable: "Invoices aren't switched on for this server yet." };
  try {
    const all = await merchantInvoices(pay.merchantPay, merchant);
    return { invoices: all.filter((i) => i.status === "open" && i.paid === 0n).map((i) => ({ id: i.id.toString(), amount: i.amount.toString(), dueDate: Number(i.dueDate), dueText: istDay(Number(i.dueDate) * 1000) })) };
  } catch (error) {
    logFailure("capital: invoice list", error);
    return { invoices: null };
  }
}

async function CapitalLoader({ searchParams }: Pick<PageProps<"/merchant/capital">, "searchParams">) {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const query = await searchParams;
  const [capital, invoices] = await Promise.all([
    merchantCapital(merchant).catch((error: unknown) => {
      logFailure("capital: advance and offers", error);
      return null;
    }),
    listable(merchant),
  ]);
  return (
    <Shell active="capital" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-8">
        {capital ? (
          <AdvancePanel merchant={merchant} advance={capital.advance} offers={capital.offers} />
        ) : (
          <Problem>We couldn&apos;t read your advance and offers from the chain right now. Reload in a minute; nothing has changed.</Problem>
        )}
        <InvoicePanel merchant={merchant} invoices={invoices.invoices} unavailable={invoices.unavailable} preselect={one(query.invoice)} now={nowSeconds()} />
        {capital && <MyOffers merchant={merchant} offers={capital.offers} />}
      </div>
    </Shell>
  );
}
