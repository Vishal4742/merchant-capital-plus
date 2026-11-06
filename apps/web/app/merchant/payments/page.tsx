// Payments (FR-PAY-8, FR-GW-5's list for the dashboard): every payment to the signed-in wallet, with its receipt, its
// transaction and a refund. The same sources as GET /api/v1/payments (the Paid log index for ids, payments(id) on chain
// for amounts and what is left to refund), read on our server for the signed-in wallet.
import { connection } from "next/server";
import { Suspense } from "react";
import { Account, EditorialHeader, SignedOut, card } from "@/components/gateway/Frame";
import { Shell } from "@/components/dashboard/Shell";
import { Refund } from "@/components/merchant/Refund";
import { StatusBadge, type StatusTone } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { authSecret } from "@/lib/auth";
import { payConfig } from "@/lib/config";
import { confirmed, formatWbt, paymentRows, WBT_HINT } from "@/lib/dashboard";
import { currentMerchant } from "@/lib/merchant-session";
import { isHex } from "viem";
import { paidLogs, readPayment, readTxFee, type PaymentRecord } from "@/lib/onchain";
import { listPayments } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

const header = (
  <EditorialHeader
    label="Payments"
    lede="Each payment as the chain recorded it, with its receipt and transaction reference. Refund all or part of one directly from your wallet."
  >
    Every payment, <span className="emphasis">settled on chain.</span>
  </EditorialHeader>
);

const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const cellLink = "inline-flex min-h-10 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover";
const FEE_ROWS = 50;

const logged = (what: string) => (error: unknown) => {
  console.error(`payments: ${what} failed: ${error instanceof Error ? error.name : "error"}`);
  return null;
};

/** A row's status and what is left to refund, from payments(id) on chain; left is null when it couldn't be read. */
function refundCell(record: PaymentRecord | null): { status: string; left: bigint | null; tone: StatusTone } {
  if (!record) return { status: "Paid", left: null, tone: "paid" };
  const left = record.gross - record.refunded;
  if (record.refunded === 0n) return { status: "Paid", left, tone: "paid" };
  return {
    status: left === 0n ? "Refunded" : `${formatUsdt(record.refunded)} refunded`,
    left,
    tone: "refunded",
  };
}

export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <Shell active="payments">
          {header}
          <p className="px-4 py-8 text-ink-muted md:px-8">Loading payments…</p>
        </Shell>
      }
    >
      <Payments />
    </Suspense>
  );
}

