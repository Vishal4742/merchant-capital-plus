// Customer invoice page (FR-PAY-3, FR-PAY-7). Server component: our server reads invoices(id) and relayFee() on chain,
// so the browser makes no chain reads (FR-PRIV-1, SRS 1.1). The total it shows is exactly what the customer will sign.
import { warmRelayer } from "@/lib/relay";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { InvoicePay } from "@/components/InvoicePay";
import { StaticScene } from "@/components/StaticScene";
import { merchantConfig, payConfig } from "@/lib/config";
import { readInvoice, readRelayFee } from "@/lib/onchain";
import { invoiceAttempt, invoiceLock } from "@/lib/sessions";
import { invoiceState, isShopInvoice, pageState } from "@/lib/settle";
import { formatUsdt } from "@/lib/usdt";

const READ_TRIES = 2; // a customer is waiting (NFR-12): fail fast and say so

// The night and the frame prerender; the invoice streams in (Cache Components needs params inside Suspense).
// Still scene only: no three.js and no Nym on the pay page (NFR-12 speed budget).
export default function InvoicePage({ params }: PageProps<"/pay/[invoiceId]">) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-scene-night px-4 py-12 text-glass-ink">
      <StaticScene />
      <Suspense fallback={<p className="relative rounded-[28px] bg-surface px-8 py-6 text-ink-muted shadow-float">Opening invoice…</p>}>
        <InvoiceLoader params={params} />
      </Suspense>
    </main>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section role="status" className="relative grid w-full max-w-[420px] gap-3 rounded-[28px] bg-surface p-8 text-ink shadow-float">
      <span className="label text-ink-muted">Invoice</span>
      <h1 className="title">{title}</h1>
      <p className="text-sm text-ink-muted">{children}</p>
    </section>
  );
}

async function InvoiceLoader({ params }: Pick<PageProps<"/pay/[invoiceId]">, "params">) {
  const { invoiceId } = await params;
  if (!/^[1-9]\d{0,19}$/.test(invoiceId)) notFound();
  const pay = payConfig();
  if (!pay) return <Notice title="Payments aren't live yet">Nothing can be charged from this page. Try again later.</Notice>;
  warmRelayer(pay.relayerUrl); // the customer may pay in a moment (claude-relayer 09:42)
  const [invoice, fee] = await Promise.all([
    readInvoice(pay.merchantPay, BigInt(invoiceId), { tries: READ_TRIES }).catch(() => null),
    readRelayFee(pay.merchantPay, { tries: READ_TRIES }).catch(() => null),
  ]);
  if (!invoice || fee === null) return <Notice title="We can't open this invoice right now">Nothing was charged. Try again in a minute.</Notice>;
  // only the shop's own invoices are served here (human, 2026-11-06 02:3x); anything else is "not found"
  const shop = merchantConfig();
  if (!shop || !isShopInvoice(invoice, shop.merchant)) notFound();
  const settled = invoiceState(invoiceId, invoice.status);
  if (settled === "missing") notFound();
  // a payment being relayed right now may land: show "confirming", never the button (security review 004 R2 F1)
  const state = pageState(settled, invoiceLock(invoiceId));
  const owed = invoice.amount - invoice.paid; // what MerchantPay credits; the fee comes on top
  return (
    <InvoicePay
      invoiceId={invoiceId}
      merchantName={shop.merchantName}
      dueText={new Date(Number(invoice.dueDate) * 1000).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}
      invoiceText={formatUsdt(invoice.amount)}
      paidSoFarText={invoice.paid > 0n ? formatUsdt(invoice.paid) : null}
      owedText={formatUsdt(owed)}
      feeText={formatUsdt(fee)}
      totalText={formatUsdt(owed + fee)}
      state={state}
      terms={{ merchantPay: pay.merchantPay, invoiceId, amount: owed.toString(), fee: fee.toString() }}
      receiptId={invoiceAttempt(invoiceId).receipt?.paymentId ?? null}
    />
  );
}
