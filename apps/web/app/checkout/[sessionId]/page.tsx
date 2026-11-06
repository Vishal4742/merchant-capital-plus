// Hosted checkout page (FR-PAY-5, FR-PAY-7). Server component: the amount and shop come from our session
// record, so this page makes no chain reads in the browser (FR-PRIV-1, SRS 1.1).
import { announcePaid } from "@/lib/announce-paid";
import { warmRelayer } from "@/lib/relay";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Checkout } from "@/components/Checkout";
import { StaticScene } from "@/components/StaticScene";
import { payConfig } from "@/lib/config";
import { amountDue } from "@/lib/server/vouchers";
import { getSession, type Session } from "@/lib/sessions";
import { gatewayCheckout, pageState, settlePending } from "@/lib/settle";
import { formatUsdt } from "@/lib/usdt";

// The night and the frame prerender; the session streams in (Cache Components needs params inside Suspense).
// Still scene only: no three.js and no Nym on the pay page (NFR-12 speed budget).
export default function CheckoutPage({ params }: PageProps<"/checkout/[sessionId]">) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-scene-night px-4 py-12 text-glass-ink">
      <StaticScene />
      <Suspense fallback={<p className="relative rounded-[28px] bg-surface px-8 py-6 text-ink-muted shadow-float">Opening checkout…</p>}>
        <CheckoutLoader params={params} />
      </Suspense>
    </main>
  );
}

/** The FX line, rendered here on the server (NFR-12): "20.00 EUR = 22.51 USDT · 1 USD = 0.88875 EUR, rate of 6 Nov 2026 ·
 *  1 USDT = 1 USD" (rounded up to the cent). The rate is `priced.rate`, units of the currency per 1 USD (quotes.ts). */
function fxLine(session: Session): string | null {
  const p = session.priced;
  if (!p) return null;
  const converted = `${formatUsdt(p.amount)} ${p.currency} = ${formatUsdt(session.amount)} USDT`;
  if (p.currency === "USD") return `${converted} · 1 USDT = 1 USD`;
  const day = new Date(`${p.rateDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${converted} · 1 USD = ${p.rate} ${p.currency}, rate of ${day} · 1 USDT = 1 USD`;
}

/** A link or page checkout's discount code (FR-GW-12): its total before a code and what is due now. Null for a shop's
 *  own checkout, and when the gateway database can't be read (no code field; the pay route refuses then too). */
async function codeTerms(session: Session): Promise<{ total: bigint; due: bigint } | null> {
  try {
    const checkout = await gatewayCheckout(session.id);
    return checkout && { total: checkout.usdtAmount, due: (await amountDue(session.id)) ?? checkout.usdtAmount };
  } catch (error) {
    console.error(`checkout ${session.id}: code read failed: ${error instanceof Error ? error.name : "error"}`);
    return null;
  }
}

async function CheckoutLoader({ params }: Pick<PageProps<"/checkout/[sessionId]">, "params">) {
  const { sessionId } = await params;
  await connection(); // the session and its code are read per request, never in a prerender pass
  const found = getSession(sessionId);
  if (!found) notFound();
  const pay = payConfig();
  // an earlier attempt with an unknown outcome: our server asks the chain (never the browser, FR-PRIV-1)
  const state = found.pending && pay ? await settlePending(found, pay.merchantPay) : null;
  const session = getSession(sessionId) ?? found;
  // paid: re-announce (idempotent), so a lost payment.succeeded or uncounted code recovers on a visit (G4 code M2);
  // open: warm the relayer this customer is about to use (claude-relayer 09:42)
  if (session.payment) announcePaid(session, session.payment.amount ?? session.amount);
  else warmRelayer(pay?.relayerUrl);
  const terms = await codeTerms(session);
  // paid: what was charged; open: what is due now (a code makes it less than the session's amount)
  const amount = session.payment?.amount ?? terms?.due ?? session.amount;
  return (
    <Checkout
      sessionId={session.id}
      merchantName={session.merchantName}
      reference={session.reference}
      // a priced checkout's items are in the shop's currency; the total is the USDT to pay
      items={session.items.map((item) => ({ name: item.name, qty: item.qty, price: session.priced ? `${formatUsdt(item.price)} ${session.priced.currency}` : formatUsdt(item.price) }))}
      amountText={formatUsdt(amount)}
      code={terms && { totalText: formatUsdt(terms.total), discountText: terms.due < terms.total ? formatUsdt(terms.total - terms.due) : null }}
      fxLine={fxLine(session)}
      returnUrl={session.returnUrl ?? null}
      sale={pay ? { merchantPay: pay.merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: amount.toString() } : null}
      expiresAt={session.expiresAt}
      paid={Boolean(session.payment)}
      // a payment being relayed right now may land: show "confirming", never "expired" (security review 004 R2 F1)
      pending={pageState(state ?? "open", session.id) === "pending"}
    />
  );
}
