// Hosted checkout page (FR-PAY-5, FR-PAY-7). Server component: the amount and shop come from our session
// record, so this page makes no chain reads in the browser (FR-PRIV-1, SRS 1.1).
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Checkout } from "@/components/Checkout";
import { StaticScene } from "@/components/StaticScene";
import { payConfig } from "@/lib/config";
import { getSession } from "@/lib/sessions";
import { settlePending } from "@/lib/settle";
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
      items={session.items.map((item) => ({ name: item.name, qty: item.qty, price: formatUsdt(item.price) }))}
      amountText={formatUsdt(session.amount)}
      sale={pay ? { merchantPay: pay.merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: session.amount.toString() } : null}
      expiresAt={session.expiresAt}
      paid={Boolean(session.payment)}
      pending={state === "pending"}
    />
  );
}
