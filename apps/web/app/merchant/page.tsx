// Merchant dashboard home (FR-PAY-15, FR-REL-6, FR-PAY-1/2 invoices, FR-PAY-8 refunds) in the approved gateway v2
// design: the Shell, a night band, Get started (batch 024), six figures, the gross chart, quick actions, invoices,
// payments and the relayer. Any wallet can sign in; the demo shop's wallet also sees its invoices.
// Behind "Sign in with your wallet" (SIWE), for the signed-in wallet only, read on our server. Every figure comes from
// payments confirmed on chain; one we can't read shows "—", never a made-up number.
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
    // the sidebar paints at once, so switching to Home never drops the frame while its data streams in (NFR-13)
    <Suspense
      fallback={
        <Shell active="home">
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading the dashboard…</p>
        </Shell>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const card = "grid min-w-0 content-start gap-3 rounded-[20px] border border-hairline bg-surface p-5 md:px-6";
const istTime = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const istDate = (ms: number, options: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString("en-GB", { ...options, timeZone: "Asia/Kolkata" });

/** A relayer figure in WBT, 4 decimals (code review 004 R2 F6: every row has its unit), or "—". */
function wbt(value: string | null): string {
  const n = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? `${n.toFixed(4)} WBT` : "—";
}

function ackOf(acks: Map<string, InvoiceAck> | null, id: bigint) {
  const ack = acks?.get(id.toString());
  return ack ? ackView(ack) : null;
}

function invoiceRows(invoices: Invoice[], logs: PaidLog[], acks: Map<string, InvoiceAck> | null): InvoiceRow[] {
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
            ack: ackOf(acks, invoice.id),
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

interface Tile {
  label: string;
  value: string;
  sub: string;
  tone?: "up" | "down";
}

// a change of 0 is neither up nor down: no arrow and no colour (tester 006 follow-up)
const arrow = (n: number) => (n === 0 ? "0" : `${n > 0 ? "▲" : "▼"} ${Math.abs(n)}`);
const toneOf = (n: number | null): Tile["tone"] => (n === null || n === 0 ? undefined : n > 0 ? "up" : "down");

/** Everything on the home that depends on the clock, in one plain function (the render body never reads it). */
function home(payments: Confirmed[], fee: bigint | null, vouchers: Voucher[] | null) {
  const now = Date.now();
  const f = figures(payments, now);
  const vsYesterday = change(f.grossToday, f.grossYesterday);
  // before the first payment there is nothing to compare or refund: calm zeros with a hint, never "—" (batch 024)
  const none = payments.length === 0;
  const tiles: Tile[] = [
    { label: "Gross today", value: formatUsdt(f.grossToday), sub: vsYesterday === null ? "USDT, since midnight IST" : `${arrow(vsYesterday)}% vs yesterday`, tone: toneOf(vsYesterday) },
    none
      ? { label: "Payments", value: "0", sub: "Your first one shows here" }
      : { label: "Payments", value: String(f.countToday), sub: `${arrow(f.countToday - f.countYesterday)} vs yesterday`, tone: toneOf(f.countToday - f.countYesterday) },
    { label: "Fees", value: fee === null ? "—" : formatUsdt(fee * BigInt(f.countToday)), sub: fee === null ? "can't read the fee now" : `${formatUsdt(fee)} each, today` },
    none
      ? { label: "Refunds", value: formatUsdt(0n), sub: "None yet" }
      : { label: "Refunds", value: f.refunded === null ? "—" : formatUsdt(f.refunded), sub: `${f.refundedPayments} ${f.refundedPayments === 1 ? "payment" : "payments"}, all time` },
    { label: "Settled", value: "T+0", sub: "in the payment's transaction" },
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
    // taller on a phone, where the greeting takes two lines, with a lighter wash so the scene shows (UX review 006 F1)
    <div className="relative h-[180px] overflow-hidden bg-scene-night text-glass-ink md:h-[150px]">
      <StaticScene />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-scene-night/85 via-scene-night/30 via-50% to-transparent md:bg-linear-to-r md:from-scene-night md:from-10% md:via-scene-night/60 md:via-45% md:to-transparent md:to-80%"
      />
      <div className="absolute right-4 bottom-[18px] left-4 md:left-8">
        <p className="eyebrow opacity-75">
          {shop} · {when}
        </p>
        <h1 className="mt-1.5 text-[32px] leading-[1.05] font-medium tracking-[-0.035em] md:text-[40px]">
          Tonight at <span className="emphasis">{shop}.</span>
        </h1>
        {note && <p className="mt-1.5 text-sm opacity-80">{note}</p>}
      </div>
    </div>
  );
}

/** What Get started needs that the home doesn't already read: the merchant's links and keys (null: unreadable). */
async function setupFacts(merchant: Address) {
  const unread = (what: string) => (error: unknown) => {
    logFailure(`get started: ${what}`, error);
    return null;
  };
  const [links, keys] = await Promise.all([listLinks(merchant).catch(unread("links")), listKeys(merchant).catch(unread("keys"))]);
  const open = links?.find((link) => linkStatus(link) === "active");
  return { links: links?.length ?? null, keys: keys?.length ?? null, payHref: open ? `/l/${open.slug}` : null };
}

const action = "lift flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] border border-hairline px-4 py-3 text-left text-[15px]";

async function Dashboard() {
  await connection(); // live data on every request, never a build-time snapshot
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
  const shop = isShopWallet ? config.merchantName : "your shop";
  const { tiles, ranges, when, today } = home(payments, fee, await vouchers);
  // the owner may change relayFee (≤ 0.25 USDT): every fee the merchant reads comes from the chain (code review 005 F7)
  const feeText = fee === null ? null : formatUsdt(fee);
  const steps = setupSteps({ ...(await setup), payments: payments.length });
  const shopWallet = `${config.merchant.slice(0, 6)}…${config.merchant.slice(-4)}`;

  return (
    <Shell active="home" account={<Account merchant={merchant} />}>
      <Band shop={shop} when={when} note={payments.length === 0 ? "No sales yet. Your first one shows here the moment it's paid." : undefined} />
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-7">
        <GetStarted steps={steps} />

        <section aria-label="Today at a glance" className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6">
          {tiles.map((tile) => (
            <div key={tile.label} className="grid content-start gap-1.5 bg-surface p-4 md:p-[18px]">
              <h2 className="eyebrow text-ink-muted">{tile.label}</h2>
              <b className="text-[28px] leading-none font-medium tracking-[-0.03em] tabular-nums">
                <Reveal text={tile.value} />
              </b>
              <span className={`text-xs ${tile.tone === "up" ? "text-positive" : tile.tone === "down" ? "text-warning" : "text-ink-muted"}`}>{tile.sub}</span>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <GrossChart ranges={ranges} />
          <section aria-labelledby="quick" className={`${card} gap-3.5`}>
            <h2 id="quick" className="text-[15px] font-medium">
              Quick actions
            </h2>
            <ul className="grid gap-2.5">
              <li>
                <form method="post" action="/api/demo-checkout">
                  {/* the demo checkout is always the demo shop's: from another wallet it says so (batch 024) */}
                  <button type="submit" className={`${action} cursor-pointer hover:border-accent`}>
                    {isShopWallet ? "Open a test checkout" : "Try the demo shop's checkout"} <span className="eyebrow text-ink-muted">{isShopWallet ? "Test" : "Demo"}</span>
                  </button>
                </form>
              </li>
              {pay && isShopWallet && (
                <li>
                  <a href="#invoices" className={`${action} hover:border-accent`}>
                    Send an invoice <span className="eyebrow text-ink-muted">↓</span>
                  </a>
                </li>
              )}
              <li>
                <a href="/docs" className={`${action} hover:border-accent`}>
                  Add the gateway to your shop <span className="eyebrow text-ink-muted">Docs</span>
                </a>
              </li>
              <li>
                <a href="/merchant/links" className={`${action} hover:border-accent`}>
                  Create a payment link <span className="eyebrow text-ink-muted">Links</span>
                </a>
              </li>
              <li>
                <a href="/merchant/capital" className={`${action} hover:border-accent`}>
                  Get paid early <span className="eyebrow text-ink-muted">Capital</span>
                </a>
              </li>
            </ul>
          </section>
        </div>

        {pay && isShopWallet ? (
          <Invoices merchant={merchant} merchantPay={pay.merchantPay} invoices={invoices ? invoiceRows(invoices, logs ?? [], acks) : null} today={today} feeText={feeText} />
        ) : (
          // the menu's Invoices lands here too; /pay serves only the demo shop's invoices (human, 2026-11-06 02:3x)
          <section className={`${card} scroll-mt-4`} aria-labelledby="invoices">
            <h2 id="invoices" className="label text-ink-muted">
              Invoices
            </h2>
            {pay ? (
              <p className="text-sm text-ink-muted">
                In this test build, invoices go out from the demo shop&apos;s wallet only ({config.merchantName}, <span className="data">{shopWallet}</span>). To bill a
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

        <section className="rounded-[20px] border border-hairline bg-surface" aria-labelledby="payments">
          <h2 id="payments" className="scroll-mt-4 px-6 pt-5 text-[15px] font-medium">
            Latest payments
          </h2>
          {payments.length === 0 ? (
            <p className="px-6 pt-3 pb-6 text-sm text-ink-muted">
              {isShopWallet
                ? "No payments yet. Open a test checkout above and pay it to see one land here."
                : "No payments yet. Pay your own payment link with test USDT and it lands here."}
            </p>
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
                      <span className="data text-ink-muted"> · {istTime(row.paidAt)}</span>
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

        <section className={card} aria-labelledby="gas">
          <h2 id="gas" className="label text-ink-muted">
            Who pays gas
          </h2>
          <p className="text-sm text-ink-muted">Your customers never hold or pay for gas. Our relayer pays it and recovers {feeText ? `${feeText} USDT` : "a small fee"} per payment.</p>
          {health ? (
            <dl className="grid gap-2 text-sm md:grid-cols-5 md:gap-6">
              {[
                ["Relayer balance", wbt(health.wbt)],
                ["Gas spent today", wbt(health.gasSpentToday)],
                ["Budget left today", wbt(health.budgetLeft)],
                ["Fees not yet swapped", health.usdtFeesUnswapped ? `${health.usdtFeesUnswapped} USDT` : "—"],
              ].map(([term, value]) => (
                <div key={term} className="flex justify-between gap-3 border-t border-hairline pt-2 md:grid md:justify-start md:gap-1">
                  <dt>{term}</dt>
                  <dd className="data">{value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-hairline pt-2 md:grid md:justify-start md:gap-1">
                <dt>Status</dt>
                <dd className={health.paused ? "text-warning" : "text-positive"}>{health.paused ? "Paused" : "Running"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-warning">{pay ? "The relayer isn't answering right now." : "The relayer isn't connected to this server yet."}</p>
          )}
        </section>
        <p className="text-xs text-ink-muted">
          Amounts are what customers paid. A sale&apos;s {feeText ? `${feeText} USDT ` : ""}gas fee comes out of it; an invoice&apos;s is added on top. The rest goes to your wallet in the same
          transaction, or first to your investors while you repay an advance. Refunds come from your wallet, in full or in part.
        </p>
      </div>
    </Shell>
  );
}
