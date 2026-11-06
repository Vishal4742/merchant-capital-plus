// Hosted checkout page (FR-PAY-5, FR-PAY-7). Server component: the amount and shop come from our session
// record, so this page makes no chain reads in the browser (FR-PRIV-1, SRS 1.1).
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Checkout } from "@/components/Checkout";
import { StaticScene } from "@/components/StaticScene";
import { payConfig } from "@/lib/config";
import { getSession, type Session } from "@/lib/sessions";
import { pageState, settlePending } from "@/lib/settle";
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

/** The FX line, rendered here on the server (NFR-12): "20.00 EUR = 22.50 USDT · rate of 5 Nov 2026 · 1 USDT = 1 USD". */
function fxLine(session: Session): string | null {
  const p = session.priced;
  if (!p) return null;
  const converted = `${formatUsdt(p.amount)} ${p.currency} = ${formatUsdt(session.amount)} USDT`;
  if (p.currency === "USD") return `${converted} · 1 USDT = 1 USD`;
  const day = new Date(`${p.rateDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${converted} · rate of ${day} · 1 USDT = 1 USD`;
}

async function CheckoutLoader({ params }: Pick<PageProps<"/checkout/[sessionId]">, "params">) {
  const { sessionId } = await params;
  const found = getSession(sessionId);
  if (!found) notFound();
  const pay = payConfig();
  // an earlier attempt with an unknown outcome: our server asks the chain (never the browser, FR-PRIV-1)
  const state = found.pending && pay ? await settlePending(found, pay.merchantPay) : null;
  const session = getSession(sessionId) ?? found;
  return (
    <Checkout
      sessionId={session.id}
      merchantName={session.merchantName}
      reference={session.reference}
      // a priced checkout's items are in the shop's currency; the total is the USDT to pay
      items={session.items.map((item) => ({ name: item.name, qty: item.qty, price: session.priced ? `${formatUsdt(item.price)} ${session.priced.currency}` : formatUsdt(item.price) }))}
      amountText={formatUsdt(session.amount)}
      fxLine={fxLine(session)}
      returnUrl={session.returnUrl ?? null}
      sale={pay ? { merchantPay: pay.merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: session.amount.toString() } : null}
      expiresAt={session.expiresAt}
      paid={Boolean(session.payment)}
      // a payment being relayed right now may land: show "confirming", never "expired" (security review 004 R2 F1)
      pending={pageState(state ?? "open", session.id) === "pending"}
    />
  );
}
