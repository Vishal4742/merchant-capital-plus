// Customer receipt (FR-PAY-9): amount, shop, order or invoice, refund status and an explorer link, server-rendered, so
// no browser chain reads (FR-PRIV-1). /r/<checkout id> comes from our payment record, its refund line streaming on its
// own. /r/<payment id> (an invoice payment, or any payment) reads payments(id) and its Paid log on chain, so it
// survives a server restart.
import { announcePaid } from "@/lib/announce-paid";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { StaticScene } from "@/components/StaticScene";
import { merchantConfig, payConfig } from "@/lib/config";
import { paidLogs, paymentRefunded, readPayment } from "@/lib/onchain";
import { getSession, type Payment } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

// every chain read here waits at most this long; past it, the receipt says so plainly
const READ_MS = 1_500;

async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("slow")), READ_MS)));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer); // a losing timeout must not reject later with no handler
  }
}

const refundText = (refunded: bigint) => (refunded === 0n ? "No refunds yet" : `${formatUsdt(refunded)} USDT refunded`);
const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

// The refund line streams on its own, so the receipt card (the LCP element) never waits for the chain (tester R1).
async function RefundStatus({ payment }: { payment: Payment }) {
  const pay = payConfig();
  if (!pay || !payment.paymentId) return <>No refunds yet</>;
  return <>{await within(paymentRefunded(pay.merchantPay, BigInt(payment.paymentId))).then(refundText, () => "Couldn't check right now")}</>;
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
  if (/^[1-9]\d{0,19}$/.test(id)) return <PaymentReceipt paymentId={BigInt(id)} />;
  const session = getSession(id);
  if (!session?.payment) notFound();
  const payment = session.payment;
  announcePaid(session, payment.amount ?? session.amount); // idempotent: recovers a lost announcement (G4 code M2)
  return (
    <ReceiptCard
      label={`Receipt${session.reference ? ` · order ${session.reference}` : ""}`}
      amount={payment.amount ?? session.amount} // what was charged: a discount code makes it less than the session's
      merchantName={session.merchantName}
      paidAt={when(payment.paidAt)}
      reference={session.reference ? { term: "Order", value: session.reference } : null}
      price={session.priced ? `${formatUsdt(session.priced.amount)} ${session.priced.currency}` : null}
      refund={
        <Suspense fallback={<span className="text-ink-muted">Checking…</span>}>
          <RefundStatus payment={payment} />
        </Suspense>
      }
      txHash={payment.txHash}
      paymentId={payment.paymentId}
    />
  );
}

async function PaymentReceipt({ paymentId }: { paymentId: bigint }) {
  const pay = payConfig();
  if (!pay) notFound();
  const [record, logs] = await Promise.all([within(readPayment(pay.merchantPay, paymentId)).catch(() => null), within(paidLogs(pay.merchantPay, { paymentId })).catch(() => [])]);
  if (!record) return <p className="relative rounded-[28px] bg-surface px-8 py-6 text-ink shadow-float">We can&apos;t open this receipt right now. Try again in a minute.</p>;
  if (/^0x0{40}$/i.test(record.merchant)) notFound();
  const shop = merchantConfig();
  const log = logs[0];
  return (
    <ReceiptCard
      label={`Receipt · payment ${paymentId}`}
      amount={record.gross}
      merchantName={shop && shop.merchant.toLowerCase() === record.merchant.toLowerCase() ? shop.merchantName : "a merchant"}
      paidAt={log ? when(log.time) : null}
      reference={log && log.invoiceId !== 0n ? { term: "Invoice", value: log.invoiceId.toString() } : null}
      price={null}
      refund={refundText(record.refunded)}
      txHash={log?.txHash ?? null}
      paymentId={paymentId.toString()}
    />
  );
}

interface ReceiptCardProps {
  label: string;
  /** What the customer paid: a sale's price, or an invoice's amount plus its fee. */
  amount: bigint;
  merchantName: string;
  paidAt: string | null;
  reference: { term: string; value: string } | null;
  /** The shop's price when it priced in another currency (FR-GW-11), e.g. "20.00 EUR". */
  price: string | null;
  refund: ReactNode;
  txHash: string | null;
  paymentId: string | null;
}

function ReceiptCard({ label, amount, merchantName, paidAt, reference, price, refund, txHash, paymentId }: ReceiptCardProps) {
  return (
    <section className="relative grid w-full max-w-[420px] gap-5 rounded-[28px] border border-hairline bg-surface p-8 shadow-float">
      <span className="label text-ink-muted">{label}</span>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="amount-xl">{formatUsdt(amount)}</span>
        <span className="label text-ink-muted">USDT</span>
        <span className="text-ink-muted">to {merchantName}</span>
      </p>
      <dl className="grid gap-2 border-y border-hairline py-4 text-sm">
        {paidAt && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Paid</dt>
            <dd>{paidAt}</dd>
          </div>
        )}
        {reference && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">{reference.term}</dt>
            <dd>{reference.value}</dd>
          </div>
        )}
        {price && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Price</dt>
            <dd>{price}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Network fee</dt>
          <dd>None: you paid no network fee</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Refund</dt>
          <dd>{refund}</dd>
        </div>
      </dl>
      {txHash ? (
        <a className="text-sm text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
          View this payment on the explorer ↗
        </a>
      ) : (
        <p className="text-sm text-ink-muted">Payment number {paymentId} is confirmed.</p>
      )}
    </section>
  );
}