async function Payments() {
  await connection();
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const pay = payConfig();
  const logs = pay ? await paidLogs(pay.merchantPay, { merchant }).catch(logged("payment index")) : null;
  const candidates = paymentRows((await listPayments(merchant).catch(logged("checkout records"))) ?? [], logs ?? []);
  const records = pay ? await Promise.all(candidates.map((row) => (row.paymentId ? readPayment(pay.merchantPay, BigInt(row.paymentId)).catch(logged(`payments(${row.paymentId})`)) : null))) : [];
  const payments = confirmed(candidates, records, merchant);

  const fees = await Promise.all(
    payments.map(({ row }, i) => (i < FEE_ROWS && row.txHash && isHex(row.txHash) ? readTxFee(row.txHash).catch(logged(`fee of ${row.txHash}`)) : undefined)),
  );
  const known = fees.filter((fee): fee is bigint => typeof fee === "bigint");
  const failed = fees.filter((fee) => fee === null).length;
  const covered = known.reduce((sum, fee) => sum + fee, 0n);

  const totalGross = payments.reduce((sum, p) => sum + p.row.amount, 0n);

  return (
    <Shell active="payments" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-8">
        {/* Metric summary */}
        <section aria-label="Payments summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Total settled"
            value={formatUsdt(totalGross)}
            unit="USDT"
            subtext={`${payments.length} transactions`}
            tone="positive"
          />
          <MetricCard
            label="Payments recorded"
            value={payments.length}
            subtext="Confirmed on Whitechain"
          />
          <MetricCard
            label="Covered gas"
            value={known.length > 0 ? `${formatWbt(covered)}` : "0.0000"}
            unit="WBT"
            subtext="Sponsored via relayer"
          />
          <MetricCard
            label="Settlement Rail"
            value="T+0"
            subtext="Direct to receiving wallet"
          />
        </section>

        {!pay && <p className="text-sm text-warning">Payments open when MerchantPay is connected to this server.</p>}
        {pay && logs === null && <p className="text-sm text-warning">We couldn&apos;t read the full payment list just now, so only this server&apos;s own checkouts show. Reload in a minute.</p>}
        {known.length > 0 && (
          <p className="text-xs text-ink-muted">
            Your customers paid zero network fees. WhiteFlow covered <span className="font-mono text-ink font-medium">{formatWbt(covered)} WBT</span> across {known.length}{" "}
            {known.length === 1 ? "payment" : "payments"}
            {failed > 0 ? `; fee for ${failed} more couldn't be read` : ""}
            {payments.length > FEE_ROWS ? `; fees shown for newest ${FEE_ROWS}` : ""}. {WBT_HINT}
          </p>
        )}

        <section aria-labelledby="all-payments" className={`${card} p-0 md:p-0 overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4 md:px-6">
            <h2 id="all-payments" className="text-[16px] font-semibold text-ink">
              {payments.length} {payments.length === 1 ? "payment" : "payments"}
            </h2>
          </div>

          {payments.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted md:px-6">No payments yet. Open a test checkout from the overview and pay it to see one land here.</p>
          ) : (
            <ul className="grid divide-y divide-hairline text-sm md:table md:w-full md:divide-y-0 md:border-collapse">
              <li className="hidden bg-surface-sunk text-ink-muted md:table-row font-medium" aria-hidden="true">
                {["Transaction / Payment", "Amount", "Network Fee", "Status", "Receipt", "Refund"].map((h, i) => (
                  <span key={h} className={`eyebrow md:table-cell md:px-6 md:py-3.5 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </span>
                ))}
              </li>
              {payments.map(({ row, record }, i) => {
                const cell = refundCell(record);
                const fee = fees[i];
                return (
                  <li key={row.key} className="grid grid-cols-2 items-center gap-x-4 gap-y-1.5 px-5 py-4 md:table-row md:border-t md:border-hairline md:hover:bg-surface-sunk/30 transition-colors">
                    <span className="col-span-2 md:table-cell md:px-6 md:py-3.5 md:align-middle">
                      {row.txHash ? (
                        <a className={`${cellLink} data font-mono text-xs`} href={`${EXPLORER}/tx/${row.txHash}`} target="_blank" rel="noreferrer">
                          {row.label} ↗
                        </a>
                      ) : (
                        <span className="data font-mono text-xs">{row.label}</span>
                      )}
                      <span className="data text-xs text-ink-muted"> · {when(row.paidAt)}</span>
                    </span>
                    <span className="tabular-nums font-semibold md:table-cell md:px-6 md:py-3.5 md:text-right md:align-middle">
                      {formatUsdt(row.amount)} <span className="text-xs text-ink-muted font-normal">USDT</span>
                    </span>
                    <span className="text-xs text-ink-muted tabular-nums md:table-cell md:px-6 md:py-3.5 md:text-right md:align-middle">
                      <span className="md:hidden font-medium">Relayer fee: </span>
                      {typeof fee === "bigint" ? `${formatWbt(fee)} WBT` : "—"}
                    </span>
                    <span className="text-right md:table-cell md:px-6 md:py-3.5 md:align-middle">
                      <StatusBadge status={cell.tone} label={cell.status} />
                    </span>
                    <span className="md:table-cell md:px-6 md:py-3.5 md:text-right md:align-middle">
                      {row.receiptId ? (
                        <a href={`/r/${row.receiptId}`} className={cellLink}>
                          View receipt ↗
                        </a>
                      ) : (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                    </span>
                    <span className="text-right md:table-cell md:px-6 md:py-3.5 md:align-middle">
                      {pay && row.paymentId && cell.left !== null && cell.left > 0n ? (
                        <Refund key={`${row.paymentId}:${cell.left}`} merchant={merchant} merchantPay={pay.merchantPay} paymentId={row.paymentId} refundable={cell.left.toString()} />
                      ) : (
                        <span className="text-xs text-ink-muted">{cell.left === null ? "Checking" : "Settled"}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
