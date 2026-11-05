// Customer receipt (FR-PAY-9): amount, shop, order, refund status and an explorer link. Server-rendered from our
// payment record plus one server-side read of the refund status, so no browser chain reads (FR-PRIV-1).
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StaticScene } from "@/components/StaticScene";
import { payConfig } from "@/lib/config";
import { paymentRefunded } from "@/lib/onchain";
import { getSession, type Payment } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

// the refund line waits at most this long for the chain; past it, it says so plainly
const REFUND_READ_MS = 1_500;

// The refund line streams on its own, so the receipt card (the LCP element) never waits for the chain (tester R1).
async function RefundStatus({ payment }: { payment: Payment }) {
  return <>{await refundStatus(payment)}</>;
}

async function refundStatus(payment: Payment): Promise<string> {
  const pay = payConfig();
  if (!pay || !payment.paymentId) return "None";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("slow")), REFUND_READ_MS)));
  try {
    const refunded = await Promise.race([paymentRefunded(pay.merchantPay, BigInt(payment.paymentId)), timeout]);
    return refunded === 0n ? "None" : `${formatUsdt(refunded)} USDT refunded`;
  } catch {
    return "Couldn't check right now";
  } finally {
    clearTimeout(timer); // a losing timeout must not reject later with no handler
  }
}

export default function ReceiptPage({ params }: PageProps<"/r/[id]">) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-scene-night px-4 py-12">
      <StaticScene />
      <Suspense fallback={<p className="relative rounded-[28px] bg-surface px-8 py-6 text-ink-muted shadow-float">Opening receipt…</p>}>
        <Receipt params={params} />
      </Suspense>
    </main>
  );
}

async function Receipt({ params }: Pick<PageProps<"/r/[id]">, "params">) {
  const { id } = await params;
  const session = getSession(id);
  if (!session?.payment) notFound();
  const payment = session.payment;
  const when = new Date(payment.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  return (
    <section className="relative grid w-full max-w-[420px] gap-5 rounded-[28px] border border-hairline bg-surface p-8 shadow-float">
      <span className="label text-ink-muted">Receipt{session.reference ? ` · order ${session.reference}` : ""}</span>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="amount-xl">{formatUsdt(session.amount)}</span>
        <span className="label text-ink-muted">USDT</span>
        <span className="text-ink-muted">to {session.merchantName}</span>
      </p>
      <dl className="grid gap-2 border-y border-hairline py-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Paid</dt>
          <dd>{when}</dd>
        </div>
        {session.reference && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Order</dt>
            <dd>{session.reference}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Refund</dt>
          <dd>
            <Suspense fallback={<span className="text-ink-muted">Checking…</span>}>
              <RefundStatus payment={payment} />
            </Suspense>
          </dd>
        </div>
      </dl>
      {payment.txHash ? (
        <a className="text-sm text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${payment.txHash}`} target="_blank" rel="noreferrer">
          View this payment on the explorer ↗
        </a>
      ) : (
        <p className="text-sm text-ink-muted">Payment number {payment.paymentId} is confirmed.</p>
      )}
    </section>
  );
}
