// Hosted payment page (FR-GW-2, FR-PAY-7): the merchant's logo and colour (an accent only), fixed items with quantity
// fields or an open amount. Server component: the page comes from the gateway through our server (no browser chain
// reads, FR-PRIV-1), and the total for the chosen quantities is worked out here ("Update total" reloads it, no JS).
// The form posts to /p/{slug}/checkout, which answers 303 to the checkout. Still scene only (NFR-12).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HostedNotice, PageSheet } from "@/components/gateway/Hosted";
import { StaticScene } from "@/components/StaticScene";
import { GatewayError, SLUG, type PublicPage } from "@/lib/gateway-client";
import { amountText, checkoutMessage, pageQuantities, pageTotal } from "@/lib/gateway-forms";
import { gatewayFor } from "@/lib/gateway-server";

export default function HostedPage({ params, searchParams }: PageProps<"/p/[slug]">) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-scene-night px-4 py-12">
      <StaticScene />
      <Suspense fallback={<p className="relative rounded-[28px] bg-surface px-8 py-6 text-ink-muted shadow-float">Opening the page…</p>}>
        <PageLoader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function PageLoader({ params, searchParams }: PageProps<"/p/[slug]">) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  if (!SLUG.test(slug)) notFound();
  let page: PublicPage;
  try {
    page = await gatewayFor(await headers()).publicPage(slug);
  } catch (error) {
    if (error instanceof GatewayError && error.status === 404) notFound();
    return (
      <HostedNotice eyebrow="Payment page" title="We can't open this page right now" action={{ href: `/p/${slug}`, label: "Try again" }}>
        Nothing was charged. Try again in a minute.
      </HostedNotice>
    );
  }
  const query = new URLSearchParams(Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])));
  const chosen = page.items && pageQuantities(query, page.items);
  return (
    <PageSheet
      page={page}
      rows={chosen && chosen.map((item) => ({ name: item.name, priceText: amountText(item.price), qty: item.qty }))}
      totalText={chosen ? pageTotal(chosen) : ""}
      amount={query.get("amount")}
      error={checkoutMessage(query.get("error"))}
    />
  );
}
