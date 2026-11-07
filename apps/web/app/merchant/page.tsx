// Whiteflow Business Workspace Home (/merchant):
// Non-custodial settlement, verified metrics, quick actions, invoices, payments and sponsored relayer telemetry.
import { connection } from "next/server";
import { Suspense } from "react";
import type { Address } from "viem";
import { GrossChart, type GrossRange } from "@/components/dashboard/GrossChart";
import { Reveal } from "@/components/dashboard/Reveal";
import { GetStarted } from "@/components/dashboard/GetStarted";
import { Shell } from "@/components/dashboard/Shell";
import { Account, PlainPage, SignedOut } from "@/components/gateway/Frame";
import { Invoices, type InvoiceRow } from "@/components/merchant/Invoices";
import { Refund } from "@/components/merchant/Refund";
import { StaticScene } from "@/components/StaticScene";
import { StatusBadge } from "@/components/ui/Badge";
import { authSecret } from "@/lib/auth";
import { currentMerchant } from "@/lib/merchant-session";
import { merchantConfig, payConfig } from "@/lib/config";
import { change, confirmed, dailyGross, figures, paymentRows, type Confirmed } from "@/lib/dashboard";
import { vouchersUsed, type Voucher } from "@/lib/gateway-money";
import { logFailure, merchantVouchers } from "@/lib/gateway-server";
import { setupSteps } from "@/lib/onboarding";
import { merchantInvoices, paidLogs, readPayment, readRelayFee, type Invoice, type PaidLog, type PaymentRecord } from "@/lib/onchain";
import { relayerHealth } from "@/lib/relay";
import { ackView, acksFor, type InvoiceAck } from "@/lib/server/invoice-acks";
import { listKeys } from "@/lib/server/keys";
import { linkStatus, listLinks } from "@/lib/server/links";
import { listPayments } from "@/lib/sessions";
import { EXPLORER, formatUsdt } from "@/lib/usdt";

