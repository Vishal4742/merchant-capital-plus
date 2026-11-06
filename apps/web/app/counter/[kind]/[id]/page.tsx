// "Show at the counter" (FR-GW-3): a link, page or invoice as one large QR code on a full screen, with the amount and
// the shop's name, for a customer to scan with a phone camera. Public, like the page it points to; every figure is read
// on our server (no browser chain reads, FR-PRIV-1). The test-mode strip comes from the root layout.
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { rangeText } from "@/components/gateway/Hosted";
import { merchantConfig, payConfig } from "@/lib/config";
import { GatewayError } from "@/lib/gateway-client";
import { amountText, closedLinkCopy } from "@/lib/gateway-forms";
import { gatewayFor } from "@/lib/gateway-server";
import { readInvoice, readRelayFee } from "@/lib/onchain";
import { qrTarget, type QrKind } from "@/lib/qr";
import { isShopInvoice } from "@/lib/settle";
import { formatUsdt } from "@/lib/usdt";

const READ_TRIES = 2;
const doneLink = "inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"; // not from Frame: that pulls sign-in code into this page
const DONE: Record<QrKind, string> = { l: "/merchant/links", p: "/merchant/pages", pay: "/merchant#invoices" };

interface View {
  merchant: string;
  title: string;
  amount: string | null;
  hint: string;
  closed: string | null; // why it can't be paid now, instead of the code
}

export default function CounterPage({ params }: PageProps<"/counter/[kind]/[id]">) {
  return (
    <main className="grid min-h-[calc(100dvh-28px)] place-items-center bg-surface px-4 py-8 text-ink">
      <Suspense fallback={<p className="text-ink-muted">Getting the code ready…</p>}>
        <Counter params={params} />
      </Suspense>
    </main>
  );
}

async function viewOf(kind: QrKind, id: string): Promise<View | null> {
  if (kind === "l") {
    const link = await gatewayFor(await headers()).publicLink(id);
    const closed = link.status === "active" ? null : closedLinkCopy(link.status, link.merchant_name).title;
    return { merchant: link.merchant_name, title: link.description, amount: link.amount && `${amountText(link.amount)} ${link.currency}`, hint: link.amount ? "Scan to pay" : "Scan, then enter the amount", closed };
  }
  if (kind === "p") {
    const page = await gatewayFor(await headers()).publicPage(id);
    return { merchant: page.merchant_name, title: page.title, amount: page.open_amount && rangeText(page.open_amount, page.currency), hint: page.items ? "Scan to choose and pay" : "Scan, then enter the amount", closed: null };
  }
  const pay = payConfig(), shop = merchantConfig();
  if (!pay || !shop) return null;
  const [invoice, fee] = await Promise.all([readInvoice(pay.merchantPay, BigInt(id), { tries: READ_TRIES }), readRelayFee(pay.merchantPay, { tries: READ_TRIES })]);
  if (!isShopInvoice(invoice, shop.merchant)) notFound(); // /pay serves the shop's own invoices only
  const closed = invoice.status === "paid" ? "This invoice is paid" : invoice.status === "cancelled" ? "This invoice was cancelled" : null;
  // what the customer pays: what is left plus the payment fee, as on the invoice page
  return { merchant: shop.merchantName, title: `Invoice ${id}`, amount: `${formatUsdt(invoice.amount - invoice.paid + fee)} USDT`, hint: "Scan to pay", closed };
}

async function Counter({ params }: Pick<PageProps<"/counter/[kind]/[id]">, "params">) {
  const { kind, id } = await params;
  if (!qrTarget(kind, id)) notFound();
  let view: View | null;
  try {
    view = await viewOf(kind as QrKind, id);
  } catch (error) {
    if (error instanceof GatewayError && error.status === 404) notFound();
    view = null;
  }
  const done = (
    <a href={DONE[kind as QrKind]} className={doneLink}>
      Done
    </a>
  );
  if (!view) {
    return (
      <section role="status" className="grid max-w-md justify-items-center gap-3 text-center">
        <h1 className="title">We can&apos;t show this code right now</h1>
        <p className="text-sm text-ink-muted">Try again in a minute.</p>
        {done}
      </section>
    );
  }
  return (
    <section className="grid w-full max-w-[560px] justify-items-center gap-4 text-center">
      <span className="eyebrow text-ink-muted">{view.merchant}</span>
      <h1 className="text-[28px] leading-tight font-medium tracking-[-0.03em] break-words md:text-[40px]">{view.title}</h1>
      {view.closed ? (
        <p role="status" className="title text-warning">
          {view.closed}
        </p>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- our own SVG route */}
          <img src={`/qr/${kind}/${id}`} alt={`QR code to pay ${view.merchant}`} width={480} height={480} className="aspect-square w-[min(80vw,52dvh)] rounded-[20px] border border-hairline bg-white" />
          {view.amount && <p className="text-[32px] leading-none font-medium tracking-[-0.03em] tabular-nums md:text-[44px]">{view.amount}</p>}
          <p className="text-ink-muted">{view.hint} with your phone camera.</p>
        </>
      )}
      {done}
    </section>
  );
}
