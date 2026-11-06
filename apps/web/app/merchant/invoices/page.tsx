// WhiteFlow Invoices Workspace (/merchant/invoices):
// Create, manage and track business invoices and payment links settled to Whitechain in USDT.
import { connection } from "next/server";
import { Suspense } from "react";
import { Shell } from "@/components/dashboard/Shell";
import { Account, EditorialHeader, SignedOut } from "@/components/gateway/Frame";
import { Invoices, type InvoiceRow } from "@/components/merchant/Invoices";
import { MetricCard } from "@/components/ui/MetricCard";
import { authSecret } from "@/lib/auth";
import { merchantConfig, payConfig } from "@/lib/config";
import { currentMerchant } from "@/lib/merchant-session";
import { merchantInvoices, paidLogs, readRelayFee, type Invoice, type PaidLog } from "@/lib/onchain";
import { formatUsdt } from "@/lib/usdt";

const header = (
  <EditorialHeader
    label="Invoices"
    lede="Issue itemized payment requests with exact net USDT settlement. Customers pay from supported networks with zero gas friction."
  >
    One invoice. <span className="emphasis">Clear settlement.</span>
  </EditorialHeader>
);

function invoiceRows(invoices: Invoice[], logs: PaidLog[]): InvoiceRow[] {
  const paidBy = new Map(logs.filter((log) => log.invoiceId !== 0n).map((log) => [log.invoiceId, log.paymentId.toString()]));
  return invoices.flatMap((invoice) =>
    invoice.status === "missing"
      ? []
      : [
          {
            id: invoice.id.toString(),
            amountText: formatUsdt(invoice.amount),
            dueText: new Date(Number(invoice.dueDate) * 1000).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }),
            status: invoice.status,
            paidText: invoice.status === "open" && invoice.paid > 0n ? formatUsdt(invoice.paid) : null,
            receiptId: invoice.status === "paid" ? (paidBy.get(invoice.id) ?? null) : null,
          },
        ],
  );
}

const logged = (what: string) => (error: unknown) => {
  console.error(`invoices: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  return null;
};

export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <Shell active="invoices">
          {header}
          <p className="px-4 py-8 text-ink-muted md:px-8">Loading invoices…</p>
        </Shell>
      }
    >
      <InvoicesLoader />
    </Suspense>
  );
}

async function InvoicesLoader() {
  await connection();
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;

  const config = merchantConfig();
  const pay = payConfig();
  const [invoices, logs, fee] = pay
    ? await Promise.all([
        merchantInvoices(pay.merchantPay, merchant).catch(logged("invoice list")),
        paidLogs(pay.merchantPay, { merchant }).catch(logged("payment index")),
        readRelayFee(pay.merchantPay).catch(logged("fee read")),
      ])
    : [null, null, null];

  const rows = invoices ? invoiceRows(invoices, logs ?? []) : null;
  const isShopWallet = config && merchant.toLowerCase() === config.merchant.toLowerCase();
  const feeText = fee === null ? null : formatUsdt(fee);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  // Calculate metrics
  const openRows = rows ? rows.filter((r) => r.status === "open") : [];
  const paidRows = rows ? rows.filter((r) => r.status === "paid") : [];

  return (
    <Shell active="invoices" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-8">
        {/* Metric tiles row */}
        <section aria-label="Invoice metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Open invoices"
            value={rows ? openRows.length : "—"}
            subtext={rows ? "Awaiting customer payment" : "Reading on-chain status"}
            tone={openRows.length > 0 ? "up" : "neutral"}
          />
          <MetricCard
            label="Settled invoices"
            value={rows ? paidRows.length : "—"}
            subtext={rows ? "Paid in full to wallet" : "Reading on-chain status"}
            tone="positive"
          />
          <MetricCard
            label="Total issued"
            value={rows ? rows.length : "—"}
            subtext="On-chain invoice count"
          />
          <MetricCard
            label="Settlement Asset"
            value="USDT"
            subtext="Whitechain Sepolia (T+0)"
          />
        </section>

        {pay && isShopWallet ? (
          <Invoices
            merchant={merchant}
            merchantPay={pay.merchantPay}
            invoices={rows}
            today={today}
            feeText={feeText}
          />
        ) : (
          <section className="grid gap-4 rounded-[16px] border border-hairline bg-surface p-6 shadow-card">
            <h2 className="text-base font-semibold text-ink">Invoice Issuance Scope</h2>
            {pay ? (
              <div className="grid gap-3 text-sm text-ink-muted">
                <p>
                  In this testnet release, on-chain invoices are created from the designated workspace wallet (
                  <span className="font-mono text-ink">{config?.merchantName ?? "Demo Merchant"}</span>,{" "}
                  <span className="font-mono text-ink">
                    {config?.merchant ? `${config.merchant.slice(0, 6)}…${config.merchant.slice(-4)}` : ""}
                  </span>
                  ).
                </p>
                <p>
                  To request payments from any wallet address, generate instant customer payment links under{" "}
                  <a href="/merchant/links" className="font-medium text-accent underline underline-offset-4">
                    Collections → Payment Links
                  </a>
                  . Payment links settle immediately to whichever wallet generates them.
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Invoices are not yet enabled on this server. Configure MerchantPay to activate on-chain invoices.
              </p>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}