export default function MerchantPage() {
  return (
    // the sidebar paints at once, so switching to Overview never drops the frame while its data streams in (NFR-13)
    <Suspense
      fallback={
        <Shell active="home">
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading the workspace…</p>
        </Shell>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const card = "grid min-w-0 content-start gap-4 rounded-[16px] border border-hairline bg-surface p-5 md:px-6 shadow-card";
const istTime = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const istDate = (ms: number, options: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString("en-GB", { ...options, timeZone: "Asia/Kolkata" });

/** A relayer figure in WBT, 4 decimals, or "—". */
function wbt(value: string | null): string {
  const n = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? `${n.toFixed(4)} WBT` : "—";
}

/** This invoice's acks, only those signed for its own terms (security 047 L1), or null. */
const ackOf = (acks: Map<string, InvoiceAck[]> | null, invoice: Invoice) => ackView(acks?.get(invoice.id.toString()) ?? [], invoice);

function invoiceRows(invoices: Invoice[], logs: PaidLog[], acks: Map<string, InvoiceAck[]> | null): InvoiceRow[] {
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
            ack: ackOf(acks, invoice),
          },
        ],
  );
}

const logged = (what: string) => (error: unknown) => {
  console.error(`dashboard: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  return null;
};

/** One row's status and what is left to refund, from payments(id) on chain; left is null when it couldn't be read. */
function refundCell(record: PaymentRecord | null): { status: string; left: bigint | null; tone: "paid" | "refunded" } {
  if (!record) return { status: "Paid", left: null, tone: "paid" };
  const left = record.gross - record.refunded;
  if (record.refunded === 0n) return { status: "Paid", left, tone: "paid" };
  return { status: left === 0n ? "Refunded" : `${formatUsdt(record.refunded)} refunded`, left, tone: "refunded" };
}

interface Tile {
  label: string;
  value: string;
  sub: string;
  tone?: "up" | "down" | "positive";
}

const arrow = (n: number) => (n === 0 ? "0" : `${n > 0 ? "▲" : "▼"} ${Math.abs(n)}`);
const toneOf = (n: number | null): Tile["tone"] => (n === null || n === 0 ? undefined : n > 0 ? "up" : "down");

/** Everything on the home that depends on the clock, in one plain function (the render body never reads it). */
function home(payments: Confirmed[], fee: bigint | null, invoices: Invoice[] | null | undefined, vouchers: Voucher[] | null) {
  const now = Date.now();
  const f = figures(payments, now);
  const vsYesterday = change(f.grossToday, f.grossYesterday);
  const none = payments.length === 0;

  const openInvoices = (invoices ?? []).filter((i) => i.status === "open");
  const openTotal = openInvoices.reduce((sum, i) => sum + (i.amount - i.paid), 0n);

  const tiles: Tile[] = [
    {
      label: "Gross today",
      value: formatUsdt(f.grossToday),
      sub: vsYesterday === null ? "USDT, since midnight IST" : `${arrow(vsYesterday)}% vs yesterday`,
      tone: toneOf(vsYesterday),
    },
    none
      ? { label: "Payments today", value: "0", sub: "First payment will show here" }
      : {
          label: "Payments today",
          value: String(f.countToday),
          sub: `${arrow(f.countToday - f.countYesterday)} vs yesterday`,
          tone: toneOf(f.countToday - f.countYesterday),
        },
    {
      label: "Outstanding",
      value: invoices ? formatUsdt(openTotal) : "—",
      sub: invoices ? `${openInvoices.length} open ${openInvoices.length === 1 ? "invoice" : "invoices"}` : "Invoices unavailable",
      tone: openInvoices.length > 0 ? "up" : undefined,
    },
    none
      ? { label: "Refunds", value: formatUsdt(0n), sub: "None requested" }
      : {
          label: "Refunds",
          value: f.refunded === null ? "—" : formatUsdt(f.refunded),
          sub: `${f.refundedPayments} ${f.refundedPayments === 1 ? "payment" : "payments"}, all time`,
        },
    {
      label: "Relayer fees",
      value: fee === null ? "—" : formatUsdt(fee * BigInt(f.countToday)),
      sub: fee === null ? "Can't read fee" : `${formatUsdt(fee)} each, sponsored`,
    },
    { label: "Vouchers used", ...vouchersUsed(vouchers, now) },
  ];

  const series = dailyGross(
    payments.map(({ row }) => row),
    60,
    now,
  );

  const range = (days: 7 | 30): GrossRange => {
    const current = series.slice(-days), before = series.slice(-2 * days, -days);
    const total = current.reduce((a, b) => a + b, 0n);
    return {
      days,
      values: current.map((units) => Number(units) / 1e6),
      totalText: formatUsdt(total),
      change: change(total, before.reduce((a, b) => a + b, 0n)),
      fromText: istDate(now - (days - 1) * DAY_MS, { day: "numeric", month: "short" }),
      toText: "Today",
    };
  };

  const when = `${istDate(now, { weekday: "short", day: "numeric", month: "short" })} · ${istTime(now)} IST`;
  return { tiles, ranges: [range(7), range(30)], when, today: new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) };
}

function Band({ shop, when, note }: { shop: string; when: string; note?: string }) {
  return (
    <div className="relative h-[160px] overflow-hidden bg-scene-night text-glass-ink md:h-[150px]">
      <StaticScene />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-scene-night/95 via-scene-night/50 via-50% to-transparent md:bg-linear-to-r md:from-scene-night md:from-10% md:via-scene-night/70 md:via-50% md:to-transparent md:to-80%"
      />
      <div className="absolute right-4 bottom-[20px] left-4 md:left-8">
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="eyebrow text-accent font-semibold tracking-wide">
            Whiteflow Workspace
          </span>
          <span className="text-ink-muted">·</span>
          <span className="eyebrow opacity-80">{shop}</span>
          <span className="text-ink-muted">·</span>
          <span className="eyebrow opacity-80">{when}</span>
        </div>
        <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-white md:text-[34px]">
          One invoice. <span className="emphasis text-accent">Clear settlement.</span>
        </h1>
        {note && <p className="mt-1 text-xs opacity-75">{note}</p>}
      </div>
    </div>
  );
}

async function setupFacts(merchant: Address) {
  const unread = (what: string) => (error: unknown) => {
    logFailure(`get started: ${what}`, error);
    return null;
  };
  const [links, keys] = await Promise.all([listLinks(merchant).catch(unread("links")), listKeys(merchant).catch(unread("keys"))]);
  const open = links?.find((link) => linkStatus(link) === "active");
  return { links: links?.length ?? null, keys: keys?.length ?? null, payHref: open ? `/l/${open.slug}` : null };
}

const action = "lift flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface px-4 py-2.5 text-left text-sm transition-colors hover:border-accent";

async function Dashboard() {
  await connection();
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const config = merchantConfig();
  if (!config) {
    return (
      <PlainPage>
        <section className={`${card} mt-12`}>
          <h1 className="title">The shop isn&apos;t set up on this server</h1>
          <p className="text-ink-muted">Set MERCHANT_ADDRESS and SHOP_API_KEY in the server environment, then reload.</p>
        </section>
      </PlainPage>
    );
  }
  const setup = setupFacts(merchant); // its own reads, alongside the chain's
  const vouchers = merchantVouchers(merchant).catch((error: unknown) => (logFailure("dashboard: vouchers", error), null)); // the name only: a DB message can hold SQL
  const sessions = listPayments(merchant).catch(logged("checkout records")); // Postgres, alongside the chain's reads
  const pay = payConfig();
  const [health, invoices, logs, fee] = pay
    ? await Promise.all([
        relayerHealth(pay.relayerUrl),
        merchantInvoices(pay.merchantPay, merchant).catch(logged("invoice list")),
        paidLogs(pay.merchantPay, { merchant }).catch(logged("payment index")),
        readRelayFee(pay.merchantPay).catch(logged("fee read")),
      ])
    : [null, null, null, null];
  // which open invoices their debtor acknowledged (batch 047); unreadable, the list shows "Not acknowledged yet"
  const openIds = (invoices ?? []).filter((invoice) => invoice.status === "open").map((invoice) => invoice.id);
  const acks = pay ? await acksFor(pay.merchantPay, openIds).catch((error: unknown) => (logFailure("dashboard: debtor acks", error), null)) : null;
  // our checkout records only label the chain's payments: unreadable, the chain's rows still show
  const candidates = paymentRows((await sessions) ?? [], logs ?? []);
  // amounts and what is left to refund, read on chain per payment (one multicall), never from the index
  const records = pay ? await Promise.all(candidates.map((row) => (row.paymentId ? readPayment(pay.merchantPay, BigInt(row.paymentId)).catch(logged(`payments(${row.paymentId})`)) : null))) : [];
  const payments = confirmed(candidates, records, merchant);
  const isShopWallet = merchant.toLowerCase() === config.merchant.toLowerCase();
  const shop = isShopWallet ? config.merchantName : "your workspace";
  const { tiles, ranges, when, today } = home(payments, fee, invoices, await vouchers);
  // the owner may change relayFee (≤ 0.25 USDT): every fee the merchant reads comes from the chain (code review 005 F7)
  const feeText = fee === null ? null : formatUsdt(fee);
  const steps = setupSteps({ ...(await setup), payments: payments.length });
  const shopWallet = `${config.merchant.slice(0, 6)}…${config.merchant.slice(-4)}`;

  return (
    <Shell active="home" account={<Account merchant={merchant} />}>
      <Band shop={shop} when={when} note={payments.length === 0 ? "No sales yet. Real-time payments appear the moment settlement confirms on chain." : undefined} />
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-7">
        <GetStarted steps={steps} />

        {/* Financial Metrics Row */}
        <section aria-label="Financial overview" className="grid grid-cols-2 gap-px overflow-hidden rounded-[16px] border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6 shadow-card">
          {tiles.map((tile) => (
            <div key={tile.label} className="grid content-start gap-1 bg-surface p-4 md:p-[18px]">
              <h2 className="eyebrow text-ink-muted">{tile.label}</h2>
              <b className="text-[26px] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
                <Reveal text={tile.value} />
              </b>
              <span className={`text-xs ${tile.tone === "up" ? "text-positive" : tile.tone === "down" ? "text-warning" : tile.tone === "positive" ? "text-emerald-600" : "text-ink-muted"}`}>
                {tile.sub}
              </span>
            </div>
          ))}
        </section>

        {/* Charts & Quick Actions */}
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <GrossChart ranges={ranges} />
          <section aria-labelledby="quick" className={`${card} gap-3`}>
            <h2 id="quick" className="text-sm font-semibold text-ink">
              Quick actions
            </h2>
            <ul className="grid gap-2">
              <li>
                <a href="/merchant/invoices" className={action}>
                  <span>Create an invoice</span>
                  <span className="eyebrow text-accent font-medium">Invoices ↗</span>
                </a>
              </li>
              <li>
                <a href="/merchant/links" className={action}>
                  <span>Generate payment link</span>
                  <span className="eyebrow text-accent font-medium">Links ↗</span>
                </a>
              </li>
              <li>
                <form method="post" action="/api/demo-checkout">
                  <button type="submit" className={`${action} cursor-pointer`}>
                    <span>{isShopWallet ? "Open test checkout" : "Sample customer checkout"}</span>
                    <span className="eyebrow text-ink-muted">{isShopWallet ? "Test" : "Demo"}</span>
                  </button>
                </form>
              </li>
              <li>
                <a href="/merchant/connections" className={action}>
                  <span>API keys &amp; webhooks</span>
                  <span className="eyebrow text-ink-muted">APIs</span>
                </a>
              </li>
              <li>
                <a href="/merchant/settings" className={action}>
                  <span>Settlement policy</span>
                  <span className="eyebrow text-ink-muted">Settings</span>
                </a>
              </li>
              <li>
                <a href="/merchant/capital" className={action}>
                  Get paid early <span className="eyebrow text-ink-muted">Capital</span>
                </a>
              </li>
            </ul>
          </section>
        </div>

        {/* Invoices Component */}
        {pay && isShopWallet ? (
          <Invoices merchant={merchant} merchantPay={pay.merchantPay} invoices={invoices ? invoiceRows(invoices, logs ?? [], acks) : null} today={today} feeText={feeText} />
        ) : (
          <section className={`${card} scroll-mt-4`} aria-labelledby="invoices">
            <h2 id="invoices" className="text-base font-semibold text-ink">
              Invoices
            </h2>
            {pay ? (
              <p className="text-sm text-ink-muted leading-relaxed">
                In this test build, invoices go out from the demo shop&apos;s wallet only ({config.merchantName}, <span className="data font-mono text-ink">{shopWallet}</span>). To bill a
                customer from your own wallet, send them a{" "}
                <a href="/merchant/links" className="text-accent underline underline-offset-4">
                  payment link
                </a>
                .
              </p>
            ) : (
              <p className="text-sm text-ink-muted">Invoices aren&apos;t switched on for this server yet. Payment links work without them.</p>
            )}
          </section>
        )}

        {/* Latest Payments Table */}
        <section className="rounded-[16px] border border-hairline bg-surface shadow-card overflow-hidden" aria-labelledby="payments-heading">
          <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <h2 id="payments-heading" className="text-[16px] font-semibold text-ink">
              Latest payments
            </h2>
            <a href="/merchant/payments" className="text-xs font-medium text-accent underline underline-offset-4">
              View all ({payments.length}) ↗
            </a>
          </div>

          {payments.length === 0 ? (
            <p className="px-6 py-8 text-sm text-ink-muted">
              {isShopWallet
                ? "No payments recorded yet. Open a test checkout above and pay it to see settlement land here."
                : "No payments recorded yet. Create and pay your own payment link with test USDT to see it settle."}
            </p>
          ) : (
            <ul className="grid divide-y divide-hairline text-sm sm:table sm:w-full sm:divide-y-0 sm:border-collapse">
              <li className="hidden bg-surface-sunk text-ink-muted sm:table-row font-medium" aria-hidden="true">
                {["Transaction / Payment", "Amount", "Status", "Refund"].map((h, i) => (
                  <span key={h} className={`eyebrow sm:table-cell sm:px-6 sm:py-3 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </span>
                ))}
              </li>
              {payments.slice(0, 10).map(({ row, record }) => {
                const cell = refundCell(record);
                return (
                  <li key={row.key} className="grid grid-cols-2 items-center gap-x-4 gap-y-2 px-6 py-3.5 sm:table-row sm:border-t sm:border-hairline sm:hover:bg-surface-sunk/30 transition-colors">
                    <span className="col-span-2 sm:table-cell sm:px-6 sm:py-3 sm:align-middle">
                      {row.txHash ? (
                        <a className="data font-mono text-xs text-accent underline underline-offset-4 inline-flex items-center gap-1" href={`${EXPLORER}/tx/${row.txHash}`} target="_blank" rel="noreferrer">
                          {row.label} ↗
                        </a>
                      ) : (
                        <span className="data font-mono text-xs">{row.label}</span>
                      )}
                      <span className="data text-xs text-ink-muted"> · {istTime(row.paidAt)}</span>
                    </span>
                    <span className="tabular-nums font-semibold sm:table-cell sm:px-6 sm:py-3 sm:text-right sm:align-middle">
                      {formatUsdt(row.amount)} <span className="text-xs text-ink-muted font-normal sm:hidden">USDT</span>
                    </span>
                    <span className="text-right sm:table-cell sm:px-6 sm:py-3 sm:align-middle">
                      <StatusBadge status={cell.tone} label={cell.status} />
                    </span>
                    <span className="col-span-2 sm:table-cell sm:px-6 sm:py-3 sm:text-right sm:align-middle">
                      {pay && row.paymentId && cell.left !== null && cell.left > 0n ? (
                        <Refund key={`${row.paymentId}:${cell.left}`} merchant={merchant} merchantPay={pay.merchantPay} paymentId={row.paymentId} refundable={cell.left.toString()} />
                      ) : (
                        <span className="text-xs text-ink-muted">{cell.left === null ? "Checking status" : "Settled"}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Infrastructure & Gas Sponsorship Telemetry */}
        <section className={card} aria-labelledby="gas-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
            <h2 id="gas-heading" className="text-sm font-semibold text-ink">
              Sponsored Relayer &amp; Network Health
            </h2>
            <StatusBadge status={health && !health.paused ? "paid" : "warning"} label={health && !health.paused ? "Running" : "Standby"} />
          </div>
          <p className="text-xs text-ink-muted leading-relaxed">
            Customers pay zero network gas on Whitechain. The Whiteflow relayer sponsors transaction gas and deducts a transparent {feeText ? `${feeText} USDT` : "nominal"} fee upon settlement.
          </p>
          {health ? (
            <dl className="grid gap-2 text-xs md:grid-cols-4 md:gap-4 pt-1">
              {[
                ["Relayer balance", wbt(health.wbt)],
                ["Gas spent today", wbt(health.gasSpentToday)],
                ["Budget left today", wbt(health.budgetLeft)],
                ["Unswapped fees", health.usdtFeesUnswapped ? `${health.usdtFeesUnswapped} USDT` : "0.0000 USDT"],
              ].map(([term, value]) => (
                <div key={term} className="flex justify-between gap-3 border-t border-hairline pt-2 md:grid md:justify-start md:gap-0.5">
                  <dt className="text-ink-muted">{term}</dt>
                  <dd className="font-mono font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-warning">{pay ? "Relayer status check pending." : "Relayer not configured on this server."}</p>
          )}
        </section>

        <p className="text-xs text-ink-muted">
          All payments settle directly to your Whitechain receiving wallet in the settlement transaction (T+0). Whiteflow maintains non-custodial accounting; transaction amounts are customer payments, not a pooled custodial balance.
        </p>
      </div>
    </Shell>
  );
}
