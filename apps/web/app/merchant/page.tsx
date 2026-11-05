// Merchant dashboard (FR-PAY-15, FR-REL-6, FR-PAY-1/2 invoices, FR-PAY-8 refunds). Behind "Sign in with your wallet"
// (SIWE): today's sales, the relayer's health, invoices and the payments table, for the signed-in wallet only, read on
// our server. Invoices and refunds are sent by that wallet itself, which pays its own gas.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonClasses } from "@/components/Button";
import { Invoices, type InvoiceRow } from "@/components/merchant/Invoices";
import { Refund } from "@/components/merchant/Refund";
import { SignIn, SignOut } from "@/components/merchant/SignIn";
import { authSecret } from "@/lib/auth";
import { currentMerchant } from "@/lib/merchant-session";
import { merchantConfig, payConfig } from "@/lib/config";
import { merchantInvoices, paidLogs, readPayment, readRelayFee, type Invoice, type PaidLog, type PaymentRecord } from "@/lib/onchain";
import { relayerHealth } from "@/lib/relay";
import { listPayments } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

export default function MerchantPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="title inline-flex min-h-11 items-center whitespace-nowrap">
          Merchant Capital+
        </Link>
        <span className="label text-ink-muted">Merchant dashboard</span>
      </header>
      <Suspense fallback={<p className="mt-16 text-ink-muted">Loading the dashboard…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

const card = "grid content-start gap-3 rounded-md border border-hairline bg-surface p-6 shadow-card min-w-0";
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const dayIST = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

/** A relayer figure in WBT, 4 decimals (code review 004 R2 F6: every row has its unit), or "—". */
function wbt(value: string | null): string {
  const n = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? `${n.toFixed(4)} WBT` : "—";
}

interface PaymentRow {
  key: string;
  paymentId: string | null;
  label: string;
  txHash: string | null;
  paidAt: number;
  amount: bigint; // what the customer paid (an invoice's includes the fee), from payments(id) once read
  /** Our own checkout record; a row only the log index knows needs the chain to confirm it. */
  ours: boolean;
}

/** This merchant's payment candidates: checkouts our server recorded, plus every Paid log the index has (invoices,
 *  and sales from before a restart), one row per payment id, newest first. */
function paymentRows(sessions: ReturnType<typeof listPayments>, logs: PaidLog[]): PaymentRow[] {
  const rows = new Map<string, PaymentRow>();
  for (const log of logs) {
    const id = log.paymentId.toString();
    rows.set(id, { key: id, paymentId: id, label: log.invoiceId ? `Invoice ${log.invoiceId}` : `Payment ${id}`, txHash: log.txHash, paidAt: log.time, amount: log.gross, ours: false });
  }
  for (const { session, payment } of sessions) {
    const key = payment.paymentId ?? session.id;
    rows.set(key, { key, paymentId: payment.paymentId, label: session.reference || `Payment ${payment.paymentId}`, txHash: payment.txHash ?? rows.get(key)?.txHash ?? null, paidAt: payment.paidAt, amount: session.amount, ours: true });
  }
  return [...rows.values()].sort((a, b) => b.paidAt - a.paidAt);
}

/** The chain decides what is shown (security review 005 F5): the amount is payments(id).gross, a row the chain says
 *  is another merchant's is dropped, and an index-only row is shown only once the chain confirms it. */
function confirmed(rows: PaymentRow[], records: (PaymentRecord | null)[], merchant: string): { row: PaymentRow; record: PaymentRecord | null }[] {
  return rows.flatMap((row, i) => {
    const record = records[i] ?? null;
    if (record ? record.merchant.toLowerCase() !== merchant.toLowerCase() : !row.ours) return [];
    return [{ row: record ? { ...row, amount: record.gross } : row, record }];
  });
}

/** Today's payments in IST. A plain function, so reading the clock stays out of the render body. */
function todaysPayments(rows: PaymentRow[]) {
  const today = dayIST(Date.now());
  const todays = rows.filter((row) => dayIST(row.paidAt) === today);
  return { count: todays.length, received: todays.reduce((sum, row) => sum + row.amount, 0n) };
}

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

function invoiceRows(invoices: Invoice[], logs: PaidLog[]): InvoiceRow[] {
  // the payment that completed each invoice: its last Paid log (a part-paid invoice has several)
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
  console.error(`dashboard: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  return null;
};

/** One row's status and what is left to refund, from payments(id) on chain; left is null when it couldn't be read. */
function refundCell(record: PaymentRecord | null): { status: string; left: bigint | null } {
  if (!record) return { status: "Paid", left: null };
  const left = record.gross - record.refunded;
  if (record.refunded === 0n) return { status: "Paid", left };
  return { status: left === 0n ? "Refunded" : `${formatUsdt(record.refunded)} refunded`, left };
}

async function Dashboard() {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignIn available={Boolean(authSecret())} />;
  const config = merchantConfig();
  if (!config) {
    return (
      <section className={`${card} mt-12`}>
        <h1 className="title">The shop isn&apos;t set up on this server</h1>
        <p className="text-ink-muted">Set MERCHANT_ADDRESS and SHOP_API_KEY in the server environment, then reload.</p>
      </section>
    );
  }
  const pay = payConfig();
  const [health, invoices, logs, fee] = pay
    ? await Promise.all([
        relayerHealth(pay.relayerUrl),
        merchantInvoices(pay.merchantPay, merchant).catch(logged("invoice list")),
        paidLogs(pay.merchantPay, { merchant }).catch(logged("payment index")),
        readRelayFee(pay.merchantPay).catch(logged("fee read")),
      ])
    : [null, null, null, null];
  const candidates = paymentRows(listPayments(merchant), logs ?? []);
  // amounts and what is left to refund, read on chain per payment (one multicall), never from the index
  const records = pay ? await Promise.all(candidates.map((row) => (row.paymentId ? readPayment(pay.merchantPay, BigInt(row.paymentId)).catch(logged(`payments(${row.paymentId})`)) : null))) : [];
  const payments = confirmed(candidates, records, merchant);
  const isShopWallet = merchant.toLowerCase() === config.merchant.toLowerCase();
  const todays = todaysPayments(payments.map(({ row }) => row));
  // the owner may change relayFee (≤ 0.25 USDT): every fee the merchant reads comes from the chain (code review 005 F7)
  const feeText = fee === null ? null : formatUsdt(fee);

  return (
    <>
      <div className="mt-10 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="display">{isShopWallet ? config.merchantName : "Your shop"}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            Signed in as <span className="data">{merchant.slice(0, 6)}…{merchant.slice(-4)}</span>
            <SignOut />
          </p>
          {!isShopWallet && (
            <p className="text-sm text-warning">
              The demo shop is paid to {config.merchant.slice(0, 6)}…{config.merchant.slice(-4)}, not this wallet, so its test payments won&apos;t show here.
            </p>
          )}
        </div>
        <form method="post" action="/api/demo-checkout">
          <button type="submit" className={buttonClasses("glass", "border-hairline bg-surface text-ink")}>
            Open a test checkout
          </button>
        </form>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className={card} aria-labelledby="today">
          <span id="today" className="label text-ink-muted">Today</span>
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span>Paid by customers (invoice fees included)</span>
            <b className="title tabular-nums">{formatUsdt(todays.received)}</b>
          </p>
          <p className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3 text-sm">
            <span>Payments</span>
            <b className="title tabular-nums">{todays.count}</b>
          </p>
        </section>

        <section className={card} aria-labelledby="gas">
          <span id="gas" className="label text-ink-muted">Who pays gas</span>
          <p className="text-sm text-ink-muted">Your customers never hold or pay for gas. Our relayer pays it and recovers {feeText ? `${feeText} USDT` : "a small fee"} per payment.</p>
          {health ? (
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Relayer balance</dt>
                <dd className="data">{wbt(health.wbt)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Gas spent today</dt>
                <dd className="data">{wbt(health.gasSpentToday)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Budget left today</dt>
                <dd className="data">{wbt(health.budgetLeft)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Fees not yet swapped</dt>
                <dd className="data">{health.usdtFeesUnswapped ? `${health.usdtFeesUnswapped} USDT` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Status</dt>
                <dd className={health.paused ? "text-warning" : "text-positive"}>{health.paused ? "Paused" : "Running"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-warning">{pay ? "The relayer isn't answering right now." : "The relayer isn't connected to this server yet."}</p>
          )}
        </section>
      </div>

      {pay && isShopWallet ? (
        <Invoices merchant={merchant} merchantPay={pay.merchantPay} invoices={invoices ? invoiceRows(invoices, logs ?? []) : null} today={todayIST()} feeText={feeText} />
      ) : (
        <section className={`${card} mt-6`}>
          <span className="label text-ink-muted">Invoices</span>
          <p className="text-sm text-ink-muted">
            {/* /pay serves only the shop's own invoices (human, 2026-11-06 02:3x) */}
            {pay ? "This site takes invoice payments for the demo shop's wallet only. Sign in with that wallet to send invoices." : "Invoices open when MerchantPay is connected to this server."}
          </p>
        </section>
      )}

      <section className="mt-6 rounded-md border border-hairline bg-surface shadow-card" aria-labelledby="payments">
        <h2 id="payments" className="label px-6 pt-5 text-ink-muted">
          Payments
        </h2>
        {payments.length === 0 ? (
          <p className="px-6 pt-3 pb-6 text-sm text-ink-muted">No payments yet. Open a test checkout above and pay it to see one land here.</p>
        ) : (
          // a card per payment on a phone, a table row from sm up: Refund is never off screen (UX review 005 F2)
          <ul className="mt-3 grid divide-y divide-hairline text-sm sm:table sm:w-full sm:divide-y-0 sm:border-collapse">
            <li className="hidden bg-surface-sunk text-ink-muted sm:table-row" aria-hidden="true">
              {["Payment", "Amount", "Status", "Refund"].map((h, i) => (
                <span key={h} className={`label sm:table-cell sm:px-6 sm:py-3 ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </span>
              ))}
            </li>
            {payments.map(({ row, record }) => {
              const cell = refundCell(record);
              return (
                <li key={row.key} className="grid grid-cols-2 items-center gap-x-4 gap-y-2 px-6 py-4 sm:table-row sm:border-t sm:border-hairline sm:hover:bg-accent-soft">
                  <span className="col-span-2 sm:table-cell sm:px-6 sm:py-3 sm:align-middle">
                    {row.txHash ? (
                      <a className="data inline-flex min-h-11 items-center text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${row.txHash}`} target="_blank" rel="noreferrer">
                        {row.label} ↗
                      </a>
                    ) : (
                      <span className="data">{row.label}</span>
                    )}
                    <span className="data text-ink-muted"> · {time(row.paidAt)}</span>
                  </span>
                  <span className="tabular-nums sm:table-cell sm:px-6 sm:py-3 sm:text-right sm:align-middle">
                    {formatUsdt(row.amount)} <span className="text-ink-muted sm:hidden">USDT</span>
                  </span>
                  <span className="text-right sm:table-cell sm:px-6 sm:py-3 sm:align-middle">
                    <span className={`inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${cell.status === "Paid" ? "text-positive" : "text-ink-muted"}`}>{cell.status}</span>
                  </span>
                  <span className="col-span-2 sm:table-cell sm:px-6 sm:py-3 sm:text-right sm:align-middle">
                    {pay && row.paymentId && cell.left !== null && cell.left > 0n ? (
                      // keyed by what is left: after a refund the control starts again from the new figure (tester R1 #2)
                      <Refund key={`${row.paymentId}:${cell.left}`} merchant={merchant} merchantPay={pay.merchantPay} paymentId={row.paymentId} refundable={cell.left.toString()} />
                    ) : (
                      <span className="text-sm text-ink-muted">{cell.left === null ? "Can't check right now" : "Fully refunded"}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="mt-3 text-xs text-ink-muted">
        Amounts are what customers paid. A sale&apos;s {feeText ? `${feeText} USDT ` : ""}gas fee comes out of it; an invoice&apos;s is added on top. The rest goes to your wallet in the same
        transaction, or first to your investors while you repay an advance. Refunds come from your wallet, in full or in part.
      </p>
    </>
  );
}
