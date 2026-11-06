// Payments (FR-PAY-8, FR-GW-5's list for the dashboard): every payment to the signed-in wallet, with its receipt, its
// transaction and a refund. The same sources as GET /api/v1/payments (the Paid log index for ids, payments(id) on chain
// for amounts and what is left to refund), read on our server for the signed-in wallet: that route needs the shop's
// secret key, which never reaches a browser.
import { connection } from "next/server";
import { Suspense } from "react";
import { Account, EditorialHeader, SignedOut, card } from "@/components/gateway/Frame";
import { Shell } from "@/components/dashboard/Shell";
import { Refund } from "@/components/merchant/Refund";
import { authSecret } from "@/lib/auth";
import { payConfig } from "@/lib/config";
import { confirmed, paymentRows } from "@/lib/dashboard";
import { currentMerchant } from "@/lib/merchant-session";
import { paidLogs, readPayment, type PaymentRecord } from "@/lib/onchain";
import { listPayments } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

const header = (
  <EditorialHeader label="Payments" lede="Each payment as the chain recorded it, with its receipt and its transaction. Refund all or part of one from your wallet.">
    Every payment, <span className="emphasis">on the record.</span>
  </EditorialHeader>
);

const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const cellLink = "inline-flex min-h-11 items-center text-accent underline underline-offset-4";

const logged = (what: string) => (error: unknown) => {
  console.error(`payments: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  return null;
};

/** A row's status and what is left to refund, from payments(id) on chain; left is null when it couldn't be read. */
function refundCell(record: PaymentRecord | null): { status: string; left: bigint | null } {
  if (!record) return { status: "Paid", left: null };
  const left = record.gross - record.refunded;
  if (record.refunded === 0n) return { status: "Paid", left };
  return { status: left === 0n ? "Refunded" : `${formatUsdt(record.refunded)} refunded`, left };
}

export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <Shell active="payments">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your payments…</p>
        </Shell>
      }
    >
      <Payments />
    </Suspense>
  );
}

async function Payments() {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const pay = payConfig();
  const logs = pay ? await paidLogs(pay.merchantPay, { merchant }).catch(logged("payment index")) : null;
  const candidates = paymentRows(listPayments(merchant), logs ?? []);
  // amounts and what is left to refund, read on chain per payment, never from the index
  const records = pay ? await Promise.all(candidates.map((row) => (row.paymentId ? readPayment(pay.merchantPay, BigInt(row.paymentId)).catch(logged(`payments(${row.paymentId})`)) : null))) : [];
  const payments = confirmed(candidates, records, merchant);

  return (
    <Shell active="payments" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-4 px-4 py-6 md:px-8 md:py-8">
        {!pay && <p className="text-sm text-warning">Payments open when MerchantPay is connected to this server.</p>}
        {pay && logs === null && <p className="text-sm text-warning">We couldn&apos;t read the full payment list just now, so only this server&apos;s own checkouts show. Reload in a minute.</p>}
        <section aria-labelledby="all-payments" className={`${card} p-0 md:p-0`}>
          <h2 id="all-payments" className="px-5 pt-5 text-[15px] font-medium md:px-6">
            {payments.length} {payments.length === 1 ? "payment" : "payments"}
          </h2>
          {payments.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-ink-muted md:px-6">No payments yet. Open a test checkout from the dashboard home and pay it to see one land here.</p>
          ) : (
            // a card per payment on a phone, a table row from md up: Refund is never off screen (UX review 005 F2)
            <ul className="grid divide-y divide-hairline text-sm md:table md:w-full md:divide-y-0 md:border-collapse">
              <li className="hidden bg-surface-sunk text-ink-muted md:table-row" aria-hidden="true">
                {["Payment", "Amount", "Status", "Receipt", "Refund"].map((h, i) => (
                  <span key={h} className={`label md:table-cell md:px-6 md:py-3 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </span>
                ))}
              </li>
              {payments.map(({ row, record }) => {
                const cell = refundCell(record);
                return (
                  <li key={row.key} className="grid grid-cols-2 items-center gap-x-4 gap-y-1 px-5 py-4 md:table-row md:border-t md:border-hairline md:hover:bg-accent-soft">
                    <span className="col-span-2 md:table-cell md:px-6 md:py-3 md:align-middle">
                      {row.txHash ? (
                        <a className={`${cellLink} data`} href={`${EXPLORER}/tx/${row.txHash}`} target="_blank" rel="noreferrer">
                          {row.label} ↗
                        </a>
                      ) : (
                        <span className="data">{row.label}</span>
                      )}
                      <span className="data text-ink-muted"> · {when(row.paidAt)}</span>
                    </span>
                    <span className="tabular-nums md:table-cell md:px-6 md:py-3 md:text-right md:align-middle">
                      {formatUsdt(row.amount)} <span className="text-ink-muted">USDT</span>
                    </span>
                    <span className="text-right md:table-cell md:px-6 md:py-3 md:align-middle">
                      <span className={`inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${cell.status === "Paid" ? "text-positive" : "text-ink-muted"}`}>{cell.status}</span>
                    </span>
                    <span className="md:table-cell md:px-6 md:py-3 md:text-right md:align-middle">
                      {/* a full load: the receipt has its own CSP */}
                      {row.paymentId ? (
                        <a href={`/r/${row.paymentId}`} className={cellLink}>
                          Receipt
                        </a>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </span>
                    <span className="text-right md:table-cell md:px-6 md:py-3 md:align-middle">
                      {pay && row.paymentId && cell.left !== null && cell.left > 0n ? (
                        // keyed by what is left: after a refund the control starts again from the new figure (tester R1 #2)
                        <Refund key={`${row.paymentId}:${cell.left}`} merchant={merchant} merchantPay={pay.merchantPay} paymentId={row.paymentId} refundable={cell.left.toString()} />
                      ) : (
                        <span className="text-ink-muted">{cell.left === null ? "Can't check right now" : "Fully refunded"}</span>
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
