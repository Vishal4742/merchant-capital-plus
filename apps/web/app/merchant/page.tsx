// Merchant dashboard (FR-PAY-15, FR-REL-6). Behind "Sign in with your wallet" (SIWE): today's sales, the relayer's
// health and the payments table, for the signed-in wallet only.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonClasses } from "@/components/Button";
import { SignIn, SignOut } from "@/components/merchant/SignIn";
import { authSecret } from "@/lib/auth";
import { currentMerchant } from "@/lib/merchant-session";
import { merchantConfig, payConfig } from "@/lib/config";
import { relayerHealth } from "@/lib/relay";
import { listPayments } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

export default function MerchantPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="title whitespace-nowrap">
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

/** Today's payments in IST. A plain function, so reading the clock stays out of the render body. */
function todaysPayments(payments: ReturnType<typeof listPayments>) {
  const today = dayIST(Date.now());
  const todays = payments.filter((p) => dayIST(p.payment.paidAt) === today);
  return { count: todays.length, received: todays.reduce((sum, p) => sum + p.session.amount, 0n) };
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
  const [payments, health] = [listPayments(merchant), pay ? await relayerHealth(pay.relayerUrl) : null];
  const isShopWallet = merchant.toLowerCase() === config.merchant.toLowerCase();
  const todays = todaysPayments(payments);

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
            <span>Sales, before fees</span>
            <b className="title tabular-nums">{formatUsdt(todays.received)}</b>
          </p>
          <p className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3 text-sm">
            <span>Payments</span>
            <b className="title tabular-nums">{todays.count}</b>
          </p>
        </section>

        <section className={card} aria-labelledby="gas">
          <span id="gas" className="label text-ink-muted">Who pays gas</span>
          <p className="text-sm text-ink-muted">Your customers never hold or pay for gas. Our relayer pays it and recovers 0.10 USDT per payment.</p>
          {health ? (
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Relayer balance</dt>
                <dd className="data">{health.wbt ? `${Number.parseFloat(health.wbt).toFixed(4)} WBT` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Gas spent today</dt>
                <dd className="data">{health.gasSpentToday ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Budget left today</dt>
                <dd className="data">{health.budgetLeft ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-hairline pt-2">
                <dt>Fees not yet swapped</dt>
                <dd className="data">{health.usdtFeesUnswapped ?? "—"} USDT</dd>
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

      <section className="mt-6 overflow-x-auto rounded-md border border-hairline bg-surface shadow-card" aria-labelledby="payments">
        <h2 id="payments" className="label px-6 pt-5 text-ink-muted">
          Payments
        </h2>
        {payments.length === 0 ? (
          <p className="px-6 pt-3 pb-6 text-sm text-ink-muted">No payments yet. Open a test checkout above and pay it to see one land here.</p>
        ) : (
          <table className="mt-3 w-full min-w-[480px] border-collapse text-sm">
            <thead className="bg-surface-sunk text-ink-muted">
              <tr>
                {["Payment", "Amount", "Status"].map((h, i) => (
                  <th key={h} scope="col" className={`label px-6 py-3 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map(({ session, payment }) => (
                <tr key={session.id} className="border-t border-hairline hover:bg-accent-soft">
                  <td className="px-6 py-3">
                    {payment.txHash ? (
                      <a className="data text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${payment.txHash}`} target="_blank" rel="noreferrer">
                        {session.reference || "Payment"} ↗
                      </a>
                    ) : (
                      <span className="data">{session.reference || `Payment ${payment.paymentId}`}</span>
                    )}
                    <span className="data text-ink-muted"> · {time(payment.paidAt)}</span>
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatUsdt(session.amount)}</td>
                  <td className="px-6 py-3 text-right">
                    <span className="inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium text-positive">Paid</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="mt-3 text-xs text-ink-muted">Amounts are what customers paid. MerchantPay keeps 0.10 USDT of each for gas, and the rest reaches your wallet in the same transaction.</p>
    </>
  );
}
